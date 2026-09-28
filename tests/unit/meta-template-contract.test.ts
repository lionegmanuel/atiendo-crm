/**
 * Contrato de parâmetros de template da Meta — derivado, nunca redigitado.
 *
 * A fixture `tests/fixtures/meta/message-templates.json` é o payload REAL da Graph API
 * (WABA de teste, capturado em 2026-07-28), não mock inventado. É o que dá a estes casos
 * o direito de reprovar: um mock escrito por quem escreveu a derivação concorda com ela
 * por construção.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  deriveTemplateContract,
  describeAddress,
  type TemplateContract,
} from "@/lib/channels/meta/template-contract";

interface RawTemplate {
  name: string;
  language: string;
  parameter_format?: string;
  components?: unknown[];
}

const FIXTURE = JSON.parse(
  readFileSync("tests/fixtures/meta/message-templates.json", "utf8"),
) as { data: RawTemplate[] };

function contractOf(name: string): TemplateContract {
  const t = FIXTURE.data.find((x) => x.name === name);
  if (!t) throw new Error(`fixture sem template ${name}`);
  return deriveTemplateContract(t as Parameters<typeof deriveTemplateContract>[0]);
}

describe("deriveTemplateContract contra payload real da Meta", () => {
  it("template sem parâmetro nenhum deriva zero slots", () => {
    expect(contractOf("hello_world").slots).toHaveLength(0);
  });

  it("3 placeholders no corpo viram 3 slots de texto, na ordem do texto", () => {
    const c = contractOf("jaspers_market_order_confirmation_v1");
    expect(c.slots.map((s) => s.key)).toEqual(["1", "2", "3"]);
    expect(c.slots.every((s) => s.address.kind === "body")).toBe(true);
    expect(c.slots.every((s) => s.expects === "text")).toBe(true);
  });

  it("o contexto ao redor rotula o campo — é o que a tela mostra", () => {
    const c = contractOf("jaspers_market_order_confirmation_v1");
    // `example` vem null nestes templates: sem o contexto, o formulário diria
    // "Parâmetro 1" e ninguém saberia o que preencher.
    expect(c.slots[0]!.contextBefore).toContain("Hi");
    expect(c.slots[1]!.contextBefore).toContain("order number is");
    expect(c.slots[2]!.contextBefore).toContain("Estimated delivery");
  });

  it("HEADER de mídia é slot mesmo SEM nenhum {{n}} no template", () => {
    // O achado central do spike: contar placeholder daria 0 aqui, e o envio
    // sem o parâmetro de header seria montado errado.
    const c = contractOf("jaspers_market_image_cta_v1");
    expect(c.slots).toHaveLength(1);
    expect(c.slots[0]!.address).toEqual({ kind: "header" });
    expect(c.slots[0]!.expects).toBe("image");
  });

  it("CAROUSEL aninha: um slot por card, com card_index próprio", () => {
    const c = contractOf("jaspers_market_media_carousel_v1");
    expect(c.slots).toHaveLength(2);
    expect(c.slots.map((s) => s.address)).toEqual([
      { kind: "card", cardIndex: 0, inner: { kind: "header" } },
      { kind: "card", cardIndex: 1, inner: { kind: "header" } },
    ]);
    expect(describeAddress(c.slots[0]!.address)).toBe("card 1 › cabeçalho");
  });

  it("parameterFormat vem da Meta, não é inferido da chave", () => {
    expect(contractOf("hello_world").parameterFormat).toBe("POSITIONAL");
    // Chave nomeada + parameter_format ausente continua POSITIONAL: inferir do
    // formato da chave classificaria errado e mudaria o payload de envio.
    const inventado = deriveTemplateContract({
      name: "x",
      language: "pt_BR",
      components: [{ type: "BODY", text: "Oi {{customer_name}}" }],
    });
    expect(inventado.parameterFormat).toBe("POSITIONAL");
    expect(inventado.slots[0]!.key).toBe("customer_name");
  });

  it("botão URL estático não vira slot; só o com placeholder vira", () => {
    // Os 5 templates reais têm botões URL ESTÁTICOS — nenhum deles é parâmetro.
    const real = contractOf("jaspers_market_image_cta_v1");
    expect(real.slots.some((s) => s.address.kind === "button")).toBe(false);

    const comSufixo = deriveTemplateContract({
      name: "y",
      language: "pt_BR",
      components: [
        { type: "BODY", text: "veja" },
        { type: "BUTTONS", buttons: [{ type: "URL", text: "Abrir", url: "https://x.com/{{1}}" }] },
      ],
    });
    expect(comSufixo.slots).toHaveLength(1);
    expect(comSufixo.slots[0]!.address).toEqual({ kind: "button", subType: "url", index: 0 });
    expect(comSufixo.slots[0]!.expects).toBe("url_suffix");
  });

  it("FOOTER nunca vira slot, mesmo com placeholder", () => {
    const c = deriveTemplateContract({
      name: "z",
      language: "pt_BR",
      components: [
        { type: "BODY", text: "oi {{1}}" },
        { type: "FOOTER", text: "rodapé {{2}}" },
      ],
    });
    expect(c.slots).toHaveLength(1);
  });
});
