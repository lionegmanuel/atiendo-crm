import { describe, expect, it } from "vitest";

import { reencaminharMensagensSemResposta } from "./reencaminhar";

const ORG = "11111111-1111-4111-8111-111111111111";
const CANAL = "22222222-2222-4222-8222-222222222222";

interface Consulta {
  table: string;
  op: "select" | "update";
  filtros: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

/**
 * Dublê do cliente: `event_log` devolve os despachos já consumidos, `messages`
 * devolve a última mensagem de cada conversa. O que se mede é QUAIS eventos
 * voltam a `pending` — a decisão de responder continua sendo do drain.
 */
function cliente(despachos: { id: string; conversa: string; mensagem: string }[], ultimaPorConversa: Record<string, string>) {
  const consultas: Consulta[] = [];
  const abrir = (table: string) => {
    const c: Consulta = { table, op: "select", filtros: {} };
    consultas.push(c);
    const resolver = () => {
      if (table === "event_log" && c.op === "select") {
        return { data: despachos.map((d) => ({ id: d.id, payload: { conversation_id: d.conversa, inbound_message_id: d.mensagem } })), error: null };
      }
      if (table === "event_log" && c.op === "update") {
        return { data: (c.filtros["in:id"] as string[]).map((id) => ({ id })), error: null };
      }
      const conversa = c.filtros.conversation_id as string;
      return { data: ultimaPorConversa[conversa] ? { id: ultimaPorConversa[conversa] } : null, error: null };
    };
    const b = {
      select: () => b,
      update: (payload: Record<string, unknown>) => { c.op = "update"; c.payload = payload; return b; },
      eq: (k: string, v: unknown) => { c.filtros[k] = v; return b; },
      gte: (k: string, v: unknown) => { c.filtros[`gte:${k}`] = v; return b; },
      in: (k: string, v: unknown) => { c.filtros[`in:${k}`] = v; return b; },
      order: () => b,
      limit: () => b,
      maybeSingle: async () => resolver(),
      then: (ok: (r: unknown) => unknown) => Promise.resolve(resolver()).then(ok),
    };
    return b;
  };
  return { admin: { from: abrir } as never, consultas };
}

describe("reencaminhar as mensagens que chegaram com o canal fechado", () => {
  it("devolve ao drain só o último despacho de cada conversa ainda sem resposta", async () => {
    const { admin, consultas } = cliente(
      [
        { id: "ev-novo-a", conversa: "conv-a", mensagem: "msg-a2" },
        { id: "ev-velho-a", conversa: "conv-a", mensagem: "msg-a1" },
        { id: "ev-b", conversa: "conv-b", mensagem: "msg-b1" },
      ],
      // conv-a: a última é a do evento novo → responde. conv-b: alguém já respondeu.
      { "conv-a": "msg-a2", "conv-b": "resposta-da-equipe" },
    );

    const n = await reencaminharMensagensSemResposta(admin, ORG, CANAL, new Date("2026-10-02T12:00:00Z"));

    expect(n).toBe(1);
    const leitura = consultas.find((c) => c.table === "event_log" && c.op === "select")!;
    expect(leitura.filtros).toMatchObject({
      organization_id: ORG,
      event_type: "ai_agent.dispatch_requested",
      status: "done",
      "payload->>channel_session_id": CANAL,
      "gte:created_at": "2026-10-01T12:00:00.000Z",
    });
    const escrita = consultas.find((c) => c.op === "update")!;
    expect(escrita.filtros).toMatchObject({ organization_id: ORG, status: "done", "in:id": ["ev-novo-a"] });
    expect(escrita.payload).toMatchObject({ status: "pending", next_attempt_at: null });
    // A recência é medida na conversa certa e na organização certa.
    expect(consultas.filter((c) => c.table === "messages").every((c) => c.filtros.organization_id === ORG)).toBe(true);
  });

  it("sem nada pendente não escreve nada", async () => {
    const { admin, consultas } = cliente([{ id: "ev", conversa: "c", mensagem: "m" }], { c: "outra" });
    expect(await reencaminharMensagensSemResposta(admin, ORG, CANAL)).toBe(0);
    expect(consultas.some((c) => c.op === "update")).toBe(false);
  });
});
