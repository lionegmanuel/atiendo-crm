/**
 * O CARIMBO DE ORIGEM DA LINHA — quem enviou diz quem enviou (issue #652).
 *
 * ─── O defeito, medido na main de 17/09/2026 ─────────────────────────────────
 *
 * `app/api/v1/messages/_handler.ts` gravava `sent_via` com uma pergunta só:
 *
 *     sent_via: ctx.actor.type !== "user" ? "ai" : "user"
 *
 * Tudo que não era pessoa saía `'ai'` — inclusive o que a AUTOMAÇÃO envia. As
 * ações de regra (`lib/automation/actions/send-whatsapp.ts`), o texto fixo do
 * follow-up (`lib/followup/enviar-texto-fixo.ts`) e o lembrete de agenda
 * (`app/api/v1/cron/agenda-reminder/route.ts`) chamam este handler com
 * `actor: { type: "webhook_source" }`, então um template FIXO — sem IA nenhuma
 * no caminho — aparecia no balão como "IA" para o dono da conversa.
 *
 * A decisão do mantenedor (comentário de 16/09/2026 na #652) é categoria
 * própria: "mensagem que não foi escrita nem por pessoa nem pela IA ganha
 * categoria própria". O valor escolhido aqui é `'automation'` — o mesmo que o
 * CHECK de `messages.sent_via` já aceita (`supabase/baseline.sql`) e que o
 * union de `lib/types/messaging.ts` declara.
 *
 * ─── Por que o teste olha a LINHA GRAVADA e não a função ─────────────────────
 *
 * O que a tela lê é a coluna. Um teste que chamasse a função de decisão
 * continuaria verde num handler que a ignorasse — e é exatamente onde o defeito
 * morava: a decisão existia (`!== "user"`), só respondia à pergunta errada.
 * Aqui o fake é o banco: o INSERT passa por ele e é o valor persistido que a
 * asserção lê.
 *
 * O banco falso é o COMPARTILHADO (`tests/helpers/duble-do-handler.ts`), e não
 * um `makeSupabase` local: um dublê por arquivo mede o dublê, não o handler — e
 * a catraca `tests/unit/send-message-handler-nao-ganha-novo-duble.test.ts`
 * existe justamente porque a lista de legados só encolhe.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import type { SendMessageInput } from "@/lib/schemas";
import { criarDubleDoHandler } from "../helpers/duble-do-handler";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ storage: { from: () => ({ createSignedUrl: vi.fn() }) } }),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

const ORG = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";
const CONTACT = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";
const USER = "55555555-5555-4555-8555-555555555555";

/** O que o WAHA devolve no envio: o id BARE, sem o chat. */
const BARE = "3EB0ABCDEF0123456789";

const input = {
  conversation_id: CONV,
  type: "text",
  body: "Thiago, consigo te colocar amanhã às 15h.",
} as SendMessageInput;

function ctxComAtor(actor: HandlerCtx["actor"]): HandlerCtx {
  return { organization_id: ORG, actor, requestId: "req-652" };
}

function wahaRespondendo() {
  vi.stubEnv("WAHA_API_BASE_URL", "http://localhost:3030");
  vi.stubEnv("WAHA_API_KEY", "test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ id: { id: BARE } }), { status: 200 })),
  );
}

/**
 * O dublê compartilhado, com a conversa que o caminho de envio lê.
 *
 * `channel_sessions.metadata` vazio = canal aberto: o gate de pré-go-live não
 * bloqueia quando o ator não é pessoa, que é o caso dos dois primeiros testes.
 */
function duble() {
  return criarDubleDoHandler({
    conversation: {
      id: CONV,
      organization_id: ORG,
      contact_id: CONTACT,
      channel_session_id: SESSION,
      is_group: false,
      group_chat_id: null,
      contacts: { phone_number: "+553****8888", wa_identity: null, wa_lid: null, is_blocked: false },
      channel_sessions: {
        provider: "waha",
        waha_session_name: "default",
        status: "WORKING",
        archived_at: null,
        metadata: {},
      },
    },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("o carimbo de origem da linha enviada", () => {
  it("⭐ a REGRA DE AUTOMAÇÃO (webhook_source) grava 'automation', nunca 'ai'", async () => {
    // O template fixo de uma regra não passa por IA nenhuma. Com o carimbo
    // 'ai', o balão mostrado ao dono atribuía à IA um texto que a regra montou.
    wahaRespondendo();
    const { supabase, capturas } = duble();

    await sendMessageHandler(supabase, ctxComAtor({ type: "webhook_source", id: "regra-1" }), input);

    const linha = capturas.inserts.messages?.at(-1);
    expect(
      linha?.sent_via,
      "a mensagem da automação se apresentou como IA — é o defeito da #652",
    ).toBe("automation");
    expect(
      linha?.sent_by_user_id,
      "linha de automação não tem pessoa: `sent_by_user_id` é null",
    ).toBeNull();
  });

  it("CONTROLE: a pessoa pelo CRM continua 'user' — e com autoria", async () => {
    wahaRespondendo();
    const { supabase, capturas } = duble();

    await sendMessageHandler(supabase, ctxComAtor({ type: "user", id: USER }), input);

    const linha = capturas.inserts.messages?.at(-1);
    expect(linha?.sent_via).toBe("user");
    expect(linha?.sent_by_user_id).toBe(USER);
  });

  it("CONTROLE: o agente de IA continua 'ai' — a categoria nova não engoliu a dele", async () => {
    // Sem este caso, carimbar TUDO que não é pessoa 'automation' ficaria verde —
    // e a IA deixaria de ter rótulo próprio, que é o defeito na direção oposta.
    wahaRespondendo();
    const { supabase, capturas } = duble();

    await sendMessageHandler(
      supabase,
      ctxComAtor({ type: "ai_agent", id: "agente-1", role: "agent" }),
      input,
    );

    expect(capturas.inserts.messages?.at(-1)?.sent_via).toBe("ai");
  });
});
