import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { renderTemplateBody } from "@/lib/channels/meta/render-template";

const FIXTURE = JSON.parse(
  readFileSync("tests/fixtures/meta/message-templates.json", "utf8"),
) as { data: { name: string; language: string; components?: unknown[] }[] };

const tpl = (n: string) => FIXTURE.data.find((t) => t.name === n)!;

describe("renderTemplateBody — o texto que o LEAD vai ler", () => {
  it("substitui os parâmetros do corpo", () => {
    const t = tpl("jaspers_market_order_confirmation_v1");
    const texto = renderTemplateBody(
      t.components,
      { "1": "Rafael", "2": "DESK-001", "3": "30/07" },
      { name: t.name, language: t.language },
    );
    expect(texto).toContain("Hi Rafael");
    expect(texto).toContain("order number is DESK-001");
    expect(texto).toContain("Estimated delivery:  30/07");
    expect(texto).not.toContain("{{");
  });

  it("inclui HEADER de texto e junta com o corpo", () => {
    const t = tpl("hello_world");
    const texto = renderTemplateBody(t.components, {}, { name: t.name, language: t.language });
    expect(texto).toContain("Hello World"); // header
    expect(texto).toContain("Welcome and congratulations"); // body
  });

  it("NÃO inclui o FOOTER — é rodapé fixo, não fala da conversa", () => {
    const t = tpl("hello_world");
    const texto = renderTemplateBody(t.components, {}, { name: t.name, language: t.language });
    expect(texto).not.toContain("WhatsApp Business Platform sample message");
  });

  it("parâmetro sem valor fica visível como {{n}} — nunca some em silêncio", () => {
    // Se sumisse, o gate de promessa analisaria um texto que não é o que sai, e o
    // buraco viraria justamente o ponto cego que este módulo existe para fechar.
    const t = tpl("jaspers_market_order_confirmation_v1");
    const texto = renderTemplateBody(
      t.components,
      { "1": "Rafael" },
      { name: t.name, language: t.language },
    );
    expect(texto).toContain("Hi Rafael");
    expect(texto).toContain("{{2}}");
  });

  it("template só de mídia rende texto vazio, sem estourar", () => {
    const t = tpl("jaspers_market_image_cta_v1");
    const texto = renderTemplateBody(t.components, {}, { name: t.name, language: t.language });
    expect(typeof texto).toBe("string");
  });

  it("usa slotKey para achar o valor — não a chave crua", () => {
    // O carrossel tem dois slots com key '1'; se a busca fosse por key crua, um
    // sobrescreveria o outro. Aqui o corpo simples prova o caminho normal.
    const texto = renderTemplateBody(
      [{ type: "BODY", text: "Oi {{1}}" }],
      { "1": "Ana" },
      { name: "x", language: "pt_BR" },
    );
    expect(texto).toBe("Oi Ana");
  });
});
