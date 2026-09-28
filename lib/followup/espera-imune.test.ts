/**
 * A espera longa que sobrevive ao contato falar.
 *
 * Cada caso aqui defende uma peça de um mecanismo que só funciona inteiro: o
 * campo no nó (`immune_to_reply`), o piso de 24h que impede apontá-lo para o
 * próprio pé, e a projeção em `dormente` — que é o que tira a inscrição do
 * alcance da reatividade e libera o slot único anti-spam.
 *
 * O caso mais importante do arquivo é o de NÃO-REGRESSÃO: um `wait` sem a flag
 * tem de devolver exatamente o que devolvia antes. A feature inteira é invisível
 * para quem não a liga, e é isso que a torna segura de subir.
 */

import { describe, expect, it } from "vitest";

import { waitConfigSchema, type FlowNode } from "./graph-schema";
import { processNode } from "./node-handlers";
import { validateFlowForPublish } from "./validate-publish";

const NOW = new Date("2026-09-18T12:00:00.000Z");
const clock = () => NOW;
const VINTE_E_OITO_DIAS = 28 * 24 * 60 * 60 * 1000;

function enrollment() {
  return {
    id: "enr-1",
    organization_id: "org-1",
    contact_id: "c-1",
    current_node_id: "w1",
    steps_taken: 1,
    status: "active" as const,
    timing_plan: null,
  };
}

function lead() {
  return { id: "c-1", stage_id: null, tags: [] as string[] };
}

function noWait(immune: boolean, duracao = VINTE_E_OITO_DIAS): FlowNode {
  return {
    id: "w1",
    type: "wait",
    label: "Retorno",
    position: { x: 0, y: 0 },
    config: { mode: "fixed", duration_ms: duracao, ...(immune ? { immune_to_reply: true } : {}) },
  } as FlowNode;
}

const arestaSempre = {
  id: "e1",
  source: "w1",
  target: "a1",
  condition: { type: "always" as const },
  priority: 0,
};

describe("waitConfigSchema — immune_to_reply", () => {
  it("aceita a imunidade na espera fixa", () => {
    const r = waitConfigSchema.safeParse({
      mode: "fixed",
      duration_ms: VINTE_E_OITO_DIAS,
      immune_to_reply: true,
    });
    expect(r.success).toBe(true);
  });

  it("recusa a imunidade na espera adaptativa", () => {
    // `smart` é "a IA escolhe dentro de uma faixa"; faixa adaptativa com
    // imunidade é combinação que ninguém pediu. Quem recusa é o `strictObject`
    // do membro — de graça, sem código nosso.
    const r = waitConfigSchema.safeParse({
      mode: "smart",
      min_ms: 300_000,
      max_ms: VINTE_E_OITO_DIAS,
      immune_to_reply: true,
    });
    expect(r.success).toBe(false);
  });

  it("segue aceitando a espera fixa sem o campo", () => {
    const r = waitConfigSchema.safeParse({ mode: "fixed", duration_ms: 300_000 });
    expect(r.success).toBe(true);
  });
});

