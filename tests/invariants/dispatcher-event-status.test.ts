import { describe, it, expect, beforeAll } from "vitest";

import { GOV_ORG, seedGov, sql, lastLine } from "./gov-helpers";

/**
 * G6-05 (INB-13) — o agent-dispatcher gravava status inválidos no event_log.
 *
 * `event_log_status_check` (baseline) só aceita pending|processing|done|dead.
 * O dispatcher usava 'processed' (sucesso) e 'failed' (erro), que a constraint
 * REJEITA — o UPDATE falhava silenciosamente em runtime (o handler só logava
 * warn). Este invariante roda contra o Postgres cru de scripts/test-db.sh:
 *
 *  1. Prova do bug: UPDATE ... set status='processed'/'failed' VIOLA a
 *     constraint (os valores antigos do dispatcher).
 *  2. Prova do fix: o ciclo real pending→processing→done (sucesso) e
 *     pending→processing→dead (falha terminal) passa sem violação — os valores
 *     que o dispatcher passa a usar.
 */

const DISPATCH_EVENT_TYPE = "ai_agent.dispatch_requested";

function emitPending(): string {
  const out = sql(
    `select public.emit_event('${DISPATCH_EVENT_TYPE}', 'test', null, '{}'::jsonb, '{}'::jsonb, '${GOV_ORG}');`,
  );
  return lastLine(out);
}

function statusOf(id: string): string {
  return sql(`select status from public.event_log where id = '${id}';`);
}

/** Runs an UPDATE and returns the constraint error, or null if it succeeded. */
function updateStatus(id: string, status: string): string | null {
  try {
    sql(`update public.event_log set status = '${status}' where id = '${id}';`);
    return null;
  } catch (err) {
    return (err as { stderr?: string }).stderr ?? String(err);
  }
}

describe("agent-dispatcher — event_log status respeita event_log_status_check (G6-05/INB-13)", () => {
  beforeAll(() => {
    seedGov();
  });

  it("prova do bug: os valores ANTIGOS ('processed', 'failed') violam a constraint", () => {
    for (const bad of ["processed", "failed"]) {
      const id = emitPending();
      const err = updateStatus(id, bad);
      expect(err).not.toBeNull();
      expect(err).toContain("event_log_status_check");
      // A linha não muda de status — o UPDATE foi rejeitado, não silenciado.
      expect(statusOf(id)).toBe("pending");
    }
  });

  it("prova do fix: ciclo pending→processing→done (sucesso) passa sem violação", () => {
    const id = emitPending();
    expect(statusOf(id)).toBe("pending");
    expect(updateStatus(id, "processing")).toBeNull();
    expect(statusOf(id)).toBe("processing");
    expect(updateStatus(id, "done")).toBeNull();
    expect(statusOf(id)).toBe("done");
  });

  it("prova do fix: ciclo pending→processing→dead (falha terminal) passa sem violação", () => {
    const id = emitPending();
    expect(updateStatus(id, "processing")).toBeNull();
    expect(updateStatus(id, "dead")).toBeNull();
    expect(statusOf(id)).toBe("dead");
  });
});
