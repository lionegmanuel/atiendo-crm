import { describe, it, expect } from "vitest";

import { toReactFlow, fromReactFlow, graphsEqual } from "./graph-mappers";
import type { FlowGraph } from "./graph-schema";

/** Exercises all 6 node types + all 3 edge condition variants, non-trivial positions. */
const SAMPLE_GRAPH: FlowGraph = {
  nodes: [
    { id: "n1", type: "trigger", label: "Início", position: { x: 12.5, y: -30 }, config: {} },
    {
      id: "n2",
      type: "wait",
      label: "Aguardar 10min",
      position: { x: 240, y: 100 },
      config: { mode: "fixed", duration_ms: 600_000 },
    },
    {
      id: "n3",
      type: "wait",
      label: "Aguardar smart",
      position: { x: 480, y: 100 },
      config: { mode: "smart", min_ms: 300_000, max_ms: 3_600_000, guidance: "seja breve" },
    },
    {
      id: "n4",
      type: "condition",
      label: "Cliente engajado?",
      position: { x: 240, y: 260 },
      config: {
        combinator: "or",
        checks: [
          { field: "steps_taken", op: "gte", value: 2 },
          { field: "tag", op: "contains", value: "vip" },
        ],
      },
    },
    {
      id: "n5",
      type: "ai_classify",
      label: "Classificar resposta",
      position: { x: 480, y: 260 },
      config: {
        classes: ["hot", "cold"],
        grace_timeout_ms: 900_000,
        target: "last_reply",
        hint: "responda em pt-br",
      },
    },
    {
      id: "n6",
      type: "action",
      label: "Enviar mensagem",
      position: { x: 720, y: 100 },
      config: { mode: "ai_message", prompt_hint: "reforce o benefício" },
    },
    {
      id: "n7",
      type: "action",
      label: "Enviar template",
      position: { x: 720, y: 260 },
      config: { mode: "template", template_id: "11111111-1111-4111-8111-111111111111" },
    },
    {
      id: "n8",
      type: "end",
      label: "Fim — convertido",
      position: { x: 960, y: 180 },
      config: { outcome: "converted", note: "cliente comprou" },
    },
  ],
  edges: [
    { id: "e1", source: "n1", target: "n2", priority: 0, condition: { type: "always" } },
    { id: "e2", source: "n2", target: "n4", priority: 1, condition: { type: "always" } },
    {
      id: "e3",
      source: "n5",
      target: "n6",
      priority: 0,
      condition: { type: "class_match", value: "hot" },
    },
    {
      id: "e4",
      source: "n4",
      target: "n7",
      priority: 2,
      condition: { type: "cond_result", value: true },
    },
    { id: "e5", source: "n6", target: "n8", priority: 0, condition: { type: "always" } },
  ],
};

describe("graph-mappers", () => {
  it("toReactFlow → fromReactFlow round-trips the graph exactly", () => {
    const { nodes, edges } = toReactFlow(SAMPLE_GRAPH);
    const roundTripped = fromReactFlow(nodes, edges);
    expect(roundTripped).toEqual(SAMPLE_GRAPH);
  });

  it("preserves positions through the round trip (not just deep-equal on the whole graph)", () => {
    const { nodes } = toReactFlow(SAMPLE_GRAPH);
    const moved = nodes.map((n) => ({ ...n, position: { x: n.position.x + 5, y: n.position.y - 5 } }));
    const roundTripped = fromReactFlow(moved, toReactFlow(SAMPLE_GRAPH).edges);
    for (const original of SAMPLE_GRAPH.nodes) {
      const moved2 = roundTripped.nodes.find((n) => n.id === original.id)!;
      expect(moved2.position).toEqual({ x: original.position.x + 5, y: original.position.y - 5 });
    }
  });

  it("preserves each node's config object through the round trip", () => {
    const { nodes, edges } = toReactFlow(SAMPLE_GRAPH);
    const roundTripped = fromReactFlow(nodes, edges);
    for (const original of SAMPLE_GRAPH.nodes) {
      const found = roundTripped.nodes.find((n) => n.id === original.id)!;
      expect(found.config).toEqual(original.config);
      expect(found.type).toBe(original.type);
      expect(found.label).toBe(original.label);
    }
  });

  it("defaults missing edge data to an always/priority-0 condition (defensive, not exercised by valid graphs)", () => {
    const edgeWithoutData = { id: "bare", source: "n1", target: "n2" };
    const result = fromReactFlow([], [edgeWithoutData]);
    expect(result.edges).toEqual([
      { id: "bare", source: "n1", target: "n2", priority: 0, condition: { type: "always" } },
    ]);
  });

  it("round-trips the minimal 2-node graph (schema floor)", () => {
    const minimal: FlowGraph = {
      nodes: [
        { id: "a", type: "trigger", label: "A", position: { x: 0, y: 0 }, config: {} },
        { id: "b", type: "end", label: "B", position: { x: 100, y: 0 }, config: { outcome: "exhausted" } },
      ],
      edges: [{ id: "ab", source: "a", target: "b", priority: 0, condition: { type: "always" } }],
    };
    const { nodes, edges } = toReactFlow(minimal);
    expect(fromReactFlow(nodes, edges)).toEqual(minimal);
  });
});

