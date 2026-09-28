import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { claimJobs, faltaParaOProximoJob } from "@/lib/agent-engine/queue/queue";

/**
 * O relógio da fila (issue #258) contra Postgres de verdade.
 *
 * Por que invariante e não unidade: o que pode quebrar aqui é SQL — e as três
 * armadilhas deste `select` só existem no Postgres. A pior delas é silenciosa:
 * `greatest(NULL, 0)` devolve **0**, não NULL, então sem o `case when` a fila
 * VAZIA se disfarçaria de "job vencido", o laço voltaria a claimar 4×/s para
 * sempre, e o defeito da issue estaria de volta com todos os testes verdes.
 *
 * O caso do plano é o que impede o apodrecimento oposto: um predicado que
 * deixasse de casar com `idx_job_queue_claim` continuaria CORRETO e viraria seq
 * scan sobre uma tabela que nada no produto poda — o custo migraria da rede para
 * a CPU do banco sem ninguém notar.
 *
 * Roda contra o Postgres efêmero do `scripts/test-db.sh`, com o `baseline.sql`
 * aplicado — o mesmo arquivo que o kit self-host instala.
 */
const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 2,
});

const ORG = "0be7a70a-2580-4000-8000-000000000001";
const CONTATO = "0be7a70a-2580-4000-8000-000000000002";

/**
 * `runAfter` é EXPRESSÃO SQL, interpolada no texto — não parâmetro. Passá-la em
 * `$n` faz o Postgres tentar converter a string "now() + interval '8 seconds'"
 * para timestamptz e estourar. Seguro aqui porque os valores são literais deste
 * arquivo, nunca entrada externa; org e contato seguem parametrizados.
 */
