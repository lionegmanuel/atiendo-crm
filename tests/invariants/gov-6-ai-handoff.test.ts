import { beforeAll, describe, expect, it } from "vitest";

import { columnExists, seedGov, sql } from "./gov-helpers";

/**
 * Eixo 6 — Handoff IA→humano (spec 13 §1; fase que fecha: G6, + fase FG do
 * Vendaval). docs/specs/13-spec-governanca-atendimento.md — dor: "IA não sabe
 * direcionar para humano disponível/fila". Semântica de handoff na spec 05;
 * alvo assignee_kind ('user'|'ai') na spec 13 §3.
 */

beforeAll(() => {
  seedGov();
});

describe("eixo 6 — handoff IA→humano", () => {
  it("colunas de handoff do estado atual existem (spec 13 §2)", () => {
    expect(columnExists("conversations", "bot_silenced_until")).toBe(true);
    expect(columnExists("conversations", "last_handoff_at")).toBe(true);
    expect(columnExists("conversations", "last_handoff_reason")).toBe(true);
    expect(columnExists("contacts", "force_human")).toBe(true);
  });

  it("status 'ai_handling' é aceito pelo check de conversations.status", () => {
    const def = sql(
      `select pg_get_constraintdef(oid) from pg_constraint where conname = 'conversations_status_check';`,
    );
    expect(def).toContain("ai_handling");
  });

  // G3-02 fechou o GAP: assignee_kind ('user'|'ai') existe (migration 0032);
  // handoff IA→humano é reassignment auditado (reason='handoff') e kind='user'
  // veta o bot deterministicamente (workers/ai-response-worker.ts).
  it("conversations.assignee_kind ('user'|'ai') existe (spec 13 §3)", () => {
    expect(columnExists("conversations", "assignee_kind")).toBe(true);
  });
});
