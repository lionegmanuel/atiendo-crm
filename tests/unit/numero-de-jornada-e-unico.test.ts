/**
 * DUAS JORNADAS NÃO PODEM TER O MESMO NÚMERO.
 *
 * ─── Por que um teste, e não uma convenção ───────────────────────────────────
 *
 * **O git une isto SEM RECLAMAR.** Para ele são duas adições em pontos
 * diferentes do arquivo, e é exatamente o que são. A colisão não é de TEXTO —
 * é de IDENTIDADE, e só aparece se alguém for contar os números na mão.
 *
 * Aconteceu TRÊS VEZES em um único dia (2026-08-28), em quatro trabalhos
 * paralelos que bateram neste arquivo: dois lados criaram uma `J12`, depois uma
 * `J14`, depois uma `J15`. Nenhum merge acusou. Duas foram pegas por leitura
 * humana no meio do conflito; a terceira só apareceu porque alguém foi contar.
 *
 * E as duas colisões mais antigas — `J8` e `J10` — provam que isto **não
 * começou hoje**: elas já estavam na `main` antes desta leva. O dia de hoje não
 * criou o problema, só o tornou visível.
 *
 * ─── O que uma colisão custa ─────────────────────────────────────────────────
 *
 * Número de jornada é REFERÊNCIA. Mensagens de commit, corpos de PR e outras
 * seções deste mesmo documento citam "a J14" para dizer o que foi provado. Com
 * duas J14, a citação aponta para a jornada de outra pessoa — e o leitor
 * seguinte confia nela, porque um documento com duas seções homônimas parece
 * um documento normal.
 *
 * ─── A allowlist SÓ ENCOLHE ─────────────────────────────────────────────────
 *
 * O gate nasceria vermelho com as três colisões vivas, e **gate que nasce
 * vermelho é desligado pela primeira pessoa apertada** — aí ele para de vigiar
 * o que importa. Então a dívida existente entra congelada, com motivo escrito,
 * e há um caso que reprova entrada obsoleta: quando alguém pagar uma dessas
 * dívidas, a linha correspondente TEM de sair daqui. É o mesmo desenho de
 * `tests/unit/navegacao-completude.test.ts`.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const MAPA = "docs/testing/user-journey-map.md";

/**
 * Colisões que já existiam quando este gate nasceu. **Só encolhe.**
 *
 * Renumerar uma jornada publicada não é gratuito — o número é citado em commits
 * e PRs já mergeados, e trocá-lo agora quebraria essas referências em troca de
 * arrumação. Por isso elas ficam, com o custo declarado, e o gate impede que a
 * QUARTA nasça.
 */
const COLISOES_CONGELADAS: Record<string, string> = {
  J8:
    "anterior a este gate (2026-08-28): 'O cliente não morre por falta de resposta' e " +
    "'Passar o atendimento para uma pessoa, e receber de volta'. As duas são citadas por " +
    "trabalho já mergeado; renumerar quebraria referência existente para arrumar aparência.",
  J10:
    "anterior a este gate (2026-08-28): 'Marca própria: o revendedor põe a cara dele no sistema' " +
    "e 'Instalação fresca com a marca do revendedor'. Mesmo custo de renumeração.",
};

interface Jornada {
  numero: string;
  titulo: string;
  linha: number;
}

function jornadas(): Jornada[] {
  const texto = readFileSync(MAPA, "utf8");
  const fora: Jornada[] = [];
  texto.split("\n").forEach((l, i) => {
    const m = /^## (J\d+) — (.+)$/.exec(l);
    if (m) fora.push({ numero: m[1]!, titulo: m[2]!, linha: i + 1 });
  });
  return fora;
}

function porNumero(): Map<string, Jornada[]> {
  const mapa = new Map<string, Jornada[]>();
  for (const j of jornadas()) {
    const lista = mapa.get(j.numero) ?? [];
    lista.push(j);
    mapa.set(j.numero, lista);
  }
  return mapa;
}

describe("número de jornada é único", () => {
  it("o parser ENXERGA as jornadas (senão ele mede o vazio e passa)", () => {
    // Sem esta guarda, quebrar a regex faria a suíte ficar verde afirmando que
    // não há colisão nenhuma — que é o desfecho que mais se parece com sucesso e
    // menos vale. É a mesma armadilha que produziu, no mesmo dia, um `grep` que
    // contava menções em vez de falhas e devolvia zero.
    const todas = jornadas();
    expect(
      todas.length,
      `${MAPA} não rendeu jornada nenhuma — a regex quebrou, o arquivo não ficou vazio`,
    ).toBeGreaterThan(10);
    expect(todas.every((j) => /^J\d+$/.test(j.numero))).toBe(true);
  });

  it("nenhum número novo é usado duas vezes", () => {
    const novas = [...porNumero().entries()]
      .filter(([n, lista]) => lista.length > 1 && !(n in COLISOES_CONGELADAS))
      .map(([n, lista]) => `${n}: ${lista.map((j) => `linha ${j.linha} "${j.titulo}"`).join("  ×  ")}`);

    expect(
      novas,
      "duas jornadas com o MESMO número. O git une isto sem reclamar — para ele são duas " +
        "adições em pontos diferentes —, então a colisão só aparece aqui. Número de jornada é " +
        "referência: com dois iguais, uma citação passa a apontar para a jornada de outra " +
        "pessoa. Escolha o próximo número livre e renumere os casos junto (J<n>.1, J<n>.2, …):\n  " +
        novas.join("\n  "),
    ).toEqual([]);
  });

  it("colisão congelada que foi PAGA sai da lista", () => {
    // A allowlist só encolhe. Sem este caso, uma entrada resolvida ficaria aqui
    // para sempre, e a lista deixaria de descrever a dívida real — passando a
    // permitir, em silêncio, que aquele número colidisse de novo.
    const mapa = porNumero();
    const obsoletas = Object.keys(COLISOES_CONGELADAS).filter(
      (n) => (mapa.get(n)?.length ?? 0) <= 1,
    );
    expect(
      obsoletas,
      "estes números não colidem mais — tire-os de `COLISOES_CONGELADAS`, porque " +
        "allowlist que não encolhe deixa de descrever a dívida e passa a autorizar a próxima",
    ).toEqual([]);
  });

  it("toda colisão congelada carrega motivo escrito", () => {
    const semMotivo = Object.entries(COLISOES_CONGELADAS)
      .filter(([, motivo]) => motivo.trim().length < 40)
      .map(([n]) => n);
    expect(
      semMotivo,
      "dívida sem motivo escrito é dívida que ninguém sabe se ainda vale — a próxima pessoa " +
        "lê a linha e não o porquê",
    ).toEqual([]);
  });
});
