/**
 * Plano de tempo de um follow-up — PURO, sem acesso a banco.
 *
 * O nó `wait` no modo "adaptativo" (`mode:'smart'`) oferece na tela um mínimo,
 * um máximo e uma orientação. Até aqui o motor ignorava os três e esperava
 * SEMPRE o máximo (`node-handlers.ts`, case `wait`): o controle existia na tela
 * e não existia no código.
 *
 * O plano conserta isso decidindo os instantes UMA VEZ, no acionamento do fluxo
 * (nó `trigger`), para TODAS as esperas adaptativas de uma vez — e não uma
 * decisão isolada por nó. Duas razões, nesta ordem:
 *
 *  1. **É estratégia, não reflexo.** Escolher bem a 1ª espera e mal a 3ª não é
 *     um plano; quem decide precisa ver a sequência inteira.
 *  2. **Não cria um terceiro estado no nó de espera.** `resolveWaitPhase`
 *     decide "já entrei neste nó?" pelo evento do passo anterior; um turno de
 *     decisão POR NÓ seria um terceiro estado indistinguível dos outros dois
 *     — a race que manteve esta feature parada. Sem turno por nó, não há race.
 *
 * O modelo PROPÕE; quem decide o intervalo é o nó. Proposta fora de
 * `[min_ms, max_ms]` é grampeada (`clampado:true`) e o valor original fica
 * guardado em `proposto_ms` — nunca aceita fora do combinado, nunca descartada
 * em silêncio (o operador precisa poder ler "a IA pediu 3 dias, seu limite era
 * 12h").
 *
 * Tudo aqui é tolerante a lixo: `timing_plan` é `jsonb` e um clone pode ter
 * qualquer coisa lá. Plano ilegível ⇒ a espera cai no comportamento anterior
 * (o máximo), NUNCA derruba o tick — degradar é aceitável, parar o follow-up
 * de todo mundo por um jsonb torto não é.
 */
import { z } from "zod";

import type { FlowNode } from "./graph-schema";

/** Uma espera adaptativa já decidida: o que a IA pediu, o que o nó permitiu, e por quê. */
export const esperaPlanejadaSchema = z.object({
  escolhido_ms: z.number().int().nonnegative(),
  min_ms: z.number().int().nonnegative(),
  max_ms: z.number().int().nonnegative(),
  /** O que o modelo propôs ANTES do clamp — o dossiê precisa poder mostrar a diferença. */
  proposto_ms: z.number().int(),
  clampado: z.boolean(),
  /** Frase curta em pt-br: é o que a tela mostra ao operador. Sem isto a feature vira caixa-preta. */
  motivo: z.string(),
});
export type EsperaPlanejada = z.infer<typeof esperaPlanejadaSchema>;

export const timingPlanSchema = z.object({
  decidido_em: z.string(),
  modelo: z.string(),
  esperas: z.record(z.string(), esperaPlanejadaSchema),
});
export type TimingPlan = z.infer<typeof timingPlanSchema>;

/** O que o planejador precisa saber sobre cada espera adaptativa do grafo pinado. */
export interface EsperaAdaptativa {
  node_id: string;
  label: string;
  min_ms: number;
  max_ms: number;
  guidance?: string;
}

/** Proposta crua do modelo para uma espera — antes do clamp. */
export interface PropostaDeEspera {
  node_id: string;
  aguardar_ms: number;
  motivo: string;
}

/**
 * As esperas adaptativas do grafo, na ordem em que aparecem. Vazio ⇒ o fluxo
 * não tem nada a planejar e o acionamento NÃO paga uma chamada de modelo.
 */
export function coletarEsperasAdaptativas(nodes: FlowNode[]): EsperaAdaptativa[] {
  const esperas: EsperaAdaptativa[] = [];
  for (const node of nodes) {
    if (node.type !== "wait" || node.config.mode !== "smart") continue;
    esperas.push({
      node_id: node.id,
      label: node.label,
      min_ms: node.config.min_ms,
      max_ms: node.config.max_ms,
      ...(node.config.guidance !== undefined ? { guidance: node.config.guidance } : {}),
    });
  }
  return esperas;
}

