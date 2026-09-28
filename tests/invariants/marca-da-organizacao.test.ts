import { beforeAll, describe, expect, it } from "vitest";

import { GOV_ADMIN, GOV_ORG, lastLine, seedGov, sql, writeCountAs } from "./gov-helpers";
import { motivoDoErro } from "./psql-transporte";

/**
 * A MARCA DA ORGANIZAÇÃO SE GRAVA NUMA INSTRUÇÃO SÓ — E QUEM PROVA ISSO É O
 * BANCO, NÃO O COMPILADOR.
 *
 * ## Por que este arquivo existe
 *
 * Duas classes de defeito se encontram em `organizations.settings`, e nenhuma
 * das duas tinha teste antes desta fase:
 *
 * **1. O UPDATE que casa 0 linhas e devolve sucesso.** A única policy de escrita
 * de `organizations` é `orgs_write_platform_admin` (FOR ALL, `USING
 * fn_is_platform_admin()`). Pelo client de sessão, o UPDATE de um admin de
 * TENANT casa zero linhas — e o PostgREST responde `204 No Content`, porque
 * "nenhuma linha casou o filtro" não é erro. `error` chega `null` no supabase-js,
 * a tela diz "salvo" e nada foi gravado (issue #144). A classe vive em TRÊS
 * comentários longos do repo (`updateTenant.ts:31-49`, `updateBranding.ts:92-99`,
 * a migration 0157) e em nenhum teste: são 50 usos de `writeCountAs` na suíte, e
 * `grep 'update public.organizations' tests/` era vazio.
 *
 * **2. O read-modify-write do jsonb inteiro.** `settings` tem vários donos com
 * gates diferentes, e cada um lê o objeto INTEIRO, espalha em memória e regrava
 * o objeto inteiro, em round-trips separados. Quem são hoje:
 * `git grep -n "update({ settings" -- app lib workers` — a aba Organização saiu
 * da lista no PR #1209, e é por isso que aqui fica o comando e não o número. A
 * perda é
 * medida: `visibility_mode` volta de `own` para `all` sem erro em lugar nenhum, e
 * essa chave é lida DIRETO pela RLS (`fn_can_view_conversation`,
 * `fn_can_view_lead`). Um write de COR reverteria, em silêncio, uma decisão de
 * exposição de dado de cliente.
 *
 * ## Por que a prova é aqui, e não no `typecheck`
 *
 * `lib/supabase/admin.ts` devolve `SupabaseClient` **sem** o genérico
 * `<Database>`: nome errado de RPC, de argumento ou de chave jsonb compila igual
 * e só aparece em runtime como `PGRST202`/`42703`. Controle desta afirmação:
 * `platform_branding` tem 0 ocorrências em `lib/database.types.ts` e o produto
 * inteiro compila lendo aquela tabela. O compilador não é testemunha aqui.
 *
 * ## Organização e usuários DEDICADOS
 *
 * Os casos que escrevem em `settings` usam uma organização própria, e não o
 * `GOV_ORG`: o banco do `test:db` é compartilhado entre todos os arquivos da
 * suíte (`fileParallelism: false`, estado global), `visibility_mode` do GOV_ORG é
 * lido pela RLS de outros arquivos, e um caso que falhasse no meio deixaria essa
 * chave suja para quem rodasse depois. É o mesmo cuidado que
 * `gov-5-visibility-scope.test.ts` já registra ("isola o teste de 'own' sem tocar
 * no visibility_mode do GOV_ORG").
 */

