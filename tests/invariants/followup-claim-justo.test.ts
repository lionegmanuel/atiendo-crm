import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";

import { createPgAdminClient } from "@/lib/followup/turn-bridge";

import { isolarFixtureDeFollowup } from "./followup-isolamento";

/**
 * Migration 0146 — o tick do follow-up não pode servir uma organização de cada vez.
 *
 * O claim é o único ponto do follow-up onde as organizações competem por um
 * recurso compartilhado (o lote de 20 por tick). Antes da 0146 ele levava os 20
 * vencidos MAIS ANTIGOS globalmente, e quem acumulou fila tem por construção os
 * mais antigos — então uma organização atrasada ocupava o lote inteiro.
 *
 * A propriedade vale contra o Postgres de verdade e por nenhum outro caminho: é
 * uma função SQL com window function, `for update skip locked` e um `limit` que
 * só se comporta assim num planner real. Aqui quem chama é o adapter de PRODUÇÃO
 * (`createPgAdminClient`, o mesmo que o worker 24/7 usa), não um SQL reescrito
 * para o teste.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 4,
});

afterAll(async () => {
  // Quem suja, limpa. O último caso deste arquivo cria 90 enrollments e reclama
  // 21 — deixaria ~69 DEVIDOS para o próximo arquivo, e o claim é global. O
  // `beforeEach` das irmãs protegeria, mas depender disso é justamente o que
  // produziu o vermelho intermitente que este épico foi consertar.
  await isolarFixtureDeFollowup(pool);
  await pool.end();
});

const db = createPgAdminClient(pool);

const ORG_GRANDE = "f0000001-0000-4000-8000-00000000fa01";
const ORG_PEQUENA = "f0000002-0000-4000-8000-00000000fa02";

const GRAFO_MINIMO = JSON.stringify({
  nodes: [
    { id: "t1", type: "trigger", label: "i", position: { x: 0, y: 0 }, config: {} },
    { id: "e1", type: "end", label: "f", position: { x: 0, y: 0 }, config: { outcome: "converted" } },
  ],
  edges: [{ id: "a", source: "t1", target: "e1", priority: 0, condition: { type: "always" } }],
});

async function semearOrg(org: string, nome: string): Promise<{ pointerId: string; versionId: string }> {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name) values ($1, $2, $3, $3)
     on conflict (id) do nothing`,
    [org, `claim-justo-${nome}`, nome],
  );
  const { rows: v } = await pool.query<{ id: string }>(
    `insert into followup_flow_versions (organization_id, graph) values ($1, $2) returning id`,
    [org, GRAFO_MINIMO],
  );
  const { rows: p } = await pool.query<{ id: string }>(
    `insert into followup_flow_pointers (organization_id, name, status, active_version_id)
     values ($1, $2, 'active', $3) returning id`,
    [org, `Fluxo ${nome} ${Date.now()}-${Math.random()}`, v[0]!.id],
  );
  return { pointerId: p[0]!.id, versionId: v[0]!.id };
}

/** `quantos` enrollments vencidos há `vencidoHaMinutos`, `vencidoHaMinutos+1`, ... minutos. */
async function semearVencidos(
  org: string,
  ids: { pointerId: string; versionId: string },
  quantos: number,
  vencidoHaMinutos: number,
): Promise<void> {
  await pool.query(
    `with novos as (
       insert into contacts (organization_id, display_name)
       select $1, 'Lead ' || g from generate_series(1, $2::int) g
       returning id
     )
     insert into followup_enrollments
       (organization_id, pointer_id, version_id, contact_id, current_node_id, status, next_eval_at)
     select $1, $3, $4, novos.id, 't1', 'active',
            now() - (($5::int + row_number() over (order by novos.id)) || ' minutes')::interval
       from novos`,
    [org, quantos, ids.pointerId, ids.versionId, vencidoHaMinutos],
  );
}

// O claim é GLOBAL por desenho, e aqui as contagens por organização são a
// própria propriedade sob teste — enrollment alheio a falsearia. Ver
// ./followup-isolamento.ts.
beforeEach(async () => {
  await isolarFixtureDeFollowup(pool);
});

