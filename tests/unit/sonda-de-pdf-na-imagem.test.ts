// @vitest-environment node
//
// Issue #1075. A extração de PDF quebrou em TODA release publicada e nenhum job
// existente conseguia ver: `tests/unit/pdf-extractor.test.ts` importa o `pdfjs-dist`
// do repositório (onde o `pdf.worker.mjs` existe) e o gate de boot da imagem só exige
// que o Next chegue a "Ready" — o app sobe, a extração só morre quando alguém manda um
// PDF. O que faltava era medir a extração DENTRO da imagem, pelo módulo EMPACOTADO.
//
// A guarda é `.github/workflows/publish-image.yml` (passo "A imagem extrai texto de
// PDF?") + `scripts/sonda-pdf-na-imagem.mjs`. Aqui a sonda é executada DE VERDADE,
// como processo, contra um layout sintético que reproduz a FORMA do defeito: um chunk
// registrado no runtime do Turbopack (mesmo contrato `c(chunk)`/`m(id)` do runtime
// real) cuja fábrica carrega o worker pelo specifier RELATIVO `"./pdf.worker.mjs"` —
// como o pdfjs empacotado faz em Node. Sem o arquivo ao lado do chunk a extração morre
// com "Cannot find module .../pdf.worker.mjs"; com ele, o texto sai.
//
// O que estes testes travam, então, é o veredito: RED quando a imagem não extrai, GREEN
// quando extrai, e a sonda presente no job que sobe a imagem. Uma sonda "consertada"
// para passar sem extrair nada fica vermelha aqui.

import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterAll, describe, expect, it } from "vitest";

const raiz = process.cwd();
const sonda = join(raiz, "scripts", "sonda-pdf-na-imagem.mjs");
const fixture = join(raiz, "tests", "fixtures", "sample-text.pdf");
const TEXTO_DA_FIXTURE = "DeskcommCRM RAG fixture";

const executar = promisify(execFile);

/** Roda a sonda como processo e devolve o código de saída com o log. */
async function rodarSonda(ambiente: Record<string, string>) {
  try {
    const { stdout, stderr } = await executar(process.execPath, [sonda], {
      encoding: "utf8",
      env: { ...process.env, ...ambiente },
    });
    return { codigo: 0, log: `${stdout}${stderr}` };
  } catch (erro) {
    const falha = erro as { code?: number; stdout?: string; stderr?: string };
    return { codigo: falha.code ?? -1, log: `${falha.stdout ?? ""}${falha.stderr ?? ""}` };
  }
}

/**
 * O runtime do Turbopack, no contrato que a sonda usa (lido do arquivo real):
 * `module.exports = (sourcePath) => ({ m: (id) => módulo, c: (chunkPath) => carrega })`.
 * O formato do chunk é o "comprimido": uma corrida de ids seguida de UMA fábrica.
 */
const RUNTIME_SINTETICO = `
const fabricas = new Map();
function instalar(itens) {
  let i = 0;
  while (i < itens.length) {
    let fim = i + 1;
    while (fim < itens.length && typeof itens[fim] !== "function") fim++;
    if (fim === itens.length) throw new Error("malformed chunk format, expected a factory function");
    for (let j = i; j < fim; j++) fabricas.set(itens[j], itens[fim]);
    i = fim + 1;
  }
}
module.exports = (sourcePath) => ({
  c: (chunkPath) => instalar(require(chunkPath)),
  m: (id) => {
    const fabrica = fabricas.get(id);
    if (typeof fabrica !== "function") throw new Error("module factory not available for: " + id);
    const modulo = { id, exports: {} };
    fabrica({ F: (caminho) => caminho }, modulo, modulo.exports);
    return modulo;
  },
});
`;

/** Um chunk com a forma do empacotado, cuja extração passa (ou não) pelo worker. */
function chunkPdfjsSintetico(texto = TEXTO_DA_FIXTURE) {
  return `
// A fábrica carrega o worker exatamente como o pdfjs empacotado carrega em Node:
// specifier relativo ao PRÓPRIO chunk. Sem o arquivo, morre antes de ler o PDF.
// O registro começa sem espaço (\`module.exports=[\`), como no chunk gerado no build.
module.exports=[766534,
  (contexto, modulo, exports) => {
    exports.getDocument = () => ({
      promise: (async () => {
        await import("./pdf.worker.mjs");
        return {
          numPages: 1,
          getPage: async () => ({
            getTextContent: async () => ({ items: [{ str: ${JSON.stringify(texto)}, hasEOL: false }] }),
          }),
        };
      })(),
    });
  },
];
`;
}

