/**
 * O RACIOCÍNIO DA DEEPSEEK É DESLIGÁVEL — pelo knob e SÓ na DeepSeek.
 *
 * Motivo (medido em produção, com tokens reais): a DeepSeek nasce com o
 * raciocínio LIGADO e o token de raciocínio é cobrado como SAÍDA. O turno do
 * agente gastou ~2.849 tokens de saída contra ~350 do OpenAI e levou 51 s
 * contra 29 s — o desconto de preço foi anulado pelo volume. Desligar o
 * raciocínio é um campo no CORPO do request, não no prompt nem nas tools.
 *
 * Qual campo, e por quê: são DUAS superfícies e cada uma lê um nome diferente
 * (doc oficial, "Thinking Mode › Toggle and Effort Control"):
 *
 *   - Responses API        → `{"reasoning": {"effort": "none"}}` (none desliga);
 *   - Chat Completions     → `{"thinking": {"type": "disabled"}}`.
 *
 * O SDK instalado (`createOpenAI(...)(modelId)`) fala a Responses API — o
 * primeiro teste prende essa rota para o "porquê" não envelhecer em silêncio.
 * Por isso o desligamento manda os DOIS campos: o provedor ignora sem erro o
 * que a rota não conhece, então vale em qualquer uma das duas.
 *
 * ⚠️ O que estes testes medem: o CORPO QUE SAI do processo. A confirmação de
 * que a DeepSeek honra o campo é de contrato (doc oficial) e NÃO foi medida
 * contra a API real nesta entrega (sem chave) — ver o relatório.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateText, type LanguageModel } from "ai";

import { llmEdgeConfigFromEnv } from "@/lib/agent-engine/edge/llm/credentials";
import { createDefaultRegistry } from "@/lib/agent-engine/edge/llm/providers";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A rota que o SDK percorre: é ela que lê `reasoning.effort`, não `thinking`. */
const ROTA_RESPONSES_DEEPSEEK = "https://api.deepseek.com/responses";

/**
 * Intercepta o `fetch` da fábrica e guarda o que SAI (url + corpo JSON). Não
 * devolve resposta: a chamada é interrompida e o erro é engolido no `disparar`
 * — o que interessa aqui é o request, não o parse da resposta.
 */
function interceptarSaida(): { urls: string[]; corpos: Array<Record<string, unknown>> } {
  const urls: string[] = [];
  const corpos: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: { body?: unknown }) => {
      urls.push(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as { url: string }).url,
      );
      corpos.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      throw new Error("PARADA_DE_TESTE");
    }),
  );
  return { urls, corpos };
}

async function disparar(model: LanguageModel): Promise<void> {
  await generateText({ model, prompt: "oi", maxRetries: 0 }).catch(() => {});
}

describe("a rota que o SDK percorre (o porquê do campo)", () => {
  it("deepseek vai para a Responses API — é o que exige reasoning.effort", async () => {
    const { urls } = interceptarSaida();
    const modelo = createDefaultRegistry({ deepseekThinking: "disabled" })["deepseek"]!(
      "sk-de-teste",
      "deepseek-flash",
    );
    await disparar(modelo);
    expect(urls[0]).toBe(ROTA_RESPONSES_DEEPSEEK);
  });
});

describe("knob ligado: o corpo da DeepSeek desliga o raciocínio", () => {
  it("manda thinking.type=disabled (a grafia verificada na API)", async () => {
    const { corpos } = interceptarSaida();
    const modelo = createDefaultRegistry({ deepseekThinking: "disabled" })["deepseek"]!(
      "sk-de-teste",
      "deepseek-flash",
    );
    await disparar(modelo);
    expect(corpos[0]?.["thinking"]).toEqual({ type: "disabled" });
  });

  it("manda reasoning.effort=none (a grafia que a rota /responses lê)", async () => {
    const { corpos } = interceptarSaida();
    const modelo = createDefaultRegistry({ deepseekThinking: "disabled" })["deepseek"]!(
      "sk-de-teste",
      "deepseek-flash",
    );
    await disparar(modelo);
    expect(corpos[0]?.["reasoning"]).toEqual({ effort: "none" });
  });

  it("preserva o resto do corpo — não é um request novo, é o mesmo com o campo a mais", async () => {
    const { corpos } = interceptarSaida();
    const modelo = createDefaultRegistry({ deepseekThinking: "disabled" })["deepseek"]!(
      "sk-de-teste",
      "deepseek-flash",
    );
    await disparar(modelo);
    expect(corpos[0]?.["model"]).toBe("deepseek-flash");
    expect(corpos[0]?.["input"]).toBeDefined();
  });
});

describe("default preservado: quem manda no raciocínio é o provedor", () => {
  it("sem o knob, o corpo da DeepSeek não carrega thinking nem reasoning", async () => {
    const { corpos } = interceptarSaida();
    const modelo = createDefaultRegistry()["deepseek"]!("sk-de-teste", "deepseek-flash");
    await disparar(modelo);
    expect(corpos[0]?.["thinking"]).toBeUndefined();
    expect(corpos[0]?.["reasoning"]).toBeUndefined();
  });

  it("knob em 'provider' tem o mesmo efeito de não configurar", async () => {
    const { corpos } = interceptarSaida();
    const modelo = createDefaultRegistry({ deepseekThinking: "provider" })["deepseek"]!(
      "sk-de-teste",
      "deepseek-flash",
    );
    await disparar(modelo);
    expect(corpos[0]?.["thinking"]).toBeUndefined();
    expect(corpos[0]?.["reasoning"]).toBeUndefined();
  });
});

describe("outros provedores intactos — o campo é só da DeepSeek", () => {
  it("mesmo com o knob ligado, a OpenAI não recebe thinking nem reasoning", async () => {
    const { corpos } = interceptarSaida();
    const modelo = createDefaultRegistry({ deepseekThinking: "disabled" })["openai"]!(
      "sk-de-teste",
      "gpt-4o",
    );
    await disparar(modelo);
    expect(corpos[0]?.["thinking"]).toBeUndefined();
    expect(corpos[0]?.["reasoning"]).toBeUndefined();
  });

  it("mesmo com o knob ligado, a Anthropic não recebe o campo", async () => {
    const { corpos } = interceptarSaida();
    const modelo = createDefaultRegistry({ deepseekThinking: "disabled" })["anthropic"]!(
      "sk-de-teste",
      "claude-sonnet-4-5",
    );
    await disparar(modelo);
    expect(corpos[0]?.["thinking"]).toBeUndefined();
    expect(corpos[0]?.["reasoning"]).toBeUndefined();
  });
});

describe("o knob chega do env até a config", () => {
  it("DEEPSEEK_THINKING=disabled vira config explícita", () => {
    expect(llmEdgeConfigFromEnv({ DEEPSEEK_THINKING: "disabled" }).deepseekThinking).toBe(
      "disabled",
    );
  });

  it("ausente preserva o default do provedor ('provider')", () => {
    expect(llmEdgeConfigFromEnv({}).deepseekThinking).toBe("provider");
  });

  it("valor inválido é recusado com erro claro (mesmo contrato do LLM_CACHE_TTL)", () => {
    expect(() => llmEdgeConfigFromEnv({ DEEPSEEK_THINKING: "off" })).toThrow(/DEEPSEEK_THINKING/);
  });
});
