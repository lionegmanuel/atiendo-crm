import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";

import type * as InboundTurn from "@/lib/agent-engine/agent/inbound-turn";
import type * as Providers from "@/lib/agent-engine/edge/llm/providers";
import type * as Queue from "@/lib/agent-engine/queue/queue";
import type * as ObsLogger from "@/lib/agent-engine/obs/logger";

/**
 * O TURNO INTEIRO, CONTRA POSTGRES DE VERDADE: quem pede um atendente RECEBE UMA
 * RESPOSTA — e ela sai ANTES de a trava ser armada.
 *
 * ## O defeito, medido em produção (2026-08-26, conversa `cdd9cbd8`)
 *
 * O cliente escreveu "preciso de falar com atendente". A detecção determinística
 * casou, `performHumanHandoff` rodou, e o turno deu `return` com o comentário
 * *"bot silencia: sem modelo, sem envio neste turno"*. Do lado de fora, no
 * WhatsApp: silêncio absoluto sobre um pedido explícito.
 *
 * ## Por que isto precisa de banco de verdade, e não do guarda estático
 *
 * `tests/unit/handoff-avisa-o-lead.test.ts` varre o AST e prova que nenhum sítio
 * de passagem existe sem um emissor de aviso ao lado. Ele NÃO prova que a
 * mensagem sai: um emissor cujo corpo fosse `return {avisado:false}` o
 * satisfaria. E, principalmente, ele não prova a ORDEM contra o estado real —
 * que é onde o conserto vive ou morre.
 *
 * A ordem não é preferência de redação. `performHumanHandoff` grava
 * `contacts.force_human = true`, e o gate 1 da cadeia (`stopGate`) relê
 * `(is_blocked or force_human)` DIRETO da fonte, sob o advisory lock, a cada
 * tentativa de envio. **Avisar depois da passagem é avisar ninguém.** O caso
 * "avisou ANTES de a trava existir" abaixo é o que impede alguém de "consertar"
 * invertendo a ordem e ficando verde.
 *
 * ## Harness
 *
 * Copiado de `limite-de-envios-por-turno.test.ts`: `createInboundTurnHandler`
 * real, canal que CAPTURA em vez de enviar, `createFakeRegistry` para o modelo,
 * relógio fixo dentro da janela anti-ban (sem ele o `pacing` veta e a medição é
 * do motivo errado) e `sleep` no-op.
 *
 * O modelo fake aqui é um CONTROLE, não um ator: se ele for chamado num turno de
 * pedido explícito, o desvio determinístico deixou de ser determinístico.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://placeholder.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "placeholder-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "placeholder-service";

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 2,
});

const ORG = "eeee0000-0000-4000-8000-000000000001";
const CONTACT = "eeee0000-0000-4000-8000-000000000002";
const SESSION = "eeee0000-0000-4000-8000-000000000003";
const CONV = "eeee0000-0000-4000-8000-000000000004";

interface EnvioCapturado {
  body: string;
  /** `contacts.force_human` NO INSTANTE do envio — a prova da ordem. */
  forceHumanNoEnvio: boolean;
}

type Modules = {
  createInboundTurnHandler: typeof InboundTurn.createInboundTurnHandler;
  queue: typeof Queue;
  createLogger: typeof ObsLogger.createLogger;
  createFakeRegistry: typeof Providers.createFakeRegistry;
};
let m: Modules;

let enviados: EnvioCapturado[] = [];
let modeloChamado = 0;

const USO = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

/**
 * Modelo de CONTROLE: encerra o turno com um checkpoint válido e conta quantas
 * vezes foi chamado. Num turno de pedido explícito ele tem de ficar em ZERO.
 */
function modeloDeControle() {
  return async () => {
    modeloChamado += 1;
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            commitments: [],
            objections: [],
            next_action: null,
            rolling_summary: "turno de teste",
          }),
        },
      ],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: USO,
      warnings: [],
    };
  };
}

