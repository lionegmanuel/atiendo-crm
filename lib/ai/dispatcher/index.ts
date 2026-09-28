/**
 * @deprecated Fase 0 da convergência (spec 2026-07-23): fora do caminho quente.
 * O runtime canônico é lib/agent-engine (workers/agent-worker). Remoção física
 * planejada após um ciclo de estabilidade. Não adicionar features aqui.
 *
 * `agent-dispatcher` worker (S-13.07, Spec 10 §5).
 *
 * Pulls `ai_agent.dispatch_requested` rows from `event_log`, picks the
 * top-priority published agent for the (org, channel_session) tuple that
 * matches the inbound message, and creates an `ai_agent_runs` row + a
 * fire-and-forget POST to `/api/internal/agents/run`.
 *
 * Service-role caveat (CLAUDE.md §multi-tenancy): admin client bypasses RLS.
 * Every query in this module filters `organization_id` from the trusted event
 * payload, never user input.
 *
 * Schema mapping note: the spec talks about `processed_at`, but `event_log`
 * uses `status` + `consumed_by[]` (status ∈ pending|processing|done|dead, per
 * event_log_status_check). We mark a successfully-handled event as
 * `status='done'` and stamp `metadata.outcome`; a terminal failure as
 * `status='dead'`. Requeue (rate-limit) sets `next_attempt_at = now()+5s` and
 * keeps `status='pending'` so the next batch picks it up.
 */

import { randomUUID } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { aiDispatchModeSchema } from "@/lib/schemas/settings";
import { checkRateLimit } from "./rate-limit";
import {
  triggerMatches,
  type TriggerConfig,
  type DispatchMessage,
  type DispatchConversation,
} from "./triggers";

export const DISPATCHER_KEY = "worker.agent-dispatcher.v1";
export const DISPATCH_EVENT_TYPE = "ai_agent.dispatch_requested";

const DEFAULT_BATCH_SIZE = 100;
const RATE_LIMIT_PER_MIN = 60;
const RATE_LIMIT_WINDOW_SEC = 60;
const REQUEUE_DELAY_MS = 5_000;

export type DispatchOutcome =
  | "dispatched"
  | "no_match"
  | "conv_busy"
  | "rate_limited"
  | "skipped_invalid_payload"
  | "skipped_missing_message"
  | "skipped_external_dispatch"
  | "error";

export interface DispatchSummary {
  batch_size: number;
  outcomes: Record<DispatchOutcome, number>;
  errors: string[];
}

interface EventRow {
  id: string;
  organization_id: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
  consumed_by: string[];
  attempts: number;
}

interface CandidateRow {
  id: string;
  priority: number;
  created_at: string;
  archived_at: string | null;
  organization_id: string;
  published_version_id: string | null;
  version: VersionRow | null;
}

interface VersionRow {
  id: string;
  organization_id: string;
  status: string;
  channel_session_id: string;
  trigger_config: TriggerConfig;
}

const EMPTY_OUTCOMES = (): Record<DispatchOutcome, number> => ({
  dispatched: 0,
  no_match: 0,
  conv_busy: 0,
  rate_limited: 0,
  skipped_invalid_payload: 0,
  skipped_missing_message: 0,
  skipped_external_dispatch: 0,
  error: 0,
});

export interface DispatchOptions {
  /** Max events to claim in a single run (default 100, Spec 10 §5.2). */
  batchSize?: number;
  /** Override clock (tests). */
  now?: Date;
}

