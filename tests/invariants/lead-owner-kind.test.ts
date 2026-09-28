import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";

import { resolveOwnerPatch } from "@/lib/leads/owner-patch";

/**
 * 0070 — invariante de posse do negócio, contra Postgres real (baseline.sql já
 * aplicado pelo scripts/test-db.sh).
 *
 * Prova as duas metades da regra:
 * 1. O banco RECUSA estado incoerente (constraint, não boa intenção): dono
 *    humano com `owner_kind='ai'`, dono agente sem agente, e — o caso que
 *    derrubava o bulk assign inteiro — gravar `owner_user_id` num lead de dono
 *    AGENTE sem zerar o agente (23514).
 * 2. O patch que sai de `resolveOwnerPatch` (o helper que create/patch/bulk/MCP
 *    usam) passa nesse mesmo banco e produz `owner_kind` coerente — inclusive na
 *    transferência agente → humano, que é onde o 23514 aparecia.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error(
    "TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)",
  );
}
const containerName: string = container;

function sql(script: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", containerName, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tA", "-f", "-"],
    { input: script, encoding: "utf8" },
  ).trim();
}

/** Roda SQL que DEVE falhar; devolve o SQLSTATE (ex.: 23514 = check violation). */
function sqlstateOf(script: string): string {
  try {
    execFileSync(
      "docker",
      ["exec", "-i", containerName, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tA", "-f", "-"],
      { input: script, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
  } catch (err) {
    const stderr = String((err as { stderr?: Buffer }).stderr ?? "");
    // psql imprime "ERROR:  new row ... violates check constraint "<nome>""
    const match = /violates check constraint "([^"]+)"/.exec(stderr);
    return match?.[1] ?? stderr.slice(0, 200);
  }
  return "(nenhum erro — o banco ACEITOU o estado incoerente)";
}

const ORG = "0070aaaa-0000-4000-8000-000000000001";
const USER = "0070aaaa-1111-4000-8000-000000000001";
const AGENT = "0070aaaa-2222-4000-8000-000000000001";
const PIPELINE = "0070aaaa-3333-4000-8000-000000000001";
const STAGE = "0070aaaa-4444-4000-8000-000000000001";
const LEAD_AGENTE = "0070aaaa-5555-4000-8000-000000000001";

beforeAll(() => {
  sql(`
    insert into auth.users (id) values ('${USER}') on conflict do nothing;

    insert into organizations (id, slug, legal_name, display_name)
    values ('${ORG}', 'org-0070', 'Org 0070', 'Org 0070') on conflict (id) do nothing;

    insert into user_organizations (user_id, organization_id, role)
    values ('${USER}', '${ORG}', 'admin') on conflict do nothing;

    -- is_active=false de propósito: agente desligado continua sendo dono válido.
    insert into ai_agents (id, organization_id, name, system_prompt, is_active)
    values ('${AGENT}', '${ORG}', 'Bot 0070', 'prompt', false) on conflict (id) do nothing;

    insert into crm_pipelines (id, organization_id, name, slug)
    values ('${PIPELINE}', '${ORG}', 'Pipeline 0070', 'pipeline-0070') on conflict (id) do nothing;

    insert into crm_stages (id, organization_id, pipeline_id, name, slug, position)
    values ('${STAGE}', '${ORG}', '${PIPELINE}', 'Etapa', 'etapa', 1000) on conflict (id) do nothing;

    -- Lead de dono AGENTE: o fixture que o bulk assign derrubava.
    insert into crm_leads (id, organization_id, pipeline_id, stage_id, title, owner_kind, owner_agent_id)
    values ('${LEAD_AGENTE}', '${ORG}', '${PIPELINE}', '${STAGE}', 'Lead do agente', 'ai', '${AGENT}')
    on conflict (id) do update set owner_kind = 'ai', owner_agent_id = '${AGENT}', owner_user_id = null;
  `);
});

describe("0070 — o banco recusa posse incoerente", () => {
  it("owner_kind='ai' sem agente é rejeitado", () => {
    expect(
      sqlstateOf(`update crm_leads set owner_kind='ai', owner_agent_id=null where id='${LEAD_AGENTE}';`),
    ).toBe("crm_leads_owner_kind_coherence");
  });

  it("owner_kind='user' sem humano é rejeitado", () => {
    expect(
      sqlstateOf(`update crm_leads set owner_kind='user', owner_user_id=null where id='${LEAD_AGENTE}';`),
    ).toBe("crm_leads_owner_kind_coherence");
  });

  it("dois donos ao mesmo tempo é rejeitado", () => {
    expect(
      sqlstateOf(
        `update crm_leads set owner_kind='user', owner_user_id='${USER}' where id='${LEAD_AGENTE}';`,
      ),
    ).toBe("crm_leads_owner_kind_coherence");
  });
});

describe("0070 — o patch do helper compartilhado passa no banco real", () => {
  it("bulk assign sobre lead de dono AGENTE vira dono humano, sem 23514 e com owner_kind='user'", () => {
    const result = resolveOwnerPatch({ owner_user_id: USER });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.patch) throw new Error("helper não devolveu patch");

    // Exatamente o que o bulk route grava — o trio inteiro, não só owner_user_id.
    sql(`
      update crm_leads
         set owner_user_id = ${result.patch.owner_user_id ? `'${result.patch.owner_user_id}'` : "null"},
             owner_agent_id = ${result.patch.owner_agent_id ? `'${result.patch.owner_agent_id}'` : "null"},
             owner_kind = ${result.patch.owner_kind ? `'${result.patch.owner_kind}'` : "null"}
       where id = '${LEAD_AGENTE}';
    `);

    expect(
      sql(`select owner_kind || '|' || coalesce(owner_user_id::text,'-') || '|' || coalesce(owner_agent_id::text,'-')
             from crm_leads where id='${LEAD_AGENTE}';`),
    ).toBe(`user|${USER}|-`);
  });

  it("tirar o dono limpa os três campos", () => {
    const result = resolveOwnerPatch({ owner_user_id: null });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.patch) throw new Error("helper não devolveu patch");

    sql(`
      update crm_leads
         set owner_user_id = null, owner_agent_id = null, owner_kind = null
       where id = '${LEAD_AGENTE}';
    `);

    expect(
      sql(`select coalesce(owner_kind,'-') || '|' || coalesce(owner_user_id::text,'-') || '|' || coalesce(owner_agent_id::text,'-')
             from crm_leads where id='${LEAD_AGENTE}';`),
    ).toBe("-|-|-");
  });

  it("dono agente (inclusive INATIVO) é estado válido — o card precisa dele", () => {
    const result = resolveOwnerPatch({ owner_agent_id: AGENT });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.patch) throw new Error("helper não devolveu patch");

    sql(`
      update crm_leads
         set owner_user_id = null, owner_agent_id = '${AGENT}', owner_kind = 'ai'
       where id = '${LEAD_AGENTE}';
    `);

    expect(
      sql(`select owner_kind, is_active from crm_leads
             join ai_agents on ai_agents.id = crm_leads.owner_agent_id
            where crm_leads.id='${LEAD_AGENTE}';`),
    ).toBe("ai|f");
  });
});
