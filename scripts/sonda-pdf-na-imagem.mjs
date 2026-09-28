#!/usr/bin/env node
/**
 * Sonda: a IMAGEM do app extrai texto de um PDF? (issue #1075)
 *
 * Roda dentro da imagem publicada (`node /sonda-pdf-na-imagem.mjs`), com o PDF de
 * amostra montado do runner. Não conhece a árvore do repositório: só o que a
 * imagem tem.
 *
 * POR QUE UMA SONDA, SE JÁ EXISTE TESTE DE EXTRAÇÃO
 *
 * `tests/unit/pdf-extractor.test.ts` extrai texto de verdade e fica verde — o
 * defeito não está no código do extrator, está no EMPACOTAMENTO. Na imagem o pdfjs
 * vive dentro de um chunk do Turbopack gerado no build, e nada que rode a partir do
 * repositório mede esse arquivo:
 *
 * - `pnpm test:unit` importa `pdfjs-dist` do `node_modules` do repositório, onde o
 *   worker existe: verde, medindo outro caminho.
 * - O gate de boot (`imagem-do-app-sobe`) exige que o Next chegue a "Ready". O app
 *   sobe com a extração quebrada — ele só morre quando alguém manda um PDF.
 *
 * O QUE O PDFJS PROCURA (medido no chunk empacotado deste build)
 *
 *   module.exports=[766534,t=>{ ... static{n&&(this.#s5=!0,iM.workerSrc||="./pdf.worker.mjs")} ... }]
 *   setupFakeWorkerGlobal: (async()=> ... (await import(this.workerSrc)).WorkerMessageHandler)()
 *
 * Em Node o pdfjs configura o worker sozinho, com o specifier RELATIVO
 * `"./pdf.worker.mjs"`, e o carrega de dentro do próprio chunk empacotado. Quem
 * resolve esse caminho é o runtime, a partir da posição do chunk: se o arquivo não
 * estiver lá, a extração morre ANTES de ler o PDF, e o texto de um PDF comum — que
 * tem texto — vira "não consegui ler" ou "PDF sem texto" em toda extração.
 *
 * O CAMINHO DA ROTA, NÃO UM PARECIDO
 *
 * O módulo é carregado como a imagem o carrega: o chunk do pdfjs é registrado no
 * runtime do Turbopack e instanciado por ele (`c(chunk)` + `m(id)`), e a extração
 * roda de verdade sobre a fixture deste repo. `import("pdfjs-dist")` cru mediria
 * outro caminho (na imagem esse pacote não está instalado fora do bundle) e um mock
 * mediria nada.
 *
 * SAÍDA
 *
 * Última linha: `VEREDITO=GREEN` (exit 0) ou `VEREDITO=RED` (exit 1). Acima dela, um
 * JSON com a etapa que falhou, o erro cru, o id do módulo empacotado, o texto lido e
 * onde um `pdf.worker.mjs` foi encontrado (a lista costuma vir vazia quando o defeito
 * está presente — é o dado que a issue #1075 pede para não se perder). Os nomes das
 * chaves e as duas palavras de veredito fazem parte do contrato:
 * `tests/unit/sonda-de-pdf-na-imagem.test.ts` os verifica.
 *
 * Variáveis de ambiente (todas com default, para rodar à mão num container):
 *
 *   APP_DIR       raiz do standalone na imagem        (default: /app)
 *   PDF_FIXTURE   caminho do PDF de amostra           (default: /fixture.pdf)
 *   PDF_ESPERADO  texto exato que ele deve render     (default: DeskcommCRM RAG fixture)
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TEXTO_ESPERADO_PADRAO = "DeskcommCRM RAG fixture";

/** Onde ficam o runtime e os chunks do servidor no `output: standalone`. */
export const DIR_CHUNKS = join(".next", "server", "chunks");

/** O runtime do Turbopack que registra as fábricas dos chunks. */
export const RUNTIME = join(DIR_CHUNKS, "[turbopack]_runtime.js");

/**
 * Os chunks que carregam o pdfjs empacotado (nome gerado no build a partir do
 * caminho do módulo — ex.: `0b5b_pdfjs-dist_legacy_build_pdf_mjs_0wixz6p._.js`).
 */
export function chunksPdfjs(nomes) {
  return nomes.filter((nome) => /pdfjs-dist.*pdf_mjs.*\.js$/.test(nome));
}

