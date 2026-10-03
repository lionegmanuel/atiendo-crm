import { describe, expect, it } from "vitest";

import { normalizarMensagemNaoSuportada } from "./nao-suportada";
import type { ZernioInboundMessage } from "./webhook";

const base = { text: "[Unsupported message]" } as ZernioInboundMessage;

describe("normalizarMensagemNaoSuportada", () => {
  it("troca o marcador do provider por uma frase no idioma da instalação", () => {
    expect(normalizarMensagemNaoSuportada(base, "es").text).toBe(
      "Mensaje no compatible (abrir en WhatsApp)",
    );
    expect(normalizarMensagemNaoSuportada(base, "pt-BR").text).toBe(
      "Mensagem não suportada (abra no WhatsApp)",
    );
  });

  it("não toca em texto comum nem em mensagem sem texto", () => {
    const comum = { text: "Hola, ¿tienen turnos?" } as ZernioInboundMessage;
    expect(normalizarMensagemNaoSuportada(comum, "es")).toBe(comum);
    const vazia = { text: null } as ZernioInboundMessage;
    expect(normalizarMensagemNaoSuportada(vazia, "es")).toBe(vazia);
  });
});
