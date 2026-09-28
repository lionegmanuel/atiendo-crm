/**
 * O INVENTÁRIO DE TELAS PARA DE MENTIR SOBRE SI MESMO.
 *
 * ## O defeito que fez este arquivo existir
 *
 * `docs/design-system/screen-flow/03-screen-inventory.md` afirmava, em dez
 * lugares, quantas telas tinha. **Nove desses dez números estavam errados** —
 * medido em 2026-08-14, `214f47f0`:
 *
 * | Afirmação | Medido |
 * |---|---|
 * | abertura: "Total ~70 telas" | 94 linhas numeradas |
 * | seção C: "3 telas" | 2 |
 * | seção G: "10 telas" | 11 |
 * | seção M: "15 telas" | 17 |
 * | Resumo: "~74 telas únicas" | 94 |
 * | Resumo: "P0 ~32" | 41 |
 * | Resumo: "P1 ~30" | 46 |
 * | Resumo: "P2 ~12" | 6 |
 * | Resumo: "Realtime ~22" | 27 |
 * | Resumo: "Cross-tenant 17" | 17 — o único certo, e contradizia o cabeçalho da própria seção M |
 *
 * O doc já carregava uma nota declarando que M divergia. Declarar não conserta:
 * a nota envelheceu ao lado do defeito por três meses, e os outros oito números
 * ninguém tinha contado. Número que ninguém mede sobrevive cercado de material
 * rigoroso — foi o que aconteceu aqui.
 *
 * ## O que este arquivo guarda, e o que NÃO guarda
 *
 * Guarda a **consistência interna do doc** (cabeçalho × tabela, totais ×
 * linhas) e uma **catraca que só encolhe** sobre a lista de rotas planejadas e
 * não construídas.
 *
 * NÃO guarda "toda página do disco tem linha no doc", e a ausência é a decisão
 * mais importante daqui. Esse gate criaria uma **segunda lista de telas mantida
 * à mão** — em tabela markdown lida por regex, espelhando um disco que muda toda
 * semana — no mesmo épico em que `components/admin/audit/action-codes.ts` foi
 * apagado por ser exatamente isso. O registro obrigatório por tela já existe e é
 * outro: `lib/navigation/registry.ts` + `tests/unit/navegacao-completude.test.ts`,
 * que reprova tela que existe mas em que só se chega digitando a URL. A seção
 * "Construído fora deste plano" do doc é uma **foto com data**, declarada como
 * não-vigiada no próprio doc para ninguém "completar" o gate depois.
 *
 * ## Por que o caso de vacuidade vem primeiro
 *
 * O parser lê tabela markdown com regex. Quebrado, ele devolve conjunto vazio, e
 * zero divergência sobre zero linha passa por "está tudo certo". O controle
 * positivo mora em `conferirVacuidade` (compartilhado com o script, para não
 * haver duas versões da mesma checagem) e LANÇA — as asserções abaixo só valem
 * porque ele passou.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  conferirVacuidade,
  lerInventario,
  reconciliar,
  rotasNoDisco,
} from "../../scripts/inventario-de-telas.leitura";

const RAIZ = process.cwd();
const DOC = path.join(RAIZ, "docs", "design-system", "screen-flow", "03-screen-inventory.md");

const inventario = lerInventario(readFileSync(DOC, "utf8"));
const rotas = rotasNoDisco(path.join(RAIZ, "app"), (dir) =>
  readdirSync(dir, { withFileTypes: true }).map((e) => ({
    nome: e.name,
    diretorio: e.isDirectory(),
  })),
).sort();
const reconciliacao = reconciliar(inventario, rotas);

const COMANDO = "pnpm exec tsx scripts/inventario-de-telas.ts";

/**
 * Quantas seções o arquivo BRUTO tem, contadas sem passar pelo parser.
 *
 * Medido por revisão adversarial: tirar o "(N telas)" do cabeçalho de UMA seção
 * a faz sumir do parser — e então o doc pode afirmar 93 sobre uma tabela de 95
 * com os seis casos VERDES. O parser só enxerga o que ele mesmo reconhece;
 * comparar com a contagem crua é o que separa "não diverge" de "parei de ler".
 */
