import { describe, it, expect } from "vitest";

import {
  clampEspera,
  coletarEsperasAdaptativas,
  esperaPlanejadaDe,
  montarTimingPlan,
} from "./timing-plan";
import type { FlowNode } from "./graph-schema";

const AGORA = new Date("2026-08-10T12:00:00.000Z");

function waitSmart(id: string, min: number, max: number, guidance?: string): FlowNode {
  return {
    id,
    type: "wait",
    label: `Espera ${id}`,
    position: { x: 0, y: 0 },
    config: { mode: "smart", min_ms: min, max_ms: max, ...(guidance !== undefined ? { guidance } : {}) },
  };
}

const WAIT_FIXO: FlowNode = {
  id: "wf",
  type: "wait",
  label: "Espera fixa",
  position: { x: 0, y: 0 },
  config: { mode: "fixed", duration_ms: 300_000 },
};

const TRIGGER: FlowNode = { id: "t1", type: "trigger", label: "Início", position: { x: 0, y: 0 }, config: {} };

describe("coletarEsperasAdaptativas", () => {
  it("pega só as esperas adaptativas, na ordem do grafo, com a orientação de cada uma", () => {
    const esperas = coletarEsperasAdaptativas([
      TRIGGER,
      waitSmart("w1", 600_000, 1_800_000, "não insistir de madrugada"),
      WAIT_FIXO,
      waitSmart("w2", 3_600_000, 86_400_000),
    ]);
    expect(esperas).toEqual([
      { node_id: "w1", label: "Espera w1", min_ms: 600_000, max_ms: 1_800_000, guidance: "não insistir de madrugada" },
      { node_id: "w2", label: "Espera w2", min_ms: 3_600_000, max_ms: 86_400_000 },
    ]);
  });

  it("fluxo sem espera adaptativa devolve vazio — é o sinal de NÃO pagar uma chamada de modelo", () => {
    expect(coletarEsperasAdaptativas([TRIGGER, WAIT_FIXO])).toEqual([]);
  });
});

describe("clampEspera", () => {
  it("mantém o que já está dentro do intervalo", () => {
    expect(clampEspera(900_000, 600_000, 1_800_000)).toEqual({ escolhido_ms: 900_000, clampado: false });
  });

  it("grampeia acima do máximo", () => {
    expect(clampEspera(10_000_000, 600_000, 1_800_000)).toEqual({ escolhido_ms: 1_800_000, clampado: true });
  });

  it("grampeia abaixo do mínimo", () => {
    expect(clampEspera(1_000, 600_000, 1_800_000)).toEqual({ escolhido_ms: 600_000, clampado: true });
  });

  it("número não-finito degrada para o mínimo (lado seguro: não prende o lead além do combinado)", () => {
    expect(clampEspera(Number.NaN, 600_000, 1_800_000)).toEqual({ escolhido_ms: 600_000, clampado: false });
    expect(clampEspera(Number.POSITIVE_INFINITY, 600_000, 1_800_000)).toEqual({
      escolhido_ms: 600_000,
      clampado: false,
    });
  });
});

describe("montarTimingPlan", () => {
  const esperas = [
    { node_id: "w1", label: "A", min_ms: 600_000, max_ms: 1_800_000 },
    { node_id: "w2", label: "B", min_ms: 3_600_000, max_ms: 86_400_000 },
  ];

  it("clampa contra o GRAFO, e guarda o que a IA pediu antes do clamp", () => {
    const plano = montarTimingPlan({
      esperas,
      propostas: [{ node_id: "w1", aguardar_ms: 3 * 86_400_000, motivo: "esperar 3 dias" }],
      modelo: "anthropic/claude-sonnet-4-6",
      agora: AGORA,
    });
    expect(plano.esperas.w1).toEqual({
      escolhido_ms: 1_800_000,
      min_ms: 600_000,
      max_ms: 1_800_000,
      proposto_ms: 3 * 86_400_000,
      clampado: true,
      motivo: "esperar 3 dias",
    });
    expect(plano.modelo).toBe("anthropic/claude-sonnet-4-6");
    expect(plano.decidido_em).toBe(AGORA.toISOString());
  });

  it("espera sem proposta fica FORA do plano — quem não foi decidido cai no máximo depois", () => {
    const plano = montarTimingPlan({
      esperas,
      propostas: [{ node_id: "w1", aguardar_ms: 900_000, motivo: "ok" }],
      modelo: "m",
      agora: AGORA,
    });
    expect(Object.keys(plano.esperas)).toEqual(["w1"]);
  });

  it("proposta para nó que não é espera adaptativa do fluxo é ignorada", () => {
    const plano = montarTimingPlan({
      esperas,
      propostas: [{ node_id: "fantasma", aguardar_ms: 900_000, motivo: "x" }],
      modelo: "m",
      agora: AGORA,
    });
    expect(plano.esperas).toEqual({});
  });
});

describe("esperaPlanejadaDe", () => {
  const plano = montarTimingPlan({
    esperas: [{ node_id: "w1", label: "A", min_ms: 600_000, max_ms: 1_800_000 }],
    propostas: [{ node_id: "w1", aguardar_ms: 900_000, motivo: "ok" }],
    modelo: "m",
    agora: AGORA,
  });

  it("devolve a espera do nó pedido", () => {
    expect(esperaPlanejadaDe(plano, "w1")?.escolhido_ms).toBe(900_000);
  });

  it("nó ausente do plano devolve null", () => {
    expect(esperaPlanejadaDe(plano, "w9")).toBeNull();
  });

  it("null/undefined devolvem null — enrollment de antes da feature", () => {
    expect(esperaPlanejadaDe(null, "w1")).toBeNull();
    expect(esperaPlanejadaDe(undefined, "w1")).toBeNull();
  });

  // O jsonb de um clone pode ter QUALQUER coisa. Degradar é o desfecho certo;
  // lançar aqui derrubaria o tick de todos os follow-ups por causa de uma linha.
  it("jsonb corrompido devolve null em vez de lançar", () => {
    expect(esperaPlanejadaDe({ esperas: "isto não é objeto" }, "w1")).toBeNull();
    expect(esperaPlanejadaDe("nem é objeto", "w1")).toBeNull();
    expect(esperaPlanejadaDe({ esperas: { w1: { escolhido_ms: "muito tempo" } } }, "w1")).toBeNull();
    expect(esperaPlanejadaDe(42, "w1")).toBeNull();
  });
});
