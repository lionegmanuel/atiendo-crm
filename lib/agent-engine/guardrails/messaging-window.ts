/**
 * A janela de atendimento de 24 horas — **derivada**, nunca guardada.
 *
 * Canais com hetero-restrição (WhatsApp Cloud API) só aceitam texto livre enquanto
 * a janela está aberta; fora dela, apenas template aprovado. Ver
 * `docs/doctrine/restricao-de-canal.md`.
 *
 * ─── Por que NÃO existe coluna `conversation_window_expires_at` ───────────────
 * O TomikCRM guarda essa coluna, e o desenho inicial desta fase copiou. Está errado
 * para este repo, e a doutrina DIRC do `CLAUDE.md` responde por quê: para a pergunta
 * "a janela está aberta?", a resposta é **Calcular**, não Duplicar.
 *
 * `conversations.last_inbound_at` já existe e é a verdade. Uma coluna de expiração
 * seria:
 *   - **segunda fonte da verdade** — exige cron para expirar, e deriva no minuto em
 *     que qualquer caminho de escrita de inbound esquecer de atualizá-la;
 *   - **falsamente tranquilizadora** — uma data no futuro parece autoritativa mesmo
 *     quando o `last_inbound_at` já a contradiz, e ninguém desconfia de um campo que
 *     "diz" que está tudo certo.
 *
 * É a mesma lição do contrato de parâmetros da Fase 3a, num eixo diferente: o que é
 * derivável não se armazena.
 *
 * Puro e síncrono — quem lê banco é o chamador.
 */

/** Largura da janela imposta pela Meta. Constante nomeada: número solto vira mistério. */
export const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Milissegundos restantes de janela. `0` quando fechada — **nunca negativo**, para
 * que o chamador possa somar/comparar sem tratar sinal.
 *
 * `lastInboundAt` nulo devolve `0` (fail-closed): contato que nunca escreveu não tem
 * janela aberta. Tratá-lo como aberto faria toda prospecção fria passar como se fosse
 * resposta — exatamente o que a regra existe para impedir.
 *
 * Carimbo no futuro (relógio torto num webhook) não estende nada: o restante é limitado
 * pela largura da janela, não pela distância até o carimbo.
 */
export function windowRemainingMs(now: Date, lastInboundAt: Date | null): number {
  if (!lastInboundAt) return 0;
  const decorrido = now.getTime() - lastInboundAt.getTime();
  // `max(0, …)` fecha embaixo (nunca negativo) e `min(…, WINDOW_MS)` fecha em cima
  // (carimbo no futuro não estende). Uma linha em que as DUAS partes sustentam um
  // caso de teste — a versão anterior tinha um `if (restante <= 0) return 0` que era
  // equivalente a `< 0`, e a sabotagem passou verde justamente por isso.
  return Math.max(0, Math.min(WINDOW_MS - decorrido, WINDOW_MS));
}

/**
 * A janela está aberta? Borda **exclusiva**: em 24h exatas já fechou.
 *
 * Definida em termos de `windowRemainingMs` de propósito — duas contas separadas para
 * a mesma pergunta divergem com o tempo, e o teste `aberta ⟺ restante > 0` existe para
 * travar isso.
 */
export function isWindowOpen(now: Date, lastInboundAt: Date | null): boolean {
  return windowRemainingMs(now, lastInboundAt) > 0;
}
