import { describe, expect, it } from "vitest";
import { ehFaltaDeAcessoAEmbeddings } from "./falta-de-embeddings";

describe("ehFaltaDeAcessoAEmbeddings", () => {
  it("reconhece o projeto da OpenAI sem acesso ao modelo de embeddings", () => {
    expect(
      ehFaltaDeAcessoAEmbeddings(
        "embed@0: Project `proj_KuC3Yj1oRX7W0QwivIJ4rJS9` does not have access to model `text-embedding-3-small`",
      ),
    ).toBe(true);
  });

  it("reconhece model_not_found e chave restrita sem permissão de embeddings", () => {
    expect(ehFaltaDeAcessoAEmbeddings("404 model_not_found")).toBe(true);
    expect(
      ehFaltaDeAcessoAEmbeddings("You have insufficient permissions for this operation. Missing scopes: embeddings"),
    ).toBe(true);
  });

  it("não confunde com outros motivos de falha", () => {
    expect(ehFaltaDeAcessoAEmbeddings(null)).toBe(false);
    expect(ehFaltaDeAcessoAEmbeddings("")).toBe(false);
    expect(ehFaltaDeAcessoAEmbeddings("PdfExtractError: só imagens escaneadas")).toBe(false);
    expect(ehFaltaDeAcessoAEmbeddings("429 You exceeded your current quota")).toBe(false);
  });
});
