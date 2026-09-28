/**
 * Wave 2 — a precedência do slot é uma função pura, não um encadeado de `&&`
 * dentro do JSX. Se alguém reimplementar isso no componente, estes testes
 * continuam passando e o card diverge em silêncio: por isso o card CONSOME
 * daqui (ver KanbanCard.tsx) em vez de decidir sozinho.
 */
import { describe, it, expect } from "vitest";

import { resolveCardState, coolingLabel, stageAgeLabel, type CardInput } from "./card-state";

const base: CardInput = {
  id: "l-1",
  title: "Clínica Vitalis — implantes",
  valueCents: 1_240_000,
  currency: "BRL",
  owner: { kind: "user", name: "Maria Silva", agentVersion: null },
  stageName: "Negociação",
  hoursInStage: 5,
  isCooling: false,
  tags: [],
};

describe("resolveCardState — precedência estrita", () => {
  it("sem sinal nenhum: normal, borda neutra, slot reservado (não some)", () => {
    expect(resolveCardState(base)).toEqual({
      kind: "normal",
      border: "neutral",
      slot: { type: "idle" },
      showStageAge: true,
    });
  });

  it("com score: medidor, ainda neutro — número não é alarme", () => {
    expect(resolveCardState({ ...base, probability: 72, band: "quente" as const })).toEqual({
      kind: "normal",
      border: "neutral",
      slot: { type: "meter", probability: 72, band: "quente", reason: "", factors: [] },
      showStageAge: true,
    });
  });

  // UM relógio por card: enquanto "tempo no estágio" e "tempo sem resposta"
  // saem os dois de last_activity_at, mostrar ambos é o mesmo número duas vezes.
  it("esfriando: o slot conta o tempo, o rodapé cala o número", () => {
    expect(resolveCardState({ ...base, isCooling: true }).showStageAge).toBe(false);
  });

  it("aguardando e normal: o rodapé mantém o relógio", () => {
    expect(resolveCardState({ ...base, nextAction: { label: "Ligar" } }).showStageAge).toBe(true);
    expect(resolveCardState({ ...base, probability: 10, band: "frio" as const }).showStageAge).toBe(true);
    expect(resolveCardState(base).showStageAge).toBe(true);
  });

  it("esfriando E aguardando: quem manda é o slot de cima, e o relógio volta", () => {
    // "Aguardando você" não conta tempo, então o rodapé volta a mostrá-lo —
    // continua havendo exatamente UM relógio no card.
    const r = resolveCardState({ ...base, isCooling: true, nextAction: { label: "Ligar" } });
    expect(r.kind).toBe("awaiting");
    expect(r.showStageAge).toBe(true);
  });

  it("esfriando vence o score", () => {
    const r = resolveCardState({ ...base, probability: 72, band: "quente" as const, isCooling: true, hoursInStage: 144 });
    expect(r.kind).toBe("cooling");
    expect(r.border).toBe("warning");
    expect(r.slot).toEqual({ type: "cooling", label: "Sem resposta há 6 dias" });
  });

  it("aguardando decisão vence esfriando E score (cenário 24 do briefing)", () => {
    const r = resolveCardState({
      ...base,
      probability: 72,
      band: "quente" as const,
      isCooling: true,
      hoursInStage: 144,
      nextAction: { label: "Enviar proposta" },
    });
    expect(r.kind).toBe("awaiting");
    expect(r.border).toBe("accent");
    expect(r.slot).toEqual({ type: "awaiting", label: "Enviar proposta" });
  });

  it("nunca acumula: o slot é sempre UM", () => {
    const cheio = resolveCardState({
      ...base,
      probability: 72,
      band: "quente" as const,
      isCooling: true,
      nextAction: { label: "Ligar" },
    });
    expect(Object.keys(cheio.slot)).toHaveLength(2); // { type, label }
    expect(cheio.slot.type).toBe("awaiting");
  });

  it("próxima ação vazia não conta como decisão pendente", () => {
    expect(resolveCardState({ ...base, nextAction: { label: "" } }).kind).toBe("normal");
    expect(resolveCardState({ ...base, nextAction: null }).kind).toBe("normal");
  });

  it("probabilidade é limitada a 0-100 e arredondada", () => {
    const acima = resolveCardState({ ...base, probability: 120.6, band: "quente" as const }).slot;
    const abaixo = resolveCardState({ ...base, probability: -5, band: "frio" as const }).slot;
    expect(acima).toEqual({ type: "meter", probability: 100, band: "quente", reason: "", factors: [] });
    expect(abaixo).toEqual({ type: "meter", probability: 0, band: "frio", reason: "", factors: [] });
  });

  it("probabilidade 0 é um valor, não ausência de valor", () => {
    expect(resolveCardState({ ...base, probability: 0, band: "frio" as const }).slot).toEqual({
      type: "meter",
      probability: 0,
      band: "frio",
      reason: "",
      factors: [],
    });
  });
});

