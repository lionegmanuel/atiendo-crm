import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

/**
 * A COR DA PESSOA É UMA TRILHA, E NÃO SOBROU HEX NENHUM NO SCHEMA DA AGENDA.
 *
 * Guardar hex no banco parece inofensivo e não é: as cores vivem em três blocos
 * de tema no `globals.css`, e a mesma trilha tem hex diferente em cada um. Um
 * valor gravado nasce sem tema escuro — a tela ou ignora o que o cliente
 * escolheu, ou perde o tema.
 *
 * O caso que mais trabalha aqui é o ÚLTIMO: ele não olha uma coluna conhecida,
 * varre o schema atrás de QUALQUER coluna de agenda com cara de cor. Uma coluna
 * nova chamada `cor_do_status` entraria sem ninguém notar, e os três primeiros
 * casos continuariam verdes — é o eixo da completude, não o do comportamento.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db`");
const containerName: string = container;

function linhas(q: string): string[] {
  return execFileSync(
    "docker",
    ["exec", "-i", containerName, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", q],
    { encoding: "utf8" },
  ).trim().split("\n").map((s) => s.trim()).filter(Boolean);
}

const COLUNAS_DA_AGENDA = `
  select c.relname || '.' || a.attname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
   where n.nspname = 'public' and c.relkind = 'r'
     and (c.relname like 'calendar%' or c.relname = 'user_organizations')
`;

describe("a cor da pessoa é uma trilha", () => {
  it("a varredura enxerga colunas (guarda de vacuidade)", () => {
    expect(linhas(`${COLUNAS_DA_AGENDA} order by 1`).length).toBeGreaterThan(40);
  });

  it("user_organizations.calendar_trilha existe, é smallint e aceita 1..8", () => {
    const tipo = linhas(`select data_type from information_schema.columns
                          where table_name='user_organizations' and column_name='calendar_trilha'`);
    expect(tipo).toEqual(["smallint"]);
    const check = linhas(`select pg_get_constraintdef(oid) from pg_constraint
                           where conname = 'user_organizations_calendar_trilha_valida'`);
    expect(check.join(" ")).toContain("8");
  });

  it("as duas colunas de hex SUMIRAM", () => {
    expect(linhas(`${COLUNAS_DA_AGENDA} and a.attname = 'calendar_color'`)).toEqual([]);
    expect(linhas(`${COLUNAS_DA_AGENDA} and c.relname = 'calendar_event_types' and a.attname = 'color'`)).toEqual([]);
  });

  it("e NENHUMA coluna de agenda tem cara de cor — nem uma que ainda não existe", () => {
    // Este é o caso de COMPLETUDE. Os três acima checam nomes conhecidos e
    // continuariam verdes se alguém acrescentasse `cor_do_status` amanhã.
    const suspeitas = linhas(`${COLUNAS_DA_AGENDA}
      and (a.attname like '%color%' or a.attname like '%cor\\_%' or a.attname like '%\\_cor')
      order by 1`);
    expect(suspeitas).toEqual([]);
  });
});
