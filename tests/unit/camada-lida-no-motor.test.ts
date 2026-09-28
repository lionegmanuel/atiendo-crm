/**
 * O MOTOR TEM DE LER A ESCOLHA DA ORGANIZAÇÃO — SENÃO O INTERRUPTOR É DECORATIVO.
 *
 * ## Como esta lacuna foi descoberta
 *
 * Por sabotagem, e ela custou uma previsão errada para valer a pena: desfiz o
 * `camadaLigada(...)` no turno do Conversador — deixando o motor voltar a ler só
 * a variável de ambiente — e rodei a rede inteira que eu tinha acabado de
 * escrever. **13 testes, nenhum vermelho.**
 *
 * A rede cobria três coisas e nenhuma era esta: o teste puro guarda a REGRA de
 * precedência, o invariante guarda o SCHEMA e o isolamento, o componente e o e2e
 * guardam a TELA. Ninguém guardava a FIAÇÃO — e é ela que separa "a tela grava a
 * escolha" de "a escolha vale alguma coisa".
 *
 * O defeito que isso deixaria passar é exatamente o que este trabalho existe para
 * não cometer: um interruptor que a pessoa liga, que grava no banco, que aparece
 * ligado quando ela volta — e que o motor ignora. Pior que não ter o controle,
 * porque a tela vira prova de uma coisa que não acontece.
 *
 * ## Por que estático
 *
 * O comportamento só apareceria num turno real, com modelo e fila. A propriedade,
 * porém, é enumerável a partir do repositório: **todo ponto que lê o knob de
 * ambiente destas duas camadas passa pela função de precedência**. Onde a
 * propriedade é enumerável, o teste ganha do hábito — a régua do
 * `navegacao-completude`.
 *
 * A fraqueza é conhecida e declarada: isto mede TEXTO. Um refactor que renomeie
 * `camadaLigada` sem mudar o comportamento reprova aqui (falso positivo barato de
 * corrigir), e um que leia o knob por um caminho que este regex não conhece passa
 * batido (falso negativo). Por isso o controle positivo abaixo exige que os
 * pontos continuem sendo encontrados: instrumento que não acha nada devolve verde
 * igual a instrumento que não achou problema.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();

/**
 * Os pontos onde o knob de ambiente das duas camadas é consultado.
 *
 * Cada entrada é um arquivo do motor e o trecho que denuncia a leitura. Ponto
 * novo entra aqui — e é justamente isso que faz a lista valer: o terceiro
 * consumidor (`followup-turn`) só foi ligado porque alguém foi procurar TODOS, e
 * não só o do caminho principal.
 */
const PONTOS_DE_CONSUMO: Array<{ arquivo: string; knob: string }> = [
  { arquivo: "lib/agent-engine/agent/inbound-turn.ts", knob: "deps.knobs.jailbreak !== undefined" },
  {
    arquivo: "lib/agent-engine/agent/inbound-turn.ts",
    knob: "deps.knobs.promiseSemantic?.enabled === true",
  },
  {
    arquivo: "lib/agent-engine/agent/followup-turn.ts",
    knob: "deps.knobs.promiseSemantic?.enabled === true",
  },
];

function fonte(arquivo: string): string {
  return readFileSync(path.join(RAIZ, arquivo), "utf8");
}

describe("a escolha da organização é lida onde a camada é consumida", () => {
  it("os pontos de consumo ainda existem — controle positivo", () => {
    // Sem isto, um refactor que mudasse a forma do knob faria todas as asserções
    // abaixo passarem por não encontrar nada: verde de instrumento morto.
    for (const p of PONTOS_DE_CONSUMO) {
      expect(
        fonte(p.arquivo).includes(p.knob),
        `o knob \`${p.knob}\` não existe mais em ${p.arquivo} — ENSINE ESTA LISTA ` +
          "antes de assumir que o ponto sumiu.",
      ).toBe(true);
    }
  });

  it("todo knob de ambiente passa pela função de precedência", () => {
    const fora: string[] = [];
    for (const p of PONTOS_DE_CONSUMO) {
      const texto = fonte(p.arquivo);
      const i = texto.indexOf(p.knob);
      // A chamada envolve o knob: `camadaLigada(<escolha>, <knob>)`. Olhar a
      // janela ANTES do knob é o que distingue "envolvido" de "existe um
      // `camadaLigada` em algum lugar do arquivo".
      const janela = texto.slice(Math.max(0, i - 120), i);
      if (!janela.includes("camadaLigada(")) fora.push(`${p.arquivo} → ${p.knob}`);
    }

    expect(
      fora,
      "Este knob vem do `.env` do worker e vale para a instalação inteira. Sem " +
        "`camadaLigada(escolhaDaOrg, knob)`, a escolha que a organização faz na tela é " +
        "gravada no banco e IGNORADA pelo motor — um interruptor que mente, que é pior " +
        "que interruptor nenhum.\n",
    ).toEqual([]);
  });

  it("os três pontos são lidos com UMA leitura por turno, não uma por ponto", () => {
    // Duas queries para a mesma pergunta viram, com o tempo, duas respostas — e
    // aqui as duas respostas seriam duas políticas de segurança diferentes dentro
    // do mesmo atendimento.
    for (const arquivo of new Set(PONTOS_DE_CONSUMO.map((p) => p.arquivo))) {
      const ocorrencias = fonte(arquivo).split("lerCamadasDaOrg(").length - 1;
      // 1 import + 1 chamada = 2. Mais que isso é uma segunda leitura no mesmo
      // arquivo.
      expect(ocorrencias, `${arquivo} lê as camadas mais de uma vez por turno`).toBeLessThanOrEqual(2);
      expect(ocorrencias, `${arquivo} não lê as camadas`).toBeGreaterThan(0);
    }
  });
});
