import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sendTemplate } from "@/lib/channels/meta/send-template";
import type { TemplateBinding } from "@/lib/channels/meta/template-binding";

const FIXTURE = JSON.parse(
  readFileSync("tests/fixtures/meta/message-templates.json", "utf8"),
) as { data: { name: string; language: string; components?: unknown[] }[] };

const PEDIDO = FIXTURE.data.find((t) => t.name === "jaspers_market_order_confirmation_v1")!;

const BINDING: TemplateBinding = {
  name: PEDIDO.name,
  language: PEDIDO.language,
  contractHash: "hash-vigente",
  values: { "1": "Rafael", "2": "DESK-001", "3": "30/07" },
};

const CURRENT = {
  name: PEDIDO.name,
  language: PEDIDO.language,
  contractHash: "hash-vigente",
  status: "APPROVED",
  components: PEDIDO.components,
};

const BASE = {
  phoneNumberId: "1103328999528818",
  token: "tok",
  graphVersion: "v22.0",
  to: "5531999998888",
};

function stubFetch(resposta: unknown, ok = true) {
  const spy = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 400,
    json: async () => resposta,
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => vi.unstubAllGlobals());

describe("sendTemplate", () => {
  it("bind ok monta o payload por buildComponents e envia", async () => {
    const spy = stubFetch({ messages: [{ id: "wamid.ABC" }] });
    const r = await sendTemplate({ ...BASE, binding: BINDING, current: CURRENT });

    expect(r).toEqual({ sent: true, externalId: "wamid.ABC" });

    const corpo = JSON.parse(spy.mock.calls[0]![1].body as string) as {
      template: { name: string; components: { type: string; parameters: unknown[] }[] };
    };
    expect(corpo.template.name).toBe(PEDIDO.name);
    expect(corpo.template.components).toEqual([
      {
        type: "body",
        parameters: [
          { type: "text", text: "Rafael" },
          { type: "text", text: "DESK-001" },
          { type: "text", text: "30/07" },
        ],
      },
    ]);
  });

  it("bind STALE não envia — e diz o motivo, não um false mudo", async () => {
    const spy = stubFetch({});
    const r = await sendTemplate({
      ...BASE,
      binding: BINDING,
      current: { ...CURRENT, contractHash: "outro" },
    });
    expect(r).toEqual({ sent: false, reason: "stale" });
    expect(spy).not.toHaveBeenCalled(); // não gasta chamada nem dinheiro
  });

  it("template sumiu da Meta não envia", async () => {
    const spy = stubFetch({});
    const r = await sendTemplate({ ...BASE, binding: BINDING, current: null });
    expect(r).toEqual({ sent: false, reason: "missing" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("template não aprovado não envia", async () => {
    const spy = stubFetch({});
    const r = await sendTemplate({
      ...BASE,
      binding: BINDING,
      current: { ...CURRENT, status: "PENDING" },
    });
    expect(r).toEqual({ sent: false, reason: "not_approved" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("valor faltando NÃO vira 132000 — é barrado antes da chamada", async () => {
    // É o defeito que a fase inteira persegue, interceptado no último ponto onde
    // ainda é barato: antes de sair.
    const spy = stubFetch({});
    const r = await sendTemplate({
      ...BASE,
      binding: { ...BINDING, values: { "1": "Rafael" } },
      current: CURRENT,
    });
    expect(r).toEqual({ sent: false, reason: "missing_values", missing: ["2", "3"] });
    expect(spy).not.toHaveBeenCalled();
  });

  it("valor só com espaços conta como ausente", async () => {
    const spy = stubFetch({});
    const r = await sendTemplate({
      ...BASE,
      binding: { ...BINDING, values: { "1": "Rafael", "2": "   ", "3": "30/07" } },
      current: CURRENT,
    });
    expect(r).toMatchObject({ sent: false, reason: "missing_values", missing: ["2"] });
    expect(spy).not.toHaveBeenCalled();
  });

  it("erro da Meta carrega o `details`, que é quem diz QUAL parâmetro divergiu", async () => {
    stubFetch(
      {
        error: {
          code: 132000,
          message: "(#132000) Number of parameters does not match",
          error_data: { details: "body: number of localizable_params (2) does not match (3)" },
        },
      },
      false,
    );
    const r = await sendTemplate({ ...BASE, binding: BINDING, current: CURRENT });
    expect(r).toMatchObject({ sent: false, reason: "api_error", code: 132000 });
    if (r.sent || r.reason !== "api_error") throw new Error("inalcançável");
    expect(r.message).toContain("localizable_params");
  });

  it("template SEM parâmetro não manda `components` vazio — a Meta recusa", async () => {
    const hello = FIXTURE.data.find((t) => t.name === "hello_world")!;
    const spy = stubFetch({ messages: [{ id: "wamid.X" }] });
    await sendTemplate({
      ...BASE,
      binding: { name: hello.name, language: hello.language, contractHash: "h", values: {} },
      current: {
        name: hello.name,
        language: hello.language,
        contractHash: "h",
        status: "APPROVED",
        components: hello.components,
      },
    });
    const corpo = JSON.parse(spy.mock.calls[0]![1].body as string) as {
      template: Record<string, unknown>;
    };
    expect(corpo.template).not.toHaveProperty("components");
  });
});
