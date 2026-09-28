import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./psql-transporte";

/**
 * O CAP GLOBAL DO CLAIM NÃO PODE VARRER A FILA (issue #260).
 *
 * `claimJobs` (lib/agent-engine/queue/queue.ts) abre TODA rodada perguntando
 * quantos jobs estão `running` — é o cap global de concorrência, e ele roda
 * dentro do advisory lock que serializa os claimers. Até a migration 0166
 * nenhum dos quatro índices de `job_queue` servia esse predicado (o parcial das
 * lanes é mais ESTREITO — exclui `contact_id is null` —, então o planejador não
 * pode responder por ele), e a pergunta saía como Seq Scan.
 *
 * Medido em pg17 com este baseline, 50.000 linhas `done` + 4 `running`:
 *
 *     sem idx_job_queue_running   Seq Scan,        715 buffers
 *     com idx_job_queue_running   Index Only Scan,   3 buffers
 *
 * E o custo NÃO depende de linha viva: apagando as 50.004 dentro de uma
 * transação, o Seq Scan ainda lê os mesmos 715 buffers — ele visita PÁGINA, não
 * tupla. Uma fila com histórico já drenado paga o mesmo pedágio que uma fila
 * cheia, a cada rodada, para sempre. Nada no produto poda `job_queue`.
 *
 * ## Por que este arquivo guarda COMPORTAMENTO e não símbolo
 *
 * Um teste que só procurasse `idx_job_queue_running` no texto do
 * `baseline.sql` ficaria verde com o índice presente e inútil — bastaria alguém
 * mudar o predicado do `claimJobs` (`status = 'running'` → `status in
 * ('running','pending')`, um `::text` a mais, um `lower(status)`) para o plano
 * voltar a ser Seq Scan com o símbolo intacto. Por isso o `select` medido aqui é
 * EXTRAÍDO DO FONTE de produção, não copiado: se o call site mudar, é a query
 * NOVA que passa pelo EXPLAIN.
 */
const FONTE = join(process.cwd(), "lib", "agent-engine", "queue", "queue.ts");

const ORG = "0be7a70a-2580-4000-8000-000000000260";
const LINHAS_MORTAS = 50_000;

/**
 * O `select` do cap global, lido do fonte de `claimJobs`.
 *
 * Comentários caem antes da varredura: o cabeçalho do módulo cita `job_queue` e
 * outros identificadores entre crases, e casar dentro de prosa faria o
 * instrumento medir a documentação em vez do código.
 */
function selectDoCapGlobal(): string[] {
  const src = readFileSync(FONTE, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  return [...src.matchAll(/`([^`]*from\s+job_queue[^`]*)`/g)]
    .map((m) => m[1] ?? "")
    .filter((q) => /count\s*\(/.test(q));
}

/** Soma `hit=`/`read=` da PRIMEIRA linha `Buffers:` — a do nó de topo. */
function buffersDoTopo(plano: string): number {
  const linha = plano.split("\n").find((l) => l.includes("Buffers:")) ?? "";
  return [...linha.matchAll(/(?:hit|read)=(\d+)/g)].reduce((s, m) => s + Number(m[1]), 0);
}

beforeAll(() => {
  sql(`
    insert into organizations (id, slug, legal_name, display_name)
    values ('${ORG}', 'org-cap-do-claim', 'Org Cap do Claim LTDA', 'Org Cap do Claim')
    on conflict (id) do nothing;

    -- O histórico que uma fila real acumula: turnos concluídos que ninguém poda.
    insert into job_queue (organization_id, contact_id, kind, payload, status, run_after)
    select '${ORG}', null, 'watchdog', '{}'::jsonb, 'done', now()
      from generate_series(1, ${LINHAS_MORTAS});

    -- E os poucos jobs em voo, que é tudo o que a pergunta do cap quer contar.
    insert into job_queue (organization_id, contact_id, kind, payload, status, run_after)
    select '${ORG}', null, 'watchdog', '{}'::jsonb, 'running', now()
      from generate_series(1, 4);

    analyze job_queue;
  `);
});

describe("cap global do claim × volume da fila", () => {
  it("o instrumento acha o select que o claimJobs realmente roda", () => {
    // Guarda de vacuidade E de call site: zero achados fariam o caso seguinte
    // medir uma string inventada por este arquivo; dois achados significariam
    // que a extração deixou de ser específica.
    const achados = selectDoCapGlobal();
    expect(achados, `nenhum select de contagem sobre job_queue em ${FONTE}`).toHaveLength(1);
    expect(achados[0]).toMatch(/status\s*=\s*'running'/);
  });

  it("com 50 mil linhas na fila, o cap global usa o índice — nunca Seq Scan", () => {
    const consulta = selectDoCapGlobal()[0] ?? "";
    const plano = sql(`explain (analyze, buffers) ${consulta}`);

    expect(plano, "o cap do claim voltou a varrer job_queue inteira a cada rodada").not.toMatch(
      /Seq Scan on job_queue/,
    );
    expect(plano).toMatch(/Index (Only )?Scan using idx_job_queue_running/);
    // 715 buffers é o Seq Scan medido; 3 é o Index Only Scan. O teto é folgado de
    // propósito — o que se guarda é a ORDEM DE GRANDEZA, não o número exato, que
    // depende do fillfactor e do estado do visibility map.
    expect(buffersDoTopo(plano), `buffers do nó de topo:\n${plano}`).toBeLessThan(50);
  });

  it("o índice chegou pelo baseline, com a definição e o delator esperados", () => {
    // O banco desta suíte é construído SÓ do supabase/baseline.sql — que é o que
    // o self-hoster aplica. Migration que ficasse só em migrations/ não chega a
    // ninguém, e aqui isso aparece como índice ausente.
    const [def = "", comentario = ""] = sql(`
      select coalesce(pg_get_indexdef(c.oid), ''),
             coalesce(obj_description(c.oid, 'pg_class'), '')
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'idx_job_queue_running';
    `).split("|");

    expect(def, "idx_job_queue_running não existe no banco vindo do baseline").toContain(
      "ON public.job_queue USING btree (status)",
    );
    expect(def).toContain("WHERE (status = 'running'");
    // O COMMENT é o delator do apêndice: sem índice, ele levanta "relation does
    // not exist", texto que NÃO casa com o filtro benigno do update.sh e chega ao
    // operador — enquanto "already exists" seria engolido. Apagá-lo por parecer
    // enfeite devolve o modo de falha silencioso.
    expect(comentario, "o COMMENT delator do índice sumiu").toContain("Cap global do claim");
  });
});
