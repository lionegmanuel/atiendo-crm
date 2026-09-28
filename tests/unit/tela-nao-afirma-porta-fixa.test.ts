import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { EXTENSION_PERMISSIONS } from "@/lib/extensions/capacidades";
import { nomeDaPorta } from "@/lib/extensions/portas-legiveis";

/**
 * NENHUMA TELA AFIRMA, EM TEXTO FIXO, QUAL PORTA UMA EXTENSÃO ABRE.
 *
 * Não é regra estética. O defeito aconteceu em QUATRO lugares ao mesmo tempo, e eu consertei o
 * primeiro achando que era o único:
 *
 *   - `InstalledExtensionCard` derivava a frase de um `includes` de uma permissão só — escondia
 *     as demais portas e dizia "não recebe acesso" para quem abre duas telas;
 *   - `ExtensionCatalog` tinha a frase LITERAL, exibida para toda extensão do catálogo,
 *     inclusive as que não abrem Tarefas — mentira na tela onde a pessoa decide;
 *   - `ExtensionGuide` e `NavHub` repetiam a literal no cabeçalho e no cartão.
 *
 * Enquanto existia uma porta só, as quatro frases eram verdade por acidente. A ADR-0003 as
 * tornou falsas de uma vez, e nenhum teste apontou, porque todos mediam outra coisa.
 *
 * A varredura é por AST, e não por heurística de texto: a primeira versão deste arquivo filtrava
 * comentários por prefixo de linha e acusou o próprio comentário acima. Literal de string é um
 * nó do TypeScript; comentário não é nó nenhum, então some sozinho.
 */

const RAIZ = join(__dirname, "..", "..");

const ARQUIVOS = [
  "components/extensions/ExtensionCatalog.tsx",
  "components/extensions/ExtensionGuide.tsx",
  "components/extensions/InstalledExtensionCard.tsx",
  "components/extensions/ExtensionsManager.tsx",
  "components/shell/NavHub.tsx",
];

const NOMES = EXTENSION_PERMISSIONS.map(nomeDaPorta);

/** Todo texto de string literal, template e texto solto de JSX do arquivo. */
function textosLiterais(caminho: string): string[] {
  const origem = ts.createSourceFile(
    caminho,
    readFileSync(caminho, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const achados: string[] = [];
  const visitar = (no: ts.Node) => {
    if (ts.isStringLiteral(no) || ts.isNoSubstitutionTemplateLiteral(no)) achados.push(no.text);
    else if (ts.isTemplateExpression(no)) {
      achados.push(no.head.text, ...no.templateSpans.map((s) => s.literal.text));
    } else if (ts.isJsxText(no)) achados.push(no.text);
    ts.forEachChild(no, visitar);
  };
  ts.forEachChild(origem, visitar);
  return achados;
}

function afirmaPorta(texto: string): boolean {
  return NOMES.some((nome) => texto.includes(`Abre ${nome}`));
}

describe("a tela não afirma porta fixa", () => {
  it.each(ARQUIVOS)("%s não nomeia uma porta em texto literal", (relativo) => {
    const suspeitos = textosLiterais(join(RAIZ, relativo)).filter(afirmaPorta);
    expect(
      suspeitos,
      "a frase da porta sai de portasLegiveis(), nunca de literal na tela",
    ).toEqual([]);
  });

  it("controle positivo: a sonda ENXERGA a frase quando ela é um literal", () => {
    // Sem isto, um extrator quebrado devolveria zero em tudo e o arquivo ficaria verde sem medir.
    const caminho = join(RAIZ, "tests", "unit", "__sonda-porta-fixa.tsx");
    writeFileSync(caminho, `export const x = t("Abre ${NOMES[0]}; não lê seus dados.");\n`);
    try {
      expect(textosLiterais(caminho).filter(afirmaPorta).length).toBeGreaterThan(0);
    } finally {
      rmSync(caminho, { force: true });
    }
  });

  it("controle negativo: comentário que cita a frase NÃO é acusado", () => {
    const caminho = join(RAIZ, "tests", "unit", "__sonda-comentario.tsx");
    writeFileSync(caminho, `// antes dizia "Abre ${NOMES[0]}" e virou portasLegiveis()\nexport const y = 1;\n`);
    try {
      expect(textosLiterais(caminho).filter(afirmaPorta)).toEqual([]);
    } finally {
      rmSync(caminho, { force: true });
    }
  });
});
