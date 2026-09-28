import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { loadPublishedAgentConfig } from "@/lib/agent-engine/agent/agent-config";

/**
 * Wave 3a (spec 15 §4) — `casesEnabled` no config publicado. Cobertura mínima do
 * seam de config (real Postgres via TEST_DB_CONTAINER, mesmo mecanismo de
 * human-cases.test.ts): `cases_enabled=true` publicado → `casesEnabled===true`;
 * ausente/false → default false. O gating das tools open_human_case/
 * provide_case_update DENTRO do turno (runAgentTurn) não tem seam de teste
 * isolável sem harness pesado (não existe inbound-turn.test.ts no repo — nem
 * para handoff/multimodal, gating equivalentes já existentes) — a asserção de
 * presença-no-turno fica para o E2E da Wave 6.
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

const ORG = "dddddddd-0000-4000-8000-000000000001";

const SESSION_ON = "dddddddd-0000-4000-8000-000000000002";
const AGENT_ON = "dddddddd-0000-4000-8000-000000000003";
const VERSION_ON = "dddddddd-0000-4000-8000-000000000004";

const SESSION_OFF = "dddddddd-0000-4000-8000-000000000012";
const AGENT_OFF = "dddddddd-0000-4000-8000-000000000013";
const VERSION_OFF = "dddddddd-0000-4000-8000-000000000014";

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, 'ac-cases-proof', 'Org de Prova', 'Org de Prova') on conflict (id) do nothing`,
    [ORG],
  );

  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
     values ($1, $2, 'ac-cases-session-on', 'WORKING', '\\x00'::bytea) on conflict (id) do nothing`,
    [SESSION_ON, ORG],
  );
  await pool.query(
    `insert into ai_agents (id, organization_id, name, system_prompt)
     values ($1, $2, 'Agente com casos', 'system') on conflict (id) do nothing`,
    [AGENT_ON, ORG],
  );
  await pool.query(
    `insert into ai_agent_versions
       (id, organization_id, agent_id, version_number, system_prompt, provider, model, channel_session_id, status, cases_enabled)
     values ($1, $2, $3, 1, 'system', 'anthropic', 'claude-sonnet-4-6', $4, 'published', true)
     on conflict (id) do nothing`,
    [VERSION_ON, ORG, AGENT_ON, SESSION_ON],
  );
  await pool.query(`update ai_agents set published_version_id = $1 where id = $2`, [VERSION_ON, AGENT_ON]);

  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
     values ($1, $2, 'ac-cases-session-off', 'WORKING', '\\x00'::bytea) on conflict (id) do nothing`,
    [SESSION_OFF, ORG],
  );
  await pool.query(
    `insert into ai_agents (id, organization_id, name, system_prompt)
     values ($1, $2, 'Agente sem casos', 'system') on conflict (id) do nothing`,
    [AGENT_OFF, ORG],
  );
  // cases_enabled OMITIDO de propósito — cobre o default da coluna (false).
  await pool.query(
    `insert into ai_agent_versions
       (id, organization_id, agent_id, version_number, system_prompt, provider, model, channel_session_id, status)
     values ($1, $2, $3, 1, 'system', 'anthropic', 'claude-sonnet-4-6', $4, 'published')
     on conflict (id) do nothing`,
    [VERSION_OFF, ORG, AGENT_OFF, SESSION_OFF],
  );
  await pool.query(`update ai_agents set published_version_id = $1 where id = $2`, [VERSION_OFF, AGENT_OFF]);
});

afterAll(async () => {
  await pool.end();
});

describe("wave 3a — casesEnabled no config publicado", () => {
  it("casesEnabled=true quando ai_agent_versions.cases_enabled=true", async () => {
    const config = await loadPublishedAgentConfig(pool, ORG, SESSION_ON);
    expect(config).not.toBeNull();
    expect(config?.casesEnabled).toBe(true);
  });

  it("casesEnabled=false (default da coluna) quando não setado na publicação", async () => {
    const config = await loadPublishedAgentConfig(pool, ORG, SESSION_OFF);
    expect(config).not.toBeNull();
    expect(config?.casesEnabled).toBe(false);
  });
});
