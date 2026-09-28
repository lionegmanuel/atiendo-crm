/**
 * `fn_agent_tool_usage` (migration 0103) contra Postgres real.
 *
 * A função É o painel: se ela contar errado, a tela recomenda desligar uma
 * capacidade que funciona, ou deixa ligada uma que falha em toda tentativa. E é
 * SQL — nenhum teste de TypeScript a exercita, o typecheck não a enxerga, e um
 * erro de join passa direto pelo `pnpm test:unit`.
 *
 * O que se prova aqui, além da soma:
 *   - a chamada de OUTRO agente da mesma organização não entra;
 *   - a chamada de OUTRA organização não entra (o painel é por tenant);
 *   - a janela `p_since` corta pelo início do run;
 *   - audit de outra `action` não é contado como uso de capacidade.
 *
 * O shape do `metadata` inserido aqui é o que `auditMcpToolCall` escreve — o
 * contrato entre as duas pontas está preso em `lib/mcp/audit.test.ts`
 * ("escreve os campos de que o painel de uso depende para ler").
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 2,
});

const ORG_A = "a5500000-0000-4000-8000-000000000001";
const ORG_B = "a5500000-0000-4000-8000-000000000002";
const SESSION_A = "a5500000-0000-4000-8000-000000000010";
const SESSION_B = "a5500000-0000-4000-8000-000000000011";
const AGENTE = "a5500000-0000-4000-8000-000000000020";
const AGENTE_VIZINHO = "a5500000-0000-4000-8000-000000000021";
const AGENTE_ORG_B = "a5500000-0000-4000-8000-000000000022";
const VERSAO = "a5500000-0000-4000-8000-000000000030";

/** Um run e as chamadas de tool que ele auditou. */
interface RunFalso {
  id: string;
  agentId: string;
  orgId: string;
  diasAtras: number;
  dryRun?: boolean;
  chamadas: Array<{ tool: string; ok: boolean }>;
}

const RUNS: RunFalso[] = [
  {
    id: "a5500000-0000-4000-8000-000000000100",
    agentId: AGENTE, orgId: ORG_A, diasAtras: 1,
    chamadas: [
      { tool: "crm_get_lead", ok: true },
      { tool: "crm_get_lead", ok: true },
      { tool: "crm_move_lead_stage", ok: false },
    ],
  },
  {
    id: "a5500000-0000-4000-8000-000000000101",
    agentId: AGENTE, orgId: ORG_A, diasAtras: 2, dryRun: true,
    chamadas: [
      { tool: "crm_get_lead", ok: true },
      { tool: "crm_move_lead_stage", ok: false },
    ],
  },
  {
    // Fora da janela de 7 dias usada nos casos.
    id: "a5500000-0000-4000-8000-000000000102",
    agentId: AGENTE, orgId: ORG_A, diasAtras: 40,
    chamadas: [{ tool: "crm_get_lead", ok: true }],
  },
  {
    // Mesmo tenant, OUTRO agente — não pode entrar na conta.
    id: "a5500000-0000-4000-8000-000000000103",
    agentId: AGENTE_VIZINHO, orgId: ORG_A, diasAtras: 1,
    chamadas: [{ tool: "crm_get_lead", ok: true }, { tool: "crm_get_lead", ok: true }],
  },
  {
    // Outro tenant — não pode entrar na conta.
    id: "a5500000-0000-4000-8000-000000000104",
    agentId: AGENTE_ORG_B, orgId: ORG_B, diasAtras: 1,
    chamadas: [{ tool: "crm_get_lead", ok: true }],
  },
];

async function seedOrg(orgId: string, slug: string, sessionId: string): Promise<void> {
  // Um parâmetro por coluna: `slug` e os nomes não têm o mesmo tipo, e reusar
  // $2 nas três faz o pg deduzir tipos conflitantes.
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, $2, $3, $4) on conflict (id) do nothing`,
    [orgId, slug, slug, slug],
  );
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
     values ($1, $2, $3, 'WORKING', '\\x00'::bytea) on conflict (id) do nothing`,
    [sessionId, orgId, `uso-cap-${slug}`],
  );
}