/** Namespace próprio (`a4ca` = marca, `0157` = a migration). Sem colisão medida. */
const MARCA_ORG = "a4ca0157-0000-4000-8000-000000000001";
const MARCA_ADMIN = "a4ca0157-1111-4000-8000-000000000001";
const MARCA_VIEWER = "a4ca0157-1111-4000-8000-000000000002";
const MARCA_AGENT = "a4ca0157-1111-4000-8000-000000000003";
const MARCA_MANAGER = "a4ca0157-1111-4000-8000-000000000004";
/** Admin de OUTRA organização — o caso cross-tenant. */
const MARCA_ESTRANHO = "a4ca0157-1111-4000-8000-000000000005";
const MARCA_ORG_VIZINHA = "a4ca0157-0000-4000-8000-000000000002";
/**
 * Super-admin de PLATAFORMA, membro de organização nenhuma.
 *
 * A função autoriza os dois caminhos, e sem este ator o segundo ficaria por
 * medir — e o `row_count` de "organização inexistente" seria inalcançável, porque
 * para um admin de tenant um id que não existe falha ANTES, no gate.
 */
const MARCA_PLATFORM = "a4ca0157-1111-4000-8000-000000000006";

const FN = "public.fn_definir_marca_da_organizacao(uuid,uuid,jsonb)";

/**
 * O `settings` de partida de todo caso que escreve.
 *
 * As três chaves não são decorativas: `visibility_mode` é a que a RLS lê e a que
 * a perda medida apagava; `routing` e `llm` são objetos ANINHADOS, e um merge
 * feito com `settings || novo` (raso) só é distinguível de `jsonb_set` quando há
 * aninhamento para achatar.
 */
const SETTINGS_BASE =
  '{"visibility_mode":"own","routing":{"mode":"round_robin"},"llm":{"provider":"anthropic"}}';

const MEMBROS: ReadonlyArray<readonly [string, string, string]> = [
  [MARCA_ADMIN, "admin", "marca-admin"],
  [MARCA_VIEWER, "viewer", "marca-viewer"],
  [MARCA_AGENT, "agent", "marca-agent"],
  [MARCA_MANAGER, "manager", "marca-manager"],
];

/** Devolve `settings` inteiro, como texto — para comparar "não mudou nada". */
function settingsDe(org: string): string {
  return lastLine(sql(`select coalesce(settings::text, 'NULO') from public.organizations where id = '${org}';`));
}

function caminho(org: string, path: string): string {
  return lastLine(sql(`select coalesce(settings #>> '{${path}}', 'AUSENTE') from public.organizations where id = '${org}';`));
}

/** Chama a função e devolve o `row_count`. Lança se o Postgres recusar. */
function definirMarca(org: string, ator: string, marca: string): number {
  const out = lastLine(
    sql(`select public.fn_definir_marca_da_organizacao('${org}', '${ator}', ${marca});`),
  );
  if (!/^-?\d+$/.test(out)) throw new Error(`saída inesperada do psql: ${out}`);
  return Number(out);
}

/**
 * A mensagem de recusa do Postgres, ou `null` quando a chamada PASSOU.
 *
 * Devolver `null` em vez de lançar é deliberado: o modo de falha interessante é
 * a chamada ter sido ACEITA, e um `expect(...).toContain()` sobre uma exceção
 * não capturada reprovaria com um stack trace que não fala de autorização
 * nenhuma.
 */
function erroAoDefinir(org: string, ator: string, marca: string): string | null {
  try {
    definirMarca(org, ator, marca);
    return null;
  } catch (err) {
    return motivoDoErro(err);
  }
}

/** Igual a `erroAoDefinir`, com os três argumentos como literais SQL crus. */
function erroComArgumentosCrus(org: string, ator: string, marca: string): string {
  try {
    sql(`select public.fn_definir_marca_da_organizacao(${org}, ${ator}, ${marca});`);
    return "A CHAMADA PASSOU";
  } catch (err) {
    return motivoDoErro(err);
  }
}

function semearSettings(): void {
  sql(`update public.organizations set settings = '${SETTINGS_BASE}'::jsonb where id = '${MARCA_ORG}';`);
}