/**
 * Grampeia a proposta no intervalo do nó. Proposta não-finita (o modelo
 * devolveu lixo que passou pelo parse) degrada para o MÍNIMO — o lado seguro:
 * não prende o lead além do combinado por causa de um número inválido.
 */
export function clampEspera(
  propostoMs: number,
  minMs: number,
  maxMs: number,
): { escolhido_ms: number; clampado: boolean } {
  const base = Number.isFinite(propostoMs) ? Math.trunc(propostoMs) : minMs;
  const escolhido = Math.min(Math.max(base, minMs), maxMs);
  return { escolhido_ms: escolhido, clampado: escolhido !== base };
}

/**
 * Monta o plano a partir das propostas do modelo, clampando cada uma contra o
 * GRAFO PINADO (`esperas`) — nunca contra o que o payload do modelo afirma que
 * o intervalo era. Espera sem proposta correspondente fica FORA do plano: o nó
 * cai no comportamento anterior (máximo) em vez de receber um número inventado.
 */
export function montarTimingPlan(input: {
  esperas: EsperaAdaptativa[];
  propostas: PropostaDeEspera[];
  modelo: string;
  agora: Date;
}): TimingPlan {
  const porNo = new Map(input.propostas.map((p) => [p.node_id, p]));
  const esperas: Record<string, EsperaPlanejada> = {};

  for (const espera of input.esperas) {
    const proposta = porNo.get(espera.node_id);
    if (proposta === undefined) continue;
    const { escolhido_ms, clampado } = clampEspera(proposta.aguardar_ms, espera.min_ms, espera.max_ms);
    esperas[espera.node_id] = {
      escolhido_ms,
      min_ms: espera.min_ms,
      max_ms: espera.max_ms,
      proposto_ms: Number.isFinite(proposta.aguardar_ms) ? Math.trunc(proposta.aguardar_ms) : espera.min_ms,
      clampado,
      motivo: proposta.motivo,
    };
  }

  return { decidido_em: input.agora.toISOString(), modelo: input.modelo, esperas };
}

/**
 * A espera planejada deste nó, ou `null` se não houver plano legível para ele.
 * `null` é o caminho de compatibilidade: enrollment de antes desta feature,
 * fluxo sem espera adaptativa, plano corrompido ou nó ausente do plano — todos
 * caem no comportamento anterior. NUNCA lança.
 *
 * TUDO OU NADA, e é deliberado: o `safeParse` valida o plano INTEIRO, e `esperas`
 * é um `z.record` — uma única espera malformada invalida o record e esta função
 * devolve `null` para TODOS os nós, não só para o podre. O fluxo inteiro cai no
 * `max_ms`.
 *
 * A alternativa (parse por nó, aproveitando as esperas boas) foi recusada: um
 * plano meio-lido faz parte das esperas obedecerem à IA e parte ao teto, e
 * ninguém — nem o operador na tela, nem quem for depurar — consegue explicar a
 * mistura. Plano nenhum é um estado que se explica em uma frase; plano pela
 * metade, não.
 *
 * Consequência para QUEM EXIBE: a tela precisa ler por aqui, e não por um parse
 * próprio mais tolerante, senão ela mostra uma escolha que o motor não vai
 * cumprir. Se um dia a granularidade for desejada (exibir as boas e marcar a
 * podre), a troca do `record` por parse por-nó tem de acontecer nos dois lados no
 * MESMO commit.
 */
export function esperaPlanejadaDe(timingPlan: unknown, nodeId: string): EsperaPlanejada | null {
  if (timingPlan === null || timingPlan === undefined) return null;
  const parsed = timingPlanSchema.safeParse(timingPlan);
  if (!parsed.success) return null;
  return parsed.data.esperas[nodeId] ?? null;
}
