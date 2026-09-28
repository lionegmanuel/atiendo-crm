/**
 * G6-02 — organizations.settings.ai_dispatch_mode respeitado pelo dispatcher.
 *
 * Prova, contra o dispatcher REAL (admin client mockado):
 *  - org 'external' → o evento é PULADO antes do claim: event_log NUNCA sofre
 *    UPDATE (nem claim/processing, nem markProcessed/done), o contador
 *    skipped_external_dispatch incrementa e batch_size fica 0 (não-consumido);
 *  - org 'native' (sem a chave) → regressão: o dispatcher CLAIMA e processa como
 *    hoje (event_log sofre UPDATE, batch_size=1, skipped_external_dispatch=0).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchAgents } from "@/lib/ai/dispatcher";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// env.ts valida process.env no import; o vitest não carrega .env, e nenhum dos
// caminhos exercidos aqui (invokeRunner) usa env — stub mínimo evita o throw.
vi.mock("@/lib/env", () => ({ env: {} }));

const EXTERNAL_ORG = "11111111-1111-4111-8111-111111111111";
const NATIVE_ORG = "22222222-2222-4222-8222-222222222222";
const EVENT_ID = "33333333-3333-4333-8333-333333333333";

function eventRow(orgId: string) {
  return {
    id: EVENT_ID,
    organization_id: orgId,
    payload: {
      organization_id: orgId,
      conversation_id: "44444444-4444-4444-8444-444444444444",
      channel_session_id: "55555555-5555-4555-8555-555555555555",
      inbound_message_id: "66666666-6666-4666-8666-666666666666",
    },
    metadata: null,
    consumed_by: [],
    attempts: 0,
    next_attempt_at: null,
    status: "pending",
  };
}

/**
 * Stub do admin client. `orgSettings` alimenta a query organizations; `onEventUpdate`
 * dispara sempre que event_log sofre .update() — é a sonda do claim/markProcessed.
 */
function makeAdmin(opts: {
  events: unknown[];
  orgSettings: Record<string, unknown> | null;
  orgId: string;
  onEventUpdate: () => void;
}) {
  const from = (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      or: () => chain,
      in: () => chain,
      order: () => chain,
      update: () => {
        if (table === "event_log") opts.onEventUpdate();
        return chain;
      },
      // event_log pull termina em .limit(); organizations/leitura via .in() → then.
      limit: () =>
        Promise.resolve({ data: table === "event_log" ? opts.events : [], error: null }),
      maybeSingle: () =>
        Promise.resolve({
          // claimEvent: update(...).select().maybeSingle() → linha claimed.
          data: table === "event_log" ? { id: EVENT_ID } : null,
          error: null,
        }),
      then: (resolve: (v: unknown) => unknown) => {
        const data =
          table === "organizations" ? [{ id: opts.orgId, settings: opts.orgSettings }] : [];
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return chain;
  };
  return { from };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("dispatcher — ai_dispatch_mode (G6-02)", () => {
  it("org 'external' → evento PULADO sem tocar event_log (não-consumido)", async () => {
    const onEventUpdate = vi.fn();
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdmin({
        events: [eventRow(EXTERNAL_ORG)],
        orgSettings: { ai_dispatch_mode: "external" },
        orgId: EXTERNAL_ORG,
        onEventUpdate,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    );

    const summary = await dispatchAgents();

    // Nenhum UPDATE no event_log: nem claim (processing), nem markProcessed (done).
    expect(onEventUpdate).not.toHaveBeenCalled();
    expect(summary.outcomes.skipped_external_dispatch).toBe(1);
    // batch_size conta eventos claimados; external não foi claimado.
    expect(summary.batch_size).toBe(0);
  });

  it("org 'native' (sem a chave) → regressão: claima e processa como hoje", async () => {
    const onEventUpdate = vi.fn();
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdmin({
        events: [eventRow(NATIVE_ORG)],
        orgSettings: {}, // chave ausente → default 'native'
        orgId: NATIVE_ORG,
        onEventUpdate,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    );

    const summary = await dispatchAgents();

    // O claim aconteceu (event_log sofreu UPDATE) e o evento foi consumido.
    expect(onEventUpdate).toHaveBeenCalled();
    expect(summary.batch_size).toBe(1);
    expect(summary.outcomes.skipped_external_dispatch).toBe(0);
    // messages retorna null no stub → o pipeline segue seu curso atual e marca
    // skipped_missing_message (prova de que NÃO foi barrado pela flag).
    expect(summary.outcomes.skipped_missing_message).toBe(1);
  });
});
