/**
 * Wave 3 (CORE 2) — o emissor único do barramento.
 *
 * O que estes testes protegem: a regra de lastro do banco (0071) tem de ser
 * respeitada ANTES do INSERT. Se o emissor mandar `actor_kind='ai'` sem
 * run_id/trace_id, a constraint recusa e a atividade some — e some em silêncio,
 * porque emitir é fire-and-forget de propósito.
 */
import { describe, it, expect, vi } from "vitest";

import {
  emitLeadActivity,
  actorParaAtividade,
  stageChangeReason,
} from "./activity-emitter";
import type { Actor } from "@/lib/api/handlers/types";

/** Supabase client mínimo: guarda o que teria ido para o banco. */
function supabaseFake(erro?: string) {
  const inserts: Record<string, unknown>[] = [];
  const client = {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserts.push(row);
        return Promise.resolve({ error: erro ? { message: erro } : null });
      },
    }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, inserts };
}

const base = {
  organizationId: "org-1",
  leadId: "lead-1",
  type: "stage_changed" as const,
  sourceModule: "crm",
  reason: "Movido de A para B",
};

describe("actorParaAtividade", () => {
  it("usuário vira 'user' com performed_by_user_id", () => {
    expect(actorParaAtividade({ type: "user", id: "u-1" })).toEqual({
      kind: "user",
      userId: "u-1",
      agentId: null,
    });
  });

  it("agente vira 'ai' com actor_agent_id", () => {
    expect(actorParaAtividade({ type: "ai_agent", id: "ag-1", agent_id: "ag-1", role: "agent" })).toEqual({
      kind: "ai",
      userId: null,
      agentId: "ag-1",
    });
  });

  /**
   * ⚠️ ESTE É O CASO QUE CUSTOU A ATIVIDADE INTEIRA.
   *
   * O runtime nativo põe o id do RUN em `actor.id` (é o que correlaciona a
   * chamada de tool com o turno no audit), e `actor_agent_id` tem FK para
   * `ai_agents`. Enquanto o emissor lia `id`, todo write tool chamado pelo agente
   * configurado na tela derrubava o INSERT na FK: a mutação acontecia, a timeline
   * não registrava, e a perda só aparecia em `event_log`.
   *
   * A polaridade certa é perder a AUTORIA, não a LINHA: sem `agent_id`, entra
   * como sistema.
   */
  it("id de RUN em `id` NÃO vira actor_agent_id — perde a autoria, não a linha", () => {
    expect(
      actorParaAtividade({ type: "ai_agent", id: "run-abc", role: "agent" }),
    ).toEqual({ kind: "ai", userId: null, agentId: null });
  });

  it("webhook vira 'system' — o produto agiu, não uma pessoa", () => {
    expect(actorParaAtividade({ type: "webhook_source", id: "wh-1" })).toEqual({
      kind: "system",
      userId: null,
      agentId: null,
    });
  });
});