export async function dispatchAgents(opts: DispatchOptions = {}): Promise<DispatchSummary> {
  const admin = createAdminClient();
  const batchSize = Math.min(Math.max(opts.batchSize ?? DEFAULT_BATCH_SIZE, 1), 500);
  const summary: DispatchSummary = {
    batch_size: 0,
    outcomes: EMPTY_OUTCOMES(),
    errors: [],
  };

  // 1. Pull pending dispatch_requested events that are due (next_attempt_at
  //    null or past). Order by created_at to keep FIFO semantics.
  const nowIso = (opts.now ?? new Date()).toISOString();
  const { data: rawEvents, error: pullErr } = await admin
    .from("event_log")
    .select("id, organization_id, payload, metadata, consumed_by, attempts, next_attempt_at, status")
    .eq("event_type", DISPATCH_EVENT_TYPE)
    .eq("status", "pending")
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .order("created_at", { ascending: true })
    .limit(batchSize);

  if (pullErr) {
    summary.errors.push(`event_log_pull_failed: ${pullErr.message}`);
    return summary;
  }

  const candidateEvents = (rawEvents ?? []) as EventRow[];
  if (candidateEvents.length === 0) return summary;

  // 1b. Resolve organizations.settings.ai_dispatch_mode for the batch's orgs in
  //     one query (G6-02). 'external' orgs delegate dispatch to the Vendaval
  //     runtime; the native dispatcher must leave their events untouched.
  const dispatchModeByOrg = await loadDispatchModes(candidateEvents);

  // 2. Claim each event optimistically (CAS on status='pending'). Skip when
  //    another worker already processed/claimed it in this tick.
  for (const event of candidateEvents) {
    // G6-02: skip BEFORE claim. Unlike the skipped_* outcomes below (which mark
    // the event 'done' via markEventProcessed), an 'external' org's event is
    // NOT consumed here — no claim, no status change, consumed_by intact — so
    // the external dispatcher (Vendaval) still picks it up as pending.
    if (dispatchModeByOrg.get(event.organization_id) === "external") {
      summary.outcomes.skipped_external_dispatch += 1;
      continue;
    }

    const claimed = await claimEvent(event.id);
    if (!claimed) continue;
    summary.batch_size += 1;

    try {
      const outcome = await processEvent(event);
      summary.outcomes[outcome] += 1;
    } catch (err) {
      summary.outcomes.error += 1;
      const detail = err instanceof Error ? err.message : String(err);
      summary.errors.push(`${event.id}:${detail}`);
      logger.error("[agent-dispatcher] processEvent threw", {
        event_id: event.id,
        organization_id: event.organization_id,
        error: detail,
      });
      await markEventFailed(event, detail);
    }
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Per-event pipeline
// ---------------------------------------------------------------------------

async function processEvent(event: EventRow): Promise<DispatchOutcome> {
  const admin = createAdminClient();

  const payload = event.payload ?? {};
  const orgId = String(payload.organization_id ?? event.organization_id);
  const conversationId = strOrNull(payload.conversation_id);
  const channelSessionId = strOrNull(payload.channel_session_id);
  const inboundMessageId = strOrNull(payload.inbound_message_id);

  if (!orgId || !conversationId || !channelSessionId || !inboundMessageId) {
    await markEventProcessed(event, "skipped_invalid_payload");
    return "skipped_invalid_payload";
  }

  // Org from payload must match the row's organization_id (defence-in-depth).
  if (orgId !== event.organization_id) {
    await markEventProcessed(event, "skipped_invalid_payload", {
      reason: "org_mismatch",
    });
    return "skipped_invalid_payload";
  }

  // Load the inbound message + conversation. Both filtered by org.
  const { data: messageRow } = await admin
    .from("messages")
    .select("id, body, direction, created_at, contact_id, conversation_id, organization_id")
    .eq("id", inboundMessageId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!messageRow) {
    await markEventProcessed(event, "skipped_missing_message");
    return "skipped_missing_message";
  }

  const message: DispatchMessage = {
    id: messageRow.id as string,
    body: (messageRow.body as string | null) ?? null,
    direction: messageRow.direction as string,
    created_at: messageRow.created_at as string,
  };

  const { data: convRow } = await admin
    .from("conversations")
    .select("id, organization_id, is_group, group_chat_id")
    .eq("id", conversationId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!convRow) {
    await markEventProcessed(event, "skipped_missing_message", { reason: "conv_missing" });
    return "skipped_missing_message";
  }

  const conversation: DispatchConversation = {
    id: convRow.id as string,
    is_group: (convRow.is_group as boolean | null) ?? null,
    group_chat_id: (convRow.group_chat_id as string | null) ?? null,
  };

  // Candidate agents: published, non-archived, version bound to this channel session.
  const candidates = await loadCandidates(orgId, channelSessionId);

  // Filter by trigger_config; first match wins (sort already applied).
  const matched = candidates.find((c) =>
    c.version
      ? triggerMatches({
          config: c.version.trigger_config,
          message,
          conversation,
        })
      : false,
  );

  if (!matched || !matched.version) {
    await markEventProcessed(event, "no_match");
    return "no_match";
  }

  // Concurrency pre-check: any running run for this conversation?
  const { data: running } = await admin
    .from("ai_agent_runs")
    .select("id")
    .eq("organization_id", orgId)
    .eq("conversation_id", conversationId)
    .eq("status", "running")
    .eq("is_dry_run", false)
    .limit(1)
    .maybeSingle();

  if (running) {
    await markEventProcessed(event, "conv_busy");
    return "conv_busy";
  }

  // O guard de orçamento saiu daqui junto com `./budget.ts`: ele lia
  // `ai_budgets.is_throttled/is_disabled`, flags sem escritor vivo desde que o
  // cron que as ligava foi apagado. Este módulo é `@deprecated` e a rota que o
  // acionava (`app/api/v1/cron/agent-dispatcher/route.ts`) é no-op permanente,
  // então não há teto a reimplantar aqui — quem aplica o teto é
  // `aplicarOrcamento` no seam do engine e `vetoPorTetoDeGasto` no caminho
  // legado do `ai-response-worker`.

  // Per-tenant rate limit (60/min default). Failed limit → requeue, not drop.
  const rateResult = await checkRateLimit(`ai-runs:${orgId}`, RATE_LIMIT_PER_MIN, RATE_LIMIT_WINDOW_SEC);
  if (!rateResult.allowed) {
    await requeueEvent(event, REQUEUE_DELAY_MS, {
      reason: "rate_limited",
      count: rateResult.count,
      limit: rateResult.limit,
    });
    return "rate_limited";
  }

  // Insert run row. Partial unique index covers `status='running'`; we insert
  // pending, so the index will only fire if a parallel dispatcher inserted
  // first AND the runner already promoted it to running. In that race we
  // surface as conv_busy.
  const runId = randomUUID();
  const { error: insertErr } = await admin.from("ai_agent_runs").insert({
    id: runId,
    organization_id: orgId,
    agent_id: matched.id,
    agent_version_id: matched.version.id,
    conversation_id: conversationId,
    contact_id: (messageRow.contact_id as string | null) ?? null,
    channel_session_id: channelSessionId,
    inbound_message_id: inboundMessageId,
    status: "pending",
    is_dry_run: false,
  });

  if (insertErr) {
    if (insertErr.code === "23505") {
      await markEventProcessed(event, "conv_busy", { reason: "unique_index_race" });
      return "conv_busy";
    }
    throw new Error(`ai_agent_runs_insert_failed: ${insertErr.message}`);
  }

  // Fire-and-forget the runner. Failure to reach the runner does not roll
  // back the run row — the runtime cron will retry stuck pending runs.
  await invokeRunner(runId);

  await markEventProcessed(event, "dispatched", {
    run_id: runId,
    agent_id: matched.id,
    agent_version_id: matched.version.id,
  });
  return "dispatched";
}

// ---------------------------------------------------------------------------
// Dispatch-mode resolution (G6-02)
// ---------------------------------------------------------------------------

/**
 * Resolve organizations.settings.ai_dispatch_mode for every org present in the
 * batch, in a single query. Orgs absent from the result (or with an
 * absent/invalid key) resolve to the default 'native' via the schema's
 * `.catch("native")`, i.e. they are processed as today.
 */
async function loadDispatchModes(events: EventRow[]): Promise<Map<string, string>> {
  const modes = new Map<string, string>();
  const orgIds = [...new Set(events.map((e) => e.organization_id))];
  if (orgIds.length === 0) return modes;

  const admin = createAdminClient();
  const { data, error } = await admin.from("organizations").select("id, settings").in("id", orgIds);
  if (error) {
    logger.warn("[agent-dispatcher] loadDispatchModes failed — defaulting to native", {
      error: error.message,
    });
    return modes;
  }

  for (const row of (data ?? []) as Array<{ id: string; settings: Record<string, unknown> | null }>) {
    const raw = row.settings?.ai_dispatch_mode;
    modes.set(row.id, aiDispatchModeSchema.parse(raw));
  }
  return modes;
}

// ---------------------------------------------------------------------------
// Candidate loading
// ---------------------------------------------------------------------------

async function loadCandidates(
  orgId: string,
  channelSessionId: string,
): Promise<CandidateRow[]> {
  const admin = createAdminClient();

  // Two-step join — supabase-js inner joins on FK aliases work, but the
  // database.types.ts has not been regenerated for the new ai_agents columns
  // yet, so we cast the response shape and filter by channel_session_id in
  // memory after loading published versions. Cheap because we limit the
  // candidate set to published agents per org (small N in MVP).
  const { data, error } = await admin
    .from("ai_agents")
    .select(
      "id, organization_id, priority, created_at, archived_at, published_version_id, version:ai_agent_versions!ai_agents_published_version_id_fkey(id, organization_id, status, channel_session_id, trigger_config)",
    )
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .not("published_version_id", "is", null)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    logger.warn("[agent-dispatcher] loadCandidates failed", { error: error.message, organization_id: orgId });
    return [];
  }

  const rows = (data ?? []) as unknown as Array<
    Omit<CandidateRow, "version"> & { version: VersionRow | VersionRow[] | null }
  >;

  return rows
    .map((r) => {
      const version = Array.isArray(r.version) ? r.version[0] ?? null : r.version;
      return { ...r, version } as CandidateRow;
    })
    .filter((r) => r.version && r.version.channel_session_id === channelSessionId);
}

// ---------------------------------------------------------------------------
// Event lifecycle helpers
// ---------------------------------------------------------------------------

async function claimEvent(eventId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("event_log")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", eventId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) {
    logger.warn("[agent-dispatcher] claim failed", { event_id: eventId, error: error.message });
    return false;
  }
  return Boolean(data);
}