/** Monta um "standalone" sintético em /tmp e devolve a raiz dele. */
function montarImagem(opcoes: { comWorker: boolean; texto?: string }) {
  const raizApp = mkdtempSync(join(tmpdir(), "sonda-pdf-1075-"));
  const chunks = join(raizApp, ".next/server/chunks");
  mkdirSync(chunks, { recursive: true });
  writeFileSync(join(chunks, "[turbopack]_runtime.js"), RUNTIME_SINTETICO);
  writeFileSync(
    join(chunks, "0b5b_pdfjs-dist_legacy_build_pdf_mjs_sintetico._.js"),
    chunkPdfjsSintetico(opcoes.texto),
  );
  if (opcoes.comWorker) {
    writeFileSync(join(chunks, "pdf.worker.mjs"), "export const WorkerMessageHandler = {};\n");
  }
  return raizApp;
}

const imagens: string[] = [];
function novaImagem(opcoes: { comWorker: boolean; texto?: string }) {
  const raizApp = montarImagem(opcoes);
  imagens.push(raizApp);
  return raizApp;
}

afterAll(() => {
  for (const raizApp of imagens) rmSync(raizApp, { recursive: true, force: true });
});

describe("scripts/sonda-pdf-na-imagem.mjs", () => {
  it("dá GREEN quando a imagem extrai o texto da fixture pelo módulo empacotado", async () => {
    const raizApp = novaImagem({ comWorker: true });
    const { codigo, log } = await rodarSonda({
      APP_DIR: raizApp,
      PDF_FIXTURE: fixture,
      PDF_ESPERADO: TEXTO_DA_FIXTURE,
    });

    expect(log).toContain("VEREDITO=GREEN");
    expect(codigo).toBe(0);
    // O texto é o mesmo que o extrator do RAG devolve — não basta "não deu erro".
    expect(log).toContain(`"textoExtraido": "${TEXTO_DA_FIXTURE}"`);
    expect(log).toContain('"idEmpacotado": 766534');
  });

  it("dá RED quando o worker não está na imagem — o defeito da issue #1075", async () => {
    const raizApp = novaImagem({ comWorker: false });
    const { codigo, log } = await rodarSonda({
      APP_DIR: raizApp,
      PDF_FIXTURE: fixture,
      PDF_ESPERADO: TEXTO_DA_FIXTURE,
    });

    expect(codigo).toBe(1);
    expect(log).toContain("VEREDITO=RED");
    // O erro cru tem de estar no log: quem lê o job precisa saber QUAL arquivo faltou.
    expect(log).toContain("Cannot find module");
    expect(log).toContain("pdf.worker.mjs");
    expect(log).toContain('"etapa": "extrair"');
    // A lista de onde o worker foi procurado é o dado que a issue pede para não sumir.
    expect(log).toContain('"workersEncontrados"');
  });

  it("dá RED quando a imagem extrai outro texto (PDF que abre, mas sem o texto esperado)", async () => {
    const raizApp = novaImagem({ comWorker: true, texto: "só imagem escaneada" });
    const { codigo, log } = await rodarSonda({
      APP_DIR: raizApp,
      PDF_FIXTURE: fixture,
      PDF_ESPERADO: TEXTO_DA_FIXTURE,
    });

    expect(codigo).toBe(1);
    expect(log).toContain("VEREDITO=RED");
    expect(log).toContain("não bate com o da fixture");
  });

  it("está no job que sobe a imagem do app, rodando dentro da imagem construída", () => {
    const linhas = readFileSync(join(raiz, ".github/workflows/publish-image.yml"), "utf8").split("\n");

    // O job inteiro: de `imagem-do-app-sobe:` até o próximo job (mesma indentação).
    const inicio = linhas.findIndex((linha) => linha.startsWith("  imagem-do-app-sobe:"));
    expect(inicio).toBeGreaterThan(-1);
    const fim = linhas.findIndex(
      (linha, i) => i > inicio && /^  [a-z0-9-]+:$/.test(linha),
    );
    const job = linhas.slice(inicio, fim === -1 ? undefined : fim).join("\n");

    // A imagem precisa existir antes de a sonda rodar.
    expect(job.indexOf("deskcomm-smoke:pr")).toBeLessThan(job.indexOf("sonda-pdf-na-imagem.mjs"));
    // ...e a sonda roda DENTRO dela: mesma tag, executando o script montado.
    expect(job).toMatch(/deskcomm-smoke:pr node \/sonda-pdf-na-imagem\.mjs/);
    // O PDF de amostra é o MESMO do teste de extração do repositório, montado do runner.
    expect(job).toContain("tests/fixtures/sample-text.pdf:/fixture.pdf");
    expect(job).toContain("scripts/sonda-pdf-na-imagem.mjs:/sonda-pdf-na-imagem.mjs");
    expect(job).toContain(`PDF_ESPERADO="${TEXTO_DA_FIXTURE}"`);
  });
});
