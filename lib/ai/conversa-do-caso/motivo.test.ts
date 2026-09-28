import { describe, expect, it } from "vitest";

import {
  LlmBudgetExceededError,
  LlmModelNotEnabledError,
  LlmNotConfiguredError,
  LlmProviderUnknownError,
} from "@/lib/agent-engine/edge/llm/run-model-call";

import { motivoDaConversaDoCaso } from "./motivo";

describe("motivoDaConversaDoCaso", () => {
  it("sem provedor de IA: o código e a frase dizem ONDE configurar", () => {
    // É o caso da instalação FRESCA. Sem esta tradução, a tela mostra a frase
    // genérica e ninguém descobre que falta a chave — e este erro nem chega a
    // `llm_calls`, então a tela de Execuções também não conta.
    const m = motivoDaConversaDoCaso(new LlmNotConfiguredError());
    expect(m.codigo).toBe("llm_not_configured");
    expect(m.texto).toContain("IA › Provedores");
    expect(m.acionavel).toBe(true);
  });

  it("orçamento esgotado tem código próprio — não é 'tente de novo'", () => {
    // Veto PERMANENTE de negócio: o gasto não diminui sozinho. Mandar tentar de
    // novo seria mandar a pessoa bater na mesma porta até desistir.
    const m = motivoDaConversaDoCaso(new LlmBudgetExceededError());
    expect(m.codigo).toBe("orcamento_esgotado");
    expect(m.texto).toContain("Uso de IA › Orçamento");
  });

  it("modelo não habilitado e provider desconhecido caem no MESMO código", () => {
    // Os dois se resolvem no mesmo lugar e com o mesmo gesto. Códigos separados
    // dariam à pessoa duas frases para a mesma tela.
    expect(motivoDaConversaDoCaso(new LlmModelNotEnabledError("gpt-9")).codigo).toBe(
      "modelo_indisponivel",
    );
    expect(motivoDaConversaDoCaso(new LlmProviderUnknownError("acme")).codigo).toBe(
      "modelo_indisponivel",
    );
  });

  it("erro desconhecido cai no genérico, e o genérico diz o GESTO", () => {
    const m = motivoDaConversaDoCaso(new Error("ECONNRESET"));
    expect(m.codigo).toBe("case_chat_unavailable");
    expect(m.acionavel).toBe(false);
    // A frase fala com quem ia DECIDIR o caso, não com quem administra o
    // servidor: o que ela pode fazer é tentar de novo e a quem levar o código.
    expect(m.texto).toContain("Tente de novo");
  });

  it("o que NÃO é Error também cai no genérico, sem estourar", () => {
    // O `catch` recebe `unknown`. Um `instanceof` sobre `undefined` não lança,
    // mas um acesso a `.name` lançaria — e uma tradução que estoura troca uma
    // falha nomeada por um 500 sem nome.
    expect(motivoDaConversaDoCaso(undefined).codigo).toBe("case_chat_unavailable");
    expect(motivoDaConversaDoCaso("boom").codigo).toBe("case_chat_unavailable");
  });
});
