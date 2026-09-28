/**
 * O OPERADOR LÊ O CHECKPOINT DO SEU TURNO — NÃO O MAIS RECENTE DO LEAD.
 *
 * ## A corrida, e por que a ordem do enqueue não a matava
 *
 * O comentário do enfileiramento declarava que enfileirar DEPOIS de o checkpoint
 * existir mata a corrida. Mata metade: a metade "ler o checkpoint anterior". A
 * outra — ler o checkpoint POSTERIOR — ficava aberta, porque a leitura era "o mais
 * recente do lead", não "o do meu turno".
 *
 * E ela é alcançável com os defaults do produto: a fila ordena por
 * `(priority, run_after)`, o job do Operador nasce com `run_after = now()` e o
 * inbound nasce com `now() + INBOUND_DEBOUNCE_MS` (8s). Uma mensagem que chega
 * enquanto o turno corrente ainda fecha é servida antes, e o Operador N acorda
 * lendo a declaração N+1 — a mesma promessa executada duas vezes, e um aviso
 * aberto duas vezes para uma promessa só.
 *
 * ## Por que o PAR de casos, e não um
 *
 * É a classe "chave presente, chave não usada": a chave viajava no payload desde o
 * primeiro dia e era usada só como campo de log. Um caso provaria que a função
 * lê algo; o par prova que **a chave muda a resposta** — duas chamadas, mesmo
 * lead, respostas diferentes. Uma implementação que ignore a chave não consegue
 * passar nos dois.
 *
 * O segundo caso mede o CALL SITE pelo handler real: função certa chamada com a
 * chave errada é o defeito que um teste de função pura não vê.
 *
 * Bloco de UUID próprio (`0be7a70d-…`): `fileParallelism: false` compartilha o
 * contêiner e o `afterAll` do arquivo vizinho apaga a organização dele inteira.
 */
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createOperatorTurnHandler,
  lerDeclaracaoDoTurno,
} from "@/lib/agent-engine/agent/operator-turn";
import type { InboundTurnDeps } from "@/lib/agent-engine/agent/inbound-turn";
import type { JobRow } from "@/lib/agent-engine/queue/queue";
import type { Logger } from "@/lib/agent-engine/obs/logger";

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 2,
});

const ORG = "0be7a70d-0000-4000-8000-000000000001";
const CONTACT = "0be7a70d-0000-4000-8000-000000000002";
const SESSION = "0be7a70d-0000-4000-8000-000000000003";
const CONV = "0be7a70d-0000-4000-8000-000000000004";
const AGENT = "0be7a70d-0000-4000-8000-000000000005";
const VERSION = "0be7a70d-0000-4000-8000-000000000006";
/** O turno que prometeu algo. */
const J1 = "0be7a70d-0000-4000-8000-00000000000a";
/** O turno seguinte, que não teve nada a declarar — o que a leitura errada pegava. */
const J2 = "0be7a70d-0000-4000-8000-00000000000b";

const COM_PROMESSA = {
  intencoes: [{ o_que: "quer confirmar horário", evidencia: "dá terça?" }],
  promessas: [{ o_que: "confirmo o horário e te aviso", prazo: null }],
  nada_a_declarar: false,
};
const SEM_NADA = { intencoes: [], promessas: [], nada_a_declarar: true };

function fakeLogger(): Logger {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

function fakeDeps(): InboundTurnDeps {
  return {
    crmCfg: { supabase: createClient("http://127.0.0.1", "test-key") },
    llmCfg: {},
    knobs: {
      historyLimit: 20,
      maxContextTokens: 1_000,
      notesIndexMaxTokens: 500,
      maxSteps: 6,
      queuedRetryDelayMs: 1_000,
      breaker: {
        exactFailureWarn: 2,
        exactFailureBlock: 4,
        sameToolFailureWarn: 3,
        sameToolFailureHalt: 6,
        noProgressWarn: 2,
        noProgressBlock: 4,
      },
    },
    log: fakeLogger(),
  };
}

function jobDoOperador(originJobId: string): JobRow {
  return {
    id: "0be7a70d-0000-4000-8000-0000000000cc",
    organization_id: ORG,
    contact_id: CONTACT,
    kind: "operator_turn",
    source_event_id: null,
    payload: { conversation_id: CONV, origin_job_id: originJobId, agent_id: AGENT },
    status: "running",
    priority: 100,
    run_after: new Date(),
    attempts: 0,
    max_attempts: 5,
    last_error: null,
    locked_by: "test-worker",
    locked_at: new Date(),
    created_at: new Date(),
  };
}

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, 'org-turno-certo', 'Org Turno Certo', 'Org Turno Certo')
     on conflict (id) do nothing`,
    [ORG],
  );
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
     values ($1, $2, 'turno-certo-session', 'WORKING', '\\x00'::bytea) on conflict (id) do nothing`,
    [SESSION, ORG],
  );
  await pool.query(
    `insert into contacts (id, organization_id, name, phone_number)
     values ($1, $2, 'Lead do Turno', '+5511900000913') on conflict (id) do nothing`,
    [CONTACT, ORG],
  );
  await pool.query(
    `insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group)
     values ($1, $2, $3, $4, 'open', false) on conflict (id) do nothing`,
    [CONV, ORG, CONTACT, SESSION],
  );
  await pool.query(
    `insert into ai_agents (id, organization_id, name, system_prompt)
     values ($1, $2, 'Agente do turno', 'system') on conflict (id) do nothing`,
    [AGENT, ORG],
  );
  await pool.query(
    `insert into ai_agent_versions
       (id, organization_id, agent_id, version_number, system_prompt, provider, model,
        channel_session_id, status, operator_enabled)
     values ($1, $2, $3, 1, 'system', 'anthropic', 'claude-sonnet-4-6', $4, 'published', true)
     on conflict (id) do nothing`,
    [VERSION, ORG, AGENT, SESSION],
  );
  await pool.query(`update ai_agents set published_version_id = $1 where id = $2`, [VERSION, AGENT]);
});

