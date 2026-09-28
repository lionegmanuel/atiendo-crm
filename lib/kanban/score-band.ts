/**
 * A faixa do score, e a regra que a impede de piscar.
 *
 * Score é número contínuo; faixa é rótulo. Toda vez que um número contínuo vira
 * rótulo por limiar simples, ele oscila na fronteira: 59, 61, 58, 62 viram
 * morno, quente, morno, quente — e o card pisca a cada recálculo. Sinal que
 * pisca é sinal em que o usuário para de olhar, e aí o score vira enfeite.
 *
 * A saída é HISTERESE: para SUBIR de faixa o score precisa passar do limiar
 * mais a banda; para DESCER, precisa cair abaixo do limiar menos a banda. Entre
 * os dois, a faixa anterior permanece — a fronteira deixa de ser um ponto e
 * vira uma zona onde nada muda.
 */
export type ScoreBand = "frio" | "morno" | "quente";

/** Os rótulos, exaustivos por construção — `Record` fechado, não `<string, string>`. */
export const SCORE_BAND_LABELS = {
  frio: "Frio",
  morno: "Morno",
  quente: "Quente",
} as const satisfies Record<ScoreBand, string>;

/**
 * Limiares de SUBIDA. Descer usa o mesmo número menos a banda morta.
 *
 * Escolhidos redondos de propósito: são convenção de produto, não resultado de
 * calibração — fingir precisão em número inventado é pior que assumir a
 * convenção.
 */
export const LIMIAR_QUENTE = 70;
export const LIMIAR_MORNO = 40;

/**
 * Banda morta em pontos percentuais.
 *
 * 5 pontos: largo o bastante para absorver a variação de um recálculo por
 * chegada de mensagem, estreito o bastante para o card não ficar preso numa
 * faixa que já não descreve o lead.
 */
export const BANDA = 5;

/**
 * Os pisos/tetos ALCANÇÁVEIS de cada faixa, dada a histerese — a fonte única.
 *
 * O banco tem um CHECK de coerência com estes mesmos números, e a UI pinta com
 * eles: valor persistido que PARECE derivado pode divergir da fonte, e três
 * cópias do mesmo corte seria a quarta lista à mão nascendo dentro da wave que
 * nasceu para acabar com listas à mão.
 *
 * `quente` só é alcançável a partir de `LIMIAR_QUENTE`, mas SE MANTÉM até
 * `LIMIAR_QUENTE - BANDA` (é o que a histerese faz). Por isso o piso do CHECK é
 * 65 e não 70: gravar 'quente' com 67 é legítimo (o lead está descendo e ainda
 * não confirmou), gravar com 40 é impossível.
 */
export const FAIXA_LIMITES = {
  quente: { min: LIMIAR_QUENTE - BANDA, max: 100 },
  morno: { min: LIMIAR_MORNO - BANDA, max: LIMIAR_QUENTE + BANDA },
  frio: { min: 0, max: LIMIAR_MORNO + BANDA },
} as const satisfies Record<ScoreBand, { min: number; max: number }>;

/** A faixa que o score indicaria se não houvesse memória nenhuma. */
function faixaCrua(score: number): ScoreBand {
  if (score >= LIMIAR_QUENTE) return "quente";
  if (score >= LIMIAR_MORNO) return "morno";
  return "frio";
}

/**
 * A faixa nova, dada a anterior — o coração da histerese.
 *
 * `anterior === null` é primeira leitura: sem memória não há o que segurar, e a
 * faixa crua vale. Note que a assimetria é deliberada: a zona morta protege a
 * faixa que já estava, seja ela qual for, em vez de favorecer subida ou descida.
 */
/** Da mais fria para a mais quente — a escada que a histerese sobe e desce. */
const ESCADA: readonly ScoreBand[] = ["frio", "morno", "quente"] as const;
const ORDEM: Record<ScoreBand, number> = { frio: 0, morno: 1, quente: 2 };

/** O limiar de ENTRADA de uma faixa — o mesmo por onde ela é abandonada. */
const LIMIAR_DE: Record<ScoreBand, number> = {
  quente: LIMIAR_QUENTE,
  morno: LIMIAR_MORNO,
  frio: 0,
};

/**
 * A faixa nova, dada a anterior — UM DEGRAU POR VEZ.
 *
 * A histerese é uma propriedade de cada FRONTEIRA, não da faixa como um todo:
 * subir para quente exige confirmar a fronteira morno→quente, e descer de
 * quente exige confirmar a saída de quente. Tratar "mudou de faixa" como um
 * evento único produziu dois defeitos que o invariante de coerência pegou —
 *
 *   resolveBand(36, "quente") devolvia "quente": testava a fronteira da faixa
 *   CRUA (frio/morno) em vez da que estava sendo cruzada;
 *   resolveBand(70, "frio") devolvia "frio": não confirmava quente (precisa 75)
 *   e, em vez de parar em morno — que ESTAVA confirmado —, segurava a original.
 *
 * Os dois casos gravariam faixa incompatível com o score, e o CHECK do banco
 * recusaria: o defeito só apareceria em produção, no lead que oscila muito.
 * Percorrer a escada degrau a degrau elimina a classe inteira em vez de tapar
 * os dois buracos conhecidos.
 */
export function resolveBand(score: number, anterior: ScoreBand | null): ScoreBand {
  if (anterior === null) return faixaCrua(score);

  let atual = anterior;
  // Sobe enquanto a fronteira seguinte estiver confirmada (limiar + banda).
  while (ORDEM[atual] < ESCADA.length - 1) {
    const acima = ESCADA[ORDEM[atual] + 1]!;
    if (score < LIMIAR_DE[acima] + BANDA) break;
    atual = acima;
  }
  // Desce enquanto a SAÍDA da faixa atual estiver confirmada (limiar - banda).
  while (ORDEM[atual] > 0) {
    if (score > LIMIAR_DE[atual] - BANDA) break;
    atual = ESCADA[ORDEM[atual] - 1]!;
  }
  return atual;
}

/** Rótulo para exibir. Fechado: tipo novo sem rótulo não compila. */
export function bandLabel(
  band: ScoreBand,
  t: (texto: string) => string = (texto) => texto,
): string {
  return t(SCORE_BAND_LABELS[band]);
}
