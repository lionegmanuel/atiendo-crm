import { describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

/**
 * As tabelas de instância não vazam para o inquilino.
 *
 * `system_version` e `system_update_runs` descrevem o SERVIDOR. Um usuário
 * comum autenticado não tem por que saber que existe uma atualização pendente,
 * e um atacante com um JWT válido não pode ler o log de atualização. A defesa
 * é estrutural: RLS habilitada com ZERO policy nega tudo por construção —
 * não depende de a rota lembrar de checar.
 */

/** `sql()` devolve string crua; json_agg empacota o resultado como array tipado (precedente: automation-send-whatsapp.test.ts). */
function rows<T>(query: string): T[] {
  const out = sql(`select coalesce(json_agg(t), '[]') from (${query}) t;`);
  return JSON.parse(out || "[]") as T[];
}

describe("tabelas de instância da atualização self-service", () => {
  it("têm RLS habilitada", () => {
    const found = rows<{ relname: string; relrowsecurity: boolean }>(`
      select relname, relrowsecurity
        from pg_class
       where relname in ('system_version', 'system_update_runs')
    `);
    expect(found).toHaveLength(2);
    for (const row of found) {
      expect(row.relrowsecurity, `${row.relname} sem RLS`).toBe(true);
    }
  });

  it("não têm nenhuma policy — negar é o default", () => {
    const found = rows<{ tablename: string }>(`
      select tablename from pg_policies
       where tablename in ('system_version', 'system_update_runs')
    `);
    expect(found).toEqual([]);
  });

  it("system_version é singleton", () => {
    expect(() => sql(`insert into public.system_version (id) values (2);`)).toThrow();
    const found = rows<{ n: string }>(`select count(*)::text as n from public.system_version`);
    expect(found[0]?.n).toBe("1");
  });

  /**
   * Fix da Task 4 (review round 1): o índice único parcial
   * `uniq_system_update_runs_dispatched` (migration 0090) é o que torna real
   * o invariante "no máximo 1 run dispatched por vez" que a rota
   * /api/v1/system/agent assume — sem ele é só expectativa de aplicação,
   * um TOCTOU sob concorrência (dois cliques quase simultâneos criariam 2
   * runs "dispatched", e o lookup do heartbeat acharia mais de uma linha).
   */
  it("no máximo 1 run dispatched por vez (índice único parcial)", () => {
    sql(`insert into public.system_update_runs (status) values ('dispatched');`);
    expect(() => sql(`insert into public.system_update_runs (status) values ('dispatched');`)).toThrow();
    const found = rows<{ n: string }>(
      `select count(*)::text as n from public.system_update_runs where status = 'dispatched'`,
    );
    expect(found[0]?.n).toBe("1");
  });
});