async function seedAgente(id: string, orgId: string, nome: string): Promise<void> {
  await pool.query(
    `insert into ai_agents (id, organization_id, name, system_prompt)
     values ($1, $2, $3, 'system') on conflict (id) do nothing`,
    [id, orgId, nome],
  );
}

beforeAll(async () => {
  await seedOrg(ORG_A, "uso-cap-a", SESSION_A);
  await seedOrg(ORG_B, "uso-cap-b", SESSION_B);
  await seedAgente(AGENTE, ORG_A, "Agente observado");
  await seedAgente(AGENTE_VIZINHO, ORG_A, "Agente vizinho");
  await seedAgente(AGENTE_ORG_B, ORG_B, "Agente de outro tenant");

  // Uma versão por agente: `ai_agent_runs.agent_version_id` é not null, e
  // apontar o run de um agente para a versão de outro criaria dado que o
  // sistema real nunca produz.
  const VERSAO_POR_AGENTE = new Map<string, string>([
    [AGENTE, VERSAO],
    [AGENTE_VIZINHO, "a5500000-0000-4000-8000-000000000031"],
    [AGENTE_ORG_B, "a5500000-0000-4000-8000-000000000032"],
  ]);
  for (const [agentId, versaoId] of VERSAO_POR_AGENTE) {
    const orgDoAgente = agentId === AGENTE_ORG_B ? ORG_B : ORG_A;
    const sessaoDoAgente = agentId === AGENTE_ORG_B ? SESSION_B : SESSION_A;
    await pool.query(
      `insert into ai_agent_versions
         (id, organization_id, agent_id, version_number, system_prompt, provider, model, channel_session_id, status, tool_ids)
       values ($1, $2, $3, 1, 'system', 'anthropic', 'claude-sonnet-4-6', $4, 'published',
               array['crm_get_lead','crm_move_lead_stage','crm_list_leads'])
       on conflict (id) do nothing`,
      [versaoId, orgDoAgente, agentId, sessaoDoAgente],
    );
  }

  for (const run of RUNS) {
    await pool.query(
      `insert into ai_agent_runs
         (id, organization_id, agent_id, agent_version_id, status, is_dry_run, started_at)
       values ($1, $2, $3, $4, 'completed', $5, now() - ($6 || ' days')::interval)
       on conflict (id) do nothing`,
      [
        run.id,
        run.orgId,
        run.agentId,
        VERSAO_POR_AGENTE.get(run.agentId)!,
        run.dryRun ?? false,
        String(run.diasAtras),
      ],
    );

    for (const chamada of run.chamadas) {
      // Mesmo shape que `auditMcpToolCall` escreve.
      await pool.query(
        `insert into api_audit_log
           (organization_id, action, resource_type, resource_id, request_id, metadata, created_at)
         values ($1, 'mcp.tool_called', 'mcp_tool', null, $2, $3::jsonb,
                 now() - ($4 || ' days')::interval)`,
        [
          run.orgId,
          run.id,
          JSON.stringify({ tool_name: chamada.tool, success: chamada.ok, duration_ms: 5 }),
          String(run.diasAtras),
        ],
      );
    }
  }

  // Ruído: audit de OUTRA ação, no mesmo run. Não é uso de capacidade.
  await pool.query(
    `insert into api_audit_log
       (organization_id, action, resource_type, request_id, metadata, created_at)
     values ($1, 'ai.handoff_triggered', 'conversation', $2, '{"tool_name":"crm_get_lead"}'::jsonb, now())`,
    [ORG_A, RUNS[0]!.id],
  );
});

