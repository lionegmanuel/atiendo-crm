/**
 * QUANDO A RECUSA POR ENDEREÇO PRÓPRIO SEM CHAVE DA EMPRESA PASSA A VALER.
 *
 * A decisão 22-a do dono do produto — "endereço próprio exige chave própria da
 * empresa" — continua de pé. O que esta regra decide é **o degrau final**, e o
 * porquê é de versionamento, não de segurança:
 *
 * Recusar no instante da atualização obriga quem opera a agir ANTES de
 * atualizar (abrir Agente de IA › Provedores em cada empresa), sob pena de a IA
 * de uma empresa parar de responder aos clientes. Pela régua de
 * `docs/doctrine/versionamento.md`, "antes de atualizar você precisa fazer
 * algo" é **major** — e a decisão do dono (19/09/2026, doc 40) é que major só
 * sai quando ele pedir.
 *
 * Então a mudança entra em DOIS tempos:
 *
 *   1. **Agora:** a chamada SEGUE, e o aviso crítico abre na Central com a DATA
 *      em que ela deixará de seguir. Ninguém precisa agir para atualizar, e o
 *      operador tem semanas — não segundos — para corrigir.
 *   2. **A partir de `RECUSA_A_PARTIR_DE`:** a recusa entra sozinha, sem
 *      depender de ninguém reabrir o assunto. É este arquivo que faz a virada,
 *      e é ele que o teste exercita com o relógio injetado.
 *
 * A data é ABSOLUTA, e não "30 dias a partir da atualização": quem lê o alerta
 * três semanas depois precisa saber o dia, não uma contagem que já correu.
 */

/**
 * O dia em que a recusa passa a valer, em ISO (UTC). São ~30 dias a partir da
 * versão que leva o aviso (19/09/2026) — prazo declarado, não medido: é a
 * janela que o dono do produto escolheu para o parque se ajustar.
 *
 * Mover esta data para frente é afrouxar um degrau que já foi anunciado a quem
 * opera. Se for preciso, que seja com a razão escrita aqui e o aviso refeito.
 */
export const RECUSA_A_PARTIR_DE = "2026-10-19T00:00:00.000Z";

/** Como a data aparece para quem lê o aviso na Central e em Execuções. */
export function prazoLegivel(iso: string = RECUSA_A_PARTIR_DE): string {
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

export type DegrauDoEnderecoProprio = "avisa" | "recusa";

/**
 * A pergunta inteira, pura e sem I/O: neste instante, a combinação "endereço
 * próprio da empresa + chave da instalação" é avisada ou recusada?
 *
 * `agora` é injetado sempre — sem relógio injetável a virada nunca é
 * exercitada, e o dia do corte vira surpresa em produção.
 */
export function degrauDoEnderecoProprio(
  agora: Date,
  aPartirDe: string = RECUSA_A_PARTIR_DE,
): DegrauDoEnderecoProprio {
  return agora.getTime() >= Date.parse(aPartirDe) ? "recusa" : "avisa";
}
