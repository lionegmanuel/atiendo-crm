/**
 * Detector determinístico de SINAL DE URGÊNCIA/SEGURANÇA na mensagem do lead — usado
 * SÓ para decidir prioridade de alerta humano quando o turno é adiado por cap de
 * envio (warm-up/diário), não para vetar nem alterar o que o modelo responde.
 *
 * Contexto: `pacingCapVeto` (`inbound-turn.ts`) já reagenda o job pra próxima abertura
 * quando o número está em warm-up/bateu o teto diário — sem isso o job morria
 * silenciosamente (medido em produção, 2026-08-29). Mas reagendar sozinho trata toda
 * mensagem represada como igual: um lead relatando risco de segurança (freio falhando,
 * cheiro de queimado, bateria esquentando — vocabulário que o PRÓPRIO prompt de um
 * agente em produção já pede pra tratar com cautela) espera a mesma janela
 * que um "bom dia" qualquer, às vezes 20h+. Este módulo dá ao runtime um jeito de medir
 * "isto parece grave" sem custo de LLM, pra abrir um alerta CRÍTICO imediato na Central
 * (kind='handoff') em vez de deixar o lead represado sem ninguém sabendo até o cap
 * resetar.
 *
 * Sem LLM (mesma disciplina de `human-promise.ts`/`promise/engine.ts`): léxico
 * genérico de risco/emergência, não amarrado a nenhum nicho (o produto é
 * multi-vertical — e-commerce, clínica, oficina, imobiliária). Conservador de
 * propósito: o custo de um falso negativo aqui é "o alerta crítico não dispara e o
 * lead espera o reagendamento normal" (o comportamento de hoje) — não perda de
 * mensagem. O custo de falso positivo é um alerta a mais na Central, tolerável.
 */

const URGENCY_PATTERN = new RegExp(
  '\\b(urgente|urgencia|emergencia|socorro|risco de vida|perigo|perigoso)\\b|' +
    '\\bpeg(ou|ando)\\s+fogo\\b|\\bincendio\\b|\\bfuma[cç]a\\b|\\bcheiro de queimado\\b|' +
    '\\bfa[íi]sca\\b|\\bchoque\\s+el[eé]trico\\b|\\bvazamento de g[aá]s\\b|' +
    '\\bn[aã]o\\s+(consigo|consegue|est[aá])\\s+respirando?\\b|\\bdesmaiou\\b|\\bsangrando\\b|' +
    '\\bsem\\s+freio\\b|\\bfreio\\s+n[aã]o\\s+(funciona|pega|segura)\\b|\\baquecendo\\s+muito\\b|' +
    '\\baquecimento\\s+anormal\\b',
  'i',
);

/** Normaliza minúsculas + sem diacríticos, mesma disciplina de `human-promise.ts`. */
function normalize(body: string): string {
  return body
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * True se o texto do lead bate um sinal de urgência/segurança. Vazio/whitespace =
 * false. Usado só como gatilho de PRIORIDADE de alerta — nunca para vetar/alterar
 * a resposta do modelo.
 */
export function detectUrgencySignal(body: string): boolean {
  if (body.trim() === '') return false;
  return URGENCY_PATTERN.test(normalize(body));
}
