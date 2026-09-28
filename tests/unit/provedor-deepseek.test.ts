/**
 * A DEEPSEEK É PROVEDOR DE PRIMEIRA CLASSE — as duas pontas da corrente.
 *
 * A migration 0127 abriu `provider` no banco e transferiu a garantia para
 * `lib/ai/pontos/provedores.ts`. `tests/unit/provedores-x-registry.test.ts` casa
 * a lista com o registry genérico; ESTE arquivo prende o caso concreto que
 * motivou a abertura seguinte — para que a próxima sessão não precise redescobrir
 * que "entrar na lista" é só a metade.
 *
 * Os dois caminhos que a DeepSeek atravessa e que este arquivo trava:
 *
 *  - ESCRITA: `versionCreateSchema` (e todas as portas que derivam de
 *    `IDS_DE_PROVEDOR` — rota de credenciais, diálogo, hook da tela) `aceita
 *    provider=deepseek`. Antes da 0127 o `z.enum` de três recusava a OpenRouter
 *    aqui, e é este mesmo formato de porta.
 *  - EXECUÇÃO: o registry de produção e o runtime de ensaio sabem instanciar
 *    deepseek como OpenAI-compatível (base URL própria, sem SDK novo).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDefaultRegistry } from "@/lib/agent-engine/edge/llm/providers";
import { versionCreateSchema } from "@/lib/ai/agents/validation";
import { ehProvedorSuportado, IDS_DE_PROVEDOR, PROVEDOR_POR_ID } from "@/lib/ai/pontos/provedores";
import { validateProviderKey } from "@/lib/ai/provider-validators";
import { buildModel } from "@/lib/ai/runtime/agent";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DeepSeek é aceita na ESCRITA", () => {
  it("está na lista única de que derivam todas as portas de escrita", () => {
    expect(IDS_DE_PROVEDOR).toContain("deepseek");
    expect(ehProvedorSuportado("deepseek")).toBe(true);
  });

  it("o schema de versão de agente aceita provider=deepseek", () => {
    const r = versionCreateSchema.safeParse({
      system_prompt: "Você é um atendente útil e cordial.",
      provider: "deepseek",
      model: "deepseek-flash",
      credential_id: null,
      channel_session_id: null,
    });
    expect(r.success, r.success ? "" : JSON.stringify(r.error.issues)).toBe(true);
  });
});

describe("DeepSeek é executável", () => {
  it("declara os campos que a tela precisa", () => {
    const p = PROVEDOR_POR_ID.get("deepseek");
    expect(p).toBeDefined();
    expect(p!.rotulo.trim().length).toBeGreaterThan(0);
    expect(p!.quandoUsar.trim().length).toBeGreaterThan(20);
    expect(p!.aceitaEndpointProprio).toBe(true);
    expect(p!.catalogoSincronizavel).toBe(true);
    expect(p!.ondePegarAChave).toMatch(/^https:\/\//);
    expect(p!.prefixoDaChave).toBe("sk-…");
  });

  it("o registry de PRODUÇÃO tem a fábrica", () => {
    expect(createDefaultRegistry()["deepseek"]).toBeTypeOf("function");
  });

  it("a fábrica honra um endpoint próprio (é OpenAI-compatível)", () => {
    const modelo = createDefaultRegistry()["deepseek"]!(
      "sk-de-teste",
      "deepseek-flash",
      "https://gateway.exemplo/v1",
    );
    expect(modelo).toBeDefined();
  });

  it("o runtime de ENSAIO executa deepseek (buildModel)", () => {
    expect(() => buildModel("deepseek", "sk-de-teste", "deepseek-flash")).not.toThrow();
  });

  it("o validador de chave conhece deepseek (não cai em unknown_provider)", async () => {
    // A prova tem de ser um endpoint AUTENTICADO — 401 é a resposta honesta de
    // chave ruim, e é o que separa "conheço o provedor" de "cai no default".
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 401,
            json: async () => ({}),
          }) as unknown as Response,
      ),
    );
    const r = await validateProviderKey("deepseek", "");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error.startsWith("unknown_provider")).toBe(false);
    expect(r.ok === false && r.error).toBe("auth_failed_401");
  });
});