describe("fn_claim_due_followup_enrollments — rodízio entre organizações", () => {
  it("organização com UM vencido é atendida no MESMO tick em que outra tem a fila cheia", async () => {
    const grande = await semearOrg(ORG_GRANDE, "grande");
    const pequena = await semearOrg(ORG_PEQUENA, "pequena");

    // A grande está atrasada: 25 vencidos, de 10 a 34 minutos atrás — todos MAIS
    // ANTIGOS que o único da pequena, que venceu agora. É o cenário real: quem
    // acumula fila tem sempre os next_eval_at mais antigos.
    await semearVencidos(ORG_GRANDE, grande, 25, 10);
    await semearVencidos(ORG_PEQUENA, pequena, 1, 0);

    const reclamados = await db.claimDueEnrollments(20, 120);

    expect(reclamados).toHaveLength(20); // o teto continua sendo teto
    const daPequena = reclamados.filter((e) => e.organization_id === ORG_PEQUENA);
    // ESTE é o caso que reprova a versão anterior: lá, os 20 mais antigos eram
    // todos da grande e a pequena só entrava vários ticks depois.
    expect(daPequena).toHaveLength(1);
  });

  // A ORDEM das linhas devolvidas nunca foi prometida (é o `returning` de um
  // UPDATE), então o que se congela aqui é o CONJUNTO: os 20 mais antigos, e
  // nenhum dos 5 mais novos. É o comportamento que a instalação de operador
  // único — a de hoje — tinha antes da 0146 e continua tendo.
  it("com UMA organização, o lote é o mesmo de antes: exatamente os 20 mais antigos", async () => {
    const grande = await semearOrg(ORG_GRANDE, "grande");
    await semearVencidos(ORG_GRANDE, grande, 25, 10);

    const reclamados = await db.claimDueEnrollments(20, 120);
    expect(reclamados).toHaveLength(20);

    const { rows } = await pool.query<{ next_eval_at: Date }>(
      `select next_eval_at from followup_enrollments
        where claimed_until is null and organization_id = $1`,
      [ORG_GRANDE],
    );
    expect(rows).toHaveLength(5); // sobraram os 5 mais novos

    const maisNovoReclamado = Math.max(...reclamados.map((e) => new Date(e.next_eval_at!).getTime()));
    const maisAntigoDeFora = Math.min(...rows.map((r) => new Date(r.next_eval_at).getTime()));
    expect(maisNovoReclamado).toBeLessThan(maisAntigoDeFora);
  });

  it("o lease continua valendo: o tick seguinte não repega o que já foi reclamado", async () => {
    const grande = await semearOrg(ORG_GRANDE, "grande");
    await semearVencidos(ORG_GRANDE, grande, 25, 10);

    const primeiro = await db.claimDueEnrollments(20, 120);
    const segundo = await db.claimDueEnrollments(20, 120);

    expect(segundo).toHaveLength(5);
    const idsDoPrimeiro = new Set(primeiro.map((e) => e.id));
    expect(segundo.some((e) => idsDoPrimeiro.has(e.id))).toBe(false);
  });

  it("três organizações dividem o lote em vez de a primeira levar tudo", async () => {
    const grande = await semearOrg(ORG_GRANDE, "grande");
    const pequena = await semearOrg(ORG_PEQUENA, "pequena");
    const terceira = await semearOrg("f0000003-0000-4000-8000-00000000fa03", "terceira");

    await semearVencidos(ORG_GRANDE, grande, 30, 60);
    await semearVencidos(ORG_PEQUENA, pequena, 30, 30);
    await semearVencidos("f0000003-0000-4000-8000-00000000fa03", terceira, 30, 1);

    const reclamados = await db.claimDueEnrollments(21, 120);

    // O teto vem primeiro: um lote maior que o pedido faria o tick estourar o
    // tempo do cron (25s no curl do compose), e a divisão abaixo perderia o
    // sentido se o total flutuasse.
    expect(reclamados).toHaveLength(21);
    const porOrg = new Map<string, number>();
    for (const e of reclamados) porOrg.set(e.organization_id, (porOrg.get(e.organization_id) ?? 0) + 1);
    expect([...porOrg.values()].sort()).toEqual([7, 7, 7]);
  });
});
