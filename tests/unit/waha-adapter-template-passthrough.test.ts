import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as SendMessageModule from "@/lib/agent-engine/edge/crm/send-message";

/**
 * O `template` do turno chega inteiro ao sink do CRM.
 *
 * ─── Por que este teste existe ──────────────────────────────────────────────
 * O `send_template` do agente monta `channel.send({ ..., template: {...} })`. Quem
 * recebe, em produção, é o `WahaChannelAdapter` — o worker não injeta `deps.channel`
 * (medido em `workers/agent-worker/main.ts:364`), então o default é ele.
 *
 * Procurando por "template" no adapter aparece **só um comentário**. Isso me levou a
 * concluir, errado, que o campo era descartado — e portanto que o agente gravaria
 * `type: 'text'` num envio de template, perdendo custo e conformidade.
 *
 * O campo trafega: o adapter passa o `input` **inteiro** para `sendTurnMessage`, e a
 * palavra nunca aparece no arquivo. Grep de padrão prova a ausência do **padrão**,
 * nunca a do **mecanismo**.
 *
 * O que sobrou dessa investigação é este teste, que não existia: o repasse estava
 * garantido apenas pela estrutural do TypeScript (dois tipos com o mesmo campo
 * opcional). Um refactor que destrinche o `input` em campos nomeados — a forma mais
 * natural de "deixar explícito o que passa" — derruba o template em silêncio e
 * compila, porque `template` é opcional dos dois lados.
 */

const sendTurnMessage = vi.hoisted(() => vi.fn());

vi.mock("@/lib/agent-engine/edge/crm/send-message", async (importOriginal) => {
  const real = await importOriginal<typeof SendMessageModule>();
  return { ...real, sendTurnMessage };
});

const { WahaChannelAdapter } = await import("@/lib/agent-engine/edge/channel/waha-adapter");

const TEMPLATE = {
  name: "pedido_confirmado",
  language: "pt_BR",
  values: { "1": "Ana", "2": "1234" },
};

function envio(extra: Record<string, unknown> = {}) {
  return {
    tenantId: "org-1",
    leadId: "lead-1",
    jobId: "job-1",
    seq: 1,
    conversationId: "conv-1",
    body: "Olá Ana, seu pedido 1234 foi confirmado.",
    ...extra,
  };
}

function adapter() {
  // O pool e o cfg não são exercitados: `sendTurnMessage` é o seam, e é ele que
  // este teste observa.
  return new WahaChannelAdapter({} as never, {} as never);
}

// O spy é de módulo: sem limpar, `mock.calls[0]` continua sendo a chamada do caso
// ANTERIOR — foi assim que o terceiro caso deste arquivo passou a ler o template do
// primeiro e falhou por um motivo que não era o dele.
beforeEach(() => {
  sendTurnMessage.mockReset();
  sendTurnMessage.mockResolvedValue({ kind: "sent", idempotencyKey: "k", crmMessageId: "m" });
});

describe("WahaChannelAdapter — o template não pode cair no caminho", () => {
  it("repassa o template ao sink, com nome, idioma e valores intactos", async () => {
    await adapter().send(envio({ template: TEMPLATE }));

    const recebido = sendTurnMessage.mock.calls[0]?.[2] as { template?: unknown };
    expect(recebido.template).toEqual(TEMPLATE);
  });

  it("o corpo RENDERIZADO acompanha o template — é o que os gates avaliaram", async () => {
    // A borda usa o `body` para o registro e para qualquer canal que só saiba texto.
    // Mandar o template sem o corpo renderizado gravaria a mensagem vazia no histórico.
    await adapter().send(envio({ template: TEMPLATE }));

    const recebido = sendTurnMessage.mock.calls[0]?.[2] as { body?: string };
    expect(recebido.body).toBe("Olá Ana, seu pedido 1234 foi confirmado.");
  });

  it("envio de texto comum segue SEM o campo — 'ausente' e 'vazio' não são o mesmo", async () => {
    // A borda decide `type: 'template'` pela PRESENÇA do campo. Um objeto vazio no
    // lugar de `undefined` marcaria toda mensagem de texto como template.
    await adapter().send(envio());

    const recebido = sendTurnMessage.mock.calls[0]?.[2] as { template?: unknown };
    expect(recebido.template).toBeUndefined();
  });
});