async function markEventProcessed(
  event: EventRow,
  outcome: DispatchOutcome,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const admin = createAdminClient();
  const metadata = mergeMetadata(event.metadata, {
    outcome,
    handled_by: DISPATCHER_KEY,
    handled_at: new Date().toISOString(),
    ...extra,
  });
  const consumed = uniquePush(event.consumed_by, DISPATCHER_KEY);
  const { error } = await admin
    .from("event_log")
    .update({
      status: "done",
      metadata,
      consumed_by: consumed,
      updated_at: new Date().toISOString(),
    })
    .eq("id", event.id);
  if (error) {
    logger.warn("[agent-dispatcher] markEventProcessed failed", {
      event_id: event.id,
      outcome,
      error: error.message,
    });
  }
}

async function requeueEvent(
  event: EventRow,
  delayMs: number,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const admin = createAdminClient();
  const nextAttemptAt = new Date(Date.now() + delayMs).toISOString();
  const metadata = mergeMetadata(event.metadata, {
    last_requeue: { ...extra, requeued_at: new Date().toISOString() },
  });
  const { error } = await admin
    .from("event_log")
    .update({
      status: "pending",
      attempts: (event.attempts ?? 0) + 1,
      next_attempt_at: nextAttemptAt,
      metadata,
      updated_at: new Date().toISOString(),
    })
    .eq("id", event.id);
  if (error) {
    logger.warn("[agent-dispatcher] requeueEvent failed", {
      event_id: event.id,
      error: error.message,
    });
  }
}

