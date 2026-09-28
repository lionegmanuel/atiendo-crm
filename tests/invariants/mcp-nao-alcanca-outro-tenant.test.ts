import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import {
  getLeadHandler,
  listLeadsHandler,
  moveLeadHandler,
  updateLeadHandler,
} from "@/app/api/v1/leads/_handler";
import type { HandlerCtx } from "@/lib/api/handlers/types";

import { pgComoSupabase } from "../pg-como-supabase";

/**
 * O AGENTE DE UMA ORGANIZAÇÃO NÃO ALCANÇA O NEGÓCIO DE OUTRA.
 *
 * ═══ POR QUE ESTE ARQUIVO EXISTE ═══
 *
 * O servidor MCP injeta `createAdminClient()` — service-role, que **bypassa
 * RLS** (lib/mcp/server.ts:39). O anti-pattern 10 do CLAUDE.md é exatamente
 * isto: "Service role bypassa RLS — handlers que usam admin client DEVEM
 * filtrar `organization_id` manualmente".
 *
 * As mesmas funções são chamadas por DOIS caminhos com garantias opostas:
 *
 *  - pela **rota HTTP**, com client de sessão — a RLS protege sozinha;
 *  - pelas **ferramentas do agente**, com service-role — **nada protege** além
 *    do filtro que o handler escrever à mão.
 *
 * Ler o código não basta para saber quais estão cobertos: contar menções de
 * `organization_id` num handler devolve 5 para uma função que não o usa em
 * filtro nenhum. Por isso aqui se mede COMPORTAMENTO — dois tenants de
 * verdade, e a tentativa de alcançar o lead do vizinho.
 *
 * `pgComoSupabase` conecta como `postgres`, então NÃO há RLS neste teste. É
 * deliberado: é assim que o service-role vê o banco, e é o cenário que precisa
 * ser barrado pelo próprio handler.
 */
const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 3,
});
const db = pgComoSupabase(pool);

/** A organização do agente que está agindo. */
const ORG_A = "c205e700-0000-4000-8000-00000000000a";
/** A vítima: outra organização, com um negócio dela. */
const ORG_B = "c205e700-0000-4000-8000-00000000000b";

let leadDaVitima = "";
let stageDaVitima = "";

function ctxDoAgenteDeA(): HandlerCtx {
  return {
    organization_id: ORG_A,
    // O ator é o agente, como o MCP monta.
    actor: { type: "ai_agent", id: "run-de-a", role: "agent" },
    requestId: "req-cross-tenant",
  };
}

