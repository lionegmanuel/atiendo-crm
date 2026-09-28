import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";

/**
 * O invariante do próprio HARNESS: cada arquivo de tests/invariants recebe o
 * banco no estado do MOLDE — nada do vizinho.
 *
 * Guarda o conserto da issue #207. Sem ele, apagar o `setupFiles` de
 * vitest.db.config.ts devolve a suíte ao regime de banco global compartilhado
 * SEM nenhum sinal: typecheck passa (tsconfig exclui `tests/**`), lint passa, e
 * o job obrigatório `invariants` volta a dar veredito por sorteio — que é o
 * defeito, não o sintoma.
 *
 * ## As duas asserções, e por que são duas
 *
 * 1. O MARCADOR (`DESKCOMM_INVARIANTS_DB_RESET`). Só o setupFile o escreve. É o
 *    que impede a asserção 2 de passar por vacuidade: um arquivo que calha de
 *    ser o PRIMEIRO da rodada vê um banco limpo mesmo sem reset nenhum, e sob
 *    `--sequence.shuffle.files` esse arquivo pode ser este. Sem o marcador, a
 *    guarda ficaria verde em 1 de 101 ordens de uma regressão real — e "1 em
 *    101" é exatamente o tipo de gate que a #207 está consertando.
 *
 * 2. As CONTAGENS, comparadas contra o MOLDE e não contra uma lista escrita à
 *    mão. Lista fixa envelheceria a cada linha nova de seed no baseline — e este
 *    arquivo vive num diretório congelado, onde consertá-la exigiria a variável
 *    de escape do hook. Perguntar ao molde calibra sozinho.
 *
 * Medido: com o setupFile removido, reprova 2 de 2; com o setupFile presente mas
 * o drop/create retirado dele, reprova só a 2 — as duas são carregadas.
 */

const container = process.env.TEST_DB_CONTAINER;
const template = process.env.TEST_DB_TEMPLATE;
if (!container || !template) {
  throw new Error("TEST_DB_CONTAINER/TEST_DB_TEMPLATE ausentes — rode via `pnpm test:db`.");
}

/** `tabela=linhas` de toda tabela NÃO VAZIA de public, mais auth.users. */
const CENSO = `
select 'auth.users=' || count(*) from auth.users;
select coalesce(string_agg(t || '=' || c, ' ' order by t), '(public vazio)') from (
  select c.relname as t,
         (xpath('/row/cnt/text()',
                query_to_xml(format('select count(*) as cnt from public.%I', c.relname),
                             false, true, '')))[1]::text::int as c
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
) s where c > 0;
`;

function censo(db: string): string {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container as string,
      "psql",
      "-U",
      "postgres",
      "-d",
      db,
      "-qtA",
      "-v",
      "ON_ERROR_STOP=1",
      "-f",
      "-",
    ],
    { input: CENSO, encoding: "utf8" },
  ).trim();
}

describe("harness — o banco é novo a cada arquivo (issue #207)", () => {
  it("o setupFile de reset rodou nesta suíte", () => {
    // Se esta falha, `setupFiles` sumiu de vitest.db.config.ts: os 100 arquivos
    // voltaram a dividir um banco global e o veredito voltou a depender da ordem.
    expect(process.env.DESKCOMM_INVARIANTS_DB_RESET).toBe("1");
  });

  it("o banco recebido está no estado do molde — nenhuma linha de vizinho", () => {
    expect(censo("postgres")).toBe(censo(template as string));
  });
});