async function markEventFailed(event: EventRow, detail: string): Promise<void> {
  const admin = createAdminClient();
  const metadata = mergeMetadata(event.metadata, {
    outcome: "error",
    handled_by: DISPATCHER_KEY,
    handled_at: new Date().toISOString(),
  });
  const { error } = await admin
    .from("event_log")
    .update({
      status: "dead",
      last_error: detail.slice(0, 500),
      metadata,
      updated_at: new Date().toISOString(),
    })
    .eq("id", event.id);
  if (error) {
    logger.warn("[agent-dispatcher] markEventFailed failed", {
      event_id: event.id,
      error: error.message,
    });
  }
}

function mergeMetadata(
  current: Record<string, unknown> | null,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...(current ?? {}), ...patch };
}

function uniquePush(arr: string[] | null | undefined, value: string): string[] {
  const list = Array.isArray(arr) ? arr.slice() : [];
  if (!list.includes(value)) list.push(value);
  return list;
}

function strOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ---------------------------------------------------------------------------
// Runner invocation (fire-and-forget)
// ---------------------------------------------------------------------------

async function invokeRunner(runId: string): Promise<void> {
  const secret = env.INTERNAL_SECRET;
  if (!secret) {
    logger.warn("[agent-dispatcher] INTERNAL_SECRET missing — runner not invoked", { run_id: runId });
    return;
  }
  const baseUrl = env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const url = `${baseUrl.replace(/\/$/, "")}/api/internal/agents/run`;

  // Fire-and-forget: do not await the response. Best-effort logging only.
  void fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-secret": secret,
    },
    body: JSON.stringify({ run_id: runId }),
  }).catch((err) => {
    logger.warn("[agent-dispatcher] runner invoke failed", {
      run_id: runId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