async function enfileirar(opts: {
  status?: string;
  runAfter?: string;
  contato?: string | null;
}): Promise<void> {
  const contato = opts.contato === undefined ? CONTATO : opts.contato;
  // `job_queue_turn_needs_contact` amarra kind ⇔ contato: os turnos exigem lead,
  // e `watchdog` é o kind sem contato. O relógio não olha kind nenhum — ele só
  // pergunta por `status='pending'` —, então usar os dois aqui é o que permite
  // montar os casos de lane livre e lane ocupada sem brigar com a constraint.
  const kind = contato === null ? "watchdog" : "inbound_turn";
  await pool.query(
    `insert into job_queue (organization_id, contact_id, kind, payload, status, run_after)
     values ($1, $2, $3, '{}'::jsonb, $4, ${opts.runAfter ?? "now()"})`,
    [ORG, contato, kind, opts.status ?? "pending"],
  );
}

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, 'org-relogio-fila', 'Org Relogio LTDA', 'Org Relogio')
     on conflict (id) do nothing`,
    [ORG],
  );
  await pool.query(
    `insert into contacts (id, organization_id, name, phone_number)
     values ($1, $2, 'Lead do Relogio', '+5511900000258')
     on conflict (id) do nothing`,
    [CONTATO, ORG],
  );
});

afterEach(async () => {
  await pool.query("delete from job_queue where organization_id = $1", [ORG]);
});

afterAll(async () => {
  await pool.query("delete from job_queue where organization_id = $1", [ORG]);
  await pool.query("delete from contacts where id = $1", [CONTATO]);
  await pool.query("delete from organizations where id = $1", [ORG]);
  await pool.end();
});

describe("faltaParaOProximoJob", () => {
  it("fila vazia devolve null — e não zero", async () => {
    // O `case when`. Sem ele, `greatest(NULL, 0)` = 0 e o laço leria a fila vazia
    // como "job vencido": de volta ao claim a cada 250 ms, que é a issue #258.
    await expect(faltaParaOProximoJob(pool)).resolves.toBeNull();
  });

  it("job agendado à frente devolve os milissegundos que faltam, como number", async () => {
    // O `::int`. Sem ele o pg devolve `numeric` como string, e o Math.min do
    // intervaloDeEspera compararia string com number.
    await enfileirar({ runAfter: "now() + interval '8 seconds'" });
    const falta = await faltaParaOProximoJob(pool);
    expect(typeof falta).toBe("number");
    expect(falta).toBeGreaterThan(7_000);
    expect(falta).toBeLessThanOrEqual(8_000);
  });

  it("job já vencido devolve zero — o ramo que autoriza o claim", async () => {
    await enfileirar({ runAfter: "now() - interval '5 seconds'" });
    await expect(faltaParaOProximoJob(pool)).resolves.toBe(0);
  });

  it("job que não está pending é invisível ao relógio", async () => {
    // O predicado precisa casar com o do claim: running/done/dead não são
    // trabalho a fazer, e contá-los manteria o worker acordado à toa.
    for (const status of ["running", "done", "dead", "failed"]) {
      await pool.query("delete from job_queue where organization_id = $1", [ORG]);
      await enfileirar({ status, contato: null });
      await expect(faltaParaOProximoJob(pool)).resolves.toBeNull();
    }
  });

  it("run_after = 'infinity' não estoura o int4 — devolve o clamp de 24h", async () => {
    // `session-watchdog` grava hold com run_after distante. Sem o
    // `least(..., 86400000)`, o cast para int4 lança e o relógio derruba a
    // rodada — que o laço trata como falha aberta, mas a cada volta.
    await enfileirar({ runAfter: "'infinity'::timestamptz" });
    await expect(faltaParaOProximoJob(pool)).resolves.toBe(86_400_000);
  });

  it("job a 400 dias também é clampado", async () => {
    await enfileirar({ runAfter: "now() + interval '400 days'" });
    await expect(faltaParaOProximoJob(pool)).resolves.toBe(86_400_000);
  });

  it("o job mais próximo é quem manda", async () => {
    await enfileirar({ runAfter: "now() + interval '1 hour'", contato: null });
    await enfileirar({ runAfter: "now() + interval '3 seconds'", contato: null });
    const falta = await faltaParaOProximoJob(pool);
    expect(falta).toBeGreaterThan(2_000);
    expect(falta).toBeLessThanOrEqual(3_000);
  });

  it("usa o índice parcial que já existe — não faz seq scan", async () => {
    // A leitura roda em toda rodada ociosa, para sempre. Se o predicado sair de
    // baixo de idx_job_queue_claim, o custo migra da rede para a CPU do banco
    // numa tabela que nada no produto poda, e ninguém percebe.
    await pool.query(
      `insert into job_queue (organization_id, contact_id, kind, payload, status, run_after)
       select $1, null, 'watchdog', '{}'::jsonb, 'done', now()
         from generate_series(1, 5000)`,
      [ORG],
    );
    await pool.query("analyze job_queue");
    const { rows } = await pool.query<{ "QUERY PLAN": string }>(
      `explain (analyze, buffers)
       select case
                when min(run_after) is null then null
                else least(
                       greatest(extract(epoch from (min(run_after) - now())) * 1000, 0),
                       86400000
                     )::int
              end as falta_ms
         from job_queue
        where status = 'pending'`,
    );
    const plano = rows.map((r) => r["QUERY PLAN"]).join("\n");
    expect(plano).toContain("idx_job_queue_claim");
    expect(plano).not.toContain("Seq Scan");
  });

  it("o relógio nunca esconde um job do claim — os estados de fronteira", async () => {
    // A propriedade que o desenho promete, e ela é mais fraca do que "falso
    // negativo é impossível": o relógio é uma FOTO. O que ele garante é que, se o
    // claim pegaria algo AGORA, a foto tirada agora acusa trabalho (falta ≤ 0).
    // Falso positivo é permitido e esperado — lane ocupada e cap cheio aparecem
    // como "há trabalho" e o claim volta vazio, que é o estado do ritmo curto.
    const casos: { nome: string; preparar: () => Promise<void>; cap: number }[] = [
      {
        nome: "pending vencido, lane livre",
        preparar: async () => void (await enfileirar({ runAfter: "now() - interval '1 second'" })),
        cap: 8,
      },
      {
        nome: "lane ocupada pelo mesmo contato",
        preparar: async () => {
          await enfileirar({ status: "running" });
          await enfileirar({ runAfter: "now() - interval '1 second'" });
        },
        cap: 8,
      },
      {
        nome: "cap cheio",
        preparar: async () => {
          await enfileirar({ status: "running", contato: null });
          await enfileirar({ runAfter: "now() - interval '1 second'", contato: null });
        },
        cap: 1,
      },
    ];

    for (const caso of casos) {
      await pool.query("delete from job_queue where organization_id = $1", [ORG]);
      await caso.preparar();
      const falta = await faltaParaOProximoJob(pool);
      const pegos = await claimJobs(pool, { workerId: `relogio-${caso.nome}`, maxConcurrency: caso.cap });
      // Se o claim pegou, o relógio TEM de ter acusado trabalho vencido.
      if (pegos.length > 0) {
        expect(falta, caso.nome).not.toBeNull();
        expect(falta, caso.nome).toBeLessThanOrEqual(0);
      }
      // E em nenhum dos três o relógio pode dizer "fila vazia": há pending.
      expect(falta, caso.nome).not.toBeNull();
    }
  });
});
