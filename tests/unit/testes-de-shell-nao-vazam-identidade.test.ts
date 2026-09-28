/**
 * OS TESTES DE SHELL NÃO ESCREVEM NO REPOSITÓRIO DE QUEM OS RODA.
 *
 * Um `git -C "$dir" config user.name …` grava onde o git RESOLVER o repositório,
 * e não necessariamente em "$dir": um `GIT_DIR` herdado (a suíte rodada de dentro
 * de um hook, de um `rebase --exec`) manda por cima do `-C`, e "$dir" que não é
 * repositório sobe até o pai. Em 10/09/2026 uma escrita assim deixou
 * `Pessoa <alguem@fork.dev>` — a identidade de mentira destes testes — no
 * `.git/config` do checkout compartilhado, e ela assinou 829 dos 987 commits
 * (sem merge) que entraram na main até 18/09. Nenhum gate viu: o teste passava,
 * e o estrago ficava fora da árvore de trabalho.
 *
 * Duas regras, medidas no texto dos scripts:
 *   1. nenhum `git … config user.*` que resolva repositório. Identidade de
 *      commit vai por ambiente (`GIT_AUTHOR_*`) ou por `git -c`; quando o config
 *      É o dado sob teste, a escrita é `git config --file <clone>/.git/config`,
 *      que não resolve repositório nenhum;
 *   2. todo script que cria, clona ou commita em repositório descartável zera o
 *      ambiente local do git herdado: `unset $(git rev-parse --local-env-vars)`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const SCRIPTS = [
  ...readdirSync(join(RAIZ, "tests", "shell"))
    .filter((f) => f.endsWith(".sh"))
    .map((f) => join("tests", "shell", f)),
  join("hostgator-setup-kit", "test-validators.sh"),
];

/** Linhas de código, sem comentário de linha inteira. */
function codigo(caminho: string): Array<[number, string]> {
  return readFileSync(join(RAIZ, caminho), "utf-8")
    .split("\n")
    .map((linha, i): [number, string] => [i + 1, linha])
    .filter(([, linha]) => !/^\s*#/.test(linha));
}

/** `git [-C x] config [--local] user.*` — a escrita que resolve repositório. */
const ESCRITA_DE_IDENTIDADE = /\bgit\b(?:\s+-C\s+("[^"]*"|\S+))?\s+config\s+(?:--local\s+)?user\./;
/** O que torna o script capaz de escrever num repositório. */
const ESCREVE_NO_GIT = /\bgit\b(?:\s+-C\s+("[^"]*"|\S+))?\s+(?:init|clone|commit)\b/;
const ZERA_O_AMBIENTE = /^\s*unset \$\(git rev-parse --local-env-vars\)\s*$/;

describe("testes de shell não vazam para o repositório de quem roda", () => {
  it("a varredura alcança os scripts (controle de vivacidade)", () => {
    // Sem isto, um caminho errado devolveria lista vazia e as duas regras
    // abaixo passariam sobre nada.
    expect(SCRIPTS.length).toBeGreaterThanOrEqual(10);
    expect(SCRIPTS.filter((s) => codigo(s).some(([, l]) => ESCREVE_NO_GIT.test(l))).length)
      .toBeGreaterThanOrEqual(5);
  });

  it("nenhum `git config user.*` que resolva repositório", () => {
    const achados = SCRIPTS.flatMap((s) =>
      codigo(s)
        .filter(([, l]) => ESCRITA_DE_IDENTIDADE.test(l))
        .map(([n, l]) => `${s}:${n}: ${l.trim()}`),
    );
    expect(achados).toEqual([]);
  });

  it("todo script que escreve no git zera o ambiente local herdado", () => {
    const semTrava = SCRIPTS.filter((s) => {
      const linhas = codigo(s);
      return (
        linhas.some(([, l]) => ESCREVE_NO_GIT.test(l)) &&
        !linhas.some(([, l]) => ZERA_O_AMBIENTE.test(l))
      );
    });
    expect(semTrava).toEqual([]);
  });
});