beforeAll(() => {
  // O fixture compartilhado precisa existir: o caso da catraca mede o GOV_ORG
  // junto do desta suíte, de propósito (ver o comentário lá).
  seedGov();

  const usuarios = [
    ...MEMBROS,
    [MARCA_ESTRANHO, "admin", "marca-estranho"] as const,
    [MARCA_PLATFORM, "admin", "marca-platform"] as const,
  ]
    .map(
      ([id, , tag]) =>
        `insert into auth.users (id, email) values ('${id}', '${tag}@invariant.test') on conflict do nothing;`,
    )
    .join("\n");
  const memberships = MEMBROS.map(
    ([id, papel]) =>
      `insert into public.user_organizations (user_id, organization_id, role, accepted_at)
         values ('${id}', '${MARCA_ORG}', '${papel}', now()) on conflict do nothing;`,
  ).join("\n");

  sql(`
    ${usuarios}
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${MARCA_ORG}', 'marca-inv-0157', 'Marca Invariant Org', 'Marca Inv')
      on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${MARCA_ORG_VIZINHA}', 'marca-inv-0157-vizinha', 'Marca Invariant Vizinha', 'Marca Viz')
      on conflict do nothing;
    ${memberships}
    -- Admin da VIZINHA, e de mais nenhuma: é o ator cross-tenant do caso 3.
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${MARCA_ESTRANHO}', '${MARCA_ORG_VIZINHA}', 'admin', now()) on conflict do nothing;
    -- Platform admin SEM membership nenhuma: o segundo caminho do gate.
    insert into public.platform_admins (user_id, granted_by, reason)
      values ('${MARCA_PLATFORM}', '${MARCA_ADMIN}', 'invariante da marca por organização')
      on conflict do nothing;
  `);
  semearSettings();
});

describe("guarda de vacuidade — o que todo caso abaixo supõe", () => {
  // PRIMEIRO, e não por último: o banco do `test:db` nasce com ZERO organizações
  // (`grep -c 'insert into public.organizations' supabase/baseline.sql` → 0), e
  // uma sonda medindo uma linha que não existe devolve as mesmas saídas plausíveis
  // que uma sonda medindo o produto correto.
  it("a organização existe e o `settings` de partida é o que os casos supõem", () => {
    expect(
      lastLine(sql(`select count(*) from public.organizations where id = '${MARCA_ORG}';`)),
    ).toBe("1");
    expect(caminho(MARCA_ORG, "visibility_mode")).toBe("own");
    expect(caminho(MARCA_ORG, "routing,mode")).toBe("round_robin");
    expect(caminho(MARCA_ORG, "llm,provider")).toBe("anthropic");
    expect(caminho(MARCA_ORG, "branding")).toBe("AUSENTE");
  });

  it("a função EXISTE com a assinatura exata que os casos chamam", () => {
    // `create or replace` com um parâmetro a mais criaria uma SEGUNDA função, e
    // os casos abaixo passariam chamando a antiga. O `typecheck` não vê nada
    // disto: o admin client é `SupabaseClient` sem o genérico `<Database>`.
    expect(
      lastLine(
        sql(`select count(*) from pg_proc p
               join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname = 'fn_definir_marca_da_organizacao';`),
      ),
    ).toBe("1");
    expect(lastLine(sql(`select '${FN}'::regprocedure::text is not null;`))).toBe("t");
    // `security definer` E `volatile`: as duas propriedades que a varredura de
    // hardening usa para decidir o que cobrar dela.
    // `provolatile::text` explícito: a coluna é do tipo `"char"`, e sem o cast o
    // Postgres recusa o `||` com "operator is not unique" — instrumento que não
    // roda não mede nada.
    expect(
      lastLine(
        sql(`select prosecdef::text || '/' || provolatile::text from pg_proc
              where oid = '${FN}'::regprocedure;`),
      ),
    ).toBe("true/v");
  });

  it("nenhum dos atores é platform admin — senão o gate de papel não mede nada", () => {
    // `fn_definir_marca_da_organizacao` AUTORIZA platform admin. Um ator promovido
    // (foi o que `seed-e2e-system-update.ts` fez com o admin do e2e, e nunca
    // revogou) faria o caso 3 passar por outro caminho e o verde seria mentira.
    const atores = [GOV_ADMIN, MARCA_ADMIN, MARCA_VIEWER, MARCA_AGENT, MARCA_MANAGER, MARCA_ESTRANHO]
      .map((u) => `'${u}'`)
      .join(",");
    expect(
      lastLine(
        sql(`select count(*) from public.platform_admins
              where user_id in (${atores}) and revoked_at is null;`),
      ),
    ).toBe("0");

    // CONTROLE POSITIVO da mesma sonda: o ator que DEVE ser platform admin é.
    // Sem ele, um `where` errado (nome de coluna, schema) devolveria 0 para todo
    // mundo e a asserção de cima passaria sem medir nada.
    expect(
      lastLine(
        sql(`select count(*) from public.platform_admins
              where user_id = '${MARCA_PLATFORM}' and revoked_at is null;`),
      ),
    ).toBe("1");
  });
});

