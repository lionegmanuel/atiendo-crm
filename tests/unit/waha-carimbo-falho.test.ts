import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { dispatchWahaEvent, type WahaEnvelope } from "@/lib/waha/ingest";

/**
 * QUANDO O CARIMBO DA CONVERSA FALHA, ISSO VIRA NÚMERO — não sumiço no log.
 *
 * `fn_mark_conversation_message` mantém `last_message_at` /
 * `last_message_preview`. A falha dela era engolida por um `console.error`, e o
 * efeito prático apareceu em 25/07: a suspeita de que a RPC falhava foi levada a
 * sério por horas e NÃO HAVIA COMO MEDI-LA — cada falha tinha sumido no log de
 * um processo que já não existia. Opinião não vira número sozinha.
 *
 * ⚠️ O TESTE ENTRA PELO CAMINHO DE PRODUÇÃO (`dispatchWahaEvent`), não chamando
 * a função interna: o que interessa provar é que o evento sai quando o WEBHOOK
 * REAL processa uma mensagem, e um teste que chama o helper direto provaria o
 * helper e mentiria sobre o caminho.
 */

/** Um admin de mentira que deixa tudo passar e QUEBRA só onde o teste manda. */
function adminQueFalhaEm(rpcQueFalha: string): {
  admin: unknown;
  chamadas: Array<{ fn: string; args: Record<string, unknown> }>;
} {
  const chamadas: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const retornoDeTabela = {
    insert: () => ({
      select: () => ({ maybeSingle: async () => ({ data: { id: "msg-1" }, error: null }) }),
    }),
    update: () => ({ eq: async () => ({ error: null }) }),
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: null, error: null }),
        order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      }),
    }),
  };
  const admin = {
    from: () => retornoDeTabela,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      chamadas.push({ fn, args });
      if (fn === rpcQueFalha) return { data: null, error: { message: "boom: a RPC caiu" } };
      // As RPCs de resolução devolvem o id da entidade — sem isso o ingest
      // desiste antes de chegar ao carimbo, e o teste passaria por não ter
      // exercitado nada.
      if (fn === "fn_upsert_wa_contact") return { data: "contato-1", error: null };
      if (fn === "fn_upsert_wa_conversation") return { data: "conversa-1", error: null };
      return { data: null, error: null };
    },
  };
  return { admin, chamadas };
}

const ENVELOPE: WahaEnvelope = {
  event: "message",
  session: "default",
  payload: {
    id: "false_5511999@c.us_ABC",
    from: "5511999999999@c.us",
    fromMe: false,
    body: "oi, tudo bem?",
    timestamp: 1_760_000_000,
  },
};

const SESSION = { id: "sessao-1", organization_id: "org-1" };

describe("carimbo da conversa que falha", () => {
  it("emite whatsapp.conversation_mark_failed com a conversa, o sentido e o erro", async () => {
    const { admin, chamadas } = adminQueFalhaEm("fn_mark_conversation_message");

    await dispatchWahaEvent(admin as never, SESSION as never, ENVELOPE, "req-1");

    const aviso = chamadas.find((c) => c.fn === "emit_event");
    expect(aviso, "nenhum emit_event foi chamado — a falha do carimbo sumiu").toBeDefined();
    expect(aviso!.args.p_event_type).toBe("whatsapp.conversation_mark_failed");
    expect(aviso!.args.p_entity_id).toBe("conversa-1");
    expect(aviso!.args.p_organization_id).toBe("org-1");
    expect(aviso!.args.p_payload).toMatchObject({ direction: "inbound", erro: "boom: a RPC caiu" });
  });

  it("NÃO copia o texto da mensagem para o evento", async () => {
    // Registro operacional não é cópia de conteúdo do cliente: o payload diz
    // QUAL conversa e QUE erro, e isso basta para agir. Sem esta asserção, um
    // "só para facilitar o debug" mais tarde põe conversa de gente no event_log.
    const { admin, chamadas } = adminQueFalhaEm("fn_mark_conversation_message");
    await dispatchWahaEvent(admin as never, SESSION as never, ENVELOPE, "req-1");

    const aviso = chamadas.find((c) => c.fn === "emit_event")!;
    expect(JSON.stringify(aviso.args)).not.toContain("oi, tudo bem?");
  });

  it("não emite o aviso quando o carimbo dá certo", async () => {
    // O CONTROLE que impede o teste de passar por acidente: se o aviso saísse em
    // toda mensagem, as asserções acima passariam igual e não estariam provando
    // nada sobre a FALHA.
    //
    // A primeira versão cobrava "nenhum emit_event" e ficou vermelha — e estava
    // ERRADA, não o código: o ingest emite `message.received` e
    // `ai_agent.dispatch_requested` no caminho normal, que é o produto
    // funcionando. Controle largo demais reprova o certo; o critério é a
    // ausência do MEU evento, não de evento nenhum.
    const { admin, chamadas } = adminQueFalhaEm("nenhuma-rpc-falha-aqui");

    await dispatchWahaEvent(admin as never, SESSION as never, ENVELOPE, "req-1");

    expect(chamadas.some((c) => c.fn === "fn_mark_conversation_message")).toBe(true);
    const avisos = chamadas.filter(
      (c) => c.fn === "emit_event" && c.args.p_event_type === "whatsapp.conversation_mark_failed",
    );
    expect(avisos).toHaveLength(0);
  });
});
