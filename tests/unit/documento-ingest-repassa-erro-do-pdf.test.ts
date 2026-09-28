// @vitest-environment node
//
// ONDE VAI PARAR A CAUSA DE UMA FALHA DE PDF — a decisão, e a guarda dela.
//
// O defeito é real e foi medido duas vezes, por duas frentes independentes:
// `extrairTextoDoArquivo` traduzia TODO `PdfExtractError` para a mesma frase
// ("Se ele for só imagens escaneadas…"), inclusive quando `extractPdfText` já
// tinha diagnosticado algo bem mais específico — o binário nativo
// `@napi-rs/canvas` ausente, ou o pacote `pdfjs-dist` inteiro fora do tracing
// do `next build standalone`. Nos dois casos é defeito de INFRAESTRUTURA, e o
// operador lia uma frase que acusava o arquivo dele.
//
// As duas frentes discordaram no remédio, e a `main` decidiu:
//
//   • o PR #928 (@cabindaferreira) mandava a causa específica para a TELA;
//   • a `main` (17/09, medida numa instalação real) mantém UMA frase para a
//     pessoa — "é a única que faz sentido pra quem não sabe o que é
//     pdfjs-dist" — e manda a causa para o LOG.
//
// Venceu a da `main`, e é ela que este arquivo prende. O teste mudou de lado
// junto: ele nasceu, no recorte do #928, provando o repasse para a tela; agora
// prova as DUAS metades da decisão que ficou de pé — porque a metade que
// importa (a causa não se perder) é a mesma nas duas versões, e era justamente
// a que não tinha teste nenhum depois do merge.
//
// ⚠️ A asserção sobre o `console.error` NÃO é decoração. Sem ela, "a causa vai
// para o log" é só uma frase de comentário: quem apagasse aquele `console.error`
// devolveria o defeito original — a causa some — com a suíte inteira verde,
// porque a mensagem que a pessoa vê continuaria idêntica.

import { afterEach, describe, expect, it, vi } from "vitest";

import type * as PdfExtractorModule from "@/lib/ai/rag/extractors/pdf";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        download: async () => ({
          data: new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])]),
          error: null,
        }),
      }),
    },
  }),
}));

/**
 * Faz `extractPdfText` falhar como o módulo real falha, sem tocar no resto dele.
 *
 * O `motivo` é o argumento que importa: `documento.ts` decide por ele, e **não**
 * pela frase ("a frase é traduzível", diz o comentário da decisão). Um duplo que
 * só reproduzisse a mensagem entregaria conteúdo classificado como
 * infraestrutura — e foi exatamente o que este arquivo fez enquanto a decisão
 * ainda era pela frase.
 */
function comFalhaDePdf(mensagem: string, motivo: PdfExtractorModule.MotivoDaFalhaDePdf = "falha") {
  vi.doMock("@/lib/ai/rag/extractors/pdf", async () => {
    const real = await vi.importActual<typeof PdfExtractorModule>("@/lib/ai/rag/extractors/pdf");
    return {
      ...real,
      extractPdfText: async () => {
        throw new real.PdfExtractError(mensagem, undefined, motivo);
      },
    };
  });
}

/**
 * A frase que o extrator emite quando o PDF abriu e não tem letra selecionável.
 * Ela é só o texto do diagnóstico: quem separa conteúdo de infraestrutura é o
 * `motivo` que acompanha o erro.
 */
const SEM_TEXTO = "pdfjs-dist extracted no text (possibly image-only PDF)";

afterEach(() => {
  vi.doUnmock("@/lib/ai/rag/extractors/pdf");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("extrairTextoDoArquivo — onde a causa da falha de PDF vai parar", () => {
  it("falha de INFRAESTRUTURA: a pessoa vê a frase única, e a causa vai para o log", async () => {
    comFalhaDePdf(
      "Extração de PDF indisponível nesta instalação: falta o binário nativo @napi-rs/canvas, " +
        "que o leitor de PDF usa.",
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const { extrairTextoDoArquivo } = await import("@/lib/ai/rag/ingest/documento");

    // O que a PESSOA lê: a frase única, e não o nome de um pacote npm.
    await expect(extrairTextoDoArquivo("org/material.pdf")).rejects.toThrow(/imagens escaneadas/);
    await expect(extrairTextoDoArquivo("org/material.pdf")).rejects.not.toThrow(
      /@napi-rs\/canvas/,
    );

    // O que o LOG guarda: a causa real, inteira. É a metade que o defeito
    // original apagava, e a que nenhum teste cobria.
    const linhas = log.mock.calls.map((c) => c.join(" "));
    expect(linhas.some((l) => /@napi-rs\/canvas/.test(l))).toBe(true);
    expect(linhas.some((l) => /falha de infraestrutura/.test(l))).toBe(true);
  });

  it("falha de CONTEÚDO (PDF só imagem): mesma frase para a pessoa, e NADA no log", async () => {
    // O controle que dá sentido ao caso acima. Se o `console.error` fosse
    // incondicional, esta asserção ficaria vermelha — e sem ela a sonda do
    // outro caso não distinguiria "logou a causa certa" de "loga sempre".
    comFalhaDePdf(SEM_TEXTO, "sem_texto");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const { extrairTextoDoArquivo } = await import("@/lib/ai/rag/ingest/documento");

    await expect(extrairTextoDoArquivo("org/material.pdf")).rejects.toThrow(/imagens escaneadas/);
    expect(log.mock.calls.filter((c) => /extracao-pdf/.test(c.join(" ")))).toHaveLength(0);
  });
});