describe("processNode — wait imune projeta `dormente`", () => {
  it("dorme quando a espera é imune", () => {
    const r = processNode({
      node: noWait(true),
      edges: [arestaSempre],
      enrollment: enrollment(),
      lead: lead(),
      clock,
      waitElapsed: false,
    } as never);

    expect(r).toEqual({
      kind: "wait",
      next_eval_at: new Date(NOW.getTime() + VINTE_E_OITO_DIAS),
      wake_status: "dormente",
    });
  });

  it("NÃO dorme sem a flag — byte a byte o que devolvia antes", () => {
    // Não-regressão: todo fluxo que já existe passa por aqui a cada tick, e
    // `wake_status` ausente é o que mantém `engine.ts` escrevendo "active".
    const r = processNode({
      node: noWait(false),
      edges: [arestaSempre],
      enrollment: enrollment(),
      lead: lead(),
      clock,
      waitElapsed: false,
    } as never);

    expect(r).toEqual({
      kind: "wait",
      next_eval_at: new Date(NOW.getTime() + VINTE_E_OITO_DIAS),
    });
    expect("wake_status" in r).toBe(false);
  });

  it("ao vencer, avança como qualquer espera — quem acorda é o relógio", () => {
    // O dormente não tem despertador próprio: volta pelo mesmo claim, cai aqui
    // com `waitElapsed`, e segue. Um segundo agendador seria o `cron_jobs`
    // paralelo que esta entrega existe para dispensar.
    const r = processNode({
      node: noWait(true),
      edges: [arestaSempre],
      enrollment: enrollment(),
      lead: lead(),
      clock,
      waitElapsed: true,
    } as never);

    expect(r).toEqual({ kind: "advance", next_node_id: "a1", next_eval_at: NOW });
  });
});

describe("validatePublish — immune_wait_too_short", () => {
  function grafo(duracao: number, immune: boolean) {
    return {
      nodes: [
        { id: "t", type: "trigger", label: "t", position: { x: 0, y: 0 }, config: {} },
        {
          id: "w1",
          type: "wait",
          label: "espera",
          position: { x: 0, y: 0 },
          config: { mode: "fixed", duration_ms: duracao, ...(immune ? { immune_to_reply: true } : {}) },
        },
        {
          id: "a1",
          type: "action",
          label: "manda",
          position: { x: 0, y: 0 },
          config: { mode: "text", body: "oi" },
        },
        { id: "end", type: "end", label: "fim", position: { x: 0, y: 0 }, config: { outcome: "custom" } },
      ],
      edges: [
        { id: "e1", source: "t", target: "w1", condition: { type: "always" }, priority: 0 },
        { id: "e2", source: "w1", target: "a1", condition: { type: "always" }, priority: 0 },
        { id: "e3", source: "a1", target: "end", condition: { type: "always" }, priority: 0 },
      ],
    } as never;
  }

  function codigos(r: ReturnType<typeof validateFlowForPublish>) {
    return r.ok ? [] : r.errors.map((e) => e.code);
  }

  it("recusa imunidade em espera curta", () => {
    // Uma espera imune de dez minutos prende um lead no meio da conversa: ele
    // responde, e nada encurta a espera — que é o que a imunidade promete, e o
    // oposto do que se quer num intervalo curto.
    const r = validateFlowForPublish(grafo(600_000, true));
    expect(codigos(r)).toContain("immune_wait_too_short");
  });

  it("aceita imunidade a partir de 24h", () => {
    const r = validateFlowForPublish(grafo(86_400_000, true));
    expect(codigos(r)).not.toContain("immune_wait_too_short");
  });

  it("não cobra o piso de quem não é imune", () => {
    const r = validateFlowForPublish(grafo(600_000, false));
    expect(codigos(r)).not.toContain("immune_wait_too_short");
  });

  it("a regra do template continua valendo por cima da imune", () => {
    // `long_wait_needs_template` é a que torna o toque de 28 dias entregável
    // (janela de 24h do WhatsApp). A imunidade não a substitui nem a relaxa.
    //
    // Ela morde o nó de AÇÃO em `ai_message` sem `fallback_template_id` alcançado
    // por ≥24h de espera — texto fixo não tem fallback a exigir. Por isso este
    // caso troca a ação do grafo, em vez de reusar a de texto dos outros.
    const g = grafo(VINTE_E_OITO_DIAS, true) as unknown as {
      nodes: Array<{ id: string; config: Record<string, unknown> }>;
    };
    const acao = g.nodes.find((n) => n.id === "a1")!;
    acao.config = { mode: "ai_message", prompt_hint: "retome o retorno de manutenção" };

    const r = validateFlowForPublish(g as never);
    expect(codigos(r)).toContain("long_wait_needs_template");
  });
});
