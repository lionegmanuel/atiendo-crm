import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GOV_MANAGER, GOV_ORG, GOV_VIEWER, seedGov } from "./gov-helpers";

/**
 * A COR DA ETIQUETA (issue #1271, fatia S6 da #852) — medida no Postgres, não
 * lida no texto.
 *
 * O que este arquivo existe para provar, e por que cada caso é o que é:
 *
 *  1. **A cor persiste e VOLTA pela leitura.** Gravar e não devolver deixaria a
 *     tela salvando cor nenhuma com o banco "certo": a leitura é a mesma função
 *     que o painel chama ao abrir a página.
 *  2. **Hex inválido não escreve NADA.** A validação da rota (`lib/schemas/tags`)
 *     cobre o caminho da tela; a função é `security definer` e alcançável por
 *     RPC, então a segunda camada precisa ter dente própria. "Não escreveu" se
 *     mede comparando o `settings` ANTES e DEPOIS — erro sem escrita é o que
 *     separa uma recusa de uma escrita parcial.
 *  3. **`viewer` é recusado antes de qualquer escrita** — o portão de papel vale
 *     para a ação nova também.
 *  4. **A cor de uma organização não aparece na outra.** A ação mexe em
 *     `organizations.settings`, que é a tabela do TENANT: um `where` esquecido
 *     aqui pintaria a etiqueta de todo mundo.
 *  5. **`null` limpa**, e a etiqueta continua no vocabulário (limpar cor não é
 *     excluir etiqueta).
 *  6. **Dar cor é curar**: a etiqueta que só existia em uso ganha entrada no
 *     vocabulário curado, e a leitura passa a devolvê-la como `no_vocabulario`.
 *
 * Mesmo harness do arquivo irmão (`tests/invariants/tags-vocabulario.test.ts`):
 * a função é chamada com a SESSÃO do usuário, nunca como `postgres`, porque
 * medir definer como superusuário não provaria nada sobre papel.
 */

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 5,
});

const ORG_B = "cccccccc-0000-4000-8000-0000000000b6";

beforeAll(() => {
  seedGov();
});

afterAll(() => pool.end());

async function actor(user: string | null, sql: string, args: unknown[] = []) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(user ? "set local role authenticated" : "set local role anon");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: user, role: user ? "authenticated" : "anon", aal: "aal2" }),
    ]);
    const r = await client.query(sql, args);
    await client.query("commit");
    return r;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

function operar(org: string, acao: string, tag: string, destino: string | null, cor: string | null) {
  return actor(
    GOV_MANAGER,
    "select public.fn_vocabulario_de_tags_operar($1,$2,$3,$4,$5) as r",
    [org, acao, tag, destino, cor],
  );
}

/** O vocabulário curado da organização, como está gravado. */
async function vocabulario(org: string): Promise<{ tag: string; cor?: string }[]> {
  const r = await pool.query("select settings -> 'tags' as tags from public.organizations where id = $1", [org]);
  return (r.rows[0]?.tags ?? []) as { tag: string; cor?: string }[];
}

async function limparVocabulario(org: string) {
  await pool.query(
    "update public.organizations set settings = coalesce(settings, '{}'::jsonb) - 'tags' where id = $1",
    [org],
  );
}

/** A leitura que o painel usa, com a sessão do gerente.
 *
 * ⚠️ `select * from fn(...)`, e não `select fn(...) as t`: a função devolve
 * `returns table (...)`, e uma SRF no alvo do SELECT vira UMA coluna com o
 * composto — não uma linha por etiqueta. Medido: com o alias, `linha.t` chegava
 * como o texto `(vip,0,0,0,0,,t)` e todo `find` por tag dava `undefined`.
 */
async function ler(org: string) {
  const r = await actor(GOV_MANAGER, "select * from public.fn_vocabulario_de_tags($1)", [org]);
  return r.rows as { tag: string; cor: string | null; no_vocabulario: boolean }[];
}

