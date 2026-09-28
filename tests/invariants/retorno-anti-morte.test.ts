import { execFileSync } from "node:child_process";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyScheduleFollowup } from "@/lib/agent-engine/agent/schedule-followup";
import { cancelaRetorno, listaRetornos, situacaoDoRetorno } from "@/lib/followup/retorno";
import { criaRetornoDbPg } from "@/lib/followup/retorno-pg";

/**
 * O ANTI-MORTE, contra Postgres real e pelo CÓDIGO DE PRODUÇÃO.
 *
 * ⚠️ Este arquivo não escreve SQL de retorno à mão de propósito. INSERT manual
 * prova que o banco aceita uma linha que EU montei; o que precisa ser provado é
 * que o caminho que roda em produção monta a linha certa e que o banco a aceita.
 * Por isso ele chama `applyScheduleFollowup` — a mesma função que o motor do
 * agente executa num turno — contra o Postgres efêmero do `pnpm test:db`, por um
 * `pg.Pool` de verdade.
 *
 * As quatro coisas que só este arranjo consegue provar:
 *
 *  1. **Agendar emite atividade que o banco ACEITA.** `crm_lead_activities` tem
 *     FK em `actor_agent_id` e CHECK de lastro; um stub aceitaria qualquer coisa.
 *  2. **O guard anti-empilhamento vale no banco**, não só na leitura em memória.
 *  3. **Cancelado ≠ disparado.** Antes da 0102 as duas situações eram
 *     `enabled = false` e o agente não tinha como distinguir ao retomar.
 *  4. **A organização está na QUERY**, não só no chamador: o adaptador roda com
 *     `pg` direto (sem RLS), então o filtro explícito é a única defesa.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}
const containerName: string = container;
const porta = process.env.TEST_DB_PORT ?? "54329";

function psql(script: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", containerName, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tA", "-f", "-"],
    { input: script, encoding: "utf8" },
  ).trim();
}

const ORG_A = "0102aaaa-1111-4111-8111-000000000001";
const ORG_B = "0102bbbb-1111-4111-8111-000000000002";
const PIPELINE = "0102aaaa-2222-4222-8222-000000000001";
const STAGE = "0102aaaa-3333-4333-8333-000000000001";
const CONTATO = "0102aaaa-4444-4444-8444-000000000001";
const LEAD = "0102aaaa-5555-4555-8555-000000000001";
const AGENTE = "0102aaaa-6666-4666-8666-000000000001";

const AGORA = new Date("2026-08-04T12:00:00Z");
const JANELA = { minAheadMs: 300_000, maxAheadMs: 15_552_000_000, staggerWindowMs: 0 };
const DAQUI_A_DOIS_DIAS = "2026-08-06T13:00:00.000Z";

let pool: pg.Pool;

beforeAll(async () => {
  psql(`
    insert into organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'org-0102-a', 'Org 0102 A', 'Org 0102 A'),
      ('${ORG_B}', 'org-0102-b', 'Org 0102 B', 'Org 0102 B')
    on conflict (id) do nothing;

    insert into ai_agents (id, organization_id, name, system_prompt)
    values ('${AGENTE}', '${ORG_A}', 'Agente 0102', 'prompt') on conflict (id) do nothing;

    -- Sem is_default: o índice único parcial de funil padrão por organização
    -- transforma um re-seed em erro, e este arquivo não precisa do padrão — há um
    -- funil só, e o roteamento contato→negócio não fica ambíguo.
    insert into crm_pipelines (id, organization_id, name, slug)
    values ('${PIPELINE}', '${ORG_A}', 'Funil 0102', 'funil-0102') on conflict (id) do nothing;

    insert into crm_stages (id, organization_id, pipeline_id, name, slug, position)
    values ('${STAGE}', '${ORG_A}', '${PIPELINE}', 'Em negociação', 'em-negociacao', 1000)
    on conflict (id) do nothing;

    insert into contacts (id, organization_id, name)
    values ('${CONTATO}', '${ORG_A}', 'Cliente 0102') on conflict (id) do nothing;

    insert into crm_leads (id, organization_id, pipeline_id, stage_id, contact_id, title, status)
    values ('${LEAD}', '${ORG_A}', '${PIPELINE}', '${STAGE}', '${CONTATO}', 'Negócio 0102', 'open')
    on conflict (id) do nothing;

    delete from cron_jobs where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from crm_lead_activities where lead_id = '${LEAD}';
  `);

  pool = new pg.Pool({
    connectionString: `postgres://postgres:postgres@127.0.0.1:${porta}/postgres`,
    max: 2,
  });
});

afterAll(async () => {
  await pool?.end();
});

/** O agendamento como o motor o faz — mesma função, mesmos argumentos. */
function agendaComoOMotor(prometidoPara: string) {
  return applyScheduleFollowup(
    pool,
    { clock: () => AGORA, knobs: JANELA },
    // No motor, "lead" É o contato (inbound-turn: leadId = job.contact_id).
    { tenantId: ORG_A, leadId: CONTATO, agentId: AGENTE },
    {
      reason: "reconfirmar a consulta de quarta",
      promised_at: prometidoPara,
      promise: "confirmo com você na quarta de manhã",
      context_snapshot: null,
    },
  );
}

