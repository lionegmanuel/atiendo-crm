/**
 * UMA CONSTRAINT, UM BLOCO — O APÊNDICE DO BASELINE NÃO A RECONSTRÓI EM SÉRIE.
 *
 * O `baseline.sql` é o que o self-hoster aplica: `install.sh` numa base nova
 * (com `ON_ERROR_STOP=1`) e `update.sh` numa base que JÁ TEM DADOS. O apêndice
 * cresce por blocos, um por migration — e quando duas migrations mexem na mesma
 * constraint de vocabulário, o padrão natural é cada bloco fazer
 * `drop constraint` + `add constraint` com a lista da SUA época.
 *
 * ## O defeito que fez este arquivo existir
 *
 * `agent_inbox_items_kind_check` era reconstruída SETE vezes, cada bloco com o
 * vocabulário do seu momento. Num banco com uma linha cujo `kind` veio de uma
 * migration posterior — digamos `capabilities_missing`, da 0105 — os seis
 * primeiros blocos falham em cadeia ao re-aplicar:
 *
 *   ERROR: check constraint "agent_inbox_items_kind_check" of relation
 *          "agent_inbox_items" is violated by some row      (×6)
 *
 * O estado final ficava certo por acidente: o sétimo bloco, o último do arquivo,
 * tinha o vocabulário completo e recriava a constraint. Mas entre o primeiro
 * `drop` e o `add` que funciona, a tabela passa SEM constraint nenhuma — e se o
 * run morre no meio (queda de rede, OOM), é assim que a base fica.
 *
 * E o dano garantido é outro: o `update.sh` classifica erro por padrão de texto
 * (`already exists`, `multiple primary keys`…) e este NÃO está na lista. Todo
 * clone com dados via, a cada atualização, o alarme "avisos que NÃO são os
 * esperados… se algo estiver errado, restaure o backup" — para um problema que
 * não existia. Alarme falso recorrente treina o dono a ignorar o alarme certo.
 *
 * ## Por que nenhum teste pegava
 *
 * `scripts/test-db.sh` aplica o baseline em modo install e depois em modo
 * update, mas na MESMA base recém-criada — **vazia**. Sem linhas, nenhuma
 * constraint pode ser violada, e os dois modos passam. O gate mede idempotência
 * de DDL, não de DDL sobre dados. É exatamente a lacuna que este arquivo cobre,
 * e por isso ele é estático (lê o arquivo) e não precisa de Postgres.
 *
 * ## A regra
 *
 * Cada constraint aparece UMA vez no `baseline.sql`, na versão final. O apêndice
 * de uma migration que só amplia vocabulário não recria a constraint: comenta
 * que o valor novo já está no bloco único. Migration nova que amplia o
 * vocabulário edita AQUELE bloco — o arquivo é apêndice idempotente, não um
 * diário de bordo executável.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const BASELINE = join(process.cwd(), "supabase", "baseline.sql");

/** Nomes de constraint em cada `add constraint <nome>`, na ordem do arquivo. */
function constraintsAdicionadas(sql: string): string[] {
  return [...sql.matchAll(/add\s+constraint\s+([a-z0-9_]+)/gi)]
    .map((m) => m[1])
    .filter((nome): nome is string => nome !== undefined)
    .map((nome) => nome.toLowerCase());
}

describe("baseline.sql — uma constraint, um bloco", () => {
  const sql = readFileSync(BASELINE, "utf8");

  it("nenhuma constraint é adicionada mais de uma vez", () => {
    const contagem = new Map<string, number>();
    for (const nome of constraintsAdicionadas(sql)) {
      contagem.set(nome, (contagem.get(nome) ?? 0) + 1);
    }

    const repetidas = [...contagem.entries()]
      .filter(([, n]) => n > 1)
      .map(([nome, n]) => `${nome} (${n}×)`);

    expect(
      repetidas,
      `Constraint reconstruída em mais de um bloco do baseline.sql: ${repetidas.join(", ")}.\n` +
        "Num banco com dados do vocabulário mais novo, os blocos antigos falham ao re-aplicar\n" +
        "(update.sh) e a tabela fica sem constraint entre o drop e o add que funciona.\n" +
        "Deixe UM bloco só, com o vocabulário final, e comente os demais.",
    ).toEqual([]);
  });

  it("o instrumento enxerga repetição quando ela existe", () => {
    // Controle negativo: sem isto, um regex quebrado faria o teste acima passar
    // para sempre — verde por não medir nada.
    const falso =
      "alter table t add constraint c_check check (k in ('a'));\n" +
      "alter table t add constraint c_check check (k in ('a','b'));\n";
    const nomes = constraintsAdicionadas(falso);
    expect(nomes).toEqual(["c_check", "c_check"]);
  });
});
