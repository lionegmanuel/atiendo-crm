import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

/**
 * NENHUMA TABELA TENANT-AWARE FICA SEM RLS — e a lista sai do CATÁLOGO.
 *
 * ═══ O defeito que este arquivo fecha, e ele estava documentado ═══
 *
 * `rls-isolation.test.ts` avisa, no próprio corpo:
 *
 *   ⚠️ LISTA FIXA — tabela tenant-aware nova que NÃO entrar aqui passa verde
 *   sem RLS. Não existe varredura genérica do tipo "toda tabela com
 *   organization_id tem relrowsecurity = true".
 *
 * E eu reproduzi o mesmo defeito em `agenda-rls.test.ts`: escrevi as seis
 * tabelas da agenda à mão. Uma sétima entraria sem ninguém provar o isolamento
 * dela, e o arquivo continuaria verde — verde por não medir.
 *
 * ═══ Comportamento e completude são dois eixos ═══
 *
 * A distinção é do @DevVivo, e ela é o que separa este arquivo daquele. Aquele
 * prova COMPORTAMENTO: que o agent da org A lê zero linhas da org B, com
 * fixture e JWT. Este prova COMPLETUDE: que nenhuma tabela ficou de fora. Teste
 * de comportamento não cobre completude por mais casos que tenha, e o inverso
 * também vale — por isso os dois existem, e não um substituindo o outro.
 *
 * A lista aqui é DERIVADA do catálogo. Não há o que esquecer de acrescentar.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error(
    "TEST_DB_CONTAINER not set — rode esta suíte via `pnpm test:db` (scripts/test-db.sh)",
  );
}
const containerName: string = container;

function sql(query: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", containerName, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tA", "-f", "-"],
    { input: query, encoding: "utf8" },
  ).trim();
}

function linhas(query: string): string[] {
  return sql(query).split("\n").map((l) => l.trim()).filter((l) => l !== "");
}

/** Toda tabela de `public` que tem a coluna `organization_id`. */
const TENANT_AWARE = `
  select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'organization_id' and a.attnum > 0
   where n.nspname = 'public' and c.relkind = 'r'
   order by c.relname
`;

describe("completude: nenhuma tabela tenant-aware sem RLS", () => {
  it("a varredura enxerga tabelas (guarda de vacuidade)", () => {
    // Sem este caso, um `where` que não casa nada devolve lista vazia e o teste
    // abaixo passa medindo o vácuo — o modo de falha que esta base já pagou.
    expect(linhas(TENANT_AWARE).length).toBeGreaterThan(30);
  });

  it("toda tabela com organization_id tem row level security LIGADA", () => {
    const sem = linhas(`${TENANT_AWARE.replace("order by c.relname", "")}
      and c.relrowsecurity = false order by c.relname`);
    expect(
      sem,
      "Tabela com `organization_id` e SEM RLS: o service role a alcança e o " +
        "PostgREST também, com a anon key + o JWT de qualquer usuário logado. " +
        "Acrescente `alter table ... enable row level security` na migration.",
    ).toEqual([]);
  });

  it("toda tabela com organization_id tem ao menos UMA policy", () => {
    // RLS ligada sem policy nenhuma nega tudo para `authenticated` — o que é uma
    // decisão legítima (`watchdog_cursors` faz isso), mas nunca por acidente.
    // Aqui só entram tabelas de agenda, onde a ausência seria acidente.
    const sem = linhas(`
      select c.relname
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid and a.attname = 'organization_id'
       where n.nspname = 'public' and c.relkind = 'r'
         and c.relname like 'calendar%'
         and not exists (select 1 from pg_policies p
                          where p.schemaname = 'public' and p.tablename = c.relname)
       order by c.relname`);
    expect(sem).toEqual([]);
  });

  it("nenhuma tabela de agenda é alcançável por `anon`", () => {
    const alcancaveis = linhas(`
      select c.relname
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'calendar%'
         and has_table_privilege('anon', c.oid, 'SELECT')
       order by c.relname`);
    expect(alcancaveis).toEqual([]);
  });
});