beforeEach(async () => {
  await pool.query(`delete from agent_inbox_items where organization_id = $1`, [ORG]);
  await pool.query(`delete from lead_checkpoints where organization_id = $1`, [ORG]);
  await pool.query(`delete from job_queue where organization_id = $1`, [ORG]);

  // DOIS turnos do MESMO contato, na ordem em que aconteceriam.
  for (const id of [J1, J2]) {
    await pool.query(
      `insert into job_queue (id, organization_id, contact_id, kind, payload)
       values ($1, $2, $3, 'inbound_turn', '{}')`,
      [id, ORG, CONTACT],
    );
  }
  await pool.query(
    `insert into lead_checkpoints (organization_id, contact_id, job_id, rolling_summary, declaracao)
     values ($1, $2, $3, 'prometeu confirmar', $4::jsonb)`,
    [ORG, CONTACT, J1, JSON.stringify(COM_PROMESSA)],
  );
  await pool.query(
    `insert into lead_checkpoints (organization_id, contact_id, job_id, rolling_summary, declaracao)
     values ($1, $2, $3, 'nada novo', $4::jsonb)`,
    [ORG, CONTACT, J2, JSON.stringify(SEM_NADA)],
  );
});

afterAll(async () => {
  await pool.query(`delete from organizations where id = $1`, [ORG]);
  await pool.end();
});

describe("a leitura do Operador é pela chave do turno", () => {
  it("A CHAVE MUDA A RESPOSTA — mesmo lead, dois turnos, duas declarações", async () => {
    // Este é o caso que uma implementação que ignora a chave não consegue passar:
    // ela devolveria o checkpoint de J2 nas duas chamadas.
    const doJ1 = await lerDeclaracaoDoTurno(pool, ORG, CONTACT, J1);
    const doJ2 = await lerDeclaracaoDoTurno(pool, ORG, CONTACT, J2);

    expect(doJ1.declaracao?.promessas).toHaveLength(1);
    expect(doJ1.declaracao?.nada_a_declarar).toBe(false);
    expect(doJ2.declaracao?.nada_a_declarar).toBe(true);
    expect(doJ2.declaracao?.promessas).toHaveLength(0);
  });

  it("turno que não fechou não tem checkpoint — e isso leva a RODAR, não a pular", async () => {
    const orfao = "0be7a70d-0000-4000-8000-0000000000ff";
    await pool.query(
      `insert into job_queue (id, organization_id, contact_id, kind, payload)
       values ($1, $2, $3, 'inbound_turn', '{}')`,
      [orfao, ORG, CONTACT],
    );
    const r = await lerDeclaracaoDoTurno(pool, ORG, CONTACT, orfao);
    expect(r.houveCheckpoint).toBe(false);
    // `null` aqui significa "ninguém avaliou este turno", e é a condição em que o
    // papel mais importa — a direção segura é rodar.
    expect(r.declaracao).toBeNull();
  });

  it("O CALL SITE usa a chave — o handler real age sobre o turno que o originou", async () => {
    // Função certa chamada com a chave errada é o defeito que um teste de função
    // pura não vê. Com `operator_tool_ids` vazio o handler não chama modelo e o
    // efeito observável é o aviso da promessa de J1.
    await createOperatorTurnHandler(fakeDeps())(jobDoOperador(J1), pool, { workerId: "t" });

    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text as n from agent_inbox_items
        where organization_id = $1 and kind = 'promise_unfulfilled'`,
      [ORG],
    );
    expect(
      rows[0]?.n,
      "o handler não viu a promessa de J1 — ele leu o checkpoint de outro turno",
    ).toBe("1");
  });

  it("GUARDA DE VACUIDADE — apontado para J2, o mesmo handler NÃO abre aviso", async () => {
    // Sem este caso, o anterior passaria mesmo que o handler abrisse aviso sempre.
    // J2 declarou "nada a declarar", então o curto-circuito decide não agir.
    await createOperatorTurnHandler(fakeDeps())(jobDoOperador(J2), pool, { workerId: "t" });

    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text as n from agent_inbox_items
        where organization_id = $1 and kind = 'promise_unfulfilled'`,
      [ORG],
    );
    expect(rows[0]?.n).toBe("0");
  });
});
