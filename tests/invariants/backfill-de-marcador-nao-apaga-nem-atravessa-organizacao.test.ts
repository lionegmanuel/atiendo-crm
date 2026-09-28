/**
 * O BACKFILL DO MARCADOR NORMALIZADO (migration 0335) NÃO APAGA MARCADOR NEM
 * ATRAVESSA ORGANIZAÇÃO.
 *
 * ═══ A guarda que faltava, e por que o verde de hoje não a substitui ═══
 *
 * O `pnpm test:db` aplica o `baseline.sql` num banco VAZIO. Um backfill sobre
 * zero linha passa por vacuidade: a sentença roda, não toca nada e o gate fica
 * verde — inclusive com o SQL errado. Nenhum job deste repositório executa um
 * backfill contra dado sujo, e foi por isso que o defeito abaixo atravessou o
 * CI do PR inteiro (#1263, @webtecnica).
 *
 * ═══ O defeito que este arquivo prende (medido em Postgres 17.6) ═══
 *
 * A primeira sentença do backfill deduplica com `distinct on`. Com a chave
 *
 *     select distinct on (left(lower(btrim(u.x)), 40))
 *
 * o Postgres guarda UMA linha por marcador na TABELA INTEIRA — não por contato.
 * Efeito: o segundo contato que tem "VIP" PERDE o marcador ({VIP,Suporte} vira
 * {suporte}), e a deduplicação atravessa organizações, porque a chave não tem
 * nada que separe tenant. A consulta é válida, roda sem erro e sem aviso: quem
 * denuncia é o dado.
 *
 * A chave certa é `(c2.id, left(...))`, com o `order by` acompanhando.
 *
 * ═══ Por que num invariante, e não num teste de unidade ═══
 *
 * A propriedade é do SQL rodando sobre linhas de verdade. Um dublê responderia
 * o que o autor do dublê espera — e o defeito é exatamente uma diferença entre
 * o que a consulta parece fazer e o que o Postgres faz.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { beforeAll, afterAll, describe, expect, it } from "vitest";

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error(
    "TEST_DB_CONTAINER not set — rode esta suíte via `pnpm test:db` (scripts/test-db.sh)",
  );
}
const containerName: string = container;

function sql(script: string): string {
  return execFileSync(
    "docker",
    [
      "exec", "-i", containerName, "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-tA", "-f", "-",
    ],
    { input: script, encoding: "utf8" },
  ).trim();
}

const ORG_A = "dddddddd-0335-4000-8000-00000000000a";
const ORG_B = "dddddddd-0335-4000-8000-00000000000b";
const CONTATO_A = "dddddddd-0335-4000-8000-0000000000a1";
const CONTATO_B = "dddddddd-0335-4000-8000-0000000000b1";

/**
 * O backfill sai do ARQUIVO DA MIGRATION, e não de uma cópia escrita aqui: um
 * espelho se deriva. Copiado à mão, este teste passaria a provar a cópia — e o
 * dia em que a migration mudasse sem o teste mudar junto seria o dia em que ele
 * pararia de valer, em silêncio.
 */
const BACKFILL = (() => {
  const arquivo = readFileSync(
    "supabase/migrations/20260919160000_0335_marcador_do_contato_normalizado.sql",
    "utf8",
  );
  return arquivo.slice(arquivo.indexOf("update public.contacts c"));
})();

const tagsDe = (id: string): string =>
  sql(`select coalesce(array_to_string(tags, ','), '') from public.contacts where id = '${id}';`);

beforeAll(() => {
  sql(`
    insert into public.organizations (id, slug, display_name, legal_name)
      values ('${ORG_A}', 'org-backfill-0335-a', 'Org A', 'Org A'),
             ('${ORG_B}', 'org-backfill-0335-b', 'Org B', 'Org B')
      on conflict (id) do nothing;
    delete from public.contacts where id in ('${CONTATO_A}', '${CONTATO_B}');
    insert into public.contacts (id, organization_id, name, phone_number, tags)
      values ('${CONTATO_A}', '${ORG_A}', 'Contato A', '+5511900000335',
              array['VIP', ' Suporte ']),
             ('${CONTATO_B}', '${ORG_B}', 'Contato B', '+5511900000336',
              array['vip', 'Cliente']);
  `);
});

afterAll(() => {
  sql(`
    delete from public.contacts where id in ('${CONTATO_A}', '${CONTATO_B}');
    delete from public.organizations where id in ('${ORG_A}', '${ORG_B}');
  `);
});

describe("backfill do marcador normalizado (0335)", () => {
  it("cada contato conserva TODOS os seus marcadores, mesmo com 'vip' nas duas organizações", () => {
    sql(BACKFILL);

    // Com a chave global do `distinct on`, o contato B saía {cliente}: o "vip"
    // dele era descartado porque o "VIP" do contato A — de OUTRA organização —
    // já tinha vencido a deduplicação da tabela inteira.
    expect(tagsDe(CONTATO_A), "contato A perdeu marcador").toBe("vip,suporte");
    expect(tagsDe(CONTATO_B), "contato B perdeu marcador (dedup atravessou a organização)").toBe(
      "vip,cliente",
    );
  });

  it("segunda execução não muda mais nada — o baseline é reaplicado em todo update", () => {
    sql(BACKFILL);
    const depoisDaPrimeira = [tagsDe(CONTATO_A), tagsDe(CONTATO_B)];
    sql(BACKFILL);
    expect([tagsDe(CONTATO_A), tagsDe(CONTATO_B)]).toEqual(depoisDaPrimeira);
  });
});
