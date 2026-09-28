/**
 * O TEMPO QUE A IA ESCOLHEU — o lado da LEITURA do `timing_plan`.
 *
 * Quem PRODUZ o plano é `timing-plan.ts` (o motor, migration 0144): ele decide
 * os instantes de todas as esperas adaptativas de uma vez, no acionamento do
 * fluxo. Aqui só se lê, para o dossiê mostrar quanto a IA escolheu, por quê, e
 * se a escolha bateu no limite que o dono do fluxo configurou.
 *
 * ⚠️ O PLANO É TUDO-OU-NADA, E ISSO É DECISÃO DO PRODUTOR. `timingPlanSchema`
 * valida `esperas` como um `z.record`: UMA espera malformada invalida o registro
 * inteiro, e o motor devolve `null` para TODOS os nós — o fluxo cai no `max_ms`
 * em cada espera, não só na podre. É deliberado do lado dele (plano meio-lido
 * seria pior: parte das esperas obedeceria à IA e parte ao teto, sem ninguém
 * conseguir explicar a mistura), e é por isso que esta tela não mostra bloco
 * nenhum quando o plano não valida — mostrar as esperas boas prometeria o que o
 * motor não vai fazer. Se um dia a granularidade for desejada, a mudança é nos
 * DOIS lados no mesmo commit; ver o cabeçalho de `timing-plan.ts`.
 *
 * ⚠️ O CRITÉRIO DE ACEITE É O DO MOTOR, NÃO UM PARALELO. `esperaPlanejadaDe`
 * (timing-plan.ts) faz `timingPlanSchema.safeParse` do plano INTEIRO e, se
 * falhar, ignora o plano todo — a espera cai no comportamento anterior (o
 * máximo). Uma leitura mais tolerante aqui produziria a pior tela possível:
 * "a IA escolheu 4 horas" sobre um plano que o motor está descartando, e o
 * operador veria uma decisão que não aconteceu. Quando um dos dois lados
 * recusa, os dois recusam — por isso este arquivo NÃO tem schema próprio.
 */
import { timingPlanSchema, type EsperaPlanejada, type TimingPlan } from "./timing-plan";
import { duracaoLegivel } from "./eventos-legiveis";

export type { EsperaPlanejada, TimingPlan };

/**
 * O plano como a tela o usa, ou `null`.
 *
 * `null` cobre três casos que a tela trata igual — e trata igual de propósito:
 * fluxo v1 (coluna nunca escrita), fluxo só com espera fixa (nada a planejar) e
 * plano ilegível (o motor também o ignora). Nos três, o bloco não é desenhado.
 * Um placeholder afirmaria que houve decisão da IA onde não houve.
 */
export function leituraDoPlano(bruto: unknown): TimingPlan | null {
  if (bruto === null || bruto === undefined) return null;
  const parsed = timingPlanSchema.safeParse(bruto);
  if (!parsed.success) return null;
  if (Object.keys(parsed.data.esperas).length === 0) return null;
  return parsed.data;
}

export interface EsperaLegivel {
  /** Quanto o follow-up vai de fato esperar. */
  escolhido: string;
  /** O intervalo que o dono do fluxo configurou no nó. */
  faixa: string;
  /** A frase curta que o modelo deu — o que transforma telemetria em explicação. */
  motivo: string;
  /**
   * O que a IA PEDIU, quando foi grampeada. `null` quando a escolha coube no
   * intervalo — aí não há diferença a contar.
   */
  pedido: string | null;
}

/**
 * A espera em frases prontas para a tela.
 *
 * `pedido` existe porque o produtor guarda `proposto_ms` justamente para isto:
 * sem ele, "bateu no seu limite" diz que houve um corte e não diz de quanto —
 * e é o tamanho do corte que decide se o operador vai mexer no nó. Guardar o
 * dado e não mostrá-lo seria o mesmo defeito que este dossiê existe para
 * consertar, uma camada acima.
 */
export function descreveEspera(espera: EsperaPlanejada): EsperaLegivel {
  return {
    escolhido: duracaoLegivel(espera.escolhido_ms),
    faixa: `seu limite: de ${duracaoLegivel(espera.min_ms)} a ${duracaoLegivel(espera.max_ms)}`,
    motivo: espera.motivo,
    pedido: espera.clampado ? duracaoLegivel(espera.proposto_ms) : null,
  };
}