describe("fatia S6 — a cor da etiqueta", () => {
  it("a cor é gravada no vocabulário e VOLTA pela leitura, com o nome que estava lá", async () => {
    await limparVocabulario(GOV_ORG);
    await pool.query(
      "insert into public.contacts(id,organization_id,name,display_name,tags) values($1,$2,'Da cor','Da cor',array['reclamacao']) on conflict (id) do update set tags = array['reclamacao']",
      ["cccccccc-4444-4000-8000-0000000000c6", GOV_ORG],
    );

    const r = await operar(GOV_ORG, "definir_cor", "reclamacao", null, "#e54d2e");
    expect((r.rows[0].r as { alterou: boolean }).alterou).toBe(true);
    // A ação NÃO toca linha nenhuma: os laços saem antes, e os contadores vêm zerados.
    const contadores = r.rows[0].r as { contatos: number; leads: number; conversas: number; cor: string };
    expect([contadores.contatos, contadores.leads, contadores.conversas]).toEqual([0, 0, 0]);
    expect(contadores.cor).toBe("#e54d2e");

    expect(await vocabulario(GOV_ORG)).toEqual([{ tag: "reclamacao", cor: "#e54d2e" }]);

    const linha = (await ler(GOV_ORG)).find((l) => l.tag === "reclamacao");
    expect(linha?.cor).toBe("#e54d2e");
    // Dar cor é CURAR: a etiqueta que só existia em uso entra no vocabulário.
    expect(linha?.no_vocabulario).toBe(true);
  });

  it("hex inválido é recusado (22023) e NÃO escreve nada", async () => {
    await limparVocabulario(GOV_ORG);
    await operar(GOV_ORG, "definir_cor", "vip", null, "#0091ff");
    const antes = await vocabulario(GOV_ORG);

    for (const ruim of ["nome-verde", "#12345", "#zzzzzz", "#0091ff;"]) {
      await expect(operar(GOV_ORG, "definir_cor", "vip", null, ruim)).rejects.toThrow(/cor_invalida/);
      // "Não escreveu" é o que separa recusa de escrita parcial.
      expect(await vocabulario(GOV_ORG)).toEqual(antes);
    }

    // A ação fora da lista continua recusada — o `not in` cresceu, não afrouxou.
    await expect(operar(GOV_ORG, "pintar", "vip", null, "#0091ff")).rejects.toThrow(/acao_invalida/);
  });

  it("'sem cor' é `cor null`: limpa a cor e MANTÉM a etiqueta no vocabulário", async () => {
    await limparVocabulario(GOV_ORG);
    await operar(GOV_ORG, "definir_cor", "obra", null, "#12a594");
    expect(await vocabulario(GOV_ORG)).toEqual([{ tag: "obra", cor: "#12a594" }]);

    const r = await operar(GOV_ORG, "definir_cor", "obra", null, null);
    expect((r.rows[0].r as { cor: string | null }).cor).toBeNull();
    // A entrada continua lá (sem a chave `cor`): limpar cor não é excluir etiqueta
    // — isso é a ação `excluir`, que tira a etiqueta dos registros.
    const depois = await vocabulario(GOV_ORG);
    expect(depois).toEqual([{ tag: "obra" }]);
    expect((await ler(GOV_ORG)).find((l) => l.tag === "obra")?.cor).toBeNull();
  });

  it("viewer é recusado antes de qualquer escrita", async () => {
    await limparVocabulario(GOV_ORG);
    await expect(
      actor(GOV_VIEWER, "select public.fn_vocabulario_de_tags_operar($1,$2,$3,$4,$5)", [
        GOV_ORG,
        "definir_cor",
        "vip",
        null,
        "#0091ff",
      ]),
    ).rejects.toThrow(/insufficient_role/);
    expect(await vocabulario(GOV_ORG)).toEqual([]);
  });

  it("a cor de uma organização não aparece na outra", async () => {
    await limparVocabulario(GOV_ORG);
    await pool.query(
      "insert into public.organizations(id,slug,legal_name,display_name) values($1,'s6-org-b','S6 B','S6 B') on conflict do nothing",
      [ORG_B],
    );
    await limparVocabulario(ORG_B);
    await pool.query(
      "insert into public.contacts(id,organization_id,name,display_name,tags) values($1,$2,'Do B','Do B',array['reclamacao']) on conflict (id) do update set tags = array['reclamacao']",
      ["cccccccc-4444-4000-8000-0000000000b6", ORG_B],
    );

    await operar(GOV_ORG, "definir_cor", "reclamacao", null, "#e54d2e");

    expect(await vocabulario(GOV_ORG)).toEqual([{ tag: "reclamacao", cor: "#e54d2e" }]);
    // O `where o.id = p_org` da função é o que separa os tenants: pedir a
    // organização de outro (mesmo sendo gerente da SUA) não devolve nada — a
    // leitura é `security invoker` e a RLS de `organizations` recorta junto.
    expect(await vocabulario(ORG_B)).toEqual([]);
    expect(await ler(ORG_B)).toEqual([]);
  });

  it("renomear PRESERVA a cor escolhida", async () => {
    // O `jsonb_set` do rename mexe só em `{tag}` desde a 0264, e a cor mora no
    // mesmo objeto: um `to_jsonb(v_destino)` no lugar do `jsonb_set` apagaria o
    // metadado em silêncio — a etiqueta voltaria cinza depois de arrumada.
    await limparVocabulario(GOV_ORG);
    await operar(GOV_ORG, "definir_cor", "promo", null, "#ab4aba");
    await operar(GOV_ORG, "renomear", "promo", "Promoção", null);

    expect(await vocabulario(GOV_ORG)).toEqual([{ tag: "Promoção", cor: "#ab4aba" }]);
  });

  it("redar a mesma cor não reporta alteração", async () => {
    // Idempotência medida no retorno, não no "não deu erro": a tela usa
    // `alterou` para dizer se algo mudou.
    await limparVocabulario(GOV_ORG);
    await operar(GOV_ORG, "definir_cor", "frio", null, "#6f6f6f");
    const r = await operar(GOV_ORG, "definir_cor", "frio", null, "#6f6f6f");
    expect((r.rows[0].r as { alterou: boolean }).alterou).toBe(false);
  });

  it("`settings.tags` malformado (escalar) não derruba a operação — e a escrita conserta o dado", async () => {
    // `settings` é jsonb livre: nada no banco impede um `tags` que não é lista.
    // A LEITURA já tolerava (`case when jsonb_typeof(...) = 'array'`); a ESCRITA
    // não — o `jsonb_array_elements` levantava `cannot extract elements from a
    // scalar` e derrubava a TELA INTEIRA (renomear E cor) numa organização que
    // só tinha o campo torto. A recusa é medida pela MENSAGEM, porque o defeito
    // era erro genérico de runtime, não regra de negócio: nada a renomear é
    // vocabulário vazio, e vocabulário vazio tem resposta própria.
    await limparVocabulario(GOV_ORG);
    await pool.query(
      "update public.organizations set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{tags}', '\"vip\"'::jsonb) where id = $1",
      [GOV_ORG],
    );

    const erroDoRenomear = await operar(GOV_ORG, "renomear", "vip", "vip2", null)
      .then(() => null)
      .catch((e: Error) => e.message);
    expect(erroDoRenomear ?? "").not.toMatch(/cannot extract elements from a scalar/);

    // e a cor, que também passa pelo mesmo `v_antes`, funciona e CONSERTA:
    // o vocabulário sai daqui como lista de verdade, com a entrada nova.
    const r = await operar(GOV_ORG, "definir_cor", "reclamacao", null, "#e54d2e");
    // O contrato da função é `alterou` (não existe `ok` no retorno — a tela usa
    // `alterou` para dizer se algo mudou). Aqui o `true` também prova que a
    // guarda não só evitou o erro: a escrita ACONTECEU e consertou o dado.
    expect((r.rows[0].r as { alterou: boolean }).alterou).toBe(true);
    expect(await vocabulario(GOV_ORG)).toEqual([{ tag: "reclamacao", cor: "#e54d2e" }]);
  });

  it("existe UMA assinatura só da função — a antiga fica para trás", async () => {
    // O motivo declarado da PR: com DUAS sobrecargas no catálogo, o PostgREST
    // resolve a chamada pela assinatura ANTIGA (4 argumentos, sem `p_cor`) e a
    // cor nunca chega ao banco — a tela diz "salvo" e a etiqueta continua cinza.
    // O teste mede o catálogo, não o caminho feliz: `install` (baseline) e
    // `update` (migrations) precisam chegar no mesmo estado.
    const r = await pool.query(
      "select p.oid::regprocedure::text as assinatura from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'fn_vocabulario_de_tags_operar'",
    );
    const assinaturas = r.rows.map((x: { assinatura: string }) => x.assinatura);
    expect(assinaturas).toHaveLength(1);
    // `oid::regprocedure::text` escreve SEM espaço depois da vírgula:
    // `fn_vocabulario_de_tags_operar(uuid,text,text,text,text)`.
    expect(assinaturas[0]).toMatch(/\(uuid,\s*text,\s*text,\s*text,\s*text\)$/);
  });
});
