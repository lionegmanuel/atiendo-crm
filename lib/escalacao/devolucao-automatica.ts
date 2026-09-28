/**
 * DEVOLUÇÃO AUTOMÁTICA AO AGENTE — a regra pura, sem banco.
 *
 * ## O que muda em relação à IA-06
 *
 * A regra IA-06 (spec 05 §7) diz que o bot **não reassume** depois da passagem
 * a humano: `bot_silenced_until = 'infinity'` até alguém clicar "Devolver ao
 * automático". Ela continua sendo o PADRÃO — quem instalou e nunca mexeu em
 * nada não vê diferença.
 *
 * O que este arquivo acrescenta é um prazo OPCIONAL, por organização
 * (`organizations.settings.routing.handoff_return_after_minutes`): passado esse
 * tempo sem NENHUM sinal humano na conversa, o produto devolve o atendimento
 * ao agente sozinho, pela MESMA função que o botão da tela usa
 * (`devolverAtendimentoAoAgente`, que solta as três travas certas).
 *
 * Medido numa instalação real antes de escrever: 12 de 31 conversas ativas do
 * dia estavam em handoff formal, nenhuma foi devolvida, e o cliente que
 * escreveu de novo ficou sem resposta — humano ocupado, IA proibida. O botão
 * existe; ninguém clica.
 *
 * ## Como o prazo conta
 *
 * A partir do ÚLTIMO SINAL HUMANO, não da passagem: o maior entre a passagem
 * (`last_handoff_at`), o "assumir" (`assigned_at`) e a última mensagem que
 * saiu (`last_outbound_at`). Enquanto a conversa está em handoff a IA não
 * envia, então toda saída nesse período é de gente — inclusive a feita pelo
 * celular, que a ingestão grava como `external_device`. Contar da passagem
 * interromperia um atendimento de 1h30 no meio, que é o pior desfecho
 * possível: justamente quando há uma pessoa na conversa.
 *
 * ## O que fica de fora, e por quê
 *
 * - **Sessão sem agente publicado.** Devolver "para ninguém" tira a conversa
 *   da fila humana e ninguém responde — pior que deixá-la com a pessoa. O cron
 *   só devolve onde há quem atenda (`sessoesComAgente`).
 * - **Conversa encerrada.** Devolver conversa fechada a reabriria como
 *   `ai_handling`; o encerramento é decisão, não abandono.
 * - **Pausa por resposta pelo celular** (`bot_silenced_until` finito, ver
 *   `atendimento-manual.ts`): tem prazo próprio e vence sozinha. Aqui só entra
 *   quem está com humano de forma durável: `'infinity'`, `assignee_kind='user'`
 *   ou `assigned_to_user_id` preenchido.
 */

/** Piso e teto do prazo, em minutos. Abaixo de 5 a IA volta no meio da digitação. */
export const PRAZO_MIN_MINUTOS = 5;
export const PRAZO_MAX_MINUTOS = 24 * 60;

/** Status em que faz sentido devolver — os mesmos de `retomada.ts`. */
const STATUS_DEVOLVIVEIS = new Set(["open", "pending", "claimed", "ai_handling"]);

export interface ConversaEmHandoff {
  id: string;
  organization_id: string;
  channel_session_id: string | null;
  status: string | null;
  assignee_kind: string | null;
  assigned_to_user_id: string | null;
  assigned_at: string | null;
  bot_silenced_until: string | null;
  last_handoff_at: string | null;
  last_outbound_at: string | null;
  status_changed_at: string | null;
}

/**
 * Lê o prazo de `organizations.settings`. Ausente, nulo ou fora da faixa é
 * "nunca" — a IA-06 de sempre. Defensivo porque `settings` é jsonb livre.
 */
export function lerPrazoDeDevolucaoMinutos(settings: unknown): number | null {
  const routing = (settings as { routing?: unknown } | null)?.routing;
  const valor = (routing as { handoff_return_after_minutes?: unknown } | null)
    ?.handoff_return_after_minutes;
  if (typeof valor !== "number" || !Number.isFinite(valor)) return null;
  if (valor < PRAZO_MIN_MINUTOS || valor > PRAZO_MAX_MINUTOS) return null;
  return Math.floor(valor);
}

/** A conversa está com uma pessoa de forma durável (não é a pausa do celular). */
export function estaComHumanoDuravel(c: ConversaEmHandoff): boolean {
  if (c.assigned_to_user_id !== null) return true;
  if (c.assignee_kind === "user") return true;
  return c.bot_silenced_until === "infinity";
}

function epoch(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * O instante do último sinal humano, em ms. `null` quando a conversa não tem
 * nenhum carimbo — não dá para dizer há quanto tempo está parada, então não
 * se devolve (melhor um falso "ainda com a pessoa" que uma devolução cega).
 */
export function ultimoSinalHumanoMs(c: ConversaEmHandoff): number | null {
  const candidatos = [
    epoch(c.last_handoff_at),
    epoch(c.assigned_at),
    epoch(c.last_outbound_at),
  ].filter((t): t is number => t !== null);
  if (candidatos.length === 0) {
    // Sem carimbo de passagem nem de saída: o único relógio que sobra é o da
    // última mudança de status — que é a própria passagem quando ela veio
    // pelo orchestrator.
    return epoch(c.status_changed_at);
  }
  return Math.max(...candidatos);
}

export interface Selecao {
  prazoPorOrg: ReadonlyMap<string, number>;
  /** `organization_id` → sessões com agente publicado (ou roteador ativo). */
  sessoesComAgente: ReadonlyMap<string, ReadonlySet<string>>;
  agoraMs: number;
}

export type MotivoDeNaoDevolver =
  | "sem_prazo"
  | "nao_esta_com_humano"
  | "status_nao_devolvivel"
  | "sessao_sem_agente"
  | "sem_relogio"
  | "dentro_do_prazo";

export function avaliarDevolucao(
  c: ConversaEmHandoff,
  sel: Selecao,
): { devolver: true; minutos: number } | { devolver: false; motivo: MotivoDeNaoDevolver } {
  const minutos = sel.prazoPorOrg.get(c.organization_id);
  if (minutos === undefined) return { devolver: false, motivo: "sem_prazo" };
  if (!estaComHumanoDuravel(c)) return { devolver: false, motivo: "nao_esta_com_humano" };
  if (!STATUS_DEVOLVIVEIS.has(c.status ?? "")) {
    return { devolver: false, motivo: "status_nao_devolvivel" };
  }
  const sessoes = sel.sessoesComAgente.get(c.organization_id);
  if (!c.channel_session_id || !sessoes?.has(c.channel_session_id)) {
    return { devolver: false, motivo: "sessao_sem_agente" };
  }
  const sinal = ultimoSinalHumanoMs(c);
  if (sinal === null) return { devolver: false, motivo: "sem_relogio" };
  if (sel.agoraMs - sinal < minutos * 60_000) return { devolver: false, motivo: "dentro_do_prazo" };
  return { devolver: true, minutos };
}

/** As conversas vencidas, com o prazo que venceu cada uma. */
export function selecionarVencidas(
  conversas: readonly ConversaEmHandoff[],
  sel: Selecao,
): Array<{ conversa: ConversaEmHandoff; minutos: number }> {
  const out: Array<{ conversa: ConversaEmHandoff; minutos: number }> = [];
  for (const conversa of conversas) {
    const r = avaliarDevolucao(conversa, sel);
    if (r.devolver) out.push({ conversa, minutos: r.minutos });
  }
  return out;
}
