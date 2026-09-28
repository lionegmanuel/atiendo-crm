/**
 * A janela aceitável de um retorno agendado — UMA definição, dois runtimes.
 *
 * O motor do agente roda no worker (`lib/agent-engine/env.ts`, zod sobre o env do
 * processo) e as capacidades configuráveis rodam dentro do Next. Os dois precisam
 * concordar sobre "cedo demais" e "distante demais": se divergirem, o agendamento
 * feito pela tool que o dono da clínica ligou na tela seria aceito num caminho e
 * recusado no outro, pelo MESMO horário — e ninguém saberia dizer qual está certo.
 *
 * Por isso os números moram aqui, sem import nenhum: este módulo é folha e pode
 * ser carregado tanto pelo bundle do Next quanto pelo worker. Os defaults do zod
 * do worker apontam para estas constantes; o lado do Next lê as MESMAS variáveis
 * de ambiente por `resolveJanelaDeRetorno`.
 */

/** Antecedência mínima: antes disso o retorno é "muito cedo" (FOLLOWUP_MIN_AHEAD_MS). */
export const RETORNO_MIN_AHEAD_MS_PADRAO = 300_000; // 5 min

/** Horizonte máximo: além disso o retorno é "muito distante" (FOLLOWUP_MAX_AHEAD_MS). */
export const RETORNO_MAX_AHEAD_MS_PADRAO = 15_552_000_000; // 180 dias

/** Janela do stagger determinístico anti-rajada, herdada do cron (CRON_STAGGER_WINDOW_MS). */
export const RETORNO_STAGGER_WINDOW_MS_PADRAO = 60_000;

export interface JanelaDeRetorno {
  minAheadMs: number;
  maxAheadMs: number;
  staggerWindowMs: number;
}

/**
 * Lê um inteiro positivo do ambiente, caindo no padrão quando ausente ou lixo.
 *
 * Cair no padrão em vez de lançar é deliberado: este resolvedor roda no caminho
 * de uma tool, e derrubar o turno do agente porque alguém escreveu `abc` numa
 * variável opcional trocaria um agendamento fora da janela por nenhum
 * agendamento. O worker já valida as mesmas variáveis com zod na subida, que é
 * onde um valor inválido deve aparecer barulhento.
 */
function inteiroPositivo(bruto: string | undefined, padrao: number): number {
  if (bruto === undefined) return padrao;
  const n = Number(bruto);
  return Number.isInteger(n) && n > 0 ? n : padrao;
}

export function resolveJanelaDeRetorno(
  env: Record<string, string | undefined>,
): JanelaDeRetorno {
  return {
    minAheadMs: inteiroPositivo(env.FOLLOWUP_MIN_AHEAD_MS, RETORNO_MIN_AHEAD_MS_PADRAO),
    maxAheadMs: inteiroPositivo(env.FOLLOWUP_MAX_AHEAD_MS, RETORNO_MAX_AHEAD_MS_PADRAO),
    // min 0 é válido no stagger (desliga o espalhamento), então o parse é próprio.
    staggerWindowMs: (() => {
      const n = Number(env.CRON_STAGGER_WINDOW_MS);
      return Number.isInteger(n) && n >= 0 ? n : RETORNO_STAGGER_WINDOW_MS_PADRAO;
    })(),
  };
}
