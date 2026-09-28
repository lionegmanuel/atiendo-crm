/**
 * VARREDURA das provisionadoras de módulo (ADR-0002, D4).
 *
 * ## O que a ADR decide, e o que este arquivo guarda
 *
 * Um módulo opcional com dados próprios não traz tabelas pelo `baseline.sql` —
 * traz **uma função** `public.fn_<modulo>_provisionar()`, cujo corpo é o schema
 * dele. As tabelas nascem quando o módulo é instalado na instalação (D2/D3). Uma
 * função `security definer` que CRIA TABELA é um poder novo no banco, e a D4
 * sustenta que ele não amplia nada com três propriedades — que são exatamente as
 * três regras aqui:
 *
 *   1. **sem parâmetro.** "Não há nome de tabela, SQL ou organização vindo de
 *      quem chama; o efeito é fixo e conhecido." Um parâmetro devolve a escolha
 *      do efeito a quem chama, e aí a definer É DDL arbitrária.
 *   2. **`execute` só de `service_role`** — nas DUAS origens de grant, que é a
 *      armadilha que este repo já pagou duas vezes (migrations 0108 e 0116):
 *      o grant DIRETO do `alter default privileges … to anon` do baseline, que
 *      `revoke … from public` não remove, e o grant a PUBLIC que o Postgres dá a
 *      toda função ao criá-la, que `revoke … from anon` não remove.
 *   3. **corpo que não escreve fora do módulo.** Chave estrangeira para o núcleo
 *      é esperada (a ADR conta 23 só no financeiro); MEXER no núcleo não é.
 *
 * ## Este gate NASCE VERDE, e é de propósito
 *
 * Nenhum módulo com tabelas está na `main` hoje: o conjunto que a varredura mede
 * é **vazio**. Gate que nasce vermelho não é aceitável — ele treina a ignorar
 * vermelho. Mas um invariante que só sabe passar não guarda nada, e vazio que
 * ninguém checou é indistinguível de instrumento cego. Por isso a vacuidade aqui
 * NÃO é um `length >= N` (que seria falso hoje): é um **controle positivo** —
 * cada caso abaixo cria uma provisionadora de mentira, viola a regra dele, e
 * prova que a varredura fica vermelha. O instrumento é medido a cada rodada, com
 * o conjunto real ainda vazio.
 *
 * ## O molde que um módulo herda
 *
 * `./molde-de-provisionadora` tem a suíte completa (forma + efeito) que um
 * módulo registra com uma linha. Esta varredura é a rede que pega a
 * provisionadora que nunca escreveu molde nenhum.
 */
