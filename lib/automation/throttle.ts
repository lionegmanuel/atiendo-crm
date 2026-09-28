/**
 * Anti-banimento do envio AUTOMATIZADO: limite diário da sessão e espaçamento
 * 1.2s + jitter.
 *
 * ═══ A JANELA DE HORÁRIO NÃO MORA MAIS AQUI ═══
 *
 * Se você veio procurar por `withinSendWindow()`: ela foi REMOVIDA, e não por
 * arrumação. Ela media a janela com `new Date().getHours()` — o relógio do
 * processo —, e o contêiner de produção roda em UTC (`TZ=UTC`, declarado no
 * `Dockerfile.scheduler` e no `docker-compose.prod.yml`). A faixa "7h–22h"
 * virava 4h–19h de Brasília: a automação represava um envio das 19h30 até as
 * 4h da manhã, e mandava mensagem para o cliente às 5h.
 *
 * Pior que o fuso: era uma SEGUNDA régua. A faixa que o dono do negócio
 * configura em Conexões › Proteção de envio valia para o agente de IA e não
 * valia para a automação, sem nada na tela dizendo isso.
 *
 * A janela agora é UMA só, vem de `channel_knobs` e é avaliada no fuso do
 * tenant: `lib/automation/janela-do-canal.ts`, que chama a mesma regra pura
 * de `lib/agent-engine/pacing/`. Precisa de janela? Use aquele módulo — não
 * ressuscite uma régua local aqui.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ThrottleVerdict {
  allowed: boolean;
  retry_at?: string;
  reason?: string;
}

export async function checkDailyLimit(
  admin: SupabaseClient,
  organizationId: string,
  channelSessionId: string,
): Promise<ThrottleVerdict> {
  const { data: session } = await admin
    .from("channel_sessions")
    .select("daily_message_limit")
    .eq("id", channelSessionId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  const limit = (session as { daily_message_limit?: number } | null)?.daily_message_limit ?? 300;

  const today = new Date().toISOString().slice(0, 10);
  const { data: warmup } = await admin
    .from("channel_session_warmup")
    .select("messages_sent")
    .eq("channel_session_id", channelSessionId)
    .eq("organization_id", organizationId)
    .eq("day", today)
    .maybeSingle();
  const sent = (warmup as { messages_sent?: number } | null)?.messages_sent ?? 0;

  if (sent >= limit) {
    // ⚠️ RAMO INALCANÇÁVEL HOJE, e as duas coisas erradas nele estão aqui de
    // propósito — para quem vier reanimar o cap não replantar nenhuma.
    //
    // Inalcançável porque `channel_session_warmup` NÃO TEM ESCRITOR no produto:
    // quem conta envio de verdade é `pacing_ledger` (lib/agent-engine/pacing).
    // `sent` é sempre 0, então `sent >= limit` nunca é verdade e o cap diário da
    // automação nunca dispara. Ligar a automação ao ledger muda comportamento
    // anti-ban real e é frente própria — não foi feito aqui.
    //
    // E o `retry_at` abaixo repete, em miniatura, o defeito que esta entrega
    // veio matar: `setHours` marca a hora no relógio do PROCESSO (UTC no
    // contêiner), não no fuso do negócio. Quem reanimar isto deve tirar o
    // instante de `proximaAberturaDaJanela` (lib/agent-engine/pacing/engine),
    // via `adiarAteAJanelaAbrir` — a régua única.
    const WINDOW_START_HOUR = 7;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(WINDOW_START_HOUR, 0, 0, 0);
    return { allowed: false, retry_at: tomorrow.toISOString(), reason: "daily_limit" };
  }
  return { allowed: true };
}

export const AUTOMATED_SEND_SPACING_MS = 1200;

export function jitterMs(): number {
  return Math.floor(Math.random() * 801);
}

/**
 * Espaçamento entre envios automatizados do MESMO número, dentro do tique do
 * drain. Intervalo fixo é assinatura de robô, daí o jitter.
 *
 * O estado é de módulo — suficiente para a instância única do cron, e é o que
 * já valia quando isto morava dentro da ação de WhatsApp. Virou função aqui
 * porque a ação de IA precisa do MESMO espaçamento: duas cópias do contador
 * dariam a cada uma seu próprio relógio, e duas ações na mesma regra
 * disparariam em rajada pelo mesmo número — exatamente o padrão que faz o
 * WhatsApp banir.
 */
const _ultimoEnvioPorSessao = new Map<string, number>();

export async function espacarEnvio(sessionId: string): Promise<void> {
  const ultimo = _ultimoEnvioPorSessao.get(sessionId) ?? 0;
  const esperar = ultimo + AUTOMATED_SEND_SPACING_MS + jitterMs() - Date.now();
  if (esperar > 0) await new Promise((r) => setTimeout(r, esperar));
  _ultimoEnvioPorSessao.set(sessionId, Date.now());
}
