/**
 * A VERSÃO DA API DO GOOGLE ADS: viva, e num lugar só.
 *
 * O transporte de conversões entrou na main com `"v17"` escrito à mão, e a v17
 * já estava desativada: toda chamada voltava 404 em HTML, lido como erro
 * permanente — cada venda virava `recusado_pela_plataforma` sem nova tentativa.
 * Nenhum teste olhava o número, porque o número não tinha dono.
 *
 * Três guardas, cada uma por um modo de falha:
 *
 * 1. **Piso da janela viva.** A mais velha ainda viva em 18/09/2026 é a v22
 *    (página de sunset do Google, citada em `versao-da-api.ts`). Voltar para
 *    abaixo disso reprova. O piso só SOBE, e sobe quando o Google desativar a
 *    v22 — é a mesma manutenção do bump.
 * 2. **Um lugar só.** Versão do Google Ads escrita fora de `versao-da-api.ts`
 *    reprova — o molde é `versao-da-graph-num-lugar-so.test.ts`.
 * 3. **Motivo legível.** O 404 da versão desativada chega em HTML; o detalhe
 *    que vai à tela não pode ser marcação.
 *
 * Ponto cego DECLARADO: a catraca lê o literal escrito no fonte. Versão
 * MONTADA (`"v" + 25`) passa — quem escreve assim está driblando de propósito.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { INTERNOS } from "@/lib/plataformas-de-anuncio/google/conversions";
import { VERSAO_DA_API_DO_GOOGLE_ADS } from "@/lib/plataformas-de-anuncio/google/versao-da-api";

const RAIZ = path.join(__dirname, "..", "..");

/** A mais velha ainda viva, medida em 18/09/2026. Só sobe. */
const PISO_DA_JANELA_VIVA = 22;

const MODULO_UNICO = path.join("lib", "plataformas-de-anuncio", "google", "versao-da-api.ts");
const PASTA_DO_GOOGLE_ADS = path.join("lib", "plataformas-de-anuncio", "google");
const ONDE_PROCURAR = ["app", "lib", "components", "hooks", "workers", "scripts"];
const PASTAS_IGNORADAS = new Set(["node_modules", ".git", ".next"]);
const CODIGO = /\.(ts|tsx|mjs|js)$/;

/** Endereço do Google Ads com versão embutida, em qualquer arquivo. */
const ENDERECO_COM_VERSAO = /googleads\.googleapis\.com\/v\d+/;
/** Literal de versão solto (`"v25"`, `/v25/`) — só dentro da pasta do Google Ads. */
const LITERAL_DE_VERSAO = /(?<=["'`/])v\d{2}(?=["'`/:])/;

function arquivosDeCodigo(dir: string): string[] {
  const abs = path.join(RAIZ, dir);
  if (!fs.existsSync(abs)) return [];
  const saida: string[] = [];
  for (const entrada of fs.readdirSync(abs, { withFileTypes: true })) {
    if (PASTAS_IGNORADAS.has(entrada.name)) continue;
    const rel = path.join(dir, entrada.name);
    if (entrada.isDirectory()) saida.push(...arquivosDeCodigo(rel));
    else if (CODIGO.test(entrada.name) && !/\.test\.tsx?$/.test(entrada.name)) saida.push(rel);
  }
  return saida;
}

/** Tira comentários de linha e de bloco — história medida em comentário não reprova. */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("versão da API do Google Ads", () => {
  it(`está dentro da janela viva (>= v${PISO_DA_JANELA_VIVA}) — a v17 da main reprovava aqui`, () => {
    const casa = /^v(\d+)$/.exec(VERSAO_DA_API_DO_GOOGLE_ADS);
    expect(casa, `formato inesperado: ${VERSAO_DA_API_DO_GOOGLE_ADS}`).not.toBeNull();
    expect(Number(casa![1])).toBeGreaterThanOrEqual(PISO_DA_JANELA_VIVA);
  });

  it("mora num lugar só: nenhum outro arquivo de produção escreve a versão", () => {
    const infratores: string[] = [];
    for (const arquivo of ONDE_PROCURAR.flatMap(arquivosDeCodigo)) {
      if (arquivo === MODULO_UNICO) continue;
      const fonte = semComentarios(fs.readFileSync(path.join(RAIZ, arquivo), "utf8"));
      const naPasta = arquivo.startsWith(PASTA_DO_GOOGLE_ADS + path.sep);
      if (ENDERECO_COM_VERSAO.test(fonte) || (naPasta && LITERAL_DE_VERSAO.test(fonte))) {
        infratores.push(arquivo);
      }
    }
    expect(infratores).toEqual([]);
  });

  it("o transporte monta o endereço COM a constante (não com um literal)", () => {
    const fonte = fs.readFileSync(path.join(RAIZ, PASTA_DO_GOOGLE_ADS, "conversions.ts"), "utf8");
    expect(fonte).toMatch(/\$\{ENDERECO_BASE\}\/\$\{VERSAO_DA_API_DO_GOOGLE_ADS\}\/customers\//);
  });
});

describe("erro sem JSON vira motivo legível", () => {
  const HTML_DO_404 =
    "<!DOCTYPE html><html lang=en><meta charset=utf-8><title>Error 404 (Not Found)!!1</title>" +
    "<p><b>404.</b> <ins>That’s an error.</ins><p>The requested URL was not found on this server.";

  it("404 em HTML: nada de marcação no detalhe, e a pista da versão aparece", () => {
    const corpo = INTERNOS.lerCorpoDeErro(404, HTML_DO_404);
    const r = INTERNOS.classificaErro(404, corpo);
    expect(r.tipo).toBe("permanente");
    if (r.tipo !== "permanente") throw new Error("inalcançável");
    expect(r.detalhe).not.toMatch(/[<>]/);
    expect(r.detalhe).toContain(VERSAO_DA_API_DO_GOOGLE_ADS);
    expect(r.detalhe).toMatch(/desativada/);
  });

  it("outro status sem JSON: diz o status, sem a pista da versão", () => {
    const corpo = INTERNOS.lerCorpoDeErro(400, "Bad Request");
    expect(corpo.message).toContain("HTTP 400");
    expect(corpo.message).not.toMatch(/desativada/);
  });

  it("erro em JSON continua lido como o Google manda", () => {
    const corpo = INTERNOS.lerCorpoDeErro(
      400,
      JSON.stringify({ error: { code: 400, status: "INVALID_ARGUMENT", message: "gclid inválido" } }),
    );
    expect(corpo).toEqual({ code: 400, status: "INVALID_ARGUMENT", message: "gclid inválido" });
  });
});