function montaHandler() {
  return m.createInboundTurnHandler({
    crmCfg: { supabase: {} as never },
    llmCfg: { anthropicApiKey: "fake" } as never,
    knobs: {
      historyLimit: 10,
      maxContextTokens: 1000,
      notesIndexMaxTokens: 500,
      maxSteps: 12,
      queuedRetryDelayMs: 1000,
      breaker: {
        exactFailureWarn: 2,
        exactFailureBlock: 5,
        sameToolFailureWarn: 3,
        sameToolFailureHalt: 8,
        noProgressWarn: 3,
        noProgressBlock: 5,
      },
    },
    log: m.createLogger(),
    registry: m.createFakeRegistry(modeloDeControle() as never),
    channel: () =>
      ({
        channel: "captura",
        send: async (i: { body: string }) => {
          // A leitura acontece DENTRO do envio, contra o banco: é o instante
          // exato em que a pergunta "a trava já está armada?" tem resposta.
          const { rows } = await pool.query<{ force_human: boolean }>(
            "select force_human from contacts where id = $1",
            [CONTACT],
          );
          enviados.push({ body: i.body, forceHumanNoEnvio: rows[0]?.force_human === true });
          return {
            kind: "sent" as const,
            idempotencyKey: `k${enviados.length}`,
            messageId: `m${enviados.length}`,
          };
        },
        sessionHealth: async () => ({ healthy: true, status: "WORKING" }),
        capabilities: () => ({ freeform: true, media: true, audio: true }),
        costPerMessage: () => ({ currency: "BRL", cents: 0 }),
      }) as never,
    // Terça, 15h BRT: dentro da janela anti-ban (7h-22h). Sem isto o gate
    // `pacing` vetaria por horário e o arquivo mediria o motivo errado — o
    // mesmo cuidado de `limite-de-envios-por-turno.test.ts`.
    clock: () => new Date("2026-07-28T18:00:00Z"),
    sleep: async () => {},
  });
}

/** Grava um inbound e roda UM turno completo por cima dele. */
async function rodaTurnoCom(texto: string): Promise<void> {
  const msgId = crypto.randomUUID();
  await pool.query(
    `insert into messages (id, organization_id, conversation_id, channel_session_id, contact_id,
       type, direction, status, body, sent_via, sent_at)
     values ($1,$2,$3,$4,$5,'text','inbound','delivered',$6,'external_device', now())`,
    [msgId, ORG, CONV, SESSION, CONTACT, texto],
  );
  await pool.query("update job_queue set status = 'done' where status = 'pending'");
  const { job } = await m.queue.enqueueJob(pool, ORG, {
    kind: "inbound_turn",
    leadId: CONTACT,
    payload: {
      conversation_id: CONV,
      contact_id: CONTACT,
      channel_session_id: SESSION,
      inbound_message_id: msgId,
      crm_event_id: crypto.randomUUID(),
    },
    maxAttempts: 1,
  });
  const [claimed] = await m.queue.claimJobs(pool, { workerId: "aviso", maxConcurrency: 1 });
  expect(claimed?.id).toBe(job.id);
  try {
    await montaHandler()(claimed!, pool, { workerId: "aviso" });
    await m.queue.completeJob(pool, claimed!.id, "aviso");
  } catch (err) {
    await m.queue.failJob(pool, claimed!.id, "aviso", err);
    throw err;
  }
}

beforeAll(async () => {
  m = {
    createInboundTurnHandler: (await import("@/lib/agent-engine/agent/inbound-turn"))
      .createInboundTurnHandler,
    queue: await import("@/lib/agent-engine/queue/queue"),
    createLogger: (await import("@/lib/agent-engine/obs/logger")).createLogger,
    createFakeRegistry: (await import("@/lib/agent-engine/edge/llm/providers")).createFakeRegistry,
  };

  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1,'handoff-avisa','Handoff Avisa','Handoff Avisa') on conflict (id) do nothing`,
    [ORG],
  );
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
     values ($1,$2,'handoff-avisa-session','WORKING','\\x00'::bytea) on conflict (id) do nothing`,
    [SESSION, ORG],
  );
  // Camada `platform` do playbook: o ritual de abertura recusa o turno sem ela
  // ("publique uma versão platform e aponte antes do primeiro run"). Mesma
  // semente de `limite-de-envios-por-turno.test.ts`.
  await pool.query(
    `with v as (
       insert into playbook_versions (organization_id, layer, content)
       select null, 'platform', E'## Identidade\nAssistente de teste.'
       where not exists (select 1 from playbook_pointers where organization_id is null and layer = 'platform')
       returning id)
     insert into playbook_pointers (organization_id, layer, version_id)
     select null, 'platform', id from v`,
  );
});

beforeEach(async () => {
  enviados = [];
  modeloChamado = 0;
  // Estado limpo a cada caso: `force_human` é IRREVOGÁVEL em produção, então um
  // caso herdando a trava do anterior mediria o turno pulado, não o desvio.
  await pool.query("delete from messages where organization_id = $1", [ORG]);
  await pool.query("delete from send_ledger where organization_id = $1", [ORG]);
  await pool.query("delete from outbound_copies where organization_id = $1", [ORG]);
  await pool.query("delete from agent_inbox_items where organization_id = $1", [ORG]);
  await pool.query("delete from conversations where organization_id = $1", [ORG]);
  await pool.query("delete from contacts where organization_id = $1", [ORG]);
  await pool.query(
    `insert into contacts (id, organization_id, name, phone_number, force_human)
     values ($1,$2,'Lead que pede humano','+5511900000777', false)`,
    [CONTACT, ORG],
  );
  await pool.query(
    `insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group)
     values ($1,$2,$3,$4,'ai_handling',false)`,
    [CONV, ORG, CONTACT, SESSION],
  );
});

