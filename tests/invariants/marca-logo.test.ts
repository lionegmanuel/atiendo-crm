import { beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";
import { motivoDoErro } from "./psql-transporte";

/**
 * O LOGO NO STORAGE — E AS TRÊS PROPRIEDADES QUE SÓ O BANCO PODE TESTEMUNHAR.
 *
 * ## 1. O bucket público é UM, e é este
 *
 * `brand-logos` é o primeiro bucket `public = true` do repositório: os quatro que
 * já existiam (`ai-policy`, `lgpd-exports`, `skill-assets`, `whatsapp-media`)
 * nascem privados, e um deles guarda a mídia das conversas de todos os clientes.
 * A exceção tem razão medida (o logo é renderizado num `<img>` da tela de login,
 * onde não há sessão para assinar URL, e URL assinada VENCE — a marca sumiria da
 * fachada sozinha). O que este arquivo faz é o que documentar não faz: transformar
 * "é a única exceção" numa afirmação que reprova quando deixa de ser verdade.
 *
 * ## 2. O prefixo asseverado DENTRO da função
 *
 * O ataque, medido no desenho: o logo da plataforma é público e a URL dele está
 * no HTML da tela de login, de onde qualquer pessoa a lê. Um admin de tenant que
 * gravasse `platform/<uuid>.png` como o logo da organização dele faria a rota —
 * que roda como `service_role` e ignora RLS — apagar o logo da instalação inteira
 * na troca seguinte. O TypeScript já recusa isso (`podeApagar`), mas "a rota monta
 * o caminho certo" é promessa de UM chamador; a regra tem de estar onde o segundo
 * chamador também esbarre nela.
 *
 * ## 3. O forward-fix da 0157
 *
 * `fn_definir_marca_da_organizacao` faz `jsonb_set(settings, '{branding}', p_marca)`
 * — substitui o objeto INTEIRO. Sem o forward-fix, salvar o nome pela tela apaga o
 * logo, em silêncio, com a tela dizendo "salvo". É a classe de defeito mais cara
 * deste épico porque não tem sintoma nenhum na hora.
 *
 * ## Por que a prova é aqui, e não no `typecheck`
 *
 * `lib/supabase/admin.ts` devolve `SupabaseClient` **sem** o genérico `<Database>`:
 * nome errado de RPC, de argumento ou de chave jsonb compila igual e só aparece em
 * runtime. Controle desta afirmação: `platform_branding` tem 0 ocorrências em
 * `lib/database.types.ts` e o produto inteiro compila lendo aquela tabela.
 *
 * ## Organização e usuários DEDICADOS
 *
 * O banco do `test:db` é compartilhado entre os arquivos da suíte
 * (`fileParallelism: false`), e `settings` é lido pela RLS de outros arquivos
 * (`visibility_mode`). Uma organização própria é o que impede um caso que falhe no
 * meio de sujar o fixture de quem rodar depois.
 */

/** Namespace próprio (`10c0` = logo, `0158` = a migration). Sem colisão medida. */
const LOGO_ORG = "10c00158-0000-4000-8000-000000000001";
const LOGO_ORG_VIZINHA = "10c00158-0000-4000-8000-000000000002";
const LOGO_ADMIN = "10c00158-1111-4000-8000-000000000001";
const LOGO_VIEWER = "10c00158-1111-4000-8000-000000000002";
/** Admin da VIZINHA, e de mais nenhuma — o ator cross-tenant. */
const LOGO_ESTRANHO = "10c00158-1111-4000-8000-000000000003";
/** Super-admin de plataforma, membro de organização nenhuma. */
const LOGO_PLATFORM = "10c00158-1111-4000-8000-000000000004";

const FN_LOGO = "public.fn_definir_logo_da_organizacao(uuid,uuid,text)";
const FN_MARCA = "public.fn_definir_marca_da_organizacao(uuid,uuid,jsonb)";

/** Um nome de arquivo na forma que a rota gera. */
const NOME = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png";
const CAMINHO_DA_ORG = `${LOGO_ORG}/${NOME}`;
const CAMINHO_DA_PLATAFORMA = `platform/${NOME}`;

/**
 * O `settings` de partida. As três chaves não são decorativas: `visibility_mode`
 * é a que a RLS lê e a que um merge raso apagaria; `routing` e `llm` são objetos
 * ANINHADOS, e um `settings || novo` (raso) só é distinguível de `jsonb_set`
 * quando há aninhamento para achatar.
 */
const SETTINGS_BASE =
  '{"visibility_mode":"own","routing":{"mode":"round_robin"},"llm":{"provider":"anthropic"}}';

function semear(): void {
  sql(`update public.organizations set settings = '${SETTINGS_BASE}'::jsonb where id = '${LOGO_ORG}';`);
}

function caminho(org: string, path: string): string {
  return lastLine(
    sql(`select coalesce(settings #>> '{${path}}', 'AUSENTE') from public.organizations where id = '${org}';`),
  );
}

function definirLogo(org: string, ator: string, path: string | null): number {
  const arg = path === null ? "null" : `'${path}'`;
  const out = lastLine(sql(`select public.fn_definir_logo_da_organizacao('${org}', '${ator}', ${arg});`));
  if (!/^-?\d+$/.test(out)) throw new Error(`saída inesperada do psql: ${out}`);
  return Number(out);
}

/** A mensagem de recusa do Postgres, ou `null` quando a chamada PASSOU. */
function erroAoDefinirLogo(org: string, ator: string, path: string | null): string | null {
  try {
    definirLogo(org, ator, path);
    return null;
  } catch (err) {
    return motivoDoErro(err);
  }
}

function definirMarca(org: string, ator: string, marca: string): number {
  const out = lastLine(sql(`select public.fn_definir_marca_da_organizacao('${org}', '${ator}', ${marca});`));
  if (!/^-?\d+$/.test(out)) throw new Error(`saída inesperada do psql: ${out}`);
  return Number(out);
}

/** Roda um comando sob outro papel e devolve o erro do Postgres, ou `null`. */
function erroSob(papel: string, comando: string): string | null {
  try {
    sql(`set role ${papel};\n${comando};\nreset role;`);
    return null;
  } catch (err) {
    return motivoDoErro(err);
  }
}

beforeAll(() => {
  const usuarios = [
    [LOGO_ADMIN, "logo-admin"],
    [LOGO_VIEWER, "logo-viewer"],
    [LOGO_ESTRANHO, "logo-estranho"],
    [LOGO_PLATFORM, "logo-platform"],
  ]
    .map(([id, tag]) => `insert into auth.users (id, email) values ('${id}', '${tag}@invariant.test') on conflict do nothing;`)
    .join("\n");

  sql(`
    ${usuarios}
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${LOGO_ORG}', 'logo-inv-0158', 'Logo Invariant Org', 'Logo Inv')
      on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${LOGO_ORG_VIZINHA}', 'logo-inv-0158-vizinha', 'Logo Invariant Vizinha', 'Logo Viz')
      on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${LOGO_ADMIN}', '${LOGO_ORG}', 'admin', now()) on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${LOGO_VIEWER}', '${LOGO_ORG}', 'viewer', now()) on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${LOGO_ESTRANHO}', '${LOGO_ORG_VIZINHA}', 'admin', now()) on conflict do nothing;
    insert into public.platform_admins (user_id, granted_by, reason)
      values ('${LOGO_PLATFORM}', '${LOGO_ADMIN}', 'invariante do logo da marca')
      on conflict do nothing;
  `);
  semear();
});

describe("guarda de vacuidade — o que todo caso abaixo supõe", () => {
  it("a organização existe e o `settings` de partida é o que os casos supõem", () => {
    // PRIMEIRO, e não por último: uma sonda medindo uma linha que não existe
    // devolve as mesmas saídas plausíveis que uma sonda medindo o produto certo.
    expect(lastLine(sql(`select count(*) from public.organizations where id = '${LOGO_ORG}';`))).toBe("1");
    expect(caminho(LOGO_ORG, "visibility_mode")).toBe("own");
    expect(caminho(LOGO_ORG, "branding")).toBe("AUSENTE");
  });

  it("as DUAS funções existem com a assinatura exata que os casos chamam", () => {
    // `create or replace` com um parâmetro a mais criaria uma SEGUNDA função, e
    // os casos abaixo passariam chamando a antiga. O `typecheck` não vê nada
    // disto: o admin client é `SupabaseClient` sem o genérico `<Database>`.
    //
    // ⚠️ A primeira versão desta guarda comparava `p.oid::regprocedure::text`
    // com a string literal — e reprovava SEMPRE, num banco onde as funções
    // existem. `regprocedure` de saída OMITE o `public.` quando `public` está
    // no `search_path`, então `'public.fn_x(...)'` nunca casava e a contagem
    // dava 0. O sentido do erro engana: uma guarda de vacuidade falhando lê-se
    // como "o schema não chegou ao banco", e o diagnóstico natural é mexer na
    // migration — que estava certa. Quem desmentiu foram os 21 casos deste
    // mesmo arquivo que CHAMAM as funções e passaram.
    //
    // O sentido certo do cast é o inverso, e é o que o resto do repo usa
    // (`marca-da-organizacao.test.ts:208`): dar a STRING ao Postgres e deixar
    // ELE resolver. Se a assinatura não existir, o cast levanta `42883` e o
    // teste falha com o nome da função na mensagem.
    for (const assinatura of [FN_LOGO, FN_MARCA]) {
      expect(
        lastLine(sql(`select '${assinatura}'::regprocedure::text is not null;`)),
        `${assinatura} não existe no banco`,
      ).toBe("t");

      // O cast acima resolve a assinatura EXATA, então ele sozinho não vê uma
      // sobrecarga nascer ao lado. Esta segunda asserção é a que guarda o caso
      // original: `nome` sem argumentos, contado no schema. Mais de uma = há
      // sobrecarga, e os casos abaixo podem estar chamando a outra.
      const nome = assinatura.slice(assinatura.indexOf(".") + 1, assinatura.indexOf("("));
      expect(
        lastLine(sql(`select count(*) from pg_proc p
                        join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'public' and p.proname = '${nome}';`)),
        `${nome}: mais de uma função com este nome — sobrecarga muda quem os casos chamam`,
      ).toBe("1");
    }
  });
});

describe("o bucket público é UM, e é o dos logos", () => {
  it("`brand-logos` existe com o teto, o tipo e a visibilidade que o produto supõe", () => {
    const linha = lastLine(
      sql(`select public::text || '|' || file_size_limit::text || '|' ||
                  coalesce(array_to_string(allowed_mime_types, ','), 'NULO')
             from storage.buckets where id = 'brand-logos';`),
    );
    // 524288 é o MESMO número de `TAMANHO_MAXIMO_DO_LOGO` (lib/branding/logo.ts).
    // Dois tetos diferentes fariam a rota aceitar o que o Storage recusa, e o
    // erro que chegaria à tela seria "erro ao subir o logo".
    expect(linha).toBe("true|524288|image/png,image/jpeg");
  });

  it("NENHUM outro bucket é público — a exceção continua sendo exceção", () => {
    // Sem este caso, "o bucket público é só o de logos" é prosa. Com ele, tornar
    // `whatsapp-media` público (que exporia o histórico de todos os clientes)
    // reprova o CI.
    const publicos = lastLine(
      sql(`select coalesce(string_agg(id, ',' order by id), 'NENHUM') from storage.buckets where public;`),
    );
    expect(publicos).toBe("brand-logos");
  });

  it("NENHUMA policy de `storage.objects` nomeia o bucket — escrita só por service_role", () => {
    // `public = true` abre a LEITURA pelo endpoint `/object/public/...`; INSERT e
    // DELETE continuam exigindo privilégio. Uma policy que citasse `brand-logos`
    // devolveria a escrita ao `authenticated` sem que nada mais mudasse.
    const policies = lastLine(
      sql(`select coalesce(string_agg(policyname, ',' order by policyname), 'NENHUMA')
             from pg_policies
            where schemaname = 'storage' and tablename = 'objects'
              and (coalesce(qual, '') || coalesce(with_check, '')) like '%brand-logos%';`),
    );
    expect(policies).toBe("NENHUMA");
  });
});

describe("`platform_branding.logo_path` — a forma vive no banco", () => {
  it("aceita o caminho da instalação na forma exata", () => {
    sql(`insert into public.platform_branding (id, logo_path) values (1, '${CAMINHO_DA_PLATAFORMA}')
           on conflict (id) do update set logo_path = excluded.logo_path;`);
    expect(lastLine(sql(`select logo_path from public.platform_branding where id = 1;`))).toBe(
      CAMINHO_DA_PLATAFORMA,
    );
  });

  it("RECUSA caminho fora da forma — e o controle POSITIVO acima prova que a sonda mede", () => {
    // Sem o caso de cima, "recusou" seria indistinguível de "a coluna nem existe".
    for (const torto of [
      `${LOGO_ORG}/${NOME}`, // caminho de organização na coluna da instalação
      "platform/x.png", // nome que não é uuid
      `platform/${NOME.replace(".png", ".svg")}`, // extensão banida
      `platform/sub/${NOME}`, // subpasta
      `../platform/${NOME}`, // travessia
    ]) {
      let erro: string | null = null;
      try {
        sql(`update public.platform_branding set logo_path = '${torto}' where id = 1;`);
      } catch (err) {
        erro = motivoDoErro(err);
      }
      expect(erro, `o banco ACEITOU "${torto}"`).not.toBeNull();
      expect(erro).toContain("platform_branding_logo_path");
    }
    // E o valor bom continua lá: a recusa não é um UPDATE parcial.
    expect(lastLine(sql(`select logo_path from public.platform_branding where id = 1;`))).toBe(
      CAMINHO_DA_PLATAFORMA,
    );
    sql(`delete from public.platform_branding;`);
  });
});

describe("o prefixo asseverado — o gate que sobrevive ao segundo chamador", () => {
  it("o admin grava o caminho da PRÓPRIA organização (controle positivo)", () => {
    semear();
    expect(definirLogo(LOGO_ORG, LOGO_ADMIN, CAMINHO_DA_ORG)).toBe(1);
    expect(caminho(LOGO_ORG, "branding,logo_path")).toBe(CAMINHO_DA_ORG);
    // O merge é no CAMPO: as demais chaves de `settings` não foram tocadas.
    expect(caminho(LOGO_ORG, "visibility_mode")).toBe("own");
    expect(caminho(LOGO_ORG, "routing,mode")).toBe("round_robin");
  });

  it("RECUSA o caminho da PLATAFORMA — é o ataque, e ele é destrutivo", () => {
    const erro = erroAoDefinirLogo(LOGO_ORG, LOGO_ADMIN, CAMINHO_DA_PLATAFORMA);
    expect(erro, "a função ACEITOU um caminho de outro escopo").not.toBeNull();
    expect(erro).toContain("logo_da_organizacao_caminho_fora_do_escopo");
    // E o que já estava gravado sobreviveu à recusa.
    expect(caminho(LOGO_ORG, "branding,logo_path")).toBe(CAMINHO_DA_ORG);
  });

  it("RECUSA o caminho de OUTRA organização, e travessia de diretório", () => {
    for (const fora of [
      `${LOGO_ORG_VIZINHA}/${NOME}`,
      `${LOGO_ORG}/../platform/${NOME}`,
      `${LOGO_ORG}/sub/${NOME}`,
      `x${LOGO_ORG}/${NOME}`,
    ]) {
      expect(erroAoDefinirLogo(LOGO_ORG, LOGO_ADMIN, fora), `aceitou "${fora}"`).toContain(
        "logo_da_organizacao_caminho_fora_do_escopo",
      );
    }
  });

  it("`null` APAGA a chave e preserva o resto de `branding`", () => {
    definirMarca(LOGO_ORG, LOGO_ADMIN, `'{"app_name":"Loja da Ana"}'::jsonb`);
    expect(definirLogo(LOGO_ORG, LOGO_ADMIN, null)).toBe(1);
    expect(caminho(LOGO_ORG, "branding,logo_path")).toBe("AUSENTE");
    expect(caminho(LOGO_ORG, "branding,app_name")).toBe("Loja da Ana");
  });
});

describe("o gate de papel, repetido no banco", () => {
  beforeAll(() => {
    semear();
  });

  it("`viewer` da própria organização é BARRADO (42501)", () => {
    expect(erroAoDefinirLogo(LOGO_ORG, LOGO_VIEWER, CAMINHO_DA_ORG)).toContain(
      "logo_da_organizacao_sem_permissao",
    );
  });

  it("admin de OUTRA organização é BARRADO", () => {
    expect(erroAoDefinirLogo(LOGO_ORG, LOGO_ESTRANHO, CAMINHO_DA_ORG)).toContain(
      "logo_da_organizacao_sem_permissao",
    );
  });

  it("super-admin de plataforma PASSA — o segundo caminho do gate", () => {
    expect(definirLogo(LOGO_ORG, LOGO_PLATFORM, CAMINHO_DA_ORG)).toBe(1);
  });

  it("organização inexistente devolve 0, e não exceção", () => {
    // 0 e 42501 significam coisas diferentes, e colapsá-los deixaria o chamador
    // sem saber se o problema é papel ou id.
    expect(definirLogo("10c00158-0000-4000-8000-0000000000ff", LOGO_PLATFORM, null)).toBe(0);
  });
});

describe("o FORWARD-FIX da 0157 — salvar o nome não pode apagar o logo", () => {
  beforeAll(() => {
    semear();
    definirLogo(LOGO_ORG, LOGO_ADMIN, CAMINHO_DA_ORG);
  });

  it("gravar nome + cor PRESERVA o `logo_path`", () => {
    // A ordem natural de quem configura a marca: sobe o logo, depois troca o
    // nome. Sem o forward-fix, o segundo passo apaga o primeiro — em silêncio,
    // com a tela dizendo "salvo".
    expect(definirMarca(LOGO_ORG, LOGO_ADMIN, `'{"app_name":"Loja da Ana","accent_hex":"#b3261e"}'::jsonb`)).toBe(1);
    expect(caminho(LOGO_ORG, "branding,logo_path")).toBe(CAMINHO_DA_ORG);
    expect(caminho(LOGO_ORG, "branding,app_name")).toBe("Loja da Ana");
    expect(caminho(LOGO_ORG, "branding,accent_hex")).toBe("#b3261e");
  });

  it("gravar SÓ a cor (com `app_name` nulo) preserva o logo E o nulo", () => {
    // `jsonb_strip_nulls` aplicado ao objeto inteiro comeria `app_name: null`,
    // que é um valor COM significado ("apague o nome"). Ele é aplicado só ao
    // fragmento preservado, e este caso é o que congela a diferença.
    expect(definirMarca(LOGO_ORG, LOGO_ADMIN, `'{"app_name":null,"accent_hex":"#2563eb"}'::jsonb`)).toBe(1);
    expect(caminho(LOGO_ORG, "branding,logo_path")).toBe(CAMINHO_DA_ORG);
    expect(caminho(LOGO_ORG, "branding,accent_hex")).toBe("#2563eb");
    expect(
      lastLine(sql(`select jsonb_typeof(settings #> '{branding,app_name}') from public.organizations where id = '${LOGO_ORG}';`)),
    ).toBe("null");
  });

  it("LIMPAR a marca com logo gravado preserva o logo", () => {
    // Limpar nome+cor responde a outra pergunta: o logo tem controle próprio na
    // tela (subir/remover). Apagá-lo aqui perderia o arquivo sem ninguém pedir.
    expect(definirMarca(LOGO_ORG, LOGO_ADMIN, "null")).toBe(1);
    expect(caminho(LOGO_ORG, "branding,logo_path")).toBe(CAMINHO_DA_ORG);
    expect(caminho(LOGO_ORG, "branding,app_name")).toBe("AUSENTE");
  });

  it("LIMPAR a marca SEM logo apaga a chave `branding` inteira", () => {
    // O comportamento da 0157, preservado: `branding` ausente é o que o
    // resolvedor entende por "esta organização não fala de marca".
    definirLogo(LOGO_ORG, LOGO_ADMIN, null);
    definirMarca(LOGO_ORG, LOGO_ADMIN, `'{"app_name":"Loja da Ana"}'::jsonb`);
    expect(definirMarca(LOGO_ORG, LOGO_ADMIN, "null")).toBe(1);
    expect(caminho(LOGO_ORG, "branding")).toBe("AUSENTE");
    // E as demais chaves de `settings` continuam intactas.
    expect(caminho(LOGO_ORG, "visibility_mode")).toBe("own");
    expect(caminho(LOGO_ORG, "llm,provider")).toBe("anthropic");
  });
});

describe("as duas funções são inalcançáveis por quem vem do browser", () => {
  it("`anon` e `authenticated` recebem 42501 nas DUAS", () => {
    // Definer VOLÁTIL alcançável por qualquer usuário logado é escrita
    // cross-tenant. São duas origens distintas de EXECUTE (o grant a PUBLIC da
    // criação e o `ALTER DEFAULT PRIVILEGES ... TO anon` do baseline), e tratar
    // uma só deixa a função exposta com o gate verde.
    for (const papel of ["anon", "authenticated"]) {
      for (const chamada of [
        `select public.fn_definir_logo_da_organizacao('${LOGO_ORG}', '${LOGO_ADMIN}', null)`,
        `select public.fn_definir_marca_da_organizacao('${LOGO_ORG}', '${LOGO_ADMIN}', null)`,
      ]) {
        const erro = erroSob(papel, chamada);
        expect(erro, `\`${papel}\` executou "${chamada}" SEM erro — a função está exposta`).not.toBeNull();
        expect(erro).toContain("permission denied");
      }
    }
  });

  it("os papéis EXISTEM e o `set role` funciona — guarda de vacuidade", () => {
    // Se `set role anon` falhasse por outro motivo, o caso acima "passaria" com
    // um erro que não fala de privilégio nenhum.
    expect(erroSob("anon", "select 1")).toBeNull();
    expect(erroSob("authenticated", "select 1")).toBeNull();
  });

  it("`service_role` CONTINUA podendo — controle positivo do revoke", () => {
    // Sem ele, "todo mundo é barrado" incluiria o único chamador do produto, e o
    // logo deixaria de ser gravável sem ninguém entender por quê.
    expect(erroSob("service_role", `select public.fn_definir_logo_da_organizacao('${LOGO_ORG}', '${LOGO_PLATFORM}', null)`)).toBeNull();
  });
});