describe("a catraca: admin de TENANT não escreve em `organizations` pelo client de sessão", () => {
  it("o UPDATE direto casa ZERO linhas — e a sonda está viva", () => {
    // A forma exata da issue #144. Os dois admins de propósito: o do fixture
    // compartilhado (o que o plano nomeia) e o DESTA suíte, que é o mesmo ator
    // que a função autoriza no caso seguinte — sem ele, "a função é o único
    // caminho para este ator" ficaria por provar.
    const sonda = (org: string) =>
      `update public.organizations set settings = coalesce(settings, '{}'::jsonb) || '{"sonda_da_catraca":1}'::jsonb where id = '${org}'`;

    expect(writeCountAs(GOV_ADMIN, sonda(GOV_ORG))).toBe(0);
    expect(writeCountAs(MARCA_ADMIN, sonda(MARCA_ORG))).toBe(0);

    // CONTROLE POSITIVO. Zero sem o par é instrumento morto: id errado, tabela
    // vazia, `writeCountAs` engolindo um erro qualquer — tudo devolve zero, e
    // nenhum deles fala de RLS. Como superusuário a MESMA instrução escreve.
    for (const org of [GOV_ORG, MARCA_ORG]) {
      const linhas = lastLine(sql(`with w as (${sonda(org)} returning 1) select count(*) from w;`));
      expect(linhas, `a sonda não escreveu nem como superusuário em ${org}`).toBe("1");
    }
    // E escreveu DE FATO — `row_count` diz que a linha casou, não que o valor
    // mudou (numa coluna nula o `||` devolveria nulo com o mesmo row_count).
    expect(
      lastLine(
        sql(`select count(*) from public.organizations
              where id in ('${GOV_ORG}','${MARCA_ORG}') and settings ? 'sonda_da_catraca';`),
      ),
    ).toBe("2");

    // A sonda sai: chave de teste que sobrevive no fixture compartilhado é
    // exatamente a "fixture de rodada anterior" que mascara precondição alheia.
    sql(`update public.organizations set settings = settings - 'sonda_da_catraca'
          where id in ('${GOV_ORG}','${MARCA_ORG}');`);
    expect(
      lastLine(sql(`select count(*) from public.organizations where settings ? 'sonda_da_catraca';`)),
    ).toBe("0");
  });
});

