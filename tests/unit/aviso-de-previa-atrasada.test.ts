/**
 * O VERDE DE UM PR É DE UMA ÁRVORE QUE PODE JÁ NÃO EXISTIR.
 *
 * Em `pull_request` o CI mede a PRÉVIA do merge (base + head no instante do
 * evento), e ela não se atualiza quando a `main` anda. Medido em 18/09/2026:
 * três PRs "mergeable e verdes" tinham prévia atrasada em 29, 52 e 35 commits;
 * e o PR de release #1229 foi montado sobre uma base 5 commits velha, sem o
 * fragmento de `.changes/` que a main já tinha — a versão teria saído com um
 * conserto dentro e sem nota.
 *
 * O que este arquivo guarda é o formato do aviso, e principalmente as duas
 * decisões que o fazem servir:
 *
 *  1. ele avisa pelo CRUZAMENTO (a main andou em arquivo que o PR toca), não
 *     pelo atraso cru — com ~40 merges por dia, "atrasado em N" avisaria em
 *     todo PR e viraria ruído em uma semana;
 *  2. ele NUNCA reprova — um PR não pode ficar vermelho porque outra pessoa
 *     mesclou algo enquanto ele esperava vaga na fila.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const CI = readFileSync(".github/workflows/ci.yml", "utf8");

/** O bloco do passo, da linha do `- name:` até o próximo passo do mesmo nível. */
function passo(nome: string): string {
  const i = CI.indexOf(`      - name: ${nome}`);
  if (i < 0) throw new Error(`passo ${nome} não encontrado`);
  const resto = CI.slice(i + 1);
  const fim = resto.search(/\n {6}- (name|uses):/);
  return fim < 0 ? resto : resto.slice(0, fim);
}

describe("aviso de prévia atrasada", () => {
  const bloco = passo("A prévia deste PR mediu a main de agora?");

  it("mede a base da PRÓPRIA prévia, não a branch", () => {
    // `pull_request.base.sha` é a base que este run mediu. Trocar por
    // `origin/main` responderia outra pergunta — sempre "zero de atraso".
    expect(bloco).toMatch(/github\.event\.pull_request\.base\.sha/);
    expect(bloco).toMatch(/compare\/\$\{BASE\}\.\.\./);
  });

  it("avisa pelo cruzamento com os arquivos do PR, não pelo atraso cru", () => {
    expect(bloco, "não lista os arquivos que a main mudou").toMatch(/\.files\[\]\?\.filename/);
    expect(bloco, "não lista os arquivos do PR").toMatch(/pulls\/\$\{PR\}\/files/);
    expect(bloco, "não cruza as duas listas").toMatch(/comm -12/);
    const aviso = bloco.split("\n").find((l) => l.includes("::warning title="));
    expect(aviso, "não há aviso nomeado para o cruzamento").toBeDefined();
    expect(aviso!, "o aviso não carrega os números medidos").toMatch(/\$\{atraso\}[\s\S]*\$\{n\}|\$\{n\}[\s\S]*\$\{atraso\}/);
  });

  it("nunca reprova o PR — é informação, não gate", () => {
    const comandos = bloco
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    const saidas = comandos.filter((l) => /^exit\s+\d+/.test(l));
    expect(
      saidas.filter((l) => l !== "exit 0"),
      "o passo passou a reprovar: um PR não pode ficar vermelho porque a main andou",
    ).toEqual([]);
    expect(bloco, "`set -e` faria uma falha de API derrubar o job").not.toMatch(/set -euo/);
  });

  it("declara o truncamento da comparação em vez de ler o vazio como 'não houve'", () => {
    expect(bloco).toMatch(/NÃO MEDIDO/);
  });

  it("só roda em pull_request, e uma vez só (parte 1)", () => {
    expect(bloco).toMatch(/if: github\.event_name == 'pull_request' && matrix\.parte == 1/);
  });
});
