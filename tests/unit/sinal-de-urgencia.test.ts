import { describe, expect, it } from "vitest";

import { detectUrgencySignal } from "@/lib/agent-engine/guardrails/sinal-de-urgencia";

/**
 * Detector de urgência/segurança — usado só para priorizar o alerta na Central
 * quando o turno é adiado por cap de envio (warm-up/diário), nunca para vetar ou
 * alterar a resposta do modelo. Ver `inbound-turn.ts`, bloco `pacingCapVeto`.
 */

const URGENT: readonly string[] = [
  "isso é urgente, preciso de ajuda",
  "socorro, não sei o que fazer",
  "a moto pegou fogo!",
  "senti um cheiro de queimado saindo do painel",
  "vi uma fumaça saindo do compartimento da bateria",
  "tive um choque elétrico ao encostar",
  "meu freio não funciona",
  "estou sem freio, o que eu faço",
  "a bateria está aquecendo muito, tenho medo",
  "aquecimento anormal no motor",
  "risco de vida, por favor respondam",
];

const NOT_URGENT: readonly string[] = [
  "bom dia, tudo bem?",
  "gostaria de agendar uma revisão pra semana que vem",
  "quanto custa a manutenção?",
  "obrigado, até mais",
  "minha moto está fazendo um barulho estranho",
  "o agendamento está uma bagunça esse mês",
];

describe("detectUrgencySignal — léxico genérico de risco/emergência", () => {
  it.each(URGENT)("DETECTA sinal de urgência: %s", (body) => {
    expect(detectUrgencySignal(body)).toBe(true);
  });

  it.each(NOT_URGENT)("NÃO detecta (mensagem comum): %s", (body) => {
    expect(detectUrgencySignal(body)).toBe(false);
  });

  it("é robusto a caixa e acento", () => {
    expect(detectUrgencySignal("CHEIRO DE QUEIMADO NO PAINEL")).toBe(true);
    expect(detectUrgencySignal("Fumaça saindo da bateria")).toBe(true);
  });

  it("no-op em string vazia ou só espaço", () => {
    expect(detectUrgencySignal("")).toBe(false);
    expect(detectUrgencySignal("   ")).toBe(false);
  });
});
