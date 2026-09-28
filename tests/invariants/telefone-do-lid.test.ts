import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * O TELEFONE DO CONTATO @lid (migration 0122).
 *
 * ═══ O QUE ESTAVA ERRADO ═══
 *
 * 22 de 31 contatos ativos da produção sem telefone, todos com identidade
 * `lid:`. A explicação corrente — "@lid é opaco por privacidade, o número não
 * vem" — era falsa: `_data.key.remoteJidAlt` traz o telefone em **76 de 76**
 * payloads @lid medidos em `webhook_events_log`. Ninguém lia.
 *
 * ═══ POR QUE O CONSERTO NÃO É "GRAVAR O TELEFONE" ═══
 *
 * `wa_identity` é GERADA com o telefone na frente do lid. Preencher
 * `phone_number` num contato nascido `lid` muda a identidade de `lid:X` para
 * `phone:+Y`; o `on conflict` do upsert casava por ela, então o próximo webhook
 * com o MESMO `@lid` não reencontrava o contato e **criava um segundo** — o
 * defeito que a migration 0027 existiu para matar.
 *
 * Daí `wa_lid`: correlação do WhatsApp que não depende do telefone.
 *
 * Congela: (1) a coluna deriva e normaliza; (2) reencontro por lid DEPOIS de o
 * contato ganhar telefone — o caso que duplicava; (3) reencontro por telefone,
 * que funde quem já existia por número em vez de criar gêmeo; (4) "completa o
 * que falta, nunca sobrescreve"; (5) o backfill do rótulo legado não toca
 * contato anonimizado.
 */
const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 3,
});


/**
 * O backfill do rótulo legado, LIDO DO BASELINE — não copiado para cá.
 *
 * A primeira versão deste teste tinha o `update` escrito à mão dentro do caso.
 * Ele passava, e continuou passando quando eu SABOTEI a guarda
 * `and is_anonymized = false` no `baseline.sql`: o teste exercitava a própria
 * cópia, não o artefato que o self-hoster aplica. Zero reprovações onde eu
 * previa uma — foi assim que o furo apareceu.
 *
 * Agora o comando é extraído do arquivo. Mexer no baseline mexe no que este
 * teste roda; divergir passa a ser impossível em vez de improvável.
 */
function backfillDoBaseline(): string {
  const sql = fs.readFileSync(path.join(process.cwd(), "supabase/baseline.sql"), "utf8");
  const alvo = /update public\.contacts\s+set display_name = null[\s\S]*?;/g;
  const achados = sql.match(alvo);
  if (!achados || achados.length !== 1) {
    throw new Error(
      `esperava EXATAMENTE 1 backfill de display_name no baseline, achei ${achados?.length ?? 0} — ` +
        "o teste perdeu o alvo e mediria o vazio",
    );
  }
  return achados[0]!;
}

const ORG = "11d7e100-0000-4000-8000-000000000001";

interface Contato {
  id: string;
  phone_number: string | null;
  display_name: string | null;
  wa_identity: string | null;
  wa_lid: string | null;
}

async function upsert(args: {
  kind: "phone" | "lid";
  phone?: string | null;
  lid?: string | null;
  chatId: string;
  notify?: string | null;
  phoneAlt?: string | null;
}): Promise<string> {
  // 6 parâmetros: quem decide QUAL telefone mandar é o chamador
  // (`lib/waha/ingest.ts`), exatamente como em produção. `phoneAlt` aqui simula
  // o telefone que veio de `_data.key.remoteJidAlt` e entra no MESMO `p_phone`.
  const { rows } = await pool.query<{ fn_upsert_wa_contact: string }>(
    "select public.fn_upsert_wa_contact($1, $2, $3, $4, $5, $6)",
    [ORG, args.kind, args.phone ?? args.phoneAlt ?? null, args.lid ?? null, args.chatId, args.notify ?? null],
  );
  return rows[0]!.fn_upsert_wa_contact;
}

async function ler(id: string): Promise<Contato> {
  const { rows } = await pool.query<Contato>(
    "select id, phone_number, display_name, wa_identity, wa_lid from contacts where id = $1",
    [id],
  );
  return rows[0]!;
}

