import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { enqueueJob } from "@/lib/agent-engine/queue/queue";

/**
 * O schema do turno do Operador (spec 16 §3.2, migration 0111).
 *
 * Por que um invariante de banco e não um teste de unidade: o que pode quebrar
 * aqui não é lógica, é CONSTRAINT — e constraint só existe no Postgres. São dois
 * CHECKs, e o segundo é o que morre calado:
 *
 *   1. `job_queue_kind_check` — o kind novo é aceito;
 *   2. `job_queue_turn_needs_contact` — coerência kind ⇔ contato.
 *
 * Esquecer o (2) é o modo de falha realista: o kind passa a existir, o código
 * compila, os testes de unidade passam, e TODO insert de `operator_turn` viola a
 * constraint em produção. O Operador simplesmente nunca roda, e o self-hoster vê
 * um agente que conversa e não registra nada — sem erro na tela.
 *
 * Roda contra o Postgres efêmero do `scripts/test-db.sh`, com o `baseline.sql`
 * aplicado: é o MESMO arquivo que o kit self-host instala, então este teste
 * também prova que a mudança chegou ao apêndice, não só às migrations.
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

const ORG = "0be7a70a-0000-4000-8000-000000000001";
const CONTACT = "0be7a70a-0000-4000-8000-000000000002";

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, 'org-operador-teste', 'Org Operador LTDA', 'Org Operador')
     on conflict (id) do nothing`,
    [ORG],
  );
  await pool.query(
    `insert into contacts (id, organization_id, name, phone_number)
     values ($1, $2, 'Lead do Operador', '+5511900000911')
     on conflict (id) do nothing`,
    [CONTACT, ORG],
  );
});

afterAll(async () => {
  await pool.query("delete from job_queue where organization_id = $1", [ORG]);
  await pool.query("delete from contacts where id = $1", [CONTACT]);
  await pool.query("delete from organizations where id = $1", [ORG]);
  await pool.end();
});

describe("schema do turno do Operador", () => {
  it("aceita kind 'operator_turn' com contato — o caminho que o runtime usa", async () => {
    const { job } = await enqueueJob(pool, ORG, {
      leadId: CONTACT,
      kind: "operator_turn",
      payload: { conversation_id: "0be7a70a-0000-4000-8000-000000000003" },
    });
    expect(job.kind).toBe("operator_turn");
    expect(job.contact_id).toBe(CONTACT);
  });

  it("REJEITA 'operator_turn' sem contato — operar sem saber sobre quem é sem sentido", async () => {
    // Este caso é o que guarda o CHECK de coerência nos DOIS sentidos. Sem ele,
    // alguém "consertaria" o insert removendo o contact_id e o job passaria a
    // nascer órfão.
    await expect(
      pool.query(
        `insert into job_queue (organization_id, contact_id, kind, payload) values ($1, null, 'operator_turn', '{}')`,
        [ORG],
      ),
    ).rejects.toThrow(/job_queue_turn_needs_contact|violates check constraint/i);
  });

  it("dedup por source_event_id: o mesmo turno do Conversador não gera dois Operadores", async () => {
    // O runtime usa o job_id do turno como chave. Um retry da fila re-executa o
    // fim do turno; sem dedup, cada retry enfileiraria mais um Operador e o lead
    // levaria N vezes a mesma ação.
    const fonte = "0be7a70a-0000-4000-8000-00000000000f";
    const a = await enqueueJob(pool, ORG, {
      leadId: CONTACT,
      kind: "operator_turn",
      sourceEventId: fonte,
      payload: {},
    });
    const b = await enqueueJob(pool, ORG, {
      leadId: CONTACT,
      kind: "operator_turn",
      sourceEventId: fonte,
      payload: {},
    });
    expect(b.deduped).toBe(true);
    expect(b.job.id).toBe(a.job.id);
  });

  it("a config do papel existe na versão publicada, e nasce DESLIGADA", async () => {
    // Uma migration não pode ligar sozinha um papel que gasta uma chamada de
    // modelo por turno na chave do self-hoster.
    const { rows } = await pool.query<{ column_name: string; column_default: string | null; is_nullable: string }>(
      `select column_name, column_default, is_nullable
         from information_schema.columns
        where table_name = 'ai_agent_versions'
          and column_name in ('operator_enabled', 'operator_model')
        order by column_name`,
    );
    expect(rows.map((r) => r.column_name)).toEqual(["operator_enabled", "operator_model"]);
    expect(rows[0]!.column_default).toContain("false");
    // `operator_model` NULL = herda o modelo do agente; exigir escolha antes de
    // poder experimentar seria fricção sem ganho.
    expect(rows[1]!.is_nullable).toBe("YES");
  });

  it("os kinds antigos continuam aceitos — a lista CRESCE, nunca substitui", async () => {
    // Um `check (kind in ('operator_turn'))` escrito por engano passaria em todos
    // os casos acima e quebraria o produto inteiro.
    const { job } = await enqueueJob(pool, ORG, {
      leadId: CONTACT,
      kind: "inbound_turn",
      payload: {},
    });
    expect(job.kind).toBe("inbound_turn");
    const semContato = await enqueueJob(pool, ORG, { kind: "watchdog", payload: {} });
    expect(semContato.job.kind).toBe("watchdog");
  });
});
