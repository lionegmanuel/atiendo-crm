import { describe, expect, it } from "vitest";

import { explainSendResult } from "@/lib/channels/meta/send-template-outcome";
import type { SendTemplateResult } from "@/lib/channels/meta/send-template";

const TODOS: SendTemplateResult[] = [
  { sent: true, externalId: "wamid.X" },
  { sent: false, reason: "missing_values", missing: ["2", "3"] },
  { sent: false, reason: "stale" },
  { sent: false, reason: "missing" },
  { sent: false, reason: "not_approved" },
  { sent: false, reason: "api_error", code: 132000, message: "params não batem" },
];

describe("explainSendResult — o que o modelo lê", () => {
  it("sucesso manda PARAR de falar, não só avisa que deu certo", () => {
    // Sem isso o modelo tende a emendar um texto livre depois do template — que a
    // janela fechada recusaria, gastando tentativa e confundindo o lead.
    const o = explainSendResult({ sent: true, externalId: "wamid.X" });
    expect(o.ok).toBe(true);
    expect(o.retriable).toBe(false);
    expect(o.message).toMatch(/Não escreva mais nada/i);
  });

  it("valor faltando é o ÚNICO caso em que vale tentar de novo", () => {
    // É o único que depende do modelo. Todos os outros exigem humano; marcar
    // qualquer deles como retriable faz o turno queimar tentativas à toa.
    for (const r of TODOS) {
      const esperado = !r.sent && r.reason === "missing_values";
      expect(explainSendResult(r).retriable, JSON.stringify(r)).toBe(esperado);
    }
  });

  it("valor faltando NOMEIA quais — 'faltou parâmetro' não é acionável", () => {
    const o = explainSendResult({ sent: false, reason: "missing_values", missing: ["2", "3"] });
    expect(o.message).toContain("2");
    expect(o.message).toContain("3");
  });

  it("todo desfecho diz a CONDUTA, não só o problema", () => {
    for (const r of TODOS) {
      const { message } = explainSendResult(r);
      expect(message, JSON.stringify(r)).toMatch(/Encerre o turno|chame a ferramenta|Não escreva/i);
    }
  });

  it("erro da API carrega código e detalhe — é o que o humano lê no log", () => {
    const o = explainSendResult({
      sent: false,
      reason: "api_error",
      code: 132000,
      message: "body: localizable_params (2) does not match (3)",
    });
    expect(o.message).toContain("132000");
    expect(o.message).toContain("localizable_params");
  });

  it("nenhuma mensagem é genérica — cada desfecho tem a sua", () => {
    const frases = TODOS.map((r) => explainSendResult(r).message);
    expect(new Set(frases).size).toBe(TODOS.length);
  });
});