describe("o merge é atômico — e não perde as chaves irmãs", () => {
  it("gravar a marca preserva visibility_mode, routing e llm", () => {
    semearSettings();
    expect(definirMarca(MARCA_ORG, MARCA_ADMIN, `'{"accent_hex":"#b3261e"}'::jsonb`)).toBe(1);

    // A perda medida era ESTA: `visibility_mode` voltando de 'own' para 'all'
    // porque o escritor da marca regravou o objeto inteiro a partir de um
    // snapshot velho. E ela é lida pela RLS — `fn_can_view_conversation` passa de
    // f para t com isso.
    expect(caminho(MARCA_ORG, "visibility_mode")).toBe("own");
    expect(caminho(MARCA_ORG, "routing,mode")).toBe("round_robin");
    expect(caminho(MARCA_ORG, "llm,provider")).toBe("anthropic");
    expect(caminho(MARCA_ORG, "branding,accent_hex")).toBe("#b3261e");
  });

  it("gravar a marca DUAS vezes troca a cor sem duplicar nem achatar nada", () => {
    semearSettings();
    definirMarca(MARCA_ORG, MARCA_ADMIN, `'{"accent_hex":"#b3261e","app_name":"Loja da Ana"}'::jsonb`);
    expect(definirMarca(MARCA_ORG, MARCA_ADMIN, `'{"accent_hex":"#0f766e"}'::jsonb`)).toBe(1);

    // `jsonb_set` no caminho `{branding}` SUBSTITUI o envelope inteiro: o
    // `app_name` da chamada anterior sai junto, e é isso mesmo — quem decide o
    // conteúdo da marca é o formulário, que manda os dois campos sempre. Se um
    // dia ele mandar só um, é aqui que a decisão aparece.
    expect(caminho(MARCA_ORG, "branding,accent_hex")).toBe("#0f766e");
    expect(caminho(MARCA_ORG, "branding,app_name")).toBe("AUSENTE");
    expect(caminho(MARCA_ORG, "routing,mode")).toBe("round_robin");
  });

  it("organização inexistente devolve 0, e 0 é o que o chamador reprova", () => {
    // O `row_count` é a razão de a função devolver `integer` e não `void`: sem
    // ele, este caso seria indistinguível de sucesso, e a tela diria "salvo".
    //
    // MEDIDO ao escrever este caso, e é o motivo de o ator ser o platform admin:
    // para um admin de TENANT, organização inexistente NUNCA chega ao UPDATE —
    // ela falha antes, no gate (ele não é admin de uma org que não existe), com
    // 42501. O 0 só é alcançável por quem passa o gate para qualquer org, isto é,
    // pelo super-admin de plataforma — e pela corrida entre `resolveActiveOrg` e
    // a chamada, se a organização for apagada no meio. Um caso escrito com o
    // admin de tenant estaria medindo o gate e chamando o resultado de row_count.
    expect(
      definirMarca(
        "a4ca0157-9999-4000-8000-000000000099",
        MARCA_PLATFORM,
        `'{"accent_hex":"#b3261e"}'::jsonb`,
      ),
    ).toBe(0);
  });

  it("super-admin de plataforma escreve em organização de que não é membro", () => {
    // O outro lado do gate, e o controle positivo do caso acima: sem ele, um `0`
    // ali seria igualmente explicável por "o platform admin também é barrado" —
    // e a leitura do `row_count` estaria medindo autorização de novo.
    semearSettings();
    expect(
      lastLine(
        sql(`select count(*) from public.user_organizations
              where user_id = '${MARCA_PLATFORM}' and organization_id = '${MARCA_ORG}';`),
      ),
    ).toBe("0");
    expect(definirMarca(MARCA_ORG, MARCA_PLATFORM, `'{"accent_hex":"#0f766e"}'::jsonb`)).toBe(1);
    expect(caminho(MARCA_ORG, "branding,accent_hex")).toBe("#0f766e");
    expect(caminho(MARCA_ORG, "visibility_mode")).toBe("own");
  });
});