describe("pedido explícito de atendente", () => {
  it("o lead RECEBE uma resposta — e ela não é vazia", async () => {
    await rodaTurnoCom("preciso de falar com atendente");
    expect(
      enviados.map((e) => e.body),
      "o defeito original: pedido explícito de humano e ZERO mensagens ao lead",
    ).toHaveLength(1);
    expect(enviados[0]!.body.length).toBeGreaterThan(20);
  });

  it("o aviso saiu ANTES de a trava ser armada", async () => {
    // A asserção que impede o conserto de ser invertido. Com `force_human` já
    // gravado, o `stopGate` vetaria este mesmo envio — e o veto é mudo.
    await rodaTurnoCom("preciso de falar com atendente");
    expect(enviados[0]!.forceHumanNoEnvio, "avisou depois de armar a trava que veta o aviso").toBe(
      false,
    );
    const { rows } = await pool.query<{ force_human: boolean }>(
      "select force_human from contacts where id = $1",
      [CONTACT],
    );
    expect(rows[0]!.force_human, "a passagem não aconteceu — o teste mediu outra coisa").toBe(true);
  });

  it("nenhum token gasto: o desvio segue determinístico", async () => {
    await rodaTurnoCom("preciso de falar com atendente");
    expect(modeloChamado, "o desvio passou a chamar o modelo — custo por pedido de humano").toBe(0);
  });

  it("a conversa é devolvida à fila humana e silenciada", async () => {
    await rodaTurnoCom("preciso de falar com atendente");
    const { rows } = await pool.query<{ status: string; silencio: string | null; motivo: string | null }>(
      `select status, bot_silenced_until::text as silencio, last_handoff_reason as motivo
         from conversations where id = $1`,
      [CONV],
    );
    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.silencio).toBe("infinity");
    expect(rows[0]!.motivo).toBe("requested_human");
  });

  it("a Central registra que o cliente FOI avisado", async () => {
    // O que muda a primeira frase que o atendente digita ao abrir a conversa.
    await rodaTurnoCom("preciso de falar com atendente");
    const { rows } = await pool.query<{ body: string }>(
      "select body from agent_inbox_items where organization_id = $1 and kind = 'handoff'",
      [ORG],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body).toMatch(/JÁ FOI avisado/u);
  });

  /**
   * GUARDA DE VACUIDADE. Sem ela, "exatamente 1 envio" poderia ser verdade por o
   * harness nunca ter chegado ao desvio — e o arquivo inteiro estaria medindo o
   * nada com cinco asserções verdes.
   */
  it("controle: inbound NEUTRO não dispara passagem nenhuma", async () => {
    await rodaTurnoCom("bom dia, qual o horário de vocês?");
    const { rows } = await pool.query<{ force_human: boolean }>(
      "select force_human from contacts where id = $1",
      [CONTACT],
    );
    expect(rows[0]!.force_human, "mensagem comum virou passagem para humano").toBe(false);
    expect(modeloChamado, "turno normal não chamou o modelo — o harness não rodou").toBeGreaterThan(0);
  });

  /**
   * O SEGUNDO turno do mesmo lead: já em handoff, o turno é NO-OP e não pode
   * mandar um segundo aviso. Sem este caso, um lead que insistisse receberia o
   * mesmo texto a cada mensagem.
   */
  it("lead já em handoff não recebe aviso de novo", async () => {
    await rodaTurnoCom("preciso de falar com atendente");
    expect(enviados).toHaveLength(1);
    enviados = [];
    await rodaTurnoCom("e aí, alguém aí?");
    expect(enviados, "o aviso repetiu a cada mensagem do lead já escalado").toHaveLength(0);
  });
});

describe("suspeita de opt-out", () => {
  it("recebe confirmação da parada, e ela não oferece atendente", async () => {
    await rodaTurnoCom("não quero mais receber mensagens de vocês");
    expect(enviados).toHaveLength(1);
    expect(enviados[0]!.body).toMatch(/parar|encerro|não mando/iu);
    expect(enviados[0]!.body).not.toMatch(/atendente/iu);
    expect(enviados[0]!.forceHumanNoEnvio, "confirmou depois de armar a trava").toBe(false);
    const { rows } = await pool.query<{ motivo: string | null }>(
      "select last_handoff_reason as motivo from conversations where id = $1",
      [CONV],
    );
    expect(rows[0]!.motivo).toBe("suspected_optout");
  });
});
