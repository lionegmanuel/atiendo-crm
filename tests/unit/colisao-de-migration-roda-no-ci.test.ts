/**
 * AS DUAS CAMADAS DA GUARDA DE COLISÃO DE MIGRATION TÊM DE CONTINUAR NO CI.
 *
 * Camada 1 (já existia, e NINGUÉM a vigiava): `pnpm checar:colisao-de-migration`
 * na parte 1 do `verify` — o número que o PR acrescenta não pode estar tomado na
 * base. Sem este arquivo, apagar essa linha sai verde, e a régua vira de novo o
 * gancho local, que `core.hooksPath` não versiona e fork nenhum roda.
 *
 * Camada 2 (nova): fora de `pull_request` a camada 1 é INERTE — HEAD é a própria
 * base e nada foi "acrescentado". Medido em 19/09/2026: o #965 estava verde com
 * prévia de 1039 commits atrás e cinco números já tomados, porque a guarda dele
 * rodou contra uma `main` que já não existe. A varredura da árvore fecha essa
 * fresta: nenhum NNNN nem timestamp repetido pode existir na `main`.
 *
 * ⚠️ O NOME DO COMANDO TEM DOIS FORMATOS, e foi assim que eu errei: buscar pelo
 * ARQUIVO (`checar-colisao-de-migration.sh`) não acha quem o chama pelo ALIAS
 * (`checar:colisao-de-migration`). Medi zero, concluí "o CI não executa" e
 * escrevi um PR inteiro em cima disso — até um colega medir na fonte. Por isso
 * as asserções abaixo casam os DOIS nomes.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const CI = readFileSync(".github/workflows/ci.yml", "utf-8");
const PKG = JSON.parse(readFileSync("package.json", "utf-8")) as { scripts: Record<string, string> };

function blocoDoJob(job: string): string {
  const inicio = CI.indexOf(`\n  ${job}:\n`);
  if (inicio < 0) throw new Error(`job ${job} não encontrado`);
  const resto = CI.slice(inicio + 1);
  const fim = resto.slice(1).search(/\n  [a-zA-Z0-9_-]+:\n/);
  return fim < 0 ? resto : resto.slice(0, fim + 1);
}

describe("as duas camadas da guarda de colisão rodam no CI", () => {
  const verify = blocoDoJob("verify-parte");

  it("controle positivo: o recorte pegou o job que roda a suíte", () => {
    expect(verify).toContain("pnpm");
    expect(verify.length).toBeGreaterThan(500);
  });

  it("o alias existe no package.json e aponta para o script", () => {
    // O elo que a minha sonda cega não atravessou: é ele que liga o nome usado
    // no workflow ao arquivo de verdade.
    expect(PKG.scripts["checar:colisao-de-migration"]).toMatch(/scripts\/checar-colisao-de-migration\.sh/);
  });

  it("camada 1: o verify invoca a guarda por QUALQUER um dos dois nomes", () => {
    const invoca =
      /pnpm checar:colisao-de-migration/.test(verify) ||
      /bash scripts\/checar-colisao-de-migration\.sh/.test(verify);
    expect(
      invoca,
      "nenhum passo do verify-parte chama a guarda de colisão, nem pelo alias nem pelo arquivo: a régua volta a ser só o gancho local, que fork nenhum roda",
    ).toBe(true);
  });

  it("camada 1 roda em pull_request — não pode ser desligada justamente onde serve", () => {
    const i = verify.search(/- name: Colisão de número de migration/);
    expect(i, "o passo da camada 1 sumiu ou foi renomeado").toBeGreaterThan(-1);
    const passo = verify.slice(i, i + 400);
    expect(passo.match(/^\s+if: (.*)$/m)?.[1]).toBe("matrix.parte == 1");
  });

  it("nenhum passo REPROVA com base no `gh api compare` — ele não enxerga migrations", () => {
    // O compare devolve no máximo 300 arquivos em ordem alfabética, e
    // `supabase/migrations` cai fora do corte: medido, o do #965 traz 300
    // arquivos e ZERO migrations, com cinco colisões reais. Um gate assim
    // imprimiria "nada pôde ser tomado" e sairia verde — falha-aberta em
    // proporção ao risco (achado do @Maestro PRs na revisão do #1268).
    //
    // Avisar com ele é legítimo (o passo "A prévia deste PR mediu a main de
    // agora?" faz isso, e é ::warning::). REPROVAR não é: a camada 1 já mede
    // contra a `main` fresca, e o que sobra — o RUN envelhecer — é do vigia.
    const passos = verify.split(/\n      - name: /).filter((p) => p.includes("compare/"));
    expect(passos.length, "controle: o passo que compara pela API sumiu").toBeGreaterThan(0);
    for (const passo of passos) {
      expect(passo, `um passo reprova a partir do compare: ${passo.split("\n")[0]}`).not.toMatch(
        /::error|exit 1\b/,
      );
    }
  });

  it("camada 2: a varredura da árvore roda FORA de pull_request", () => {
    const i = verify.search(/- name: A árvore da main tem NNNN ou timestamp repetido\?/);
    expect(i, "a varredura de duplicata na árvore saiu do verify").toBeGreaterThan(-1);
    const passo = verify.slice(i, i + 400);
    expect(
      passo.match(/^\s+if: (.*)$/m)?.[1],
      "em pull_request a camada 1 já mede; fora dele é a única que mede",
    ).toBe("matrix.parte == 1 && github.event_name != 'pull_request'");
  });
});