describe("rótulos de tempo", () => {
  it("coolingLabel: horas viram dias depois de 48h", () => {
    expect(coolingLabel(6)).toBe("Sem resposta há 6h");
    expect(coolingLabel(144)).toBe("Sem resposta há 6 dias");
    expect(coolingLabel(0.5)).toBe("Sem resposta");
    expect(coolingLabel(null)).toBe("Sem resposta");
  });

  it("stageAgeLabel: compacto, cabe no rodapé", () => {
    expect(stageAgeLabel(72)).toBe("3d");
    expect(stageAgeLabel(5)).toBe("5h");
    expect(stageAgeLabel(0.2)).toBe("agora");
    expect(stageAgeLabel(null)).toBe("");
  });
});

/**
 * A PROPOSTA DE RETOMADA na faixa ③ (wave 7, cenário 23).
 *
 * A precedência é o contrato: `awaiting` > `reactivation` > `cooling` > medidor.
 * Ela não é arbitrária — separa INFORMAR de PERMITIR AGIR, e mantém a regra do
 * cenário 24 (duas decisões pendentes no mesmo card é a pilha que o §5 proíbe).
 */
describe("resolveCardState · proposta de retomada", () => {
  const base = {
    id: "l1",
    title: "t",
    valueCents: null,
    currency: null,
    owner: { kind: null, name: null, agentVersion: null },
    stageName: "s",
    hoursInStage: 80,
    isCooling: true,
  } as unknown as CardInput;

  const proposta = { proposalId: "p1", expiresAt: "2026-07-26T12:00:00Z" };

  it("proposta viva SUBSTITUI o 'esfriando' — informar não é permitir agir", () => {
    const s = resolveCardState({ ...base, reactivation: proposta });
    expect(s.slot.type).toBe("reactivation");
    // A borda continua de alerta: o negócio SEGUE frio, e a proposta é o que
    // fazer a respeito — não a cura.
    expect(s.border).toBe("warning");
  });

  it("mas PERDE para a próxima ação do agente — cenário 24 continua valendo", () => {
    const s = resolveCardState({
      ...base,
      reactivation: proposta,
      nextAction: { label: "Enviar proposta" },
    });
    expect(s.slot.type).toBe("awaiting");
  });

  it("sem proposta viva, volta a ser o 'esfriando' de sempre", () => {
    expect(resolveCardState(base).slot.type).toBe("cooling");
  });

  it("proposta viva num negócio que NÃO está frio ainda assim aparece", () => {
    // Acontece na janela entre o negócio reaquecer e o worker vencer a
    // proposta: o botão continua válido, e escondê-lo deixaria uma proposta
    // pendente sem nenhuma superfície para decidir.
    const s = resolveCardState({ ...base, isCooling: false, reactivation: proposta });
    expect(s.slot.type).toBe("reactivation");
  });

  it("o prazo viaja até o slot — o card precisa dizer quanto falta", () => {
    const s = resolveCardState({ ...base, reactivation: proposta });
    expect(s.slot.type === "reactivation" && s.slot.expiresAt).toBe(proposta.expiresAt);
  });
});