async function quantosContatos(): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    "select count(*) as n from contacts where organization_id = $1 and is_merged_into is null",
    [ORG],
  );
  return Number(rows[0]!.n);
}

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, 'org-telefone-lid', 'Lid LTDA', 'Lid') on conflict (id) do nothing`,
    [ORG],
  );
});

afterAll(async () => {
  await pool.query("delete from organizations where id = $1", [ORG]);
  await pool.end();
});

describe("wa_lid — a correlação que sobrevive ao telefone", () => {
  it("é derivada do metadata e normaliza o sufixo @lid", async () => {
    const id = await upsert({ kind: "lid", lid: "100000000000001@lid", chatId: "100000000000001@lid", notify: "Com Sufixo" });
    const c = await ler(id);
    // O WAHA manda `waha_lid` ora com sufixo, ora sem (medido na produção: as
    // duas formas convivem). A coluna precisa devolver a MESMA chave nos dois.
    expect(c.wa_lid).toBe("100000000000001");
  });

  it("contato sem lid tem wa_lid NULO, não string vazia", async () => {
    // String vazia colidiria no índice único `(organization_id, wa_lid)`: TODO
    // contato sem lid seria "o mesmo contato", e o segundo import quebraria.
    const id = await upsert({ kind: "phone", phone: "+5531900000001", chatId: "5531900000001@c.us", notify: "Só Telefone" });
    const c = await ler(id);
    expect(c.wa_lid).toBeNull();
    expect(c.wa_identity).toBe("phone:+5531900000001");
  });
});

describe("o reencontro — o defeito que duplicava contato", () => {
  it("o MESMO @lid reencontra o contato depois de ele ganhar telefone", async () => {
    const lid = "100000000000005";
    const antes = await quantosContatos();

    // 1ª mensagem: só o lid (o WAHA às vezes manda o ack sem `_data`).
    const primeiro = await upsert({ kind: "lid", lid, chatId: `${lid}@lid`, notify: "Reencontro Silva" });
    expect((await ler(primeiro)).phone_number).toBeNull();

    // 2ª mensagem: agora com `_data.key.remoteJidAlt`.
    const segundo = await upsert({ kind: "lid", lid, chatId: `${lid}@lid`, phoneAlt: "+5531988887777" });
    expect(segundo, "tem de ser o MESMO contato").toBe(primeiro);
    expect((await ler(primeiro)).phone_number).toBe("+5531988887777");

    // 3ª mensagem: o telefone já está gravado, então `wa_identity` virou
    // `phone:` — e é AQUI que a versão antiga criava o segundo contato, porque
    // o `on conflict` casava por `wa_identity` e `lid:X` já não existia.
    const terceiro = await upsert({ kind: "lid", lid, chatId: `${lid}@lid` });
    expect(terceiro, "o @lid tem de reencontrar o contato que já tem telefone").toBe(primeiro);

    expect(await quantosContatos(), "três mensagens, UM contato").toBe(antes + 1);
  });

  it("quem já existia por TELEFONE não vira um segundo contato ao escrever no WhatsApp", async () => {
    // O caso do cliente importado de planilha, ou vindo de um pedido: ele já
    // está no CRM com número. Sem este reencontro, descobrir o telefone criaria
    // exatamente o gêmeo que a mudança quer evitar.
    const antes = await quantosContatos();
    const { rows } = await pool.query<{ id: string }>(
      `insert into contacts (organization_id, display_name, phone_number, source)
       values ($1, 'Veio da Planilha', '+5531977776666', 'manual') returning id`,
      [ORG],
    );
    const existente = rows[0]!.id;

    const doWhats = await upsert({
      kind: "lid",
      lid: "100000000000006",
      chatId: "100000000000006@lid",
      notify: "Planilha no Whats",
      phoneAlt: "+5531977776666",
    });

    expect(doWhats, "tem de reaproveitar o contato que já existia").toBe(existente);
    expect(await quantosContatos(), "não pode nascer um gêmeo").toBe(antes + 1);

    const c = await ler(existente);
    expect(c.wa_lid, "e passa a ser alcançável pelo lid também").toBe("100000000000006");
  });
});

describe("completa o que falta, nunca sobrescreve", () => {
  it("o nome que já existe vence o pushName do WhatsApp", async () => {
    // Assimetria deliberada: um atendente corrigiu o nome à mão; o WhatsApp
    // manda o pushName que a própria pessoa escolheu, que pode ser um apelido.
    // O que já está lá vence — mesma regra do `coalesce` da versão anterior.
    const lid = "100000000000002";
    const id = await upsert({ kind: "lid", lid, chatId: `${lid}@lid`, notify: "Nome Original" });
    await pool.query("update contacts set display_name = 'Nome Corrigido à Mão' where id = $1", [id]);

    await upsert({ kind: "lid", lid, chatId: `${lid}@lid`, notify: "Apelido do Zap" });
    expect((await ler(id)).display_name).toBe("Nome Corrigido à Mão");
  });

  it("o nome VAZIO é preenchido — o congelamento antigo prendia o contato anônimo para sempre", async () => {
    // A versão anterior fazia `coalesce(existente, novo)` mas nunca chegava a
    // gravar telefone nem metadata no conflito. Um contato que nasceu sem nome
    // (payload sem `_data`) ficava anônimo mesmo depois de dez mensagens COM
    // nome. Esta é a metade boa do coalesce, agora exercida.
    const lid = "100000000000003";
    const id = await upsert({ kind: "lid", lid, chatId: `${lid}@lid` });
    expect((await ler(id)).display_name).toBeNull();

    await upsert({ kind: "lid", lid, chatId: `${lid}@lid`, notify: "Apareceu o Nome" });
    expect((await ler(id)).display_name).toBe("Apareceu o Nome");
  });

  it("o telefone que já existe não é trocado por outro que chegue depois", async () => {
    const lid = "100000000000004";
    const id = await upsert({ kind: "lid", lid, chatId: `${lid}@lid`, phoneAlt: "+5531911112222" });
    await upsert({ kind: "lid", lid, chatId: `${lid}@lid`, phoneAlt: "+5531933334444" });
    // Trocar o número de um contato por causa de um payload seria mudar para
    // ONDE a mensagem vai — decisão que não pode vir de dado externo em silêncio.
    expect((await ler(id)).phone_number).toBe("+5531911112222");
  });
});

describe("o rótulo técnico legado", () => {
  it("a guarda `is_anonymized` protege SOZINHA — medido, não presumido", async () => {
    // ⚠️ Este caso existe porque a primeira versão do teste creditava a proteção
    // ao mecanismo ERRADO. Ele usava `Contato Anonimizado #<hex>` (o que a rota
    // de LGPD grava) e passava mesmo com `and is_anonymized = false` SABOTADO —
    // porque esse nome não casa com o regex ancorado em dígitos. Zero
    // reprovações onde eu previa uma.
    //
    // São DOIS mecanismos, e o regex sozinho já cobre o rótulo de hoje. A guarda
    // é a segunda camada: ela vale para o clone cujo contato foi anonimizado com
    // o nome técnico ainda no lugar (anonimização feita no banco, versão antiga,
    // ou um rótulo de LGPD diferente amanhã).
    //
    // Para medir SÓ a guarda, o nome abaixo casa o regex E o contato está
    // anonimizado: se a guarda cair, o `display_name` vai a null e a
    // anonimização é revertida — violação de L-04, cuja exceção é "Nenhuma".
    const { rows } = await pool.query<{ id: string }>(
      `insert into contacts (organization_id, display_name, source, is_anonymized, anonymized_at)
       values ($1, 'Contato 777777', 'whatsapp', true, now()) returning id`,
      [ORG],
    );
    await pool.query(backfillDoBaseline());
    expect(
      (await ler(rows[0]!.id)).display_name,
      "contato ANONIMIZADO não pode ser tocado pelo backfill, mesmo casando o regex",
    ).toBe("Contato 777777");
  });

  it("o backfill do baseline NÃO desfaz anonimização", async () => {
    // `Contato Anonimizado #<id>` também começa com "Contato " e é gravado
    // DELIBERADAMENTE pela rota de LGPD. Um backfill com `~ '^Contato '` sem a
    // guarda de `is_anonymized` reverteria o direito do titular — a regra L-04,
    // cuja exceção é "Nenhuma".
    const { rows } = await pool.query<{ id: string }>(
      `insert into contacts (organization_id, display_name, source, is_anonymized, anonymized_at)
       values ($1, 'Contato Anonimizado #abcd1234', 'whatsapp', true, now()) returning id`,
      [ORG],
    );
    const anonimo = rows[0]!.id;
    const { rows: r2 } = await pool.query<{ id: string }>(
      `insert into contacts (organization_id, display_name, source, source_metadata)
       values ($1, 'Contato 543134@lid', 'whatsapp', '{"waha_lid":"100016970543134"}'::jsonb) returning id`,
      [ORG],
    );
    const legado = r2[0]!.id;

    await pool.query(backfillDoBaseline());

    expect((await ler(legado)).display_name, "o rótulo técnico sai").toBeNull();
    expect(
      (await ler(anonimo)).display_name,
      "o rótulo de anonimização FICA — reverter seria violar a LGPD",
    ).toBe("Contato Anonimizado #abcd1234");
  });

  it("nome legítimo que começa com 'Contato' não é apagado", async () => {
    // O regex exige dígitos até o fim: `Contato 543134` e `Contato 543134@lid`
    // saem, "Contato Comercial da Loja X" fica. Sem a âncora, o backfill comeria
    // nome de gente.
    const { rows } = await pool.query<{ id: string }>(
      `insert into contacts (organization_id, display_name, source)
       values ($1, 'Contato Comercial da Loja', 'manual') returning id`,
      [ORG],
    );
    await pool.query(backfillDoBaseline());
    expect((await ler(rows[0]!.id)).display_name).toBe("Contato Comercial da Loja");
  });
});
