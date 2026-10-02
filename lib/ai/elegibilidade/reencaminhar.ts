import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * AS MENSAGENS QUE CHEGARAM COM O CANAL FECHADO VOLTAM PARA A IA QUANDO ELE ABRE.
 *
 * Com o canal em modo de teste, o despacho de cada mensagem recebida
 * (`ai_agent.dispatch_requested`) é consumido pelo drain como `done`, sem turno:
 * a conversa fica para atendimento humano. Liberar o canal depois não mexia
 * nesses eventos — a pessoa que escreveu durante o teste ficava sem resposta
 * para sempre, e o operador só via a IA responder a próxima mensagem.
 *
 * Aqui o evento volta a `pending`, e quem decide é o MESMO drain de sempre
 * (`lib/agent-engine/edge/crm/drain.ts`): ele revalida a elegibilidade com o
 * acesso novo, descarta o evento superado por inbound mais recente e deduplica
 * o job por `source_event_id`. Reencaminhar não autoriza ninguém; só pede a
 * decisão de novo.
 *
 * Só volta a última mensagem recebida de cada conversa, e só se ninguém
 * respondeu depois dela (a equipe pode ter respondido à mão). A janela de 24 h é
 * a do WhatsApp: fora dela a resposta nem sairia.
 */
const JANELA_MS = 24 * 60 * 60 * 1000;
const TETO_DE_EVENTOS = 500;
const TETO_DE_CONVERSAS = 50;

interface Despacho {
  id: string;
  payload: { conversation_id?: unknown; inbound_message_id?: unknown } | null;
}

export async function reencaminharMensagensSemResposta(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  channelSessionId: string,
  agora: Date = new Date(),
): Promise<number> {
  const { data: eventos, error } = await admin
    .from("event_log")
    .select("id, payload")
    .eq("organization_id", organizationId)
    .eq("event_type", "ai_agent.dispatch_requested")
    .eq("status", "done")
    .eq("payload->>channel_session_id", channelSessionId)
    .gte("created_at", new Date(agora.getTime() - JANELA_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(TETO_DE_EVENTOS);
  if (error) throw new Error(`leitura dos despachos falhou: ${error.message}`);

  // O mais recente de cada conversa (a lista vem do mais novo para o mais velho).
  const porConversa = new Map<string, { eventoId: string; mensagemId: string }>();
  for (const e of (eventos ?? []) as Despacho[]) {
    const conversa = e.payload?.conversation_id;
    const mensagem = e.payload?.inbound_message_id;
    if (typeof conversa !== "string" || typeof mensagem !== "string") continue;
    if (!porConversa.has(conversa)) porConversa.set(conversa, { eventoId: e.id, mensagemId: mensagem });
    if (porConversa.size >= TETO_DE_CONVERSAS) break;
  }

  const reencaminhar: string[] = [];
  for (const [conversa, alvo] of porConversa) {
    // Mesma recência do drain: a mensagem do evento tem de ser a última da
    // conversa. Se a última é uma resposta (da IA ou da equipe), não há o que
    // responder.
    const { data: ultima } = await admin
      .from("messages")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("conversation_id", conversa)
      .order("sent_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ultima?.id === alvo.mensagemId) reencaminhar.push(alvo.eventoId);
  }
  if (reencaminhar.length === 0) return 0;

  // CAS em `done`: um evento que outro processo já mexeu não é tocado.
  const { data: voltaram, error: errUpdate } = await admin
    .from("event_log")
    .update({
      status: "pending",
      next_attempt_at: null,
      last_error: null,
      updated_at: agora.toISOString(),
    })
    .eq("organization_id", organizationId)
    .eq("status", "done")
    .in("id", reencaminhar)
    .select("id");
  if (errUpdate) throw new Error(`reencaminhamento falhou: ${errUpdate.message}`);
  return voltaram?.length ?? 0;
}
