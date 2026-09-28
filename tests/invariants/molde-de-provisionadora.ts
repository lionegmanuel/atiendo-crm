/**
 * MOLDE DE PROVISIONADORA DE MÓDULO — o que um módulo novo HERDA em vez de
 * reescrever (ADR-0002, D2/D4/D5).
 *
 * ## Como um módulo usa isto (é o arquivo inteiro que ele precisa escrever)
 *
 * ```ts
 * // tests/invariants/financeiro-provisionadora.test.ts
 * import { moldeDeProvisionadora } from "./molde-de-provisionadora";
 *
 * moldeDeProvisionadora({
 *   modulo: "financeiro",
 *   tabelas: ["sales", "sale_items", "commission_rules", "commissions", "loyalty_ledger"],
 * });
 * ```
 *
 * Isso já cobra, para `public.fn_financeiro_provisionar()`:
 *
 *   - **forma** (as três regras da D4): sem parâmetro; `execute` só de
 *     `service_role`, nas DUAS origens; corpo que não escreve em tabela de fora
 *     do módulo;
 *   - **efeito**: chamar cria exatamente as tabelas declaradas; cada uma nasce
 *     com RLS ligada, `anon` revogado, isolamento por organização e as travas do
 *     suporte; chamar de novo não muda nada; e o núcleo não é tocado.
 *
 * Um módulo cuja tabela precise de policy por papel, ou que deva ser
 * server-only, liga a RLS dentro da própria provisionadora: a rotina
 * `fn_proteger_tabelas_de_organizacao()` (migration 0325) só enxerga tabela com
 * RLS DESLIGADA, então a decisão do módulo prevalece. Nesse caso o módulo passa
 * `protecaoPropria: ["<tabela>", …]`, e o molde confere só o que continua
 * valendo (RLS ligada e `anon` sem privilégio), sem exigir a policy ampla.
 *
 * ## Por que existe um molde, e não só a varredura
 *
 * `provisionadora-de-modulo.test.ts` varre o catálogo e reprova QUALQUER
 * `fn_%_provisionar` malformada — inclusive a de um módulo que nunca escreveu
 * teste nenhum. Mas ela roda num banco onde módulo nenhum está instalado, então
 * ela só alcança a FORMA. O EFEITO — a tabela nasceu? nasceu protegida? o
 * núcleo ficou intocado? — só é observável depois de CHAMAR a provisionadora, e
 * isso pede o vocabulário do módulo (quais tabelas ele promete criar). O molde é
 * onde esse vocabulário entra, uma vez, por módulo.
 */
import { describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

/** Uma função `public.fn_<modulo>_provisionar()` como o catálogo a descreve. */
export interface Provisionadora {
  /** `fn_financeiro_provisionar()` — assinatura sem espaços, como `regprocedure` a imprime. */
  readonly assinatura: string;
  readonly nome: string;
  readonly qtdParametros: number;
  readonly securityDefiner: boolean;
  readonly dono: string;
  /** `proacl` cru; string vazia quando `proacl is null` (o ACL padrão). */
  readonly acl: string;
  readonly aclPadrao: boolean;
  readonly anonExecuta: boolean;
  readonly authenticatedExecuta: boolean;
  readonly serviceRoleExecuta: boolean;
}

export interface Violacao {
  readonly fn: string;
  readonly regra: string;
  readonly detalhe: string;
}

const SEPARADOR = "";

/** Toda `fn_<algo>_provisionar` de `public`, com o que as três regras da D4 pedem. */
export function provisionadorasDoCatalogo(): Provisionadora[] {
  // `~ '^fn_.+_provisionar$'` e não `like 'fn\_%\_provisionar'`: em LIKE o `_`
  // é curinga, e a versão com LIKE casaria `fnXaYprovisionar`. O erro é mudo —
  // ele só ALARGA o conjunto, então o gate seguiria verde e ninguém veria.
  const out = sql(`
    select p.oid::regprocedure::text
           || '${SEPARADOR}' || p.proname
           || '${SEPARADOR}' || p.pronargs::text
           || '${SEPARADOR}' || p.prosecdef::text
           || '${SEPARADOR}' || pg_get_userbyid(p.proowner)
           || '${SEPARADOR}' || coalesce(array_to_string(p.proacl, ' '), '')
           || '${SEPARADOR}' || (p.proacl is null)::text
           || '${SEPARADOR}' || has_function_privilege('anon', p.oid, 'EXECUTE')::text
           || '${SEPARADOR}' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
           || '${SEPARADOR}' || has_function_privilege('service_role', p.oid, 'EXECUTE')::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname ~ '^fn_.+_provisionar$'
     order by 1;
  `);
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .map((linha) => {
      const c = linha.split(SEPARADOR);
      return {
        assinatura: (c[0] ?? "").replace(/\s+/g, ""),
        nome: c[1] ?? "",
        qtdParametros: Number(c[2] ?? "0"),
        securityDefiner: c[3] === "true",
        dono: c[4] ?? "",
        acl: c[5] ?? "",
        aclPadrao: c[6] === "true",
        anonExecuta: c[7] === "true",
        authenticatedExecuta: c[8] === "true",
        serviceRoleExecuta: c[9] === "true",
      };
    });
}

/** O corpo (`prosrc`) de uma provisionadora, pelo nome. */
export function corpoDaProvisionadora(nome: string): string {
  return sql(`select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = '${nome}';`);
}

/** Toda tabela/visão que EXISTE em `public` agora. */
export function relacoesDePublic(): string[] {
  return sql(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relkind in ('r','p','v','m','f') order by 1;`)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

/**
 * Os alvos de ESCRITA/DDL que o corpo nomeia.
 *
 * ⚠️ O que esta leitura NÃO alcança, declarado: nome de tabela montado em tempo
 * de execução (`execute format('… %I', v_nome)`) é invisível aqui. SQL dinâmico
 * com o nome LITERAL dentro da string é alcançado, porque o literal está no
 * `prosrc`. Fechar o caso computado exigiria executar a função, e isso é o lado
 * do EFEITO deste molde — que compara o núcleo antes e depois de chamar.
 *
 * `references public.organizations(id)` NÃO entra: uma tabela de módulo tem
 * chave estrangeira para o núcleo por desenho (a ADR conta 23 só no financeiro).
 * O que a D4 proíbe é a provisionadora MEXER no que não é dela, não apontar
 * para o que é do núcleo.
 */
export function alvosDeEscritaNoCorpo(corpo: string): string[] {
  const ID = `"?([a-zA-Z_][a-zA-Z0-9_$]*)"?`;
  const PUB = `(?:"?public"?\\s*\\.\\s*)?`;
  const padroes: RegExp[] = [
    new RegExp(`\\binsert\\s+into\\s+(?:only\\s+)?${PUB}${ID}`, "gi"),
    new RegExp(`\\bupdate\\s+(?:only\\s+)?${PUB}${ID}\\s+set\\b`, "gi"),
    new RegExp(`\\bdelete\\s+from\\s+(?:only\\s+)?${PUB}${ID}`, "gi"),
    new RegExp(`\\btruncate\\s+(?:table\\s+)?(?:only\\s+)?${PUB}${ID}`, "gi"),
    new RegExp(`\\balter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?${PUB}${ID}`, "gi"),
    new RegExp(`\\bdrop\\s+table\\s+(?:if\\s+exists\\s+)?${PUB}${ID}`, "gi"),
    // `create table` também entra: um `create table if not exists
    // public.organizations (…)` seria no-op no banco e MENTIRA no corpo — a
    // provisionadora estaria declarando o núcleo como se fosse dela. A tabela
    // do próprio módulo não é pega por isto: na varredura ela ainda não existe
    // no catálogo, e no molde ela está em `tabelasDoModulo`.
    new RegExp(`\\bcreate\\s+(?:unlogged\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?${PUB}${ID}`, "gi"),
    new RegExp(
      `\\bcreate\\s+(?:unique\\s+)?index\\s+(?:concurrently\\s+)?(?:if\\s+not\\s+exists\\s+)?\\S+\\s+on\\s+(?:only\\s+)?${PUB}${ID}`,
      "gi",
    ),
    new RegExp(`\\b(?:create|drop)\\s+policy\\s+(?:if\\s+exists\\s+)?\\S+\\s+on\\s+${PUB}${ID}`, "gi"),
    new RegExp(`\\b(?:create|drop)\\s+(?:constraint\\s+)?trigger\\s+(?:if\\s+exists\\s+)?\\S+[\\s\\S]{0,160}?\\bon\\s+${PUB}${ID}`, "gi"),
    new RegExp(`\\b(?:grant|revoke)\\b[^;']{0,200}?\\bon\\s+(?:table\\s+)?${PUB}${ID}`, "gi"),
    new RegExp(`\\bcomment\\s+on\\s+table\\s+${PUB}${ID}`, "gi"),
  ];
  const achados = new Set<string>();
  for (const p of padroes) {
    for (const m of corpo.matchAll(p)) {
      const nome = (m[1] ?? "").toLowerCase();
      if (nome !== "") achados.add(nome);
    }
  }
  return [...achados].sort();
}

/**
 * As três regras da D4 sobre UMA provisionadora, medidas no catálogo.
 *
 * `tabelasDoModulo` é o que aquele módulo declara como SEU — fora da varredura
 * genérica (onde módulo nenhum está instalado e a lista é vazia), é o molde que
 * a informa.
 */
export function violacoesDaForma(
  p: Provisionadora,
  tabelasDoModulo: readonly string[] = [],
): Violacao[] {
  const v: Violacao[] = [];

  if (p.qtdParametros !== 0) {
    v.push({
      fn: p.assinatura,
      regra: "sem parâmetro",
      detalhe:
        `tem ${p.qtdParametros} parâmetro(s). ADR-0002 D4: "Não há nome de tabela, SQL ou ` +
        `organização vindo de quem chama; o efeito é fixo e conhecido". Parâmetro devolve a ` +
        `escolha do efeito a quem chama, e é isso que faz a definer virar DDL arbitrária.`,
    });
  }

  // As DUAS origens de EXECUTE, e é por isso que o teste não é um `revoke` só:
  //   (A) o grant DIRETO do `alter default privileges … grant all on functions to anon`
  //       do baseline, que `revoke … from public` NÃO remove;
  //   (B) o grant a PUBLIC que o Postgres dá a toda função ao criá-la — que
  //       aparece como `proacl is null` (ACL padrão) ou como entrada de grantee
  //       vazio (`=X/dono`) —, e que `revoke … from anon` NÃO remove.
  const entradas = p.acl.split(/\s+/).filter((e) => e !== "");
  const grantees = entradas.map((e) => e.split("=")[0] ?? "");
  const publicoNoAcl = grantees.some((g) => g === "");
  const permitidos = new Set([p.dono, "service_role"]);
  const indevidos = grantees.filter((g) => g !== "" && !permitidos.has(g));

  if (p.aclPadrao) {
    v.push({
      fn: p.assinatura,
      regra: "execute só de service_role",
      detalhe:
        "o ACL está no PADRÃO (proacl is null), que no Postgres significa EXECUTE para PUBLIC — " +
        "toda função em `public` NASCE assim. Acrescente `revoke execute on function … from " +
        "public, anon, authenticated;` E `grant execute on function … to service_role;`.",
    });
  }
  if (publicoNoAcl) {
    v.push({
      fn: p.assinatura,
      regra: "execute só de service_role",
      detalhe: `PUBLIC tem EXECUTE (entrada de grantee vazio no proacl: ${p.acl}).`,
    });
  }
  if (indevidos.length > 0) {
    v.push({
      fn: p.assinatura,
      regra: "execute só de service_role",
      detalhe: `papéis além de service_role com EXECUTE: ${indevidos.join(", ")} (proacl: ${p.acl}).`,
    });
  }
  if (p.anonExecuta) {
    v.push({
      fn: p.assinatura,
      regra: "execute só de service_role",
      detalhe:
        "`anon` EXECUTA (privilégio efetivo). É a anon key, que vai para o browser: uma " +
        "provisionadora alcançável por ela é DDL pública pelo PostgREST.",
    });
  }
  if (p.authenticatedExecuta) {
    v.push({
      fn: p.assinatura,
      regra: "execute só de service_role",
      detalhe: "`authenticated` EXECUTA (privilégio efetivo): qualquer usuário logado cria tabela.",
    });
  }
  // O controle positivo, sem o qual "revogue de todo mundo" passaria nas regras
  // acima e quebraria a instalação do módulo — o jeito trivial de ficar verde.
  if (!p.serviceRoleExecuta) {
    v.push({
      fn: p.assinatura,
      regra: "service_role PRECISA executar",
      detalhe:
        "`service_role` NÃO executa: é ele quem instala o módulo (ADR D3). Revogar de todos " +
        "deixa as três regras acima verdes e o módulo impossível de instalar.",
    });
  }

  const doModulo = new Set(tabelasDoModulo.map((t) => t.toLowerCase()));
  const nucleo = new Set(relacoesDePublic().map((t) => t.toLowerCase()));
  const deFora = alvosDeEscritaNoCorpo(corpoDaProvisionadora(p.nome)).filter(
    (t) => nucleo.has(t) && !doModulo.has(t),
  );
  if (deFora.length > 0) {
    v.push({
      fn: p.assinatura,
      regra: "corpo não escreve fora do módulo",
      detalhe:
        `escreve/altera tabela que já existe sem o módulo: ${deFora.join(", ")}. ` +
        `O corpo de uma provisionadora é o schema DELA (ADR D2) — chave estrangeira para o ` +
        `núcleo é esperada, mexer no núcleo não é.`,
    });
  }

  return v;
}

export interface MoldeOpcoes {
  /** O `<modulo>` de `public.fn_<modulo>_provisionar()`. */
  readonly modulo: string;
  /** As tabelas que a provisionadora promete criar, exatamente. */
  readonly tabelas: readonly string[];
  /**
   * Tabelas cujas policies o próprio módulo define (server-only, ou por papel).
   * A rotina 0325 não as toca, porque o módulo já ligou a RLS — então aqui só se
   * cobra RLS ligada e `anon` sem privilégio, não a policy ampla.
   */
  readonly protecaoPropria?: readonly string[];
}

interface EstadoDaTabela {
  readonly tabela: string;
  readonly rls: boolean;
  readonly anon: boolean;
  readonly isolamento: boolean;
  readonly travasDeSuporte: number;
}

function estadoDas(tabelas: readonly string[]): EstadoDaTabela[] {
  if (tabelas.length === 0) return [];
  const lista = tabelas.map((t) => `'${t}'`).join(",");
  return sql(`
    select c.relname
        || E'\t' || c.relrowsecurity::text
        || E'\t' || (has_table_privilege('anon', c.oid, 'select')
                     or has_table_privilege('anon', c.oid, 'insert')
                     or has_table_privilege('anon', c.oid, 'update')
                     or has_table_privilege('anon', c.oid, 'delete'))::text
        || E'\t' || exists(select 1 from pg_policy p
                            where p.polrelid = c.oid
                              and p.polname = 'tenant_isolation_' || c.relname || '_all')::text
        || E'\t' || (select count(*) from pg_policy p
                      where p.polrelid = c.oid and p.polname like 'support\\_write\\_%')::text
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relname in (${lista})
     order by 1;
  `)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .map((linha) => {
      const [tabela, rls, anon, iso, travas] = linha.split("\t");
      return {
        tabela: tabela ?? "",
        rls: rls === "true",
        anon: anon === "true",
        isolamento: iso === "true",
        travasDeSuporte: Number(travas ?? "0"),
      };
    });
}

/** Impressão digital do NÚCLEO: tudo que a provisionadora não pode ter mexido. */
function impressaoDoNucleo(excluir: readonly string[]): string {
  const fora =
    excluir.length > 0 ? `and c.relname not in (${excluir.map((t) => `'${t}'`).join(",")})` : "";
  return sql(`
    select string_agg(linha, E'\n' order by linha) from (
      select 'T|' || c.relname || '|' || c.relrowsecurity::text
             || '|' || coalesce(array_to_string(c.relacl, ' '), '')
             || '|' || coalesce((select string_agg(p.polname, ',' order by p.polname)
                                   from pg_policy p where p.polrelid = c.oid), '') as linha
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' ${fora}
      union all
      select 'C|' || c.relname || '|' || a.attname || '|' || format_type(a.atttypid, a.atttypmod)
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
       where n.nspname = 'public' and c.relkind = 'r' ${fora}
    ) s;
  `);
}

/**
 * O molde. Uma chamada no topo do arquivo de teste do módulo registra a suíte
 * inteira — forma (as três regras da D4) e efeito (provisionar de verdade).
 */
export function moldeDeProvisionadora(opcoes: MoldeOpcoes): void {
  const nome = `fn_${opcoes.modulo}_provisionar`;
  const propria = new Set((opcoes.protecaoPropria ?? []).map((t) => t.toLowerCase()));

  describe(`provisionadora do módulo ${opcoes.modulo}`, () => {
    it("existe, é SECURITY DEFINER e o catálogo a enxerga", () => {
      const achada = provisionadorasDoCatalogo().find((p) => p.nome === nome);
      expect(
        achada,
        `public.${nome}() não existe. A ADR-0002 (D2) põe o schema do módulo no corpo dela; ` +
          `a migration cria a FUNÇÃO, não as tabelas.`,
      ).toBeDefined();
      expect(
        achada?.securityDefiner,
        `${nome} não é SECURITY DEFINER — quem instala o módulo é o service_role, que não é ` +
          `dono das tabelas e não consegue criar nenhuma sem a definer.`,
      ).toBe(true);
    });

    it("respeita as três regras de forma da D4", () => {
      const p = provisionadorasDoCatalogo().find((x) => x.nome === nome);
      if (p === undefined) throw new Error(`${nome} não existe — ver o caso acima`);
      expect(violacoesDaForma(p, opcoes.tabelas)).toEqual([]);
    });

    it("provisionar cria exatamente as tabelas declaradas, e o núcleo fica intocado", () => {
      const antesDoNucleo = impressaoDoNucleo(opcoes.tabelas);
      const existiamAntes = estadoDas(opcoes.tabelas).map((e) => e.tabela);
      expect(
        existiamAntes,
        `as tabelas de ${opcoes.modulo} já existem antes de provisionar — o molde precisa de um ` +
          `banco SEM o módulo instalado (o setupFile dá um por arquivo). Alguém as pôs no baseline?`,
      ).toEqual([]);

      sql(`select public.${nome}();`);

      const depois = estadoDas(opcoes.tabelas);
      expect(
        depois.map((e) => e.tabela).sort(),
        "provisionar não criou exatamente as tabelas declaradas",
      ).toEqual([...opcoes.tabelas].map((t) => t.toLowerCase()).sort());

      expect(
        impressaoDoNucleo(opcoes.tabelas),
        "o núcleo mudou depois de provisionar — coluna, policy, ACL ou RLS de tabela que não é " +
          "do módulo. É a regra 3 da D4 medida pelo EFEITO, não pelo texto do corpo.",
      ).toEqual(antesDoNucleo);
    });

    it("toda tabela provisionada nasce protegida", () => {
      sql(`select public.${nome}();`);
      const desprotegidas = estadoDas(opcoes.tabelas).filter((e) => {
        if (!e.rls || e.anon) return true;
        if (propria.has(e.tabela)) return false;
        return !e.isolamento || e.travasDeSuporte !== 3;
      });
      expect(
        desprotegidas,
        "tabela provisionada sem a proteção que toda tabela de organização tem. A provisionadora " +
          "termina chamando `public.fn_proteger_modulo_provisionado()` na MESMA transação " +
          "(ADR-0002 D5, migration 0325) — sem isso a tabela nasce com `anon` podendo ler tudo.",
      ).toEqual([]);
    });

    it("provisionar de novo não muda nada (idempotência)", () => {
      sql(`select public.${nome}();`);
      const antes = impressaoDoNucleo([]);
      sql(`select public.${nome}();`);
      expect(
        impressaoDoNucleo([]),
        "a segunda chamada mudou o catálogo. O apêndice do baseline e a cadeia de migrations " +
          "chamam a provisionadora a cada atualização (ADR-0002 D6): ela tem que convergir.",
      ).toEqual(antes);
    });
  });
}