describe("graphsEqual", () => {
  it("is true for the same graph reconstructed with different key order", () => {
    const a: FlowGraph = {
      nodes: [{ id: "a", type: "trigger", label: "A", position: { x: 0, y: 0 }, config: {} }],
      edges: [],
    };
    // Same content, keys inserted in a different order (simulates a jsonb round trip).
    const b: FlowGraph = {
      edges: [],
      nodes: [{ position: { y: 0, x: 0 }, label: "A", type: "trigger", id: "a", config: {} }],
    };
    expect(graphsEqual(a, b)).toBe(true);
  });

  it("is false when a position or config actually differs", () => {
    const a: FlowGraph = {
      nodes: [{ id: "a", type: "trigger", label: "A", position: { x: 0, y: 0 }, config: {} }],
      edges: [],
    };
    const b: FlowGraph = {
      nodes: [{ id: "a", type: "trigger", label: "A", position: { x: 1, y: 0 }, config: {} }],
      edges: [],
    };
    expect(graphsEqual(a, b)).toBe(false);
  });
});

/**
 * `sourceHandle` é derivado da condição da aresta, nunca guardado no grafo. Sem
 * isto, reabrir um fluxo salvo desenharia TODA aresta saindo da primeira
 * bolinha: o roteamento seguiria certo e só o desenho mentiria — defeito que
 * ninguém percebe a tempo, porque nada quebra.
 */
describe("toReactFlow — de qual bolinha a aresta sai", () => {
  const GRAFO: FlowGraph = {
    nodes: [
      { id: "t1", type: "trigger", label: "Início", position: { x: 0, y: 0 }, config: {} },
      {
        id: "c1",
        type: "condition",
        label: "Triagem",
        position: { x: 0, y: 100 },
        config: {
          combinator: "and",
          branching: "per_check",
          checks: [
            { id: "chk_vip", label: "VIP", field: "tag", op: "contains", value: "vip" },
            { id: "chk_frio", field: "steps_taken", op: "gte", value: 3 },
          ],
        },
      },
      { id: "fim", type: "end", label: "Fim", position: { x: 0, y: 200 }, config: { outcome: "exhausted" } },
    ],
    edges: [
      { id: "x1", source: "t1", target: "c1", priority: 0, condition: { type: "always" } },
      { id: "x2", source: "c1", target: "fim", priority: 0, condition: { type: "branch", branch_id: "chk_vip" } },
      { id: "x3", source: "c1", target: "fim", priority: 0, condition: { type: "branch", branch_id: "chk_frio" } },
      { id: "x4", source: "c1", target: "fim", priority: 0, condition: { type: "always" } },
    ],
  };

  const bySourceHandle = () =>
    Object.fromEntries(toReactFlow(GRAFO).edges.map((e) => [e.id, e.sourceHandle]));

  it("cada aresta de um nó que ramifica volta ancorada no SEU ramo", () => {
    const handles = bySourceHandle();
    expect(handles.x2).toBe("chk_vip");
    expect(handles.x3).toBe("chk_frio");
    expect(handles.x4).toBe("else"); // a saída "nenhuma delas"
  });

  it("nó de saída única não ganha handle nomeado — a bolinha de sempre no rodapé", () => {
    expect(bySourceHandle().x1).toBeUndefined();
  });

  it("o campo é derivado: a volta pelo mapper não o grava no grafo", () => {
    const { nodes, edges } = toReactFlow(GRAFO);
    expect(fromReactFlow(nodes, edges)).toEqual(GRAFO);
  });
});