describe("o gate de papel é do BANCO, não do chamador", () => {
  it("viewer, agent e manager levam 42501 — e a linha não muda", () => {
    semearSettings();
    const antes = settingsDe(MARCA_ORG);

    for (const [ator, papel] of [
      [MARCA_VIEWER, "viewer"],
      [MARCA_AGENT, "agent"],
      [MARCA_MANAGER, "manager"],
    ] as const) {
      const erro = erroAoDefinir(MARCA_ORG, ator, `'{"accent_hex":"#b3261e"}'::jsonb`);
      expect(erro, `\`${papel}\` gravou a marca — o gate do banco não existe`).not.toBeNull();
      expect(erro).toContain("marca_da_organizacao_sem_permissao");
      expect(settingsDe(MARCA_ORG), `\`${papel}\` mexeu na linha`).toBe(antes);
    }
  });

  it("admin de OUTRA organização também leva 42501 — é escrita cross-tenant", () => {
    semearSettings();
    const antes = settingsDe(MARCA_ORG);
    const erro = erroAoDefinir(MARCA_ORG, MARCA_ESTRANHO, `'{"accent_hex":"#b3261e"}'::jsonb`);
    expect(erro).toContain("marca_da_organizacao_sem_permissao");
    expect(settingsDe(MARCA_ORG)).toBe(antes);
  });

  it("membership REVOGADA deixa de valer", () => {
    // `revoked_at is null` na condição, e não só `role = 'admin'`: quem foi
    // removido da empresa continua com a linha, e sem o filtro repintaria a marca
    // do ex-cliente.
    semearSettings();
    sql(`update public.user_organizations set revoked_at = now()
          where user_id = '${MARCA_ADMIN}' and organization_id = '${MARCA_ORG}';`);
    const erro = erroAoDefinir(MARCA_ORG, MARCA_ADMIN, `'{"accent_hex":"#b3261e"}'::jsonb`);
    sql(`update public.user_organizations set revoked_at = null
          where user_id = '${MARCA_ADMIN}' and organization_id = '${MARCA_ORG}';`);
    expect(erro).toContain("marca_da_organizacao_sem_permissao");
    // Controle positivo do próprio caso: com a membership de volta, escreve.
    expect(definirMarca(MARCA_ORG, MARCA_ADMIN, `'{"accent_hex":"#b3261e"}'::jsonb`)).toBe(1);
  });
});

describe("limpar a marca volta ao que vem de cima", () => {
  it("`null` remove a chave `branding` e PRESERVA as irmãs", () => {
    semearSettings();
    definirMarca(MARCA_ORG, MARCA_ADMIN, `'{"accent_hex":"#b3261e"}'::jsonb`);
    expect(caminho(MARCA_ORG, "branding,accent_hex")).toBe("#b3261e");

    expect(definirMarca(MARCA_ORG, MARCA_ADMIN, "null::jsonb")).toBe(1);
    expect(caminho(MARCA_ORG, "branding")).toBe("AUSENTE");
    expect(caminho(MARCA_ORG, "visibility_mode")).toBe("own");
    expect(caminho(MARCA_ORG, "routing,mode")).toBe("round_robin");
  });

  it("o jsonb `'null'` limpa igual — os dois transportes significam a mesma coisa", () => {
    // NÃO MEDIDO qual das duas formas o PostgREST produz para `{"p_marca": null}`
    // num argumento `jsonb`. As duas dizem "apague a marca", e tratar só uma
    // deixaria o caminho de limpeza levantando 22023 num dos dois transportes —
    // com a tela dizendo "não foi possível" para a ação mais simples da feature.
    semearSettings();
    definirMarca(MARCA_ORG, MARCA_ADMIN, `'{"accent_hex":"#b3261e"}'::jsonb`);
    expect(definirMarca(MARCA_ORG, MARCA_ADMIN, `'null'::jsonb`)).toBe(1);
    expect(caminho(MARCA_ORG, "branding")).toBe("AUSENTE");
    expect(caminho(MARCA_ORG, "visibility_mode")).toBe("own");
  });

  it("limpar quem nunca teve marca é inócuo — não inventa chave nem apaga irmã", () => {
    semearSettings();
    expect(definirMarca(MARCA_ORG, MARCA_ADMIN, "null::jsonb")).toBe(1);
    expect(settingsDe(MARCA_ORG)).toBe(
      lastLine(sql(`select '${SETTINGS_BASE}'::jsonb::text;`)),
    );
  });
});