function secoesNoArquivoBruto(texto: string): number {
  return (texto.match(/^## [A-Z]\./gm) ?? []).length;
}

describe("inventário de telas", () => {
  it("caso 1 — o instrumento mediu alguma coisa", () => {
    // `conferirVacuidade` lança. Envolver em `expect(...).not.toThrow()` deixaria
    // a mensagem dele (que diz QUAL conjunto veio vazio) fora da saída do vitest.
    conferirVacuidade(inventario, rotas);
    expect(inventario.linhas.length).toBeGreaterThanOrEqual(80);
    expect(rotas.length).toBeGreaterThanOrEqual(20);
  });

  it("caso 2 — o cabeçalho de cada seção conta as linhas que a seção tem", () => {
    const divergentes = inventario.secoes
      .filter((s) => s.declarado !== s.contadas)
      .map((s) => `${s.letra}: cabeçalho diz ${s.declarado}, a tabela tem ${s.contadas}`);
    expect(
      divergentes,
      `Cabeçalho de seção divergindo da própria tabela.\nRode \`${COMANDO}\` para o mapa completo.`,
    ).toEqual([]);
  });

  it("caso 3 — os totais globais são os das tabelas, não estimativas", () => {
    const linhas = inventario.linhas;
    const porPrio = (p: string) => linhas.filter((l) => l.prio === p).length;
    const medido = {
      intro: linhas.length,
      total: linhas.length,
      p0: porPrio("P0"),
      p1: porPrio("P1"),
      p2: porPrio("P2"),
      entregues: porPrio("**entregue**"),
      realtime: linhas.filter((l) => l.realtime).length,
      crossTenant: linhas.filter((l) => l.secao === "M").length,
    };
    expect(
      inventario.totais,
      `A abertura e o Resumo afirmam números que as tabelas não sustentam.\n` +
        `Rode \`${COMANDO}\` e escreva o que ele contou.`,
    ).toEqual(medido);

    // A soma tem de fechar: uma linha sem `Prio` reconhecido sumiria das quatro
    // contagens acima e nenhuma delas acusaria — o total continuaria certo.
    expect(
      medido.p0 + medido.p1 + medido.p2 + medido.entregues,
      "Há linha com `Prio` fora de P0/P1/P2/**entregue** — ela não entra em contagem nenhuma.",
    ).toBe(medido.total);
  });

  it("caso 5 — a lista de não-construído só encolhe", () => {
    expect(
      reconciliacao.curadas,
      `Estas rotas estão listadas como "planejado e ainda não construído" e JÁ existem\n` +
        `no disco. Apague-as da lista em docs/design-system/screen-flow/03-screen-inventory.md\n` +
        `(marcador \`inventario:nao-construido\`) — a catraca não afrouxa.`,
    ).toEqual([]);
  });

  it("caso 5b — toda linha sem rota no disco está declarada em uma das duas listas", () => {
    expect(
      reconciliacao.naoDeclarados.map((l) => `#${l.numero} ${l.rota}`),
      `Linha do inventário apontando para rota que não existe, sem declaração.\n` +
        `Se é plano que falta construir, entre no bloco \`inventario:nao-construido\`;\n` +
        `se existe por outro mecanismo (Server Action, not-found.tsx), no bloco\n` +
        `\`inventario:outro-mecanismo\` com o arquivo que a implementa.`,
    ).toEqual([]);
  });

  it("caso 5c — as listas não nomeiam rota que o inventário não tem", () => {
    expect(
      reconciliacao.inventadas,
      `Rota declarada nos blocos de reconciliação sem linha numerada correspondente.\n` +
        `Lista que nomeia o que a tabela não tem é lista que ninguém conferiu.`,
    ).toEqual([]);
  });
});