async function semearOrg(id: string, slug: string): Promise<{ pipeline: string; stage: string }> {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, $2, 'Cross LTDA', 'Cross') on conflict (id) do nothing`,
    [id, slug],
  );
  const { rows: p } = await pool.query<{ id: string }>(
    `insert into crm_pipelines (organization_id, name, slug, position)
     values ($1, 'Funil ' || $2, 'funil-' || $2, 100) returning id`,
    [id, slug],
  );
  const { rows: s } = await pool.query<{ id: string }>(
    `insert into crm_stages (organization_id, pipeline_id, name, slug, position)
     values ($1, $2, 'Etapa', 'etapa-' || $3, 1) returning id`,
    [id, p[0]!.id, slug],
  );
  return { pipeline: p[0]!.id, stage: s[0]!.id };
}

beforeAll(async () => {
  const a = await semearOrg(ORG_A, "cross-a");
  const b = await semearOrg(ORG_B, "cross-b");
  stageDaVitima = b.stage;

  const { rows } = await pool.query<{ id: string }>(
    `insert into crm_leads (organization_id, pipeline_id, stage_id, title)
     values ($1, $2, $3, 'Negócio SECRETO da vítima') returning id`,
    [ORG_B, b.pipeline, b.stage],
  );
  leadDaVitima = rows[0]!.id;

  // A org do agente também tem um negócio — senão a listagem devolveria vazio
  // por não haver nada, e "não vazou" passaria sem medir nada.
  await pool.query(
    `insert into crm_leads (organization_id, pipeline_id, stage_id, title)
     values ($1, $2, $3, 'Negócio legítimo de A')`,
    [ORG_A, a.pipeline, a.stage],
  );
});

afterAll(async () => {
  await pool.query("delete from organizations where id = any($1)", [[ORG_A, ORG_B]]);
  await pool.end();
});

describe("o negócio da outra organização", () => {
  it("o cenário está montado — sem isto, os casos abaixo medem o vazio", async () => {
    // Controle positivo: o lead da vítima precisa existir e ser de ORG_B. Um
    // erro de setup faria todo "não alcançou" passar por ausência de alvo.
    const { rows } = await pool.query<{ organization_id: string; title: string }>(
      "select organization_id, title from crm_leads where id = $1",
      [leadDaVitima],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.organization_id).toBe(ORG_B);
  });

  it("NÃO é legível por `crm_get_lead`", async () => {
    const lead = await getLeadHandler(db, ctxDoAgenteDeA(), leadDaVitima).catch(() => null);
    // Ou lança, ou devolve null/vazio — o que não pode é devolver o negócio.
    if (lead) {
      expect(
        (lead as { organization_id?: string }).organization_id,
        "o agente de A recebeu o negócio de B",
      ).not.toBe(ORG_B);
    }
  });

  it("a listagem RODA — sem isto, o caso abaixo passa com uma lista vazia por ERRO", async () => {
    // ⚠️ Controle positivo, e ele já pegou um falso verde MEU: a primeira versão
    // deste arquivo envolvia a chamada em `.catch(() => null)` e lia
    // `?.data ?? []`. Qualquer exceção — inclusive um método que o adaptador não
    // tem — virava lista vazia, e "não contém o lead da vítima" passava sem que
    // a listagem tivesse rodado. Aqui ela roda SEM rede: se estourar, o teste
    // morre dizendo isso, em vez de mentir verde.
    const r = await listLeadsHandler(db, ctxDoAgenteDeA(), {} as never);
    // ⚠️ O campo é `leads`, não `data` — e ler o nome errado era a SEGUNDA
    // metade do falso verde: `?.data ?? []` devolvia lista vazia mesmo quando a
    // listagem trazia o negócio da vítima. Duas camadas de mentira num caso só.
    expect(Array.isArray(r.leads), "a listagem precisa devolver uma lista").toBe(true);

    // E precisa haver O QUE listar na org do agente: uma lista vazia porque a
    // org de A não tem nada também passaria sem medir.
    const daPropriaOrg = r.leads.filter(
      (x) => (x as { organization_id?: string }).organization_id === ORG_A,
    );
    expect(daPropriaOrg.length, "a org do agente precisa ter lead para a listagem significar algo").toBeGreaterThan(0);
  });

  it("NÃO aparece em `crm_list_leads`", async () => {
    const r = await listLeadsHandler(db, ctxDoAgenteDeA(), {} as never);
    expect(
      r.leads.map((x) => (x as { id: string }).id),
      "a lista do agente de A trouxe o negócio de B",
    ).not.toContain(leadDaVitima);
  });

  it("NÃO é editável por `crm_update_lead` — e o título prova", async () => {
    // A prova é o ESTADO depois, não o retorno: um handler pode lançar DEPOIS
    // de escrever, e aí o "erro" esconderia a escrita que já aconteceu.
    await updateLeadHandler(db, ctxDoAgenteDeA(), leadDaVitima, {
      title: "INVADIDO pelo agente de outra organização",
    } as never).catch(() => null);

    const { rows } = await pool.query<{ title: string }>(
      "select title from crm_leads where id = $1",
      [leadDaVitima],
    );
    expect(rows[0]!.title, "o agente de A reescreveu o negócio de B").toBe(
      "Negócio SECRETO da vítima",
    );
  });

  it("NÃO é movível por `crm_move_lead_stage`", async () => {
    const { rows: antes } = await pool.query<{ stage_id: string }>(
      "select stage_id from crm_leads where id = $1",
      [leadDaVitima],
    );
    await moveLeadHandler(db, ctxDoAgenteDeA(), leadDaVitima, {
      to_stage_id: stageDaVitima,
    } as never).catch(() => null);
    const { rows: depois } = await pool.query<{ stage_id: string }>(
      "select stage_id from crm_leads where id = $1",
      [leadDaVitima],
    );
    expect(depois[0]!.stage_id).toBe(antes[0]!.stage_id);
  });
});