describe("a forma do que se grava", () => {
  it("hex fora de `#rrggbb` minúsculo leva 22023 e a linha fica intacta", () => {
    // MESMA regex do CHECK `platform_branding_accent_hex`, e pelo mesmo motivo:
    // `#FFF` e `#ffffff` são a mesma cor em duas grafias, e a pergunta "mudou?"
    // passaria a mentir. Dentro de jsonb não cabe CHECK de coluna — a regra é da
    // função, então é aqui que ela se prova.
    semearSettings();
    const antes = settingsDe(MARCA_ORG);
    for (const ruim of ["#FFF", "#FFFFFF", "vermelho", "#ff00a", "ff00aa", "#ff00aa;"]) {
      const erro = erroAoDefinir(
        MARCA_ORG,
        MARCA_ADMIN,
        `'{"accent_hex":"${ruim}"}'::jsonb`,
      );
      expect(erro, `deveria recusar ${JSON.stringify(ruim)}`).toContain(
        "marca_da_organizacao_accent_hex_invalido",
      );
      expect(settingsDe(MARCA_ORG)).toBe(antes);
    }
  });

  it("marca que não é objeto leva 22023 — escalar em `branding` quebra o resolvedor", () => {
    semearSettings();
    const antes = settingsDe(MARCA_ORG);
    for (const escalar of [`'"texto"'::jsonb`, `'42'::jsonb`, `'[1,2]'::jsonb`]) {
      const erro = erroAoDefinir(MARCA_ORG, MARCA_ADMIN, escalar);
      expect(erro, `deveria recusar ${escalar}`).toContain("marca_da_organizacao_forma_invalida");
      expect(settingsDe(MARCA_ORG)).toBe(antes);
    }
  });

  it("org ou ator nulo leva 22023 — e não um UPDATE de zero linhas silencioso", () => {
    // Sem esta guarda, `p_org is null` cairia no `where o.id = null`, que casa
    // zero linhas: a função devolveria 0 e o chamador diria "não gravou" para um
    // defeito de chamada. Os dois erros pedem conserto em lugares diferentes.
    const marca = `'{"accent_hex":"#b3261e"}'::jsonb`;
    expect(erroComArgumentosCrus("null::uuid", `'${MARCA_ADMIN}'`, marca)).toContain(
      "marca_da_organizacao_argumento_nulo",
    );
    expect(erroComArgumentosCrus(`'${MARCA_ORG}'`, "null::uuid", marca)).toContain(
      "marca_da_organizacao_argumento_nulo",
    );
  });
});

describe("o privilégio — com sonda positiva", () => {
  it("`anon` NÃO executa", () => {
    // O grant DIRETO do `ALTER DEFAULT PRIVILEGES ... TO anon` do baseline vale
    // para toda função criada depois dele — isto é, para todo apêndice, que por
    // construção nasce no fim do arquivo. `revoke ... from public` não o remove.
    expect(lastLine(sql(`select has_function_privilege('anon', '${FN}', 'EXECUTE');`))).toBe("f");
  });

  it("`authenticated` NÃO executa — a função é volátil e recebe o ator por argumento", () => {
    // Definer VOLÁTIL alcançável por qualquer usuário logado é escrita
    // cross-tenant: o ator vem por argumento (o admin client não tem
    // `auth.uid()`), então um `authenticated` com EXECUTE poderia passar o uuid
    // de um admin alheio. Segunda regra de `hardening-definer-varredura`.
    expect(lastLine(sql(`select has_function_privilege('authenticated', '${FN}', 'EXECUTE');`))).toBe("f");
  });

  it("`service_role` EXECUTA — controle positivo da sonda", () => {
    // Sem este caso, o jeito trivial de deixar os dois de cima verdes é revogar de
    // todo mundo — e aí a Server Action para de gravar, o produto degrada e nada
    // reprova. Este é o único papel que precisa, e é o do admin client.
    expect(lastLine(sql(`select has_function_privilege('service_role', '${FN}', 'EXECUTE');`))).toBe("t");
  });

  it("e o `search_path` está fixado — definer sem isso é sequestrável", () => {
    expect(
      lastLine(sql(`select array_to_string(proconfig, ',') from pg_proc where oid = '${FN}'::regprocedure;`)),
    ).toContain("search_path=public, pg_temp");
  });
});