describe("emitLeadActivity", () => {
  it("grava o ator humano com o id de quem agiu", async () => {
    const { client, inserts } = supabaseFake();
    await emitLeadActivity(client, { ...base, actor: { type: "user", id: "u-1" } });
    expect(inserts[0]).toMatchObject({
      actor_kind: "user",
      performed_by_user_id: "u-1",
      actor_agent_id: null,
      reason: "Movido de A para B",
    });
  });

  it("agente COM lastro grava 'ai' e mantém a evidência", async () => {
    const { client, inserts } = supabaseFake();
    await emitLeadActivity(client, {
      ...base,
      actor: { type: "ai_agent", id: "ag-1", agent_id: "ag-1", role: "agent" },
      evidence: { run_ids: ["run-1"] },
    });
    expect(inserts[0]).toMatchObject({
      actor_kind: "ai",
      actor_agent_id: "ag-1",
      evidence: { run_ids: ["run-1"] },
    });
  });

  // O caso que a constraint recusaria: em vez de perder a linha ou inventar um
  // run_id, degrada a AUTORIA e preserva o vínculo com o agente.
  it("agente SEM lastro vira 'system', mas não perde o actor_agent_id", async () => {
    const { client, inserts } = supabaseFake();
    await emitLeadActivity(client, {
      ...base,
      actor: { type: "ai_agent", id: "ag-1", agent_id: "ag-1", role: "agent" },
    });
    expect(inserts[0]).toMatchObject({
      actor_kind: "system",
      actor_agent_id: "ag-1",
      evidence: null,
    });
  });

  it("lastro com arrays VAZIOS conta como sem lastro (é o furo da constraint)", async () => {
    const { client, inserts } = supabaseFake();
    await emitLeadActivity(client, {
      ...base,
      actor: { type: "ai_agent", id: "ag-1", agent_id: "ag-1", role: "agent" },
      evidence: { run_ids: [], trace_ids: [] },
    });
    expect(inserts[0]).toMatchObject({ actor_kind: "system", evidence: null });
  });

  it("trace_ids sozinho já sustenta a autoria da IA", async () => {
    const { client, inserts } = supabaseFake();
    await emitLeadActivity(client, {
      ...base,
      actor: { type: "ai_agent", id: "ag-1", agent_id: "ag-1", role: "agent" },
      evidence: { trace_ids: ["trace-1"] },
    });
    expect(inserts[0]).toMatchObject({ actor_kind: "ai" });
  });

  // A ramificação que a PRODUÇÃO usa: depois da 0072, o turno do agente grava
  // `llm_call_ids` (antes punha id de `llm_calls` dentro de `run_ids`, que
  // apontava para a tabela errada). Era a única das três formas de lastro sem
  // teste — justamente a que o único escritor real exercita.
  it("llm_call_ids sozinho já sustenta a autoria da IA (o lastro do turno)", async () => {
    const { client, inserts } = supabaseFake();
    await emitLeadActivity(client, {
      ...base,
      actor: { type: "ai_agent", id: "ag-1", agent_id: "ag-1", role: "agent" },
      evidence: { llm_call_ids: ["call-1"] },
    });
    expect(inserts[0]).toMatchObject({
      actor_kind: "ai",
      evidence: { llm_call_ids: ["call-1"] },
    });
  });

  it("llm_call_ids VAZIO não sustenta — degrada para system, como as outras duas", async () => {
    const { client, inserts } = supabaseFake();
    await emitLeadActivity(client, {
      ...base,
      actor: { type: "ai_agent", id: "ag-1", agent_id: "ag-1", role: "agent" },
      evidence: { llm_call_ids: [] },
    });
    expect(inserts[0]).toMatchObject({ actor_kind: "system", evidence: null });
  });

  it("falha do banco vira retorno, NÃO exceção — a timeline não derruba a operação", async () => {
    const { client } = supabaseFake("boom");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await emitLeadActivity(client, { ...base, actor: { type: "user", id: "u-1" } });
    expect(r).toEqual({ ok: false, error: "boom" });
    spy.mockRestore();
  });

  it("source_id é ponteiro de ORIGEM e não se mistura com evidence", async () => {
    const { client, inserts } = supabaseFake();
    await emitLeadActivity(client, {
      ...base,
      sourceId: "lead-1",
      actor: { type: "ai_agent", id: "ag-1", agent_id: "ag-1", role: "agent" },
      evidence: { run_ids: ["run-1"] },
    });
    expect(inserts[0]!.source_id).toBe("lead-1");
    expect(JSON.stringify(inserts[0]!.evidence)).not.toContain("lead-1");
  });
});

describe("stageChangeReason", () => {
  it("com os dois nomes, diz de onde para onde", () => {
    expect(stageChangeReason("Avaliação", "Proposta enviada")).toBe(
      "Movido de Avaliação para Proposta enviada",
    );
  });

  it("sem o nome de origem, ainda diz para onde (nunca mostra UUID)", () => {
    expect(stageChangeReason(null, "Negociação")).toBe("Movido para Negociação");
    expect(stageChangeReason(null, null)).toBe("Mudou de estágio");
  });
});

describe("tipos de ator aceitos", () => {
  it("todo Actor da API mapeia para um actor_kind válido do banco", () => {
    const atores: Actor[] = [
      { type: "user", id: "u" },
      { type: "ai_agent", id: "a", role: "agent" },
      { type: "webhook_source", id: "w" },
    ];
    for (const a of atores) {
      expect(["user", "ai", "system", "rule", "contact"]).toContain(actorParaAtividade(a).kind);
    }
  });
});