describe("agendar o retorno — o próximo passo existe e é visível", () => {
  it("cria o retorno no banco pelo caminho de produção", async () => {
    const r = await agendaComoOMotor(DAQUI_A_DOIS_DIAS);
    expect(r.ok).toBe(true);

    const linha = psql(`
      select job_kind || '|' || enabled::text || '|' || coalesce(cancelled_at::text, 'sem-cancelamento')
        from cron_jobs where organization_id = '${ORG_A}' and contact_id = '${CONTATO}';
    `);
    expect(linha).toBe("followup_turn|true|sem-cancelamento");
  });

  it("emite atividade que o banco ACEITA, ancorada no negócio do contato", () => {
    // A âncora é o ponto: `crm_lead_activities.lead_id` é NOT NULL e o retorno
    // viaja por contato. Se o roteamento contato→negócio falhasse, não haveria
    // linha nenhuma — e o card pararia de esfriar sem nada explicando por quê.
    const linha = psql(`
      select type || '|' || lead_id::text || '|' || actor_kind || '|' || coalesce(actor_agent_id::text, 'sem-agente')
        from crm_lead_activities
       where organization_id = '${ORG_A}' and type = 'followup_scheduled';
    `);
    // `system` e não `ai`: o agendamento não carrega lastro de execução, e a
    // constraint 0071 recusa autoria de IA sem prova. O AGENTE continua nomeado.
    expect(linha).toBe(`followup_scheduled|${LEAD}|system|${AGENTE}`);
  });

  it("o segundo agendamento é recusado — e o banco continua com UM retorno", async () => {
    const r = await agendaComoOMotor("2026-08-07T13:00:00.000Z");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("esperava recusa");
    expect(r.error.code).toBe("already_pending");

    expect(
      psql(`select count(*) from cron_jobs where organization_id='${ORG_A}' and contact_id='${CONTATO}';`),
    ).toBe("1");
  });
});

describe("cancelar o retorno — o humano decide e o agente descobre", () => {
  it("marca cancelled_at, e a situação deixa de ser confundível com disparado", async () => {
    const db = criaRetornoDbPg(pool);
    const vivo = await db.buscaRetornoVivo(ORG_A, CONTATO);
    expect(vivo).not.toBeNull();

    const r = await cancelaRetorno(
      db,
      { agora: new Date("2026-08-05T09:00:00Z") },
      { orgId: ORG_A, retornoId: vivo!.id },
      { motivo: "desmarcado por uma pessoa da equipe" },
    );
    expect(r.ok).toBe(true);

    const [enabled, cancelledAt, motivo] = psql(`
      select enabled::text || '|' || coalesce(cancelled_at::text,'') || '|' || coalesce(cancel_reason,'')
        from cron_jobs where id = '${vivo!.id}';
    `).split("|");

    expect(enabled).toBe("false");
    // ⚠️ A DIFERENÇA QUE A 0102 EXISTE PARA CRIAR: `enabled=false` sozinho é
    // ambíguo. Sem `cancelled_at`, a linha abaixo seria idêntica à de um retorno
    // que disparou — e o agente reagendaria o que uma pessoa acabou de desmarcar.
    expect(cancelledAt).not.toBe("");
    expect(motivo).toBe("desmarcado por uma pessoa da equipe");
    expect(situacaoDoRetorno({ enabled: false, cancelled_at: cancelledAt! })).toBe("cancelado");
  });

  it("o agente, ao listar, vê 'cancelado' com o motivo — não 'disparado'", async () => {
    const retornos = await listaRetornos(criaRetornoDbPg(pool), {
      orgId: ORG_A,
      contactId: CONTATO,
    });
    expect(retornos).toHaveLength(1);
    expect(retornos[0]!.situacao).toBe("cancelado");
    expect(retornos[0]!.motivoDoCancelamento).toBe("desmarcado por uma pessoa da equipe");
  });

  it("cancelar de novo não reescreve o desfecho", async () => {
    const db = criaRetornoDbPg(pool);
    const linhas = JSON.parse(
      psql(`select json_agg(json_build_object('id', id)) from cron_jobs where organization_id='${ORG_A}';`),
    ) as Array<{ id: string }>;
    const id = linhas[0]!.id;

    const r = await cancelaRetorno(
      db,
      { agora: new Date("2026-08-05T10:00:00Z") },
      { orgId: ORG_A, retornoId: id },
      { motivo: "tentando de novo" },
    );
    expect(r.ok).toBe(false);
    expect(
      psql(`select cancel_reason from cron_jobs where id = '${id}';`),
    ).toBe("desmarcado por uma pessoa da equipe");
  });
});

describe("a organização está na query, não só no chamador", () => {
  it("o retorno de uma organização não é alcançado pela outra", async () => {
    // O adaptador roda com `pg` direto — RLS não intervém, o filtro explícito é
    // a única defesa. Um `where` esquecido passaria em todos os testes acima.
    const db = criaRetornoDbPg(pool);
    await pool.query(
      `update cron_jobs set enabled = true, cancelled_at = null, cancel_reason = null
        where organization_id = $1`,
      [ORG_A],
    );

    expect(await db.buscaRetornoVivo(ORG_A, CONTATO)).not.toBeNull();
    expect(await db.buscaRetornoVivo(ORG_B, CONTATO)).toBeNull();
    expect(await listaRetornos(db, { orgId: ORG_B, contactId: CONTATO })).toEqual([]);
  });
});

describe("o baseline entrega as colunas ao clone (é ele que o self-host aplica)", () => {
  it("cancelled_at, cancel_reason e o índice do retorno vivo existem", () => {
    expect(
      psql(`
        select string_agg(column_name, ',' order by column_name)
          from information_schema.columns
         where table_schema='public' and table_name='cron_jobs'
           and column_name in ('cancelled_at','cancel_reason');
      `),
    ).toBe("cancel_reason,cancelled_at");

    expect(
      psql(`select count(*) from pg_indexes where indexname = 'idx_cron_jobs_retorno_vivo';`),
    ).toBe("1");
  });
});
