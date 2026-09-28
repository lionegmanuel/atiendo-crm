/**
 * Config numérica da classificação inicial A/B/C/D — confirmada por Matheus
 * em 2026-08-25, depois de uma rodada de revisão que MUDOU a regra de D (ver
 * `classificacao-inicial.ts` para o raciocínio completo). Os 3 valores:
 *
 *   1. `maxScoreConhecido: 100` — `respondent.score` do Respondi tratado como
 *      já numa escala 0-100. Não é medido (o Respondi não expõe o teto real
 *      por pergunta), é a leitura mais simples e consistente com as 2
 *      amostras reais vistas em produção (scores 40 e 55 — plausíveis nessa
 *      escala). Se um dia o painel do Respondi confirmar outro teto, troque
 *      só este número.
 *   2. `bandas` — A ≥70%, B 40-69%, C 1-39%. Mesma régua que
 *      `lib/kanban/score-band.ts` já usa pro score CONVERSACIONAL (quente/
 *      morno/frio = 70/40), reaproveitada por consistência de produto.
 *   3. Orçamento declarado NÃO tem mais um corte numérico próprio aqui — ver
 *      o cabeçalho de `classificacao-inicial.ts`: a decisão de 2026-08-25 foi
 *      que orçamento não pode, sozinho, forçar a classe D (uma empresa de
 *      alto potencial que declarou orçamento inicial modesto não pode
 *      despencar pra D só por isso). O único sinal de orçamento que ainda
 *      força D é a frase EXATA "Ainda não posso investir" — tratada como
 *      sinal direto do respondente, não como um corte que eu inventei.
 */
export interface BandaDePercentual {
  min: number;
  max: number;
}

export interface ConfigClassificacaoInicial {
  /** Teto do `respondent.score` do Respondi para este form_id. */
  maxScoreConhecido: number;
  /** Cortes de percentual (0-100) para as classes A/B/C. D não é banda de score — ver classificacao-inicial.ts. */
  bandas: { A: BandaDePercentual; B: BandaDePercentual; C: BandaDePercentual };
}

export const CONFIG_CLASSIFICACAO_INICIAL: ConfigClassificacaoInicial = {
  maxScoreConhecido: 100,
  bandas: {
    A: { min: 70, max: 100 },
    B: { min: 40, max: 69 },
    C: { min: 1, max: 39 },
  },
};