import { afterEach, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";
import { provisionadorasDoCatalogo, violacoesDaForma } from "./molde-de-provisionadora";

/** O corpo de uma provisionadora BEM-COMPORTADA: cria só a tabela dela. */
const CORPO_LIMPO = `
begin
  create table if not exists public.sonda_modulo_comanda (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    total_cents bigint not null default 0
  );
  create index if not exists idx_sonda_modulo_comanda_org
    on public.sonda_modulo_comanda (organization_id);
  perform public.fn_proteger_modulo_provisionado();
end
`;

/**
 * Cria uma provisionadora de mentira. `revogar` reproduz o que uma migration
 * correta escreve; sem ele a função fica como NASCE neste banco — que é com
 * grant direto a anon, porque o prelude do harness reproduz o
 * `alter default privileges` do Supabase (é a fidelidade que faz este gate
 * medir o produto e não um Postgres cru).
 */
function criarProvisionadora(opts: {
  nome: string;
  parametros?: string;
  corpo?: string;
  revogar?: boolean;
  concederA?: readonly string[];
}): void {
  const params = opts.parametros ?? "";
  const assinatura = `public.${opts.nome}(${params.replace(/\w+\s+/g, "")})`;
  sql(`
    create or replace function public.${opts.nome}(${params})
    returns void language plpgsql security definer set search_path = public
    as $prov$ ${opts.corpo ?? CORPO_LIMPO} $prov$;
    ${
      opts.revogar === false
        ? ""
        : `revoke execute on function ${assinatura} from public, anon, authenticated;
           grant execute on function ${assinatura} to service_role;`
    }
    ${(opts.concederA ?? []).map((r) => `grant execute on function ${assinatura} to ${r};`).join("\n")}
  `);
}

/**
 * Limpa TUDO que os casos criam, numa chamada só.
 *
 * Uma chamada por sonda seria mais legível e custa caro onde importa: cada
 * `sql()` é um processo `psql` novo, e oito por caso × nove casos são 72
 * processos só de faxina — numa máquina carregada isso é a maior parte do
 * tempo do arquivo. O `drop function` aqui não enumera argumentos: varre o
 * catálogo, para alcançar tanto a sonda sem parâmetro quanto a com.
 */
function limparSondas(): void {
  sql(`
    do $limpa$
    declare f record;
    begin
      for f in select p.oid::regprocedure as assinatura
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname like 'fn\\_sonda%\\_provisionar'
      loop
        execute format('drop function if exists %s cascade', f.assinatura);
      end loop;
    end $limpa$;
    drop table if exists public.sonda_modulo_comanda cascade;
  `);
}

/** As violações que a varredura enxerga AGORA, em todo o catálogo. */
function violacoesDoCatalogo() {
  return provisionadorasDoCatalogo().flatMap((p) => violacoesDaForma(p));
}

describe("varredura: provisionadora de módulo respeita a forma da ADR-0002 (D4)", () => {
  // Cada caso limpa o que criou, senão o "conjunto real está limpo" abaixo
  // mediria a sujeira do caso anterior — e passaria ou reprovaria por ordem de
  // execução, não por defeito.
  afterEach(limparSondas);

  it("o conjunto real do catálogo está limpo", () => {
    // Hoje ele é VAZIO (nenhum módulo com tabelas está na main). O caso existe
    // para o dia em que deixar de ser: é ele que reprova a provisionadora do
    // primeiro módulo, se ela vier torta.
    expect(violacoesDoCatalogo()).toEqual([]);
  });

  it("uma provisionadora bem-comportada é ENCONTRADA e não viola nada (controle de vacuidade)", () => {
    // Sem este caso, a varredura poderia estar cega — regex que não casa,
    // `pg_proc` que mudou de forma — e o caso acima passaria por AUSÊNCIA de
    // dado. Aqui ela tem que ACHAR a função e, achando, aprovar.
    criarProvisionadora({ nome: "fn_sondamod_provisionar" });
    const achada = provisionadorasDoCatalogo().find((p) => p.nome === "fn_sondamod_provisionar");
    expect(achada, "a varredura não enxergou uma fn_*_provisionar que existe").toBeDefined();
    expect(violacoesDaForma(achada!)).toEqual([]);
  });

  it("REPROVA provisionadora COM PARÂMETRO (regra 1)", () => {
    criarProvisionadora({
      nome: "fn_sondaparam_provisionar",
      parametros: "p_org uuid",
      corpo: "begin perform p_org; end",
    });
    const regras = violacoesDoCatalogo().map((v) => v.regra);
    expect(regras).toContain("sem parâmetro");
  });

  it("REPROVA provisionadora exposta a anon (regra 2, origem do default privileges)", () => {
    // `revogar: false` = a função como NASCE neste banco. É o caso real: quem
    // copia as duas linhas de uma função antiga e não repete os revokes.
    criarProvisionadora({ nome: "fn_sondaexposta_provisionar", revogar: false });
    const v = violacoesDoCatalogo().filter((x) => x.fn.includes("fn_sondaexposta_provisionar"));
    expect(v.map((x) => x.regra)).toContain("execute só de service_role");
    expect(
      v.some((x) => x.detalhe.includes("`anon` EXECUTA")),
      `a varredura achou violação mas não a de anon: ${JSON.stringify(v)}`,
    ).toBe(true);
  });

  it("REPROVA provisionadora com EXECUTE para authenticated (regra 2)", () => {
    criarProvisionadora({ nome: "fn_sondaauth_provisionar", concederA: ["authenticated"] });
    const v = violacoesDoCatalogo().filter((x) => x.fn.includes("fn_sondaauth_provisionar"));
    expect(
      v.some((x) => x.detalhe.includes("`authenticated` EXECUTA")),
      `authenticated com EXECUTE passou: ${JSON.stringify(v)}`,
    ).toBe(true);
  });

  it("REPROVA provisionadora com EXECUTE para PUBLIC — que `revoke from anon` não tira (regra 2)", () => {
    // A segunda origem, isolada: revoga de anon e authenticated, e devolve a
    // PUBLIC. `has_function_privilege('anon', …)` volta a ser true POR HERANÇA.
    criarProvisionadora({ nome: "fn_sondapublic_provisionar" });
    sql(`grant execute on function public.fn_sondapublic_provisionar() to public;
         revoke execute on function public.fn_sondapublic_provisionar() from anon;`);
    const v = violacoesDoCatalogo().filter((x) => x.fn.includes("fn_sondapublic_provisionar"));
    expect(
      v.some((x) => x.detalhe.includes("PUBLIC tem EXECUTE")),
      `PUBLIC com EXECUTE passou — é a origem que \`revoke from anon\` não remove: ${JSON.stringify(v)}`,
    ).toBe(true);
  });

  it("REPROVA corpo que ESCREVE em tabela do núcleo (regra 3)", () => {
    criarProvisionadora({
      nome: "fn_sondanucleo_provisionar",
      corpo: `
        begin
          create table if not exists public.sonda_modulo_comanda (
            id uuid primary key default gen_random_uuid(),
            organization_id uuid not null references public.organizations(id) on delete cascade
          );
          update public.organizations set updated_at = now() where true;
        end
      `,
    });
    const v = violacoesDoCatalogo().filter((x) => x.fn.includes("fn_sondanucleo_provisionar"));
    expect(v.map((x) => x.regra)).toContain("corpo não escreve fora do módulo");
    expect(v.find((x) => x.regra === "corpo não escreve fora do módulo")?.detalhe).toContain(
      "organizations",
    );
  });

  it("NÃO confunde chave estrangeira para o núcleo com escrita no núcleo (controle do controle)", () => {
    // Sem este caso, a regra 3 poderia ser um regex guloso que reprova toda
    // provisionadora — verde impossível, que seria "consertado" afrouxando a
    // regra. O CORPO_LIMPO referencia `public.organizations(id)` de propósito.
    criarProvisionadora({ nome: "fn_sondamod_provisionar" });
    const achada = provisionadorasDoCatalogo().find((p) => p.nome === "fn_sondamod_provisionar");
    expect(
      violacoesDaForma(achada!).filter((v) => v.regra === "corpo não escreve fora do módulo"),
      "`references public.organizations(id)` foi lido como escrita no núcleo",
    ).toEqual([]);
  });

  it("REPROVA quem revogou de TODO MUNDO — inclusive de service_role (controle positivo)", () => {
    // O jeito trivial de deixar as regras acima verdes é tirar o EXECUTE de
    // todos. Isso passa nas três e quebra a instalação do módulo, que é feita
    // pelo service_role (ADR D3).
    criarProvisionadora({ nome: "fn_sondamuda_provisionar" });
    sql(`revoke execute on function public.fn_sondamuda_provisionar() from service_role;`);
    const v = violacoesDoCatalogo().filter((x) => x.fn.includes("fn_sondamuda_provisionar"));
    expect(v.map((x) => x.regra)).toContain("service_role PRECISA executar");
  });
});

describe("as rotinas de proteção da D5 existem e protegem (migration 0325)", () => {
  afterEach(() => {
    sql(`drop table if exists public.sonda_protecao_0325 cascade;`);
  });

  it("uma tabela de organização criada FORA do baseline nasce desprotegida", () => {
    // O fato que justifica a D5 inteira, medido aqui e não citado de memória.
    sql(`create table public.sonda_protecao_0325 (
           id uuid primary key default gen_random_uuid(),
           organization_id uuid not null references public.organizations(id) on delete cascade);`);
    const estado = sql(`
      select c.relrowsecurity::text || '|' || has_table_privilege('anon', c.oid, 'select')::text
             || '|' || (select count(*) from pg_policy p where p.polrelid = c.oid)::text
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'sonda_protecao_0325';`);
    expect(estado, "RLS desligada, anon lendo, zero policies — é o estado que a D5 descreve").toBe(
      "false|true|0",
    );
  });

  it("fn_proteger_modulo_provisionado() a protege, e é idempotente", () => {
    sql(`create table public.sonda_protecao_0325 (
           id uuid primary key default gen_random_uuid(),
           organization_id uuid not null references public.organizations(id) on delete cascade);`);
    const medir = () =>
      sql(`
        select c.relrowsecurity::text || '|' || has_table_privilege('anon', c.oid, 'select')::text
               || '|' || exists(select 1 from pg_policy p where p.polrelid = c.oid
                                 and p.polname = 'tenant_isolation_sonda_protecao_0325_all')::text
               || '|' || (select count(*) from pg_policy p where p.polrelid = c.oid
                           and p.polname like 'support\\_write\\_%')::text
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'sonda_protecao_0325';`);

    sql(`select public.fn_proteger_modulo_provisionado();`);
    expect(medir(), "RLS ligada, anon fora, isolamento e as 3 travas do suporte").toBe(
      "true|false|true|3",
    );

    sql(`select public.fn_proteger_modulo_provisionado();`);
    expect(medir(), "a segunda chamada mudou algo — a rotina tem que convergir").toBe(
      "true|false|true|3",
    );
  });

  it("não toca em tabela que já decidiu a própria proteção", () => {
    // A régua da 0325 é `not relrowsecurity`. O módulo que liga a RLS ele mesmo
    // — porque quer policy por papel, ou server-only — fica fora do alcance
    // dela. É o que impede a rotina de reabrir as 8 tabelas server-only e de
    // atropelar as 66 com policy por papel que o baseline já tem.
    sql(`create table public.sonda_protecao_0325 (
           id uuid primary key default gen_random_uuid(),
           organization_id uuid not null references public.organizations(id) on delete cascade);
         alter table public.sonda_protecao_0325 enable row level security;`);
    sql(`select public.fn_proteger_tabelas_de_organizacao();`);
    const policies = sql(`select count(*)::text from pg_policy p
                           join pg_class c on c.oid = p.polrelid
                          where c.relname = 'sonda_protecao_0325'
                            and p.polname = 'tenant_isolation_sonda_protecao_0325_all';`);
    expect(policies, "a rotina criou a policy ampla numa tabela que já tinha RLS ligada").toBe("0");
  });

  it("as rotinas não são executáveis por anon, authenticated nem service_role", () => {
    const fora = sql(`
      select coalesce(string_agg(t, ', '), '') from (
        select p.proname || ':' || r.rolname as t
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          cross join (values ('anon'), ('authenticated'), ('service_role')) as r(rolname)
         where n.nspname = 'public'
           and p.proname in ('fn_proteger_tabelas_de_organizacao',
                             'fn_proteger_modulo_provisionado',
                             'fn_aplicar_travas_de_suporte')
           and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
      ) s;`);
    expect(
      fora,
      "rotina de proteção alcançável por papel do PostgREST. Ela não é definer: chamada por " +
        "outro papel falharia no primeiro comando — mas o EXECUTE sai das duas origens assim mesmo.",
    ).toBe("");
  });
});