/**
 * Os ids de módulo registrados por um chunk.
 *
 * O formato do chunk é "comprimido": uma corrida de ids seguida de UMA fábrica
 * (`module.exports=[766534, t=>{...}]`), e o runtime instala a mesma fábrica para
 * todos os ids da corrida. Lemos os ids do começo do array; quem instancia valida
 * o resto.
 */
export function idsDoChunk(fonte) {
  const ids = [];
  for (const achado of fonte.matchAll(/module\.exports\s*=\s*\[([\d,\s]{1,200})/g)) {
    for (const pedaco of achado[1].split(",")) {
      const numero = pedaco.trim();
      if (numero !== "" && /^\d+$/.test(numero)) ids.push(Number(numero));
    }
  }
  return ids;
}

/**
 * Onde existe um `pdf.worker.mjs` nesta raiz — para o log dizer o que a imagem TEM,
 * em vez de só o que ela não tem.
 *
 * Não é a verdade sobre onde o arquivo DEVE estar: a sonda mede comportamento, não
 * layout. São os lugares medidos nesta família de build: ao lado do chunk (irmão —
 * é de lá que o specifier relativo é resolvido quando o chunk o carrega), no
 * caminho virtual do pnpm que o Turbopack usa nas URLs dos módulos (a issue #1075
 * cita esse caminho) e no caminho direto do pacote.
 */
export function procurarWorker(raiz) {
  const achados = [];
  const diretos = [
    join(raiz, DIR_CHUNKS, "pdf.worker.mjs"),
    join(raiz, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs"),
  ];
  for (const caminho of diretos) {
    if (existsSync(caminho)) achados.push(caminho);
  }

  const raizesPnpm = [
    join(raiz, ".next", "node_modules", ".pnpm"),
    join(raiz, "node_modules", ".pnpm"),
  ];
  for (const base of raizesPnpm) {
    if (!existsSync(base)) continue;
    let entradas = [];
    try {
      entradas = readdirSync(base);
    } catch {
      continue;
    }
    for (const entrada of entradas) {
      if (!entrada.startsWith("pdfjs-dist@")) continue;
      const caminho = join(base, entrada, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs");
      if (existsSync(caminho)) achados.push(caminho);
    }
  }
  return achados;
}

/** Configuração da execução, sempre por variável de ambiente (default: a imagem). */
export function configurar(env = process.env) {
  return {
    raiz: resolve(env.APP_DIR || "/app"),
    fixture: resolve(env.PDF_FIXTURE || "/fixture.pdf"),
    esperado: (env.PDF_ESPERADO || TEXTO_ESPERADO_PADRAO).trim(),
  };
}

/**
 * Extrai o texto como o extrator do RAG extrai (`lib/ai/rag/extractors/pdf.ts`):
 * a quebra de linha vem do `hasEOL` do pdfjs e as páginas são separadas por linha
 * em branco. Se a sonda juntasse diferente, ela mediria outro texto e poderia ficar
 * vermelha num empacotamento certo.
 */
export async function extrairTexto(pdfjs, dados) {
  const documento = await pdfjs.getDocument({ data: new Uint8Array(dados) }).promise;

  const paginas = [];
  for (let numero = 1; numero <= documento.numPages; numero++) {
    const pagina = await documento.getPage(numero);
    const conteudo = await pagina.getTextContent();
    const texto = conteudo.items
      .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : ""))
      .join("")
      .trim();
    if (texto.length > 0) paginas.push(texto);
  }
  return paginas.join("\n\n").trim();
}

/**
 * Carrega o pdfjs EMPACOTADO, pelo runtime do Turbopack, como a rota o carrega.
 *
 * Devolve `{ pdfjs, id, chunk }`. Lança quando não consegue nem chegar no módulo —
 * o que também é veredito RED: num build assim a rota não extrairia texto nenhum.
 */
export function carregarPdfjsEmpacotado({ raiz }) {
  const dirChunks = join(raiz, DIR_CHUNKS);
  const caminhoRuntime = join(raiz, RUNTIME);

  if (!existsSync(caminhoRuntime)) {
    throw new Error(`não achei o runtime do Turbopack em ${caminhoRuntime}`);
  }
  if (!existsSync(dirChunks)) {
    throw new Error(`não achei os chunks do servidor em ${dirChunks}`);
  }

  const candidatos = chunksPdfjs(readdirSync(dirChunks));
  if (candidatos.length !== 1) {
    throw new Error(
      `esperava 1 chunk do pdfjs em ${dirChunks}, achei ${candidatos.length}: ` +
        `${candidatos.join(", ") || "(nenhum)"}`,
    );
  }
  const chunk = candidatos[0];

  // O contrato do runtime (lido do próprio arquivo):
  //   module.exports = (sourcePath) => ({ m: (id) => modulo, c: (chunkPath) => carregaChunk }) 
  // `c` faz `path.resolve(RUNTIME_ROOT, chunkPath)` e `require`, então o caminho
  // absoluto do chunk passa direto.
  const runtime = createRequire(import.meta.url)(caminhoRuntime)("server/chunks/[turbopack]_runtime.js");
  runtime.c(join(dirChunks, chunk));

  const ids = idsDoChunk(readFileSync(join(dirChunks, chunk), "utf8"));
  for (const id of ids) {
    let exportado;
    try {
      exportado = runtime.m(id).exports;
    } catch {
      continue;
    }
    if (exportado && typeof exportado.getDocument === "function") {
      return { pdfjs: exportado, id, chunk };
    }
  }

  throw new Error(
    `nenhum dos ${ids.length} módulos do chunk ${chunk} exporta getDocument ` +
      `(ids: ${ids.join(", ") || "(nenhum)"})`,
  );
}

/** Roda a sonda e devolve o relatório (não imprime, não sai do processo). */
export async function rodar(env = process.env) {
  const config = configurar(env);
  const relatorio = {
    veredito: "RED",
    etapa: "preparar",
    raiz: config.raiz,
    fixture: config.fixture,
    esperado: config.esperado,
  };

  try {
    if (!existsSync(config.fixture)) {
      throw new Error(
        `não achei o PDF de amostra em ${config.fixture} — monte a fixture do repositório ` +
          `(tests/fixtures/sample-text.pdf) nesse caminho`,
      );
    }

    const { pdfjs, id, chunk } = carregarPdfjsEmpacotado(config);
    relatorio.chunkPdfjs = chunk;
    relatorio.idEmpacotado = id;

    relatorio.etapa = "extrair";
    const texto = await extrairTexto(pdfjs, readFileSync(config.fixture));
    relatorio.caracteres = texto.length;
    relatorio.textoExtraido = texto.slice(0, 200);

    relatorio.etapa = "conferir";
    if (texto.length === 0) {
      throw new Error("a extração terminou sem texto algum (PDF só com imagem?)");
    }
    if (texto !== config.esperado) {
      throw new Error("o texto extraído não bate com o da fixture");
    }

    relatorio.etapa = "fim";
    relatorio.veredito = "GREEN";
  } catch (erro) {
    relatorio.erro = erro instanceof Error ? erro.message : String(erro);
    const causa = erro instanceof Error ? erro.cause : undefined;
    if (causa) relatorio.causa = causa instanceof Error ? causa.message : String(causa);
    relatorio.workersEncontrados = procurarWorker(config.raiz);
  }

  return relatorio;
}

/** Imprime o relatório no formato que o log do job mostra. */
export function relatar(relatorio) {
  console.log(`Sonda de extração de PDF na imagem do app (issue #1075)`);
  console.log(`  raiz:    ${relatorio.raiz}`);
  console.log(`  fixture: ${relatorio.fixture} (esperado: "${relatorio.esperado}")`);

  if (relatorio.veredito === "GREEN") {
    console.log(
      `  extraiu ${relatorio.caracteres} caracteres pelo módulo empacotado ` +
        `(chunk ${relatorio.chunkPdfjs}, id ${relatorio.idEmpacotado})`,
    );
    console.log(`  texto: "${relatorio.textoExtraido}"`);
  } else {
    console.log(`  FALHOU na etapa "${relatorio.etapa}": ${relatorio.erro}`);
    if (relatorio.causa) console.log(`  causa: ${relatorio.causa}`);
    if (relatorio.textoExtraido !== undefined) {
      console.log(`  texto lido: "${relatorio.textoExtraido}"`);
    }
    const achados = relatorio.workersEncontrados || [];
    console.log(
      `  pdf.worker.mjs nesta imagem: ${achados.length > 0 ? achados.join(", ") : "(não encontrado em lugar nenhum)"}`,
    );
    console.log(
      "  a extração da rota depende desse arquivo estar onde o pdfjs empacotado o procura",
    );
  }

  console.log(JSON.stringify(relatorio, null, 2));
  console.log(`VEREDITO=${relatorio.veredito}`);
}

// Só age como programa quando é o programa; importado (teste), só exporta.
const executadoDireto =
  typeof process.argv[1] === "string" && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (executadoDireto) {
  const relatorio = await rodar();
  relatar(relatorio);
  process.exit(relatorio.veredito === "GREEN" ? 0 : 1);
}