afterAll(async () => {
  await pool.query(`delete from api_audit_log where organization_id = any($1::uuid[])`, [
    [ORG_A, ORG_B],
  ]);
  await pool.query(`delete from ai_agent_runs where organization_id = any($1::uuid[])`, [
    [ORG_A, ORG_B],
  ]);
  await pool.query(`delete from ai_agent_versions where organization_id = any($1::uuid[])`, [
    [ORG_A, ORG_B],
  ]);
  await pool.query(`delete from ai_agents where organization_id = any($1::uuid[])`, [
    [ORG_A, ORG_B],
  ]);
  await pool.end();
});

async function usar(orgId: string, agentId: string, dias: number) {
  const { rows } = await pool.query(
    `select tool_name, total, falhas, em_teste, ultima_vez
       from fn_agent_tool_usage($1::uuid, $2::uuid, now() - ($3 || ' days')::interval)
      order by tool_name`,
    [orgId, agentId, String(dias)],
  );
  return rows as Array<{
    tool_name: string;
    total: string;
    falhas: string;
    em_teste: string;
    ultima_vez: string;
  }>;
}

describe("fn_agent_tool_usage", () => {
  it("conta uso, falha e execução de teste por capacidade", async () => {
    const linhas = await usar(ORG_A, AGENTE, 7);
    const porNome = new Map(linhas.map((l) => [l.tool_name, l]));

    // crm_get_lead: 2 usos reais (run 100) + 1 em teste (run 101) = 3, sem falha.
    expect(porNome.get("crm_get_lead")).toMatchObject({
      total: "3",
      falhas: "0",
      em_teste: "1",
    });

    // crm_move_lead_stage: 1 real + 1 em teste, ambas falharam.
    expect(porNome.get("crm_move_lead_stage")).toMatchObject({
      total: "2",
      falhas: "2",
      em_teste: "1",
    });
  });

  it("não conta a chamada de outro agente da MESMA organização", async () => {
    // O vizinho fez 2 chamadas de crm_get_lead na janela. Se elas vazassem, o
    // total do agente observado seria 5, não 3.
    const linhas = await usar(ORG_A, AGENTE, 7);
    expect(linhas.find((l) => l.tool_name === "crm_get_lead")!.total).toBe("3");

    const doVizinho = await usar(ORG_A, AGENTE_VIZINHO, 7);
    expect(doVizinho.find((l) => l.tool_name === "crm_get_lead")!.total).toBe("2");
  });

  it("não conta chamada de outra organização", async () => {
    const linhas = await usar(ORG_B, AGENTE_ORG_B, 7);
    expect(linhas.find((l) => l.tool_name === "crm_get_lead")!.total).toBe("1");

    // E pedir o agente do tenant A passando a org B não devolve nada — o
    // filtro é por (organização, agente), não só por agente.
    expect(await usar(ORG_B, AGENTE, 7)).toEqual([]);
  });

  it("a janela corta pelo início da execução", async () => {
    const janelaCurta = await usar(ORG_A, AGENTE, 7);
    const janelaLonga = await usar(ORG_A, AGENTE, 90);
    expect(janelaCurta.find((l) => l.tool_name === "crm_get_lead")!.total).toBe("3");
    // O run de 40 dias atrás entra só na janela longa.
    expect(janelaLonga.find((l) => l.tool_name === "crm_get_lead")!.total).toBe("4");
  });

  it("audit de outra ação não vira uso de capacidade", async () => {
    // Há uma linha 'ai.handoff_triggered' com tool_name no metadata, no mesmo
    // run. Se a função filtrasse só por request_id, viraria um uso fantasma.
    const linhas = await usar(ORG_A, AGENTE, 7);
    const total = linhas.reduce((acc, l) => acc + Number(l.total), 0);
    expect(total).toBe(5);
  });

  it("agente sem nenhuma execução devolve lista vazia, não erro", async () => {
    const semUso = "a5500000-0000-4000-8000-0000000000ff";
    await seedAgente(semUso, ORG_A, "Agente recém-criado");
    expect(await usar(ORG_A, semUso, 30)).toEqual([]);
  });
});
