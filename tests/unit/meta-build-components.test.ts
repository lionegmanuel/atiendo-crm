/**
 * O SEGUNDO consumidor da derivação. O formulário da tela e este montador leem os
 * MESMOS slots — divergir vira impossível por construção, não por disciplina.
 *
 * A fixture é o payload REAL da Graph API (WABA de teste, 2026-07-28). Mock escrito
 * por quem escreveu o montador concorda com ele por construção e não reprova nada.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  buildComponents,
  missingSlots,
  slotKey,
} from "@/lib/channels/meta/build-components";
import { deriveTemplateContract } from "@/lib/channels/meta/template-contract";

interface RawTemplate {
  name: string;
  language: string;
  parameter_format?: string;
  components?: unknown[];
}

const FIXTURE = JSON.parse(
  readFileSync("tests/fixtures/meta/message-templates.json", "utf8"),
) as { data: RawTemplate[] };

function tpl(name: string) {
  const t = FIXTURE.data.find((x) => x.name === name);
  if (!t) throw new Error(`fixture sem template ${name}`);
  return deriveTemplateContract(t as Parameters<typeof deriveTemplateContract>[0]);
}

describe("buildComponents", () => {
  it("3 valores no corpo viram UM componente body com 3 parameters (evita 132000)", () => {
    const c = tpl("jaspers_market_order_confirmation_v1");
    const out = buildComponents(c, { "1": "Rafael", "2": "DESK-001", "3": "30/07" });
    expect(out).toEqual([
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

  it("header de mídia vira componente header (evita 132012)", () => {
    const c = tpl("jaspers_market_image_cta_v1");
    const out = buildComponents(c, { "header:1": "https://x.com/a.jpg" });
    expect(out).toEqual([
      { type: "header", parameters: [{ type: "image", image: { link: "https://x.com/a.jpg" } }] },
    ]);
  });

  it("carrossel monta cards com card_index próprio", () => {
    const c = tpl("jaspers_market_media_carousel_v1");
    const out = buildComponents(c, {
      "card0:header:1": "https://x/1.jpg",
      "card1:header:1": "https://x/2.jpg",
    });
    expect(out).toEqual([
      {
        type: "carousel",
        cards: [
          {
            card_index: 0,
            components: [
              { type: "header", parameters: [{ type: "image", image: { link: "https://x/1.jpg" } }] },
            ],
          },
          {
            card_index: 1,
            components: [
              { type: "header", parameters: [{ type: "image", image: { link: "https://x/2.jpg" } }] },
            ],
          },
        ],
      },
    ]);
  });

  it("valor faltando é reportado como slot, nunca enviado incompleto", () => {
    const c = tpl("jaspers_market_order_confirmation_v1");
    expect(missingSlots(c, { "1": "Rafael" }).map((s) => s.key)).toEqual(["2", "3"]);
  });

  it("NAMED põe parameter_name; POSITIONAL não", () => {
    const named = deriveTemplateContract({
      name: "x",
      language: "pt_BR",
      parameter_format: "NAMED",
      components: [{ type: "BODY", text: "Oi {{nome}}" }],
    });
    expect(buildComponents(named, { nome: "Rafael" })).toEqual([
      { type: "body", parameters: [{ type: "text", parameter_name: "nome", text: "Rafael" }] },
    ]);
  });

  it("template sem parâmetro nenhum não monta componente algum", () => {
    // `components: []` e `components: undefined` são a mesma coisa para a Meta, mas
    // um array com componente vazio dentro não é — montar `[{type:'body',parameters:[]}]`
    // aqui produziria justamente o 132000 ao contrário (mandou o que não foi pedido).
    expect(buildComponents(tpl("hello_world"), {})).toEqual([]);
  });

  it("chave de slot endereça o SLOT, não a key — senão um card sobrescreve o outro", () => {
    // Os dois cards do carrossel têm `key: '1'`. Se a chave de `values` fosse só a
    // key, o segundo card sobrescreveria o primeiro EM SILÊNCIO — e a tela mostraria
    // um campo onde existem dois. `slotKey` é a fonte única dos dois lados.
    const c = tpl("jaspers_market_media_carousel_v1");
    expect(c.slots.map((s) => s.key)).toEqual(["1", "1"]);
    expect(c.slots.map((s) => slotKey(s.address, s.key))).toEqual([
      "card0:header:1",
      "card1:header:1",
    ]);
  });

  it("montar com valor faltando FALHA em vez de mandar payload capenga", () => {
    // É o 132000 acontecendo do lado de cá, onde o operador ainda pode corrigir.
    // Montar sem o parâmetro e deixar a Meta reprovar é o comportamento de hoje.
    const c = tpl("jaspers_market_order_confirmation_v1");
    expect(() => buildComponents(c, { "1": "Rafael" })).toThrow(/corpo/);
  });

  it("slot de tipo que a derivação ainda não produz FALHA fechado", () => {
    // `currency`/`date_time` existem em `SlotExpects` e a Meta os monta com objeto
    // estruturado, não string. Enquanto a derivação não os emitir, montá-los como
    // texto produziria 132012 — o erro que esta fase existe para matar. Fail-closed
    // avisa quem for estender a derivação de que este montador precisa acompanhar.
    const c = tpl("jaspers_market_order_confirmation_v1");
    const forjado = {
      ...c,
      slots: [{ ...c.slots[0]!, expects: "currency" as const }],
    };
    expect(() => buildComponents(forjado, { "1": "99,90" })).toThrow(/currency/);
  });
});
