import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { DICIONARIO } from "@/lib/i18n/dicionario";

const RAIZ = process.cwd();
const DOCUMENTO = join(RAIZ, "lib/ai/rag/ingest/documento.ts");
/**
 * O worker de indexação também lança `ErroDeExtracao`. A mensagem dele não
 * passa pela rota de upload (só a reindexação a vê, e o cartão da fonte mostra
 * `last_index_error` como está, sem `t()`), então ele entra na regra de chave
 * ESTÁVEL mas não na de espanhol: exigir tradução ali seria cobrar um texto que
 * nenhuma tela traduz.
 */
const WORKER_INDEXADOR = join(RAIZ, "workers/rag-indexer.ts");
const ROTA_UPLOAD = join(RAIZ, "app/api/v1/ai/knowledge/sources/upload/route.ts");

type ChaveEncontrada = { chave: string; local: string };

function textoEstatico(expr: ts.Expression): string | null {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
  if (ts.isParenthesizedExpression(expr)) return textoEstatico(expr.expression);
  if (
    ts.isBinaryExpression(expr) &&
    expr.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const esquerda = textoEstatico(expr.left);
    const direita = textoEstatico(expr.right);
    return esquerda !== null && direita !== null ? esquerda + direita : null;
  }
  return null;
}

function mensagensDeErroDeExtracao(arquivo: string): {
  chaves: ChaveEncontrada[];
  dinamicas: string[];
} {
  const src = readFileSync(arquivo, "utf8");
  const fonte = ts.createSourceFile(arquivo, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const rel = relative(RAIZ, arquivo).split(sep).join("/");
  const chaves: ChaveEncontrada[] = [];
  const dinamicas: string[] = [];

  const visita = (no: ts.Node): void => {
    if (
      ts.isNewExpression(no) &&
      ts.isIdentifier(no.expression) &&
      no.expression.text === "ErroDeExtracao"
    ) {
      const primeiro = no.arguments?.[0];
      const linha = fonte.getLineAndCharacterOfPosition(no.getStart()).line + 1;
      const local = `${rel}:${linha}`;
      const chave = primeiro ? textoEstatico(primeiro) : null;
      if (chave === null) dinamicas.push(local);
      else chaves.push({ chave, local });
    }
    ts.forEachChild(no, visita);
  };

  visita(fonte);
  return { chaves, dinamicas };
}

describe("erros de extração que chegam à tela", () => {
  it("toda mensagem de ErroDeExtracao é uma chave estável, nunca texto de runtime", () => {
    const dinamicas = [DOCUMENTO, WORKER_INDEXADOR].flatMap(
      (arquivo) => mensagensDeErroDeExtracao(arquivo).dinamicas,
    );
    expect(
      dinamicas,
      "ErroDeExtracao chega à rota de upload e vira texto visível; mensagem dinâmica não pode ser chave de tradução",
    ).toEqual([]);
  });

  it("toda chave de ErroDeExtracao tem espanhol", () => {
    const { chaves } = mensagensDeErroDeExtracao(DOCUMENTO);
    const semEspanhol = chaves
      .filter(({ chave }) => !DICIONARIO[chave]?.es)
      .map(({ chave, local }) => `${local} → ${JSON.stringify(chave)}`);

    expect(
      semEspanhol,
      "ErroDeExtracao sem espanhol chega à tela em português porque a rota traduz err.message",
    ).toEqual([]);
  });

  it("a rota de upload traduz a mensagem de ErroDeExtracao antes de responder", () => {
    const rota = readFileSync(ROTA_UPLOAD, "utf8");
    // A janela é generosa de propósito. Ela existe para exigir que os dois
    // marcadores estejam no MESMO ramo, não para medir quantas linhas cabem
    // entre eles — e o ramo cresce: o log da causa já ocupou 209 dos 240
    // caracteres que a versão anterior permitia, e a próxima linha (o
    // console.error de falha de infraestrutura do #1061) o estouraria. O
    // vermelho resultante falaria de i18n num arquivo onde ninguém mexeu em
    // i18n. Só existe um `err instanceof ErroDeExtracao` neste arquivo, então
    // afrouxar a distância não afrouxa o que o caso afirma.
    expect(rota).toMatch(
      /err instanceof ErroDeExtracao[\s\S]{0,800}t\(err\.message\)/,
    );
  });
});
