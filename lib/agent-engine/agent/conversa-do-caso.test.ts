import { describe, expect, it, vi, beforeEach } from "vitest";

import type { PublishedAgentConfig } from "./agent-config";
import type { PersonaDaConversa } from "./conversa-do-caso/persona";

const runModelCall = vi.fn();
vi.mock("../edge/llm/run-model-call", () => ({
  runModelCall: (...args: unknown[]) => runModelCall(...args),
}));

const { montarMensagens, responderSobreOCaso } = await import("./conversa-do-caso");

const AGENTE = {
  agentId: "a-1",
  agentName: "Clara",
  provider: "openai",
  credentialId: "cred-openai",
  model: "gpt-5.6-luna",
} as unknown as PublishedAgentConfig;

const COM_AGENTE: PersonaDaConversa = { fonte: "agente_do_caso", agente: AGENTE, nome: "Clara" };
const SEM_AGENTE: PersonaDaConversa = { fonte: "padrao_da_organizacao", motivo: "pausado" };

const ENTRADA = {
  tenantId: "org-1",
  contactId: "c-1",
  system: "system montado",
  blocoDeDados: "=== DADOS DO CASO === ... === FIM DOS DADOS ===",
  historico: [],
  pergunta: "Por que a IA não resolveu sozinha?",
};

beforeEach(() => {
  runModelCall.mockReset();
  runModelCall.mockResolvedValue({ result: { text: "  Porque a política permite 10%.  " }, callId: "call-1" });
});

/** O terceiro argumento de `runModelCall` — o objeto que vai ao seam. */
function objetoDoSeam(): Record<string, unknown> {
  expect(runModelCall, "o emissor não chamou o seam").toHaveBeenCalledTimes(1);
  return runModelCall.mock.calls[0]![2] as Record<string, unknown>;
}

describe("responderSobreOCaso — o que chega ao seam de modelo", () => {
  it("o `purpose` é `case_chat`", async () => {
    // É o literal que `pontos-de-ia-completude.test.ts` procura em `lib/**` e o
    // que liga esta chamada ao painel de Provedores e à tela de Execuções.
    await responderSobreOCaso({} as never, {} as never, { ...ENTRADA, persona: COM_AGENTE });
    expect(objetoDoSeam().purpose).toBe("case_chat");
  });

  it("com persona do caso, `model` E `llmOverride` vêm no MESMO objeto", async () => {
    // A lição do PR #151: emprestar só a string do modelo e deixar
    // provider/credencial no padrão da organização manda `gpt-5-mini` para o
    // endpoint da Anthropic e mata a chamada inteira. Os três campos juntos.
    await responderSobreOCaso({} as never, {} as never, { ...ENTRADA, persona: COM_AGENTE });
    expect(objetoDoSeam()).toMatchObject({
      agentId: "a-1",
      model: "gpt-5.6-luna",
      llmOverride: { provider: "openai", credentialId: "cred-openai" },
    });
  });

  it("sem persona do caso, os TRÊS saem `undefined` juntos", async () => {
    // A recíproca, e ela é a que importa: `undefined` faz o seam seguir a
    // cadeia normal (binding → env → padrão da organização). Um `model` sozinho
    // com provider herdado é o defeito de novo, virado do avesso.
    await responderSobreOCaso({} as never, {} as never, { ...ENTRADA, persona: SEM_AGENTE });
    const o = objetoDoSeam();
    expect(o.model).toBeUndefined();
    expect(o.llmOverride).toBeUndefined();
    expect(o.agentId).toBeNull();
  });

  it("NENHUMA tool e NENHUM `maxSteps` — é o que impede o modelo de tentar agir", async () => {
    // Sem tools, o SDK para no 1º step e `result.text` vem pronto. Com uma tool
    // qualquer, o modelo poderia SEQUER TENTAR `send_message` — e a promessa da
    // feature ("a IA lê e não age") passaria a depender do prompt.
    await responderSobreOCaso({} as never, {} as never, { ...ENTRADA, persona: COM_AGENTE });
    const o = objetoDoSeam();
    expect(o.tools).toBeUndefined();
    expect(o.maxSteps).toBeUndefined();
    expect(Object.keys(o)).not.toContain("tools");
    expect(Object.keys(o)).not.toContain("maxSteps");
  });

  it("o texto volta aparado, com o `callId` e o autor", async () => {
    const r = await responderSobreOCaso({} as never, {} as never, {
      ...ENTRADA,
      persona: COM_AGENTE,
    });
    expect(r).toEqual({ texto: "Porque a política permite 10%.", callId: "call-1", agentId: "a-1" });
  });

  it("resposta sem texto vira string vazia — e não `undefined` no banco", async () => {
    runModelCall.mockResolvedValue({ result: {}, callId: null });
    const r = await responderSobreOCaso({} as never, {} as never, { ...ENTRADA, persona: SEM_AGENTE });
    expect(r.texto).toBe("");
    expect(r.callId).toBeNull();
  });
});

describe("montarMensagens — a separação de papéis", () => {
  it("o bloco de DADOS é UM turno `user`, antes de tudo", () => {
    const m = montarMensagens({ blocoDeDados: "DADOS", historico: [], pergunta: "por quê?" });
    expect(m[0]).toEqual({ role: "user", content: "DADOS" });
  });

  it("o histórico mapeia `human`→user e `ai`→assistant", () => {
    // ⚠️ NUNCA o mapeamento do rascunho (inbound→user / outbound→assistant):
    // num chat, a pergunta do ATENDENTE também é `user`, e o modelo passaria a
    // confundir o que o cliente escreveu com o que o operador pediu.
    const m = montarMensagens({
      blocoDeDados: "DADOS",
      historico: [
        { author_kind: "human", body: "o cliente já tentou o cupom?" },
        { author_kind: "ai", body: "tentou, e ele expirou" },
      ],
      pergunta: "e agora?",
    });
    expect(m.map((x) => x.role)).toEqual(["user", "user", "assistant", "user"]);
    expect(m.at(-1)).toEqual({ role: "user", content: "e agora?" });
  });

  it("a pergunta é sempre a ÚLTIMA — o modelo responde a ela, não ao histórico", () => {
    const m = montarMensagens({
      blocoDeDados: "DADOS",
      historico: [{ author_kind: "ai", body: "resposta anterior" }],
      pergunta: "a pergunta de agora",
    });
    expect(m.at(-1)?.content).toBe("a pergunta de agora");
  });
});
