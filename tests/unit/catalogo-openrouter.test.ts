/**
 * A TRADUÇÃO DO CATÁLOGO — onde o preço da conta do cliente é decidido.
 *
 * Este módulo converte a resposta da OpenRouter no que o sistema guarda, e dois
 * campos dele têm consequência em dinheiro e em comportamento:
 *
 *  - **preço**: alimenta o teto de orçamento da organização. Errar para menos é
 *    um teto que não segura; errar `null` para `0` é um modelo caro entrando na
 *    conta como gratuito, erro que só aparece na fatura.
 *  - **supports_tools**: é o que impede o operador de escolher, para o ponto que
 *    cria o lead, um modelo que não sabe chamar ferramenta — o defeito que faria
 *    o agente conversar normalmente e não registrar nada no funil.
 *
 * Os casos abaixo usam o shape REAL da API, capturado em 2026-08-07.
 */
import { describe, expect, it } from "vitest";

import {
  precoParaCentavosPorMilhao,
  traduzirCatalogo,
  traduzirModelo,
  type ModeloDaOpenRouter,
} from "@/lib/ai/catalogo/openrouter";

/** Recorte fiel de `GET https://openrouter.ai/api/v1/models` (2026-08-07). */
const OPUS_5_FAST: ModeloDaOpenRouter = {
  id: "anthropic/claude-opus-5-fast",
  name: "Claude Opus 5 (Fast)",
  description:
    "Fast-mode variant of [Opus 5](/anthropic/claude-opus-5) - identical capabilities with higher output speed at 2x pricing relative to regular Opus 5.\n\nLearn more in Anthropic's docs: https://platform.claude.com/docs",
  context_length: 1_000_000,
  architecture: { input_modalities: ["text", "image", "file"] },
  pricing: { prompt: "0.00001", completion: "0.00005" },
  supported_parameters: ["max_tokens", "tools", "tool_choice", "reasoning"],
};

describe("preço → centavos por milhão de tokens", () => {
  it("converte o caso real do Opus 5 Fast", () => {
    // 0,00001 dólar/token × 1.000.000 tokens = 10 dólares = 1000 centavos.
    expect(precoParaCentavosPorMilhao("0.00001")).toBe(1000);
    expect(precoParaCentavosPorMilhao("0.00005")).toBe(5000);
  });

  it("arredonda para CIMA, nunca para baixo", () => {
    // Um teto de orçamento alimentado por preço subestimado é um teto que não
    // segura. O pior caso do arredondamento para cima é avisar um pouco antes.
    expect(precoParaCentavosPorMilhao("0.000000001")).toBe(1);
    expect(precoParaCentavosPorMilhao("0.0000000001")).toBe(1);
  });

  it("distingue GRATUITO de DESCONHECIDO", () => {
    // O eixo que este repo já documenta em llm_calls.cost_cents: null = preço
    // desconhecido, nunca inventar 0. Colapsar os dois faria um modelo caro
    // entrar no somatório como gratuito.
    expect(precoParaCentavosPorMilhao("0")).toBe(0);
    expect(precoParaCentavosPorMilhao(null)).toBeNull();
    expect(precoParaCentavosPorMilhao(undefined)).toBeNull();
    expect(precoParaCentavosPorMilhao("")).toBeNull();
    expect(precoParaCentavosPorMilhao("grátis")).toBeNull();
    expect(precoParaCentavosPorMilhao("-1")).toBeNull();
  });
});

describe("tradução de um modelo", () => {
  it("traduz o caso real inteiro", () => {
    const linha = traduzirModelo(OPUS_5_FAST);
    expect(linha).toMatchObject({
      provider: "openrouter",
      model_id: "anthropic/claude-opus-5-fast",
      display_name: "Claude Opus 5 (Fast)",
      context_window: 1_000_000,
      input_price_per_million_cents: 1000,
      output_price_per_million_cents: 5000,
      supports_tools: true,
      supports_vision: true,
      source: "openrouter",
    });
  });

  it("supports_tools vem de supported_parameters, não do nome do modelo", () => {
    // Heurística sobre o nome erraria: há modelo "instruct" com tools e modelo
    // com nome de topo de linha sem tools. O dado do fabricante é o único que
    // não inventa.
    const semTools = traduzirModelo({ ...OPUS_5_FAST, supported_parameters: ["max_tokens"] });
    expect(semTools?.supports_tools).toBe(false);
    const semCampo = traduzirModelo({ ...OPUS_5_FAST, supported_parameters: null });
    expect(semCampo?.supports_tools).toBe(false);
  });

  it("supports_vision vem das modalidades de ENTRADA", () => {
    const soTexto = traduzirModelo({
      ...OPUS_5_FAST,
      architecture: { input_modalities: ["text"] },
    });
    expect(soTexto?.supports_vision).toBe(false);
    expect(traduzirModelo({ ...OPUS_5_FAST, architecture: null })?.supports_vision).toBe(false);
  });

  it("sem nome, o id vira o rótulo — linha em branco na tela é pior", () => {
    const semNome = traduzirModelo({ ...OPUS_5_FAST, name: null });
    expect(semNome?.display_name).toBe("anthropic/claude-opus-5-fast");
  });

  it("descarta entrada sem id", () => {
    expect(traduzirModelo({ ...OPUS_5_FAST, id: "" })).toBeNull();
    expect(traduzirModelo({ ...OPUS_5_FAST, id: "   " })).toBeNull();
  });

  it("a descrição é encurtada e perde o markdown", () => {
    const linha = traduzirModelo(OPUS_5_FAST);
    expect(linha?.description).not.toContain("[");
    expect(linha?.description).not.toContain("](");
    expect(linha?.description!.length).toBeLessThanOrEqual(301);
    expect(linha?.description).toContain("Opus 5");
  });
});

describe("tradução do catálogo inteiro", () => {
  it("remove id duplicado da origem", () => {
    // A origem já repetiu id no passado; com o índice único de (provider,
    // model_id), o upsert estouraria com "cannot affect row a second time" e o
    // cron inteiro falharia por causa de uma linha.
    const catalogo = traduzirCatalogo([
      OPUS_5_FAST,
      { ...OPUS_5_FAST, name: "Versão mais recente" },
    ]);
    expect(catalogo).toHaveLength(1);
    expect(catalogo[0]?.display_name).toBe("Versão mais recente");
  });

  it("descarta as inutilizáveis sem derrubar as boas", () => {
    // Uma entrada quebrada não pode custar o catálogo inteiro — seria trocar
    // "catálogo desatualizado" por "catálogo vazio".
    const catalogo = traduzirCatalogo([
      OPUS_5_FAST,
      { id: "" },
      { id: "meta-llama/llama-3.3-70b-instruct", supported_parameters: ["tools"] },
    ]);
    expect(catalogo.map((l) => l.model_id).sort()).toEqual([
      "anthropic/claude-opus-5-fast",
      "meta-llama/llama-3.3-70b-instruct",
    ]);
  });

  it("catálogo vazio devolve lista vazia, sem estourar", () => {
    expect(traduzirCatalogo([])).toEqual([]);
  });

  it("modelo sem preço nenhum entra com null, não com zero", () => {
    const [linha] = traduzirCatalogo([{ id: "x/y", pricing: null }]);
    expect(linha?.input_price_per_million_cents).toBeNull();
    expect(linha?.output_price_per_million_cents).toBeNull();
  });
});
