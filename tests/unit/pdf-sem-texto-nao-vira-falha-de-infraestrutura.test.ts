// @vitest-environment node
//
// PR #1061. `extrairTextoDoArquivo` passou a logar "[extracao-pdf] falha de
// infraestrutura" para todo `PdfExtractError` que NÃO seja o de PDF sem texto —
// e distinguia os dois comparando `err.message` com a frase inglesa lançada em
// `extractors/pdf.ts`. O #928 traduz essa frase. Integrados, sem conflito de
// texto na linha, todo PDF só-imagem (o caso mais comum de recusa) passaria a
// ser logado como pacote ausente no build: o log que existe para achar defeito
// de imagem Docker viraria ruído no primeiro upload de PDF escaneado.
//
// A classificação agora mora numa propriedade do erro (`motivo`), marcada no
// ponto em que ele é lançado. Estes casos reprovam se a distinção voltar a
// depender da redação:
//   - o primeiro lança o erro de "sem texto" com OUTRA frase (o que o #928 faz);
//   - o segundo passa pela fixture real, para o `motivo` não ser só do dublê;
//   - o terceiro garante que a falha de infraestrutura continua logada.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import { ErroDeExtracao, extrairTextoDoArquivo } from "@/lib/ai/rag/ingest/documento";
import { extractPdfText, PdfExtractError } from "@/lib/ai/rag/extractors/pdf";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

vi.mock("@/lib/ai/rag/extractors/pdf", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ai/rag/extractors/pdf")>();
  return { ...original, extractPdfText: vi.fn(original.extractPdfText) };
});

const fixture = (nome: string) => readFileSync(join(process.cwd(), "tests/fixtures", nome));

function servindo(bytes: Buffer): void {
  const copia = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const download = vi.fn(async () => ({ data: new Blob([copia]), error: null }));
  vi.mocked(createAdminClient).mockReturnValue({
    storage: { from: () => ({ download }) },
  } as unknown as ReturnType<typeof createAdminClient>);
}

const LOG_DE_INFRAESTRUTURA = "[extracao-pdf] falha de infraestrutura, não de conteúdo:";

function logouInfraestrutura(espiao: ReturnType<typeof vi.spyOn>): boolean {
  return espiao.mock.calls.some((args: unknown[]) => args[0] === LOG_DE_INFRAESTRUTURA);
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  const original = await vi.importActual<typeof import("@/lib/ai/rag/extractors/pdf")>(
    "@/lib/ai/rag/extractors/pdf",
  );
  vi.mocked(extractPdfText).mockImplementation(original.extractPdfText);
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("PDF sem texto x falha de infraestrutura na extração", () => {
  it("PDF sem texto não loga falha de infraestrutura, qualquer que seja a frase do erro", async () => {
    servindo(fixture("sample-sem-texto.pdf"));
    vi.mocked(extractPdfText).mockRejectedValue(
      new PdfExtractError("o PDF não tem texto selecionável (talvez só imagens)", undefined, "sem_texto"),
    );

    await expect(extrairTextoDoArquivo("org/escaneado.pdf", "pdf")).rejects.toBeInstanceOf(ErroDeExtracao);
    expect(logouInfraestrutura(consoleError)).toBe(false);
  });

  it("o PDF só-imagem real sai marcado como sem texto e não loga infraestrutura", async () => {
    servindo(fixture("sample-sem-texto.pdf"));

    const original = await vi.importActual<typeof import("@/lib/ai/rag/extractors/pdf")>(
      "@/lib/ai/rag/extractors/pdf",
    );
    await expect(original.extractPdfText(fixture("sample-sem-texto.pdf"))).rejects.toMatchObject({
      motivo: "sem_texto",
    });

    await expect(extrairTextoDoArquivo("org/escaneado.pdf", "pdf")).rejects.toBeInstanceOf(ErroDeExtracao);
    expect(logouInfraestrutura(consoleError)).toBe(false);
  });

  it("falha de infraestrutura continua logada com a mensagem do extrator", async () => {
    servindo(fixture("sample-text.pdf"));
    vi.mocked(extractPdfText).mockRejectedValue(
      new PdfExtractError(
        "pdfjs-dist failed to extract text from the PDF",
        new Error("Cannot find package 'pdfjs-dist'"),
      ),
    );

    await expect(extrairTextoDoArquivo("org/material.pdf", "pdf")).rejects.toBeInstanceOf(ErroDeExtracao);
    expect(consoleError).toHaveBeenCalledWith(
      LOG_DE_INFRAESTRUTURA,
      "pdfjs-dist failed to extract text from the PDF",
    );
  });
});
