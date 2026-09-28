# Webhooks Universais + Motor de Regras — Plano de Implementação (Parte 1: Backend)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Porta de entrada pública de leads (`POST /api/v1/webhooks/in/[token]`) + mini motor de regras gatilho→condições→ações sobre o `event_log`, com drain genérico, 5 ações (incl. WhatsApp com anti-banimento e webhook outbound) e APIs de gestão.

**Architecture:** Tudo sobre o `event_log` existente (Abordagem A da spec `docs/superpowers/specs/2026-07-17-webhooks-design.md`). Inbound cria lead via `createLeadHandler` (que já emite `lead.created`); um cron drain genérico novo drena eventos pendentes para o registry `lib/event-log/dispatcher.ts`; o motor de regras é um `EventHandler` registrado nesse registry; outbound é uma ação do motor.

**Tech Stack:** Next.js 15 App Router (route handlers), Supabase (Postgres + RLS), Zod, Vitest, TypeScript estrito.

## Global Constraints (valem para TODAS as tasks)

- Toda tabela nova: `organization_id uuid not null references organizations(id) on delete cascade` + RLS.
- Schema: migration versionada `supabase/migrations/<ts>_0038_webhooks_automation.sql` **+** apêndice idempotente no fim de `supabase/baseline.sql` **+** linha no `supabase/migrations/MANIFEST.md`. Nunca `ALTER` solto no banco.
- Rotas API: wrappers `ok()`/`fail()` de `lib/api/wrappers.ts`; Zod em TODO input externo; `X-Request-Id` (os wrappers já setam); audit em toda mutação via `audit()` de `lib/audit`.
- Service role (admin client) em handler ⇒ filtrar `organization_id` manualmente, resolvido de fonte confiável (path token / cookie), **nunca do body**.
- `type` discriminador em coluna = `text` + `check`, não enum. Dinheiro não se aplica aqui.
- Sem `console.log` novo — usar `logger` de `@/lib/logger` (exceção: os handlers existentes usam `console.error` em fire-and-forget de `emit_event`; siga o padrão local do arquivo que estiver editando).
- Trigger Postgres NUNCA faz HTTP. Side effect = `event_log` + worker.
- Rodar sempre ao final de cada task: `npm run typecheck` e `npm run lint` (zerados).
- Testes de invariante rodam com `npx vitest run tests/invariants/<arquivo> --config vitest.invariants.config.ts` se esse config existir; senão `npx vitest run tests/invariants/<arquivo>`. Olhe como `tests/invariants/gov-7-tags.test.ts` é invocado no CI (`.github/workflows/`) e use o mesmo comando.
- Commits: 1 commit atômico por task, mensagem `feat(webhooks): <slug da task>`.
- Branch de trabalho: criar `feat/webhooks-automation` a partir de `main` atualizada (NÃO trabalhar em `gov/G4`). Se `main` local estiver atrás do remoto, `git fetch origin && git checkout -b feat/webhooks-automation origin/main`.

**Eventos-gatilho v1 (contrato congelado):** `lead.created`, `lead.stage_changed`, `message.received`, `lead.tag_added`, `contact.tag_added`.
**Ações v1 (contrato congelado):** `create_or_move_lead`, `send_whatsapp_message`, `add_tag`, `assign_owner`, `call_webhook`.

---

### Task 1: Migration 0038 — tabelas, RLS, baseline, MANIFEST, types

**Files:**
- Create: `supabase/migrations/<YYYYMMDDHHMMSS-de-hoje>_0038_webhooks_automation.sql`
- Modify: `supabase/baseline.sql` (apêndice no fim do arquivo)
- Modify: `supabase/migrations/MANIFEST.md` (linha nova na tabela Applied)
- Modify: `lib/database.types.ts` (regenerar)
- Test: `tests/invariants/webhooks-rls.test.ts`

**Interfaces:**
- Consumes: `fn_user_org_ids()`, `fn_is_platform_admin()`, `fn_role_at_least(org, role)` (já existem no schema).
- Produces: tabelas `webhook_sources`, `automation_rules`, `automation_rule_runs` com as colunas EXATAS abaixo — todas as tasks seguintes dependem desses nomes.

- [ ] **Step 1: Escrever a migration**

Antes de escrever, confira em `supabase/baseline.sql` o alvo do FK de `crm_leads.created_by_user_id` (busque `created_by_user_id` na definição de `crm_leads`); use o MESMO alvo (ou nenhum FK, se lá não houver) para os `created_by_user_id` abaixo. Conteúdo da migration:

```sql
-- 0038: webhooks universais + mini motor de regras
-- Spec: docs/superpowers/specs/2026-07-17-webhooks-design.md
-- Idempotente e portável em psql puro (sem BEGIN/COMMIT — o runner envolve).

create table if not exists public.webhook_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  path_token text not null unique,
  secret text,
  kind text not null default 'lead_capture' check (kind in ('lead_capture')),
  default_pipeline_id uuid not null references public.crm_pipelines(id) on delete cascade,
  default_stage_id uuid not null references public.crm_stages(id) on delete cascade,
  field_map jsonb not null default '{}'::jsonb,
  redirect_to text,
  is_active boolean not null default true,
  last_received_at timestamptz,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  trigger_event text not null
    check (trigger_event ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  conditions jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  is_active boolean not null default false,
  last_run_at timestamptz,
  run_count integer not null default 0,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_automation_rules_org_trigger
  on public.automation_rules (organization_id, trigger_event)
  where is_active;

create table if not exists public.automation_rule_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rule_id uuid not null references public.automation_rules(id) on delete cascade,
  event_id uuid references public.event_log(id) on delete set null,
  status text not null check (status in ('success', 'partial', 'failed')),
  actions_result jsonb not null default '[]'::jsonb,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_automation_rule_runs_org_created
  on public.automation_rule_runs (organization_id, created_at desc);
create index if not exists idx_automation_rule_runs_rule
  on public.automation_rule_runs (rule_id, created_at desc);

alter table public.webhook_sources enable row level security;
alter table public.automation_rules enable row level security;
alter table public.automation_rule_runs enable row level security;

-- Padrão da migration 0030 (config tables): select p/ membro da org ou
-- platform admin; write manager+. Runs: só select (escrita é service_role,
-- que bypassa RLS; authenticated sem policy de write = negado por default).

drop policy if exists "webhook_sources_select" on public.webhook_sources;
drop policy if exists "webhook_sources_manager_write" on public.webhook_sources;

create policy "webhook_sources_select" on public.webhook_sources
  for select using (
    (organization_id in (select public.fn_user_org_ids()))
    or public.fn_is_platform_admin()
  );

create policy "webhook_sources_manager_write" on public.webhook_sources
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists "automation_rules_select" on public.automation_rules;
drop policy if exists "automation_rules_manager_write" on public.automation_rules;

create policy "automation_rules_select" on public.automation_rules
  for select using (
    (organization_id in (select public.fn_user_org_ids()))
    or public.fn_is_platform_admin()
  );

create policy "automation_rules_manager_write" on public.automation_rules
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists "automation_rule_runs_select" on public.automation_rule_runs;

create policy "automation_rule_runs_select" on public.automation_rule_runs
  for select using (
    (organization_id in (select public.fn_user_org_ids()))
    or public.fn_is_platform_admin()
  );
```

- [ ] **Step 2: Aplicar a migration no banco de dev**

Use o MCP do Supabase: `mcp__plugin_supabase_supabase__apply_migration` com o nome `0038_webhooks_automation` e o SQL acima (ou `supabase db push` se preferir a CLI). Capture o output.
Expected: sucesso sem erro; `select count(*) from webhook_sources` retorna 0.

- [ ] **Step 3: Apêndice no baseline.sql**

Abra `supabase/baseline.sql`, vá ao FIM do arquivo (após o bloco `-- ---- métricas por responsável ... (migration 0037) ----`) e cole o MESMO SQL do Step 1, precedido do cabeçalho:

```sql
-- ---- webhooks universais + motor de regras (migration 0038) ----
-- Spec: docs/superpowers/specs/2026-07-17-webhooks-design.md. Idempotente
-- (create if not exists / drop policy if exists) — auto-curativo no update.sh.
```

- [ ] **Step 4: Linha no MANIFEST.md**

Adicionar na tabela Applied de `supabase/migrations/MANIFEST.md`, seguindo o formato das linhas existentes (versão | nome | descrição):

```
| `<timestamp usado>` | `0038_webhooks_automation` | Webhooks universais + mini motor de regras (spec docs/superpowers/specs/2026-07-17-webhooks-design.md): `webhook_sources` (fontes de captação inbound, path_token único, field_map jsonb, pipeline/stage default), `automation_rules` (trigger_event + conditions jsonb AND + actions jsonb ordenadas, is_active default FALSE — regra nasce pausada), `automation_rule_runs` (1 linha por execução, actions_result jsonb, alimenta a UI de Atividade). RLS padrão 0030: select membro-da-org/platform-admin; write manager+ nas duas tabelas de config; runs é select-only (escrita via service_role). Índice parcial `idx_automation_rules_org_trigger` WHERE is_active p/ o hot path do motor. |
```

- [ ] **Step 5: Regenerar database.types.ts**

Use `mcp__plugin_supabase_supabase__generate_typescript_types` (ou `supabase gen types typescript --linked > lib/database.types.ts`) e confirme que `webhook_sources`, `automation_rules`, `automation_rule_runs` aparecem no arquivo.
Run: `npm run typecheck`
Expected: zerado.

- [ ] **Step 6: Escrever teste de invariante RLS (2 tenants, não-vazamento)**

`tests/invariants/webhooks-rls.test.ts` — siga a estrutura de `tests/invariants/gov-7-tags.test.ts` e os helpers de `tests/invariants/gov-helpers.ts` (leia ambos antes; eles criam orgs/users de teste e clients autenticados). O teste deve:

```ts
// Estrutura (adapte às assinaturas reais de gov-helpers.ts):
// 1. setup: 2 orgs (A e B), 1 manager em A, 1 agent em A, 1 manager em B.
// 2. manager A cria webhook_source e automation_rule na org A (insert direto
//    com client autenticado do manager A).
// 3. ASSERT: manager B lista webhook_sources/automation_rules → 0 linhas.
// 4. ASSERT: agent A tenta INSERT em webhook_sources → erro RLS (write é manager+).
// 5. ASSERT: manager A lê as próprias linhas → 1 linha cada.
// 6. service_role insere automation_rule_runs na org A;
//    ASSERT: manager B lista runs → 0; manager A lista → 1.
// 7. ASSERT: manager A tenta INSERT direto em automation_rule_runs → erro RLS
//    (runs é select-only para authenticated).
```

- [ ] **Step 7: Rodar o teste de invariante**

Run: comando de invariantes do repo (ver Global Constraints) apontando para `tests/invariants/webhooks-rls.test.ts`
Expected: PASS em todas as assertions.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/*0038* supabase/baseline.sql supabase/migrations/MANIFEST.md lib/database.types.ts tests/invariants/webhooks-rls.test.ts
git commit -m "feat(webhooks): migration 0038 — webhook_sources, automation_rules, rule_runs + RLS"
```

---

### Task 2: Drain genérico do event_log + extensão `retry` do HandlerResult

**Files:**
- Create: `lib/event-log/drain.ts`
- Create: `app/api/v1/cron/event-log-drain/route.ts`
- Modify: `lib/event-log/dispatcher.ts` (adicionar status `"retry"` + `retry_at` ao `HandlerResult`)
- Modify: `vercel.ts` (cron novo)
- Test: `tests/invariants/event-log-drain.test.ts`

**Interfaces:**
- Consumes: `dispatchEvent(row): Promise<HandlerResult[]>`, `getRegisteredHandlers()`, `ensureHandlersRegistered()` de `lib/event-log/*`; `createAdminClient()` de `@/lib/supabase/admin`.
- Produces: `drainEventLog(admin, opts?): Promise<DrainSummary>` com `DrainSummary = { scanned: number; done: number; retried: number; failed: number; dead: number }`. Task 9 (throttle) depende do contrato `retry`: handler retorna `{ consumer_key, status: "retry", retry_at: string }` ⇒ drain mantém o evento `pending` com `next_attempt_at = retry_at` **sem** incrementar `attempts`.

- [ ] **Step 1: Estender HandlerResult em `lib/event-log/dispatcher.ts`**

```ts
export interface HandlerResult {
  /** Stable key to push into `event_log.consumed_by`. */
  consumer_key: string;
  status: "ok" | "skipped" | "error" | "retry";
  /** ISO timestamp — obrigatório quando status="retry"; drain reagenda sem contar attempt. */
  retry_at?: string;
  detail?: string;
}
```

(Alteração aditiva — handlers existentes seguem compilando.)

- [ ] **Step 2: Escrever o teste do drain (falhando)**

`tests/invariants/event-log-drain.test.ts` — usa admin client (service_role) e um handler fake registrado no registry. Cobre a matriz de estados:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { registerHandler, type EventRow, type HandlerResult } from "@/lib/event-log/dispatcher";
import { drainEventLog } from "@/lib/event-log/drain";
// + helper de admin client / org de teste, seguindo gov-helpers.ts

// Handler fake controlável por payload.mode:
let calls: string[] = [];
registerHandler({
  key: "test-drain-handler",
  events: ["test.drain_case"],
  async handle(row: EventRow): Promise<HandlerResult> {
    calls.push(row.id);
    const mode = String(row.payload.mode ?? "ok");
    if (mode === "error") return { consumer_key: "test-drain-handler", status: "error", detail: "boom" };
    if (mode === "retry")
      return { consumer_key: "test-drain-handler", status: "retry", retry_at: new Date(Date.now() + 3600_000).toISOString() };
    return { consumer_key: "test-drain-handler", status: "ok" };
  },
});

// Casos (inserir eventos via rpc emit_event com event_type 'test.drain_case'
// e depois UPDATE payload/attempts direto via admin p/ montar o cenário):
// 1. mode=ok      → após drain: status='done', consumed_by contém a key.
// 2. mode=error   → após drain: status='pending', attempts=1, next_attempt_at > now (backoff).
// 3. mode=error com attempts=4 pré-setado → após drain: status='dead', last_error='boom'.
// 4. mode=retry   → após drain: status='pending', attempts INALTERADO (0), next_attempt_at ≈ +1h.
// 5. evento de tipo SEM handler registrado (ex. 'test.no_handler') →
//    NÃO é tocado pelo drain (status segue 'pending'): o drain só seleciona
//    event_types com handler registrado (protege ai_agent.dispatch_requested,
//    que é drenado pelo cron agent-dispatcher próprio).
// 6. next_attempt_at no futuro → não é processado neste tick.
```

- [ ] **Step 3: Rodar o teste — deve falhar** (módulo `drain.ts` não existe)

- [ ] **Step 4: Implementar `lib/event-log/drain.ts`**

```ts
/**
 * Cron driver genérico do event_log — a peça prometida em dispatcher.ts.
 *
 * Seleciona SÓ event_types com handler registrado: tipos drenados por crons
 * dedicados (ex. ai_agent.dispatch_requested → agent-dispatcher) não têm
 * handler no registry e ficam intocados.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  dispatchEvent,
  getRegisteredHandlers,
  type EventRow,
} from "@/lib/event-log/dispatcher";
import { logger } from "@/lib/logger";

const MAX_ATTEMPTS = 5;

export interface DrainSummary {
  scanned: number;
  done: number;
  retried: number;
  failed: number;
  dead: number;
}

function backoffAt(attempts: number): string {
  // 1min, 2min, 4min, 8min... (2^n minutos)
  const minutes = Math.pow(2, attempts);
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export async function drainEventLog(
  admin: SupabaseClient,
  opts: { limit?: number } = {},
): Promise<DrainSummary> {
  const limit = opts.limit ?? 50;
  const summary: DrainSummary = { scanned: 0, done: 0, retried: 0, failed: 0, dead: 0 };

  const handledTypes = [...new Set(getRegisteredHandlers().flatMap((h) => h.events))];
  if (!handledTypes.length) return summary;

  const { data: rows, error } = await admin
    .from("event_log")
    .select("id, organization_id, event_type, entity_kind, entity_id, payload, metadata, consumed_by, attempts")
    .eq("status", "pending")
    .lte("next_attempt_at", new Date().toISOString())
    .in("event_type", handledTypes)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    logger.error("[event-log.drain] select failed", { error: error.message });
    return summary;
  }

  for (const raw of rows ?? []) {
    const row = raw as unknown as EventRow;
    summary.scanned += 1;

    // Claim otimista — outra instância pode ter pego a mesma linha.
    const { data: claimed } = await admin
      .from("event_log")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id");
    if (!claimed?.length) continue;

    const results = await dispatchEvent(row);

    const okKeys = results.filter((r) => r.status === "ok" || r.status === "skipped").map((r) => r.consumer_key);
    const consumedBy = [...new Set([...row.consumed_by, ...okKeys])];
    const retry = results.find((r) => r.status === "retry");
    const errors = results.filter((r) => r.status === "error");

    if (retry) {
      // Reagendamento benigno (ex. janela anti-ban): NÃO conta attempt.
      await admin
        .from("event_log")
        .update({ status: "pending", consumed_by: consumedBy, next_attempt_at: retry.retry_at, updated_at: new Date().toISOString() })
        .eq("id", row.id);
      summary.retried += 1;
    } else if (errors.length) {
      const attempts = row.attempts + 1;
      const dead = attempts >= MAX_ATTEMPTS;
      await admin
        .from("event_log")
        .update({
          status: dead ? "dead" : "pending",
          attempts,
          consumed_by: consumedBy,
          last_error: errors.map((e) => `${e.consumer_key}: ${e.detail ?? "error"}`).join("; "),
          next_attempt_at: dead ? null : backoffAt(attempts),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      summary[dead ? "dead" : "failed"] += 1;
    } else {
      await admin
        .from("event_log")
        .update({ status: "done", consumed_by: consumedBy, updated_at: new Date().toISOString() })
        .eq("id", row.id);
      summary.done += 1;
    }
  }
  return summary;
}
```

Nota: confira no `supabase/baseline.sql:1535` se `event_log.next_attempt_at` aceita null; se for `not null`, troque o `null` do caso `dead` por manter o valor atual (remova a chave do update).

- [ ] **Step 5: Implementar a rota cron**

`app/api/v1/cron/event-log-drain/route.ts` — copie a estrutura de auth de `app/api/v1/cron/agent-dispatcher/route.ts` (Bearer `INTERNAL_CRON_SECRET` ou `INTERNAL_SECRET`, alias `x-cron-secret`), trocando o miolo:

```ts
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { drainEventLog } from "@/lib/event-log/drain";
import { ensureHandlersRegistered } from "@/lib/event-log/register-handlers";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  // [auth idêntica à do agent-dispatcher — copiar bloco inteiro]
  ensureHandlersRegistered();
  try {
    const summary = await drainEventLog(createAdminClient());
    return ok(summary, { requestId });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error("[event-log-drain.cron] threw", { error: detail, requestId });
    return fail("internal_error", detail, 500, { requestId });
  }
}
export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
```

- [ ] **Step 6: Cron no `vercel.ts`**

Adicionar ao array `crons`:

```ts
    // Webhooks/automação: drain genérico do event_log (spec 2026-07-17).
    { path: "/api/v1/cron/event-log-drain", schedule: "*/1 * * * *" },
```

- [ ] **Step 7: Rodar o teste do drain — PASS.** Depois `npm run typecheck && npm run lint`.

- [ ] **Step 8: Commit**

```bash
git add lib/event-log/ app/api/v1/cron/event-log-drain/ vercel.ts tests/invariants/event-log-drain.test.ts
git commit -m "feat(webhooks): drain genérico do event_log + status retry no HandlerResult"
```

---

### Task 3: Emissões de gatilho faltantes nos fluxos existentes

**Files:**
- Modify: `app/api/v1/leads/_handler.ts` (`moveLeadHandler` — emitir `lead.stage_changed`; `updateLeadHandler` — emitir `lead.tag_added`)
- Modify: `app/api/v1/contacts/_handler.ts` (`patchContactHandler` — emitir `contact.tag_added`)
- Modify: `lib/waha/ingest.ts` (`handleInbound` — emitir `message.received`)
- Test: `tests/invariants/webhooks-trigger-events.test.ts`

**Interfaces:**
- Produces (contrato de payload consumido pelo motor na Task 7):
  - `lead.stage_changed`: entity `crm_lead`, payload `{ pipeline_id, from_stage_id, to_stage_id }`
  - `lead.tag_added`: entity `crm_lead`, payload `{ added_tags: string[], tags: string[] }`
  - `contact.tag_added`: entity `contact`, payload `{ added_tags: string[], tags: string[] }`
  - `message.received`: entity `message`, payload `{ conversation_id, contact_id, channel_session_id, body_preview }`

- [ ] **Step 1: Teste falhando**

`tests/invariants/webhooks-trigger-events.test.ts` (admin client + org de teste via padrão gov-helpers):

```ts
// 1. Cria pipeline com 2 stages + lead no stage 1 (inserts diretos via admin).
// 2. Chama moveLeadHandler(admin, ctx, leadId, { to_stage_id: stage2 }).
//    ASSERT: event_log tem linha event_type='lead.stage_changed' com
//    payload.from_stage_id=stage1, payload.to_stage_id=stage2.
// 3. Chama updateLeadHandler(..., { tags: ["vip"] }) num lead com tags=[].
//    ASSERT: linha 'lead.tag_added' com payload.added_tags=["vip"].
// 4. Chama updateLeadHandler(..., { tags: ["vip"] }) de novo (sem tag nova).
//    ASSERT: NENHUMA linha 'lead.tag_added' nova (só emite quando added_tags
//    é não-vazio).
// 5. Chama patchContactHandler(..., { tags: ["cliente"] }) num contato sem tags.
//    ASSERT: linha 'contact.tag_added' com added_tags=["cliente"].
```

- [ ] **Step 2: Rodar — FAIL** (eventos não existem).

- [ ] **Step 3: Implementar as emissões**

Em `moveLeadHandler` (`app/api/v1/leads/_handler.ts`, após o update bem-sucedido, ao lado do audit existente — siga o padrão fire-and-forget de `emit_event` já usado no `createLeadHandler` do MESMO arquivo):

```ts
  await supabase
    .rpc("emit_event", {
      p_event_type: "lead.stage_changed",
      p_entity_kind: "crm_lead",
      p_entity_id: leadId,
      p_payload: {
        pipeline_id: lead.pipeline_id,
        from_stage_id: lead.stage_id,
        to_stage_id: input.to_stage_id,
      },
      p_metadata: { request_id: ctx.requestId, ...a.metadataActor },
      p_organization_id: ctx.organization_id,
    })
    .then(({ error }) => {
      if (error) console.error("[lead.move] emit_event failed", error.message);
    });
```

(Se `moveLeadHandler` não tiver `const a = actorAuditPayload(ctx.actor)` no escopo, adicione antes.)

Em `updateLeadHandler`, ANTES do update, capture as tags atuais (o select inicial pega só `id, organization_id` — amplie para `id, organization_id, tags`); DEPOIS do update bem-sucedido:

```ts
  if (input.tags !== undefined) {
    const prevTags: string[] = (existing as { tags?: string[] }).tags ?? [];
    const addedTags = input.tags.filter((t) => !prevTags.includes(t));
    if (addedTags.length) {
      await supabase
        .rpc("emit_event", {
          p_event_type: "lead.tag_added",
          p_entity_kind: "crm_lead",
          p_entity_id: leadId,
          p_payload: { added_tags: addedTags, tags: input.tags },
          p_metadata: { request_id: ctx.requestId, ...a.metadataActor },
          p_organization_id: existing.organization_id,
        })
        .then(({ error }) => {
          if (error) console.error("[lead.update] emit_event failed", error.message);
        });
    }
  }
```

Em `patchContactHandler` (`app/api/v1/contacts/_handler.ts`): amplie o select inicial para incluir `tags`, e após o update aplique o MESMO padrão acima com `p_event_type: "contact.tag_added"`, `p_entity_kind: "contact"`, `p_entity_id: contactId`. Esse handler não tem `actorAuditPayload` — use `p_metadata: { request_id: ctx.requestId }`.

Em `handleInbound` (`lib/waha/ingest.ts`), logo APÓS o bloco existente que emite `ai_agent.dispatch_requested` (dentro do mesmo `if (insertedMessage?.id)`), adicione uma segunda emissão no mesmo padrão `admin.rpc("emit_event" as never, {...})`:

```ts
    admin
      .rpc("emit_event" as never, {
        p_event_type: "message.received",
        p_entity_kind: "message",
        p_entity_id: inboundMessageId,
        p_payload: {
          conversation_id: conversationId,
          contact_id: contactId,
          channel_session_id: session.id,
          body_preview: (p.body ?? "").slice(0, 280),
        },
        p_metadata: { source: "waha_webhook", request_id: requestId },
        p_organization_id: session.organization_id,
      } as never)
      .then(({ error }) => {
        if (error) console.error("[waha.ingest] emit message.received failed", error.message);
      });
```

- [ ] **Step 4: Rodar o teste — PASS.** `npm run typecheck && npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/leads/_handler.ts app/api/v1/contacts/_handler.ts lib/waha/ingest.ts tests/invariants/webhooks-trigger-events.test.ts
git commit -m "feat(webhooks): emite lead.stage_changed, lead/contact.tag_added e message.received"
```

---

### Task 4: Actor `webhook_source` + passthrough de custom_fields/source_metadata no createLeadHandler

**Files:**
- Modify: `lib/api/handlers/types.ts` (union `Actor`)
- Modify: `app/api/v1/leads/_handler.ts` (`actorAuditPayload` + insert do `createLeadHandler`)
- Test: `lib/schemas/leads.test.ts` NÃO muda (o Zod REST continua server-managed); teste via `tests/invariants/webhooks-inbound.test.ts` da Task 6 — aqui só typecheck.

**Interfaces:**
- Produces: `Actor` ganha variante `{ type: "webhook_source"; id: string }` (id = `webhook_sources.id`). `createLeadHandler` passa a aceitar, além de `CreateLeadInput`, os opcionais `custom_fields?: Record<string, unknown>` e `source_metadata?: Record<string, unknown>` (tipados como interseção no parâmetro, sem mudar o schema Zod REST — o REST continua não aceitando esses campos).

- [ ] **Step 1: Estender o Actor** em `lib/api/handlers/types.ts`:

```ts
export type Actor =
  | { type: "user"; id: string; role?: string }
  | { type: "ai_agent"; id: string; role: string; api_token_id?: string }
  | { type: "webhook_source"; id: string };
```

- [ ] **Step 2: Atualizar `actorAuditPayload`** em `app/api/v1/leads/_handler.ts`:

```ts
function actorAuditPayload(actor: Actor): {
  actorUserId: string | null;
  metadataActor: Record<string, unknown>;
} {
  if (actor.type === "user") {
    return { actorUserId: actor.id, metadataActor: { actor_type: "user" } };
  }
  if (actor.type === "webhook_source") {
    return {
      actorUserId: null,
      metadataActor: { actor_type: "webhook_source", actor_id: actor.id },
    };
  }
  return {
    actorUserId: null,
    metadataActor: {
      actor_type: "ai_agent",
      actor_id: actor.id,
      ...(actor.api_token_id ? { actor_api_token_id: actor.api_token_id } : {}),
    },
  };
}
```

Busque com Grep por outros `switch`/`if` sobre `actor.type` no repo (`grep -rn "actor.type" app/ lib/`) e confirme que nenhum quebra com a variante nova (TypeScript acusa no typecheck os casos não-exaustivos).

- [ ] **Step 3: Passthrough no insert do `createLeadHandler`** — assinatura e insert:

```ts
export async function createLeadHandler(
  supabase: SB,
  ctx: HandlerCtx,
  input: CreateLeadInput & {
    custom_fields?: Record<string, unknown>;
    source_metadata?: Record<string, unknown>;
  },
): Promise<Record<string, unknown>> {
```

e no objeto do `.insert({...})` troque as duas linhas fixas:

```ts
      source_metadata: input.source_metadata ?? {},
      custom_fields: input.custom_fields ?? {},
```

- [ ] **Step 4:** Run: `npm run typecheck && npm run lint && npx vitest run lib/schemas/leads.test.ts`
Expected: tudo zerado/PASS (comportamento REST inalterado).

- [ ] **Step 5: Commit**

```bash
git add lib/api/handlers/types.ts app/api/v1/leads/_handler.ts
git commit -m "feat(webhooks): actor webhook_source + custom_fields/source_metadata no createLeadHandler"
```

---

### Task 5: `lib/webhooks/inbound.ts` — field_map, telefone E.164, assinatura HMAC

**Files:**
- Create: `lib/webhooks/inbound.ts`
- Test: `lib/webhooks/inbound.test.ts`

**Interfaces:**
- Produces (consumido pela rota da Task 6):

```ts
export interface FieldMap { name?: string[]; phone?: string[]; email?: string[] }
export interface MappedLead {
  name: string | null;
  phone: string | null;        // E.164 ou null
  email: string | null;
  custom_fields: Record<string, string>;   // campos extras do payload
  source_metadata: Record<string, string>; // utm_* + _meta do request
}
export function mapInboundPayload(payload: Record<string, unknown>, fieldMap?: FieldMap): MappedLead;
export function normalizePhoneBR(raw: unknown): string | null;
export function verifyInboundSignature(rawBody: string, header: string | null, secret: string): boolean;
```

- [ ] **Step 1: Teste falhando** — `lib/webhooks/inbound.test.ts` (Vitest puro, sem DB):

```ts
import { describe, it, expect } from "vitest";
import { mapInboundPayload, normalizePhoneBR, verifyInboundSignature } from "@/lib/webhooks/inbound";
import { createHmac } from "node:crypto";

describe("normalizePhoneBR", () => {
  it("já em E.164 passa direto", () => expect(normalizePhoneBR("+5511998765432")).toBe("+5511998765432"));
  it("DDD+numero BR ganha +55", () => expect(normalizePhoneBR("11 99876-5432")).toBe("+5511998765432"));
  it("com 55 na frente sem +", () => expect(normalizePhoneBR("5511998765432")).toBe("+5511998765432"));
  it("fixo BR 10 dígitos", () => expect(normalizePhoneBR("1133334444")).toBe("+551133334444"));
  it("lixo → null", () => expect(normalizePhoneBR("abc")).toBeNull());
  it("vazio/não-string → null", () => {
    expect(normalizePhoneBR("")).toBeNull();
    expect(normalizePhoneBR(42 as unknown)).toBeNull();
  });
});

describe("mapInboundPayload", () => {
  it("aliases default: nome/telefone/email", () => {
    const m = mapInboundPayload({ nome: "Ana", telefone: "11998765432", email: "a@b.com" });
    expect(m).toMatchObject({ name: "Ana", phone: "+5511998765432", email: "a@b.com" });
  });
  it("whatsapp como alias de phone; extras viram custom_fields; utm_* vira source_metadata", () => {
    const m = mapInboundPayload({ name: "Bo", whatsapp: "+5511998765432", empresa: "ACME", utm_source: "instagram" });
    expect(m.phone).toBe("+5511998765432");
    expect(m.custom_fields).toEqual({ empresa: "ACME" });
    expect(m.source_metadata).toEqual({ utm_source: "instagram" });
  });
  it("field_map custom tem precedência sobre defaults", () => {
    const m = mapInboundPayload({ contato: "Zé" }, { name: ["contato"] });
    expect(m.name).toBe("Zé");
  });
  it("payload sem nada mapeável → tudo null e extras preservados", () => {
    const m = mapInboundPayload({ foo: "bar" });
    expect(m.name).toBeNull();
    expect(m.phone).toBeNull();
    expect(m.custom_fields).toEqual({ foo: "bar" });
  });
  it("valores não-string são stringificados em custom_fields; objetos aninhados descartados", () => {
    const m = mapInboundPayload({ nome: "Ana", idade: 30, nested: { a: 1 } });
    expect(m.custom_fields).toEqual({ idade: "30" });
  });
});

describe("verifyInboundSignature", () => {
  const body = '{"nome":"Ana"}';
  const secret = "s3cr3t";
  const sig = createHmac("sha256", secret).update(body).digest("hex");
  it("assinatura válida", () => expect(verifyInboundSignature(body, sig, secret)).toBe(true));
  it("assinatura errada", () => expect(verifyInboundSignature(body, "deadbeef", secret)).toBe(false));
  it("header ausente", () => expect(verifyInboundSignature(body, null, secret)).toBe(false));
  it("header com tamanho diferente não lança (timingSafeEqual exige mesmo length)", () =>
    expect(verifyInboundSignature(body, "abc", secret)).toBe(false));
});
```

- [ ] **Step 2: Rodar — FAIL.** Run: `npx vitest run lib/webhooks/inbound.test.ts`

- [ ] **Step 3: Implementar `lib/webhooks/inbound.ts`**

```ts
/**
 * Parsing do inbound de captação: field_map → lead normalizado + HMAC.
 * Sem I/O — puro, testável. A rota (webhooks/in/[token]) faz o resto.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface FieldMap {
  name?: string[];
  phone?: string[];
  email?: string[];
}

const DEFAULT_FIELD_MAP: Required<FieldMap> = {
  name: ["name", "nome", "full_name", "fullname"],
  phone: ["phone", "telefone", "whatsapp", "celular", "phone_number", "tel"],
  email: ["email", "e-mail", "mail"],
};

export interface MappedLead {
  name: string | null;
  phone: string | null;
  email: string | null;
  custom_fields: Record<string, string>;
  source_metadata: Record<string, string>;
}

/** Normaliza telefone BR para E.164. ponytail: heurística BR-only (público-alvo); internacional entra quando houver demanda. */
export function normalizePhoneBR(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const digits = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+")) {
    return /^\d{8,15}$/.test(digits) ? `+${digits}` : null;
  }
  if (digits.length === 12 || digits.length === 13) {
    // 55 + DDD + numero
    return digits.startsWith("55") ? `+${digits}` : null;
  }
  if (digits.length === 10 || digits.length === 11) {
    // DDD + numero (fixo ou celular)
    return `+55${digits}`;
  }
  return null;
}

function firstMatch(payload: Record<string, unknown>, aliases: string[]): { key: string; value: string } | null {
  const lowered = new Map(Object.keys(payload).map((k) => [k.toLowerCase(), k]));
  for (const alias of aliases) {
    const key = lowered.get(alias.toLowerCase());
    if (key !== undefined) {
      const v = payload[key];
      if (typeof v === "string" && v.trim()) return { key, value: v.trim() };
    }
  }
  return null;
}

export function mapInboundPayload(
  payload: Record<string, unknown>,
  fieldMap: FieldMap = {},
): MappedLead {
  const map: Required<FieldMap> = {
    name: [...(fieldMap.name ?? []), ...DEFAULT_FIELD_MAP.name],
    phone: [...(fieldMap.phone ?? []), ...DEFAULT_FIELD_MAP.phone],
    email: [...(fieldMap.email ?? []), ...DEFAULT_FIELD_MAP.email],
  };

  const nameHit = firstMatch(payload, map.name);
  const phoneHit = firstMatch(payload, map.phone);
  const emailHit = firstMatch(payload, map.email);
  const consumed = new Set([nameHit?.key, phoneHit?.key, emailHit?.key].filter(Boolean));

  const custom_fields: Record<string, string> = {};
  const source_metadata: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (consumed.has(key)) continue;
    const str =
      typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : null;
    if (str === null) continue; // objetos/arrays aninhados: descartados no v1
    if (key.toLowerCase().startsWith("utm_")) source_metadata[key.toLowerCase()] = str;
    else custom_fields[key] = str;
  }

  return {
    name: nameHit?.value ?? null,
    phone: normalizePhoneBR(phoneHit?.value),
    email: emailHit?.value ?? null,
    custom_fields,
    source_metadata,
  };
}

/** HMAC SHA-256 hex do raw body. Header: X-Deskcomm-Signature. */
export function verifyInboundSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(header, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Rodar — PASS.** Run: `npx vitest run lib/webhooks/inbound.test.ts`

- [ ] **Step 5: Commit**

```bash
git add lib/webhooks/inbound.ts lib/webhooks/inbound.test.ts
git commit -m "feat(webhooks): parser inbound — field_map, E.164 BR, HMAC sha256"
```

---

### Task 6: Rota inbound `POST /api/v1/webhooks/in/[token]`

**Files:**
- Create: `app/api/v1/webhooks/in/[token]/route.ts`
- Modify: `lib/audit/actions.ts` (actions novas — append no FIM do union, nunca renomear)
- Test: `tests/invariants/webhooks-inbound.test.ts`

**Interfaces:**
- Consumes: `mapInboundPayload`/`verifyInboundSignature` (Task 5), `createLeadHandler` estendido (Task 4), `checkRateLimit` de `@/lib/ai/dispatcher/rate-limit`, `createAdminClient`, `audit`, `ok`/`fail`.
- Produces: contrato HTTP público — `200 {data:{lead_id, contact_hint}}` JSON; `303` redirect quando form-post com `redirect_to`; `404` token desconhecido/inativo; `401` HMAC inválido; `400` payload sem campo mapeável; `429` rate limit.

- [ ] **Step 1: Audit actions novas** — append em `lib/audit/actions.ts` (fim do union):

```ts
  | "webhook.source_created"
  | "webhook.source_updated"
  | "webhook.source_deleted"
  | "webhook.lead_received"
  | "webhook.inbound_invalid_signature"
  | "automation.rule_created"
  | "automation.rule_updated"
  | "automation.rule_deleted"
  | "automation.rule_executed"
  | "automation.run_resent";
```

- [ ] **Step 2: Teste falhando** — `tests/invariants/webhooks-inbound.test.ts`. A rota exporta `POST`; teste chamando o handler diretamente com `NextRequest` construído na mão (padrão: `new NextRequest("http://localhost/api/v1/webhooks/in/" + token, { method: "POST", body, headers })` e `ctx = { params: Promise.resolve({ token }) }`):

```ts
// Setup: org de teste + pipeline com 1 stage + webhook_source ativa (insert
// via admin) com default_pipeline_id/default_stage_id e path_token conhecido.
//
// 1. JSON feliz: POST body {"nome":"Ana","telefone":"11998765432","utm_source":"ig","empresa":"ACME"}
//    ASSERT: 200; crm_leads da org tem 1 lead com title="Ana",
//    source="webhook", custom_fields.empresa="ACME",
//    source_metadata.utm_source="ig"; contato criado com phone +5511998765432
//    e lead.contact_id apontando pra ele; event_log tem 'lead.created';
//    webhook_events_log tem linha provider='lead_capture';
//    webhook_sources.last_received_at atualizado.
// 2. Form-post: content-type application/x-www-form-urlencoded,
//    body "nome=Bia&telefone=11912345678", source com redirect_to setado.
//    ASSERT: 303 + header Location = redirect_to; lead criado.
// 3. Token inexistente → 404. Fonte is_active=false → 404 (mesma resposta).
// 4. Fonte com secret: sem header X-Deskcomm-Signature → 401 e NENHUM lead;
//    com assinatura correta (hmac sha256 do raw body) → 200.
// 5. Payload sem nome E sem telefone E sem email → 400 invalid_request, sem lead.
// 6. Isolamento: lead criado tem organization_id da org da FONTE (nunca de
//    body ou header).
```

- [ ] **Step 3: Rodar — FAIL.**

- [ ] **Step 4: Implementar a rota** — `app/api/v1/webhooks/in/[token]/route.ts`:

```ts
/**
 * POST /api/v1/webhooks/in/[token] — captação pública de leads.
 *
 * Mesmo padrão do webhook WAHA per-tenant: path_token resolve o tenant
 * (fonte confiável — nunca o body), loga em webhook_events_log e NÃO executa
 * ação síncrona além de criar o lead (motor de regras consome lead.created
 * via event_log). Aceita JSON e form-urlencoded na mesma URL.
 */
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLeadHandler } from "@/app/api/v1/leads/_handler";
import { mapInboundPayload, verifyInboundSignature, type FieldMap } from "@/lib/webhooks/inbound";
import { ApiError } from "@/lib/api/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ token: string }>;
}

const RATE_LIMIT_PER_MIN = 60;

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const requestId = randomUUID();
  const { token } = await ctx.params;
  if (!token || token.length < 8) {
    return fail("not_found", "unknown webhook token", 404, { requestId });
  }

  const rl = await checkRateLimit(`webhook_in:${token}`, RATE_LIMIT_PER_MIN, 60);
  if (!rl.allowed) {
    return fail("rate_limited", "Too many requests.", 429, {
      requestId,
      headers: { "Retry-After": "60" },
    });
  }

  const admin = createAdminClient();
  const { data: source, error: srcErr } = await admin
    .from("webhook_sources")
    .select("id, organization_id, secret, default_pipeline_id, default_stage_id, field_map, redirect_to, is_active")
    .eq("path_token", token)
    .maybeSingle();
  if (srcErr) return fail("internal_error", srcErr.message, 500, { requestId });
  if (!source || !source.is_active) {
    return fail("not_found", "unknown webhook token", 404, { requestId });
  }

  const rawBody = await req.text();
  const contentType = req.headers.get("content-type") ?? "";
  const isForm = contentType.includes("application/x-www-form-urlencoded");
  let payload: Record<string, unknown>;
  if (isForm) {
    payload = Object.fromEntries(new URLSearchParams(rawBody));
  } else {
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return fail("invalid_request", "invalid_json", 400, { requestId });
    }
  }

  const sigHeader = req.headers.get("x-deskcomm-signature");
  const validSignature = source.secret
    ? verifyInboundSignature(rawBody, sigHeader, source.secret)
    : null; // null = fonte sem secret, não exigido
  if (source.secret && !validSignature) {
    await audit({
      action: "webhook.inbound_invalid_signature",
      organizationId: source.organization_id,
      resourceType: "webhook_source",
      resourceId: source.id,
      requestId,
    });
    return fail("unauthenticated", "invalid_signature", 401, { requestId });
  }

  const headersJson: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k.startsWith("authorization") || k === "cookie") return;
    headersJson[key] = value;
  });
  await admin.from("webhook_events_log").insert({
    organization_id: source.organization_id,
    provider: "lead_capture",
    webhook_path_token: token,
    http_method: "POST",
    headers: headersJson,
    raw_body: rawBody,
    payload_parsed: payload,
    signature_header: sigHeader ?? null,
    valid_signature: validSignature ?? true,
    event_type: "lead_capture.received",
    external_id: null,
    status: "received",
    attempts: 0,
  });

  const mapped = mapInboundPayload(payload, (source.field_map ?? {}) as FieldMap);
  if (!mapped.name && !mapped.phone && !mapped.email) {
    return fail("invalid_request", "Nenhum campo mapeável (nome/telefone/email).", 400, { requestId });
  }

  // Contato: upsert por telefone (se houver) — reusa a coluna E.164 canônica.
  let contactId: string | null = null;
  if (mapped.phone) {
    const { data: existing } = await admin
      .from("contacts")
      .select("id")
      .eq("organization_id", source.organization_id)
      .eq("phone_number", mapped.phone)
      .maybeSingle();
    if (existing) {
      contactId = existing.id;
    } else {
      const { data: created } = await admin
        .from("contacts")
        .insert({
          organization_id: source.organization_id,
          name: mapped.name ?? mapped.phone,
          phone_number: mapped.phone,
          email: mapped.email,
          email_normalized: mapped.email ? mapped.email.trim().toLowerCase() : null,
          source: "webhook",
          source_metadata: { webhook_source_id: source.id, ...mapped.source_metadata },
        })
        .select("id")
        .maybeSingle();
      contactId = created?.id ?? null;
    }
  }

  let lead: Record<string, unknown>;
  try {
    lead = await createLeadHandler(
      admin,
      {
        organization_id: source.organization_id,
        actor: { type: "webhook_source", id: source.id },
        requestId,
      },
      {
        pipeline_id: source.default_pipeline_id,
        stage_id: source.default_stage_id,
        title: mapped.name ?? mapped.phone ?? mapped.email ?? "Lead sem nome",
        contact_id: contactId ?? undefined,
        source: "webhook",
        custom_fields: mapped.custom_fields,
        source_metadata: { webhook_source_id: source.id, ...mapped.source_metadata },
      } as Parameters<typeof createLeadHandler>[2],
    );
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message ?? "erro", err.status, { requestId });
    }
    throw err;
  }

  await admin
    .from("webhook_sources")
    .update({ last_received_at: new Date().toISOString() })
    .eq("id", source.id);

  await audit({
    action: "webhook.lead_received",
    organizationId: source.organization_id,
    resourceType: "crm_lead",
    resourceId: String(lead.id),
    requestId,
    metadata: { webhook_source_id: source.id },
  });

  if (isForm && source.redirect_to) {
    return NextResponse.redirect(source.redirect_to, 303) as NextResponse;
  }
  return ok({ lead_id: lead.id }, { requestId });
}
```

Notas de implementação: (a) confira a assinatura real de `ApiError` em `lib/api/types.ts` (ordem status/code/mensagem) e ajuste o `catch`; (b) `createLeadHandler` valida stage∈pipeline∈org — se o pipeline/stage default da fonte foi apagado, o erro vira 404 no catch, comportamento aceitável; (c) `checkRateLimit` já tem fallback in-memory sem Upstash (requisito VPS).

- [ ] **Step 5: Rodar o teste — PASS.** `npm run typecheck && npm run lint`.

- [ ] **Step 6: Commit**

```bash
git add app/api/v1/webhooks/in/ lib/audit/actions.ts tests/invariants/webhooks-inbound.test.ts
git commit -m "feat(webhooks): rota inbound pública /api/v1/webhooks/in/[token]"
```

---

### Task 7: Avaliador de condições

**Files:**
- Create: `lib/automation/conditions.ts`
- Test: `lib/automation/conditions.test.ts`

**Interfaces:**
- Produces (consumido pelo engine na Task 8):

```ts
export type ConditionOp = "eq" | "neq" | "contains";
export interface RuleCondition { field: string; op: ConditionOp; value: string }
export function resolveField(context: Record<string, unknown>, path: string): unknown;
export function evaluateConditions(conditions: RuleCondition[], context: Record<string, unknown>): boolean;
```

- [ ] **Step 1: Teste falhando** — `lib/automation/conditions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { evaluateConditions, resolveField } from "@/lib/automation/conditions";

const ctx = {
  event: { to_stage_id: "s2", added_tags: ["vip", "novo"] },
  lead: { title: "Ana", custom_fields: { utm_source: "instagram" }, value_cents: 5000 },
};

describe("resolveField", () => {
  it("path aninhado", () => expect(resolveField(ctx, "lead.custom_fields.utm_source")).toBe("instagram"));
  it("path ausente → undefined", () => expect(resolveField(ctx, "lead.nope.x")).toBeUndefined());
});

describe("evaluateConditions", () => {
  it("lista vazia → true (regra sem condição dispara sempre)", () =>
    expect(evaluateConditions([], ctx)).toBe(true));
  it("eq string", () =>
    expect(evaluateConditions([{ field: "event.to_stage_id", op: "eq", value: "s2" }], ctx)).toBe(true));
  it("eq com coerção numérica (valor sempre chega como string da UI)", () =>
    expect(evaluateConditions([{ field: "lead.value_cents", op: "eq", value: "5000" }], ctx)).toBe(true));
  it("neq", () =>
    expect(evaluateConditions([{ field: "event.to_stage_id", op: "neq", value: "s1" }], ctx)).toBe(true));
  it("contains em array", () =>
    expect(evaluateConditions([{ field: "event.added_tags", op: "contains", value: "vip" }], ctx)).toBe(true));
  it("contains em string (case-insensitive)", () =>
    expect(evaluateConditions([{ field: "lead.custom_fields.utm_source", op: "contains", value: "INSTA" }], ctx)).toBe(true));
  it("E entre múltiplas: uma falsa derruba", () =>
    expect(
      evaluateConditions(
        [
          { field: "event.to_stage_id", op: "eq", value: "s2" },
          { field: "lead.title", op: "eq", value: "Bia" },
        ],
        ctx,
      ),
    ).toBe(false));
  it("campo ausente → condição falsa, não erro", () =>
    expect(evaluateConditions([{ field: "lead.ghost", op: "eq", value: "x" }], ctx)).toBe(false));
});
```

- [ ] **Step 2: Rodar — FAIL.**

- [ ] **Step 3: Implementar `lib/automation/conditions.ts`**

```ts
/**
 * Condições do motor de regras: filtros simples (eq/neq/contains) em AND.
 * Campo ausente = condição falsa (nunca erro). Coerção via String() dos dois
 * lados — o value vem sempre como string da UI.
 */
export type ConditionOp = "eq" | "neq" | "contains";

export interface RuleCondition {
  field: string;
  op: ConditionOp;
  value: string;
}

export function resolveField(context: Record<string, unknown>, path: string): unknown {
  let cur: unknown = context;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function matches(cond: RuleCondition, context: Record<string, unknown>): boolean {
  const raw = resolveField(context, cond.field);
  if (raw === undefined || raw === null) return cond.op === "neq";
  if (cond.op === "contains") {
    if (Array.isArray(raw)) return raw.map(String).includes(cond.value);
    return String(raw).toLowerCase().includes(cond.value.toLowerCase());
  }
  const equal = String(raw) === cond.value;
  return cond.op === "eq" ? equal : !equal;
}

export function evaluateConditions(
  conditions: RuleCondition[],
  context: Record<string, unknown>,
): boolean {
  return conditions.every((c) => matches(c, context));
}
```

Atenção ao detalhe do teste: `campo ausente + neq` — o teste acima só exige `eq`-ausente=falso. A implementação retorna `true` para `neq` de campo ausente ("não é igual a x" vale para ausente). Adicione um caso de teste explícito para congelar isso:

```ts
  it("campo ausente com neq → true (ausente ≠ valor)", () =>
    expect(evaluateConditions([{ field: "lead.ghost", op: "neq", value: "x" }], ctx)).toBe(true));
```

- [ ] **Step 4: Rodar — PASS.** Run: `npx vitest run lib/automation/conditions.test.ts`

- [ ] **Step 5: Commit**

```bash
git add lib/automation/conditions.ts lib/automation/conditions.test.ts
git commit -m "feat(webhooks): avaliador de condições do motor de regras"
```

---

### Task 8: Engine do motor de regras (core + registro + anti-loop + runs)

**Files:**
- Create: `lib/automation/types.ts`
- Create: `lib/automation/engine.ts`
- Create: `lib/automation/engine.handler.ts`
- Create: `lib/automation/actions/index.ts` (registry de executores — nasce vazio, ações entram nas Tasks 9-11)
- Modify: `lib/event-log/register-handlers.ts`
- Test: `tests/invariants/automation-engine.test.ts`

**Interfaces:**
- Consumes: `EventRow`, `HandlerResult` (Task 2), `evaluateConditions`/`RuleCondition` (Task 7), tabelas da Task 1.
- Produces:

```ts
// lib/automation/types.ts
export interface ActionResultDetail {
  type: string;
  status: "success" | "failed" | "skipped" | "postponed";
  error?: string;
  detail?: Record<string, unknown>;
}
export interface ActionCtx {
  admin: SupabaseClient;
  organizationId: string;
  ruleId: string;
  event: EventRow;
  context: Record<string, unknown>; // mesmo objeto avaliado pelas condições
  requestId: string;
}
export interface ActionExecutor {
  type: string;
  /** Pré-checagem opcional: se retornar um ISO timestamp, o EVENTO INTEIRO é
   *  adiado para essa hora ANTES de qualquer ação executar (all-or-nothing —
   *  evita reexecução parcial no retry). Usada pelo throttle do WhatsApp. */
  postponeUntil?(ctx: ActionCtx, config: Record<string, unknown>): Promise<string | null>;
  execute(ctx: ActionCtx, config: Record<string, unknown>): Promise<ActionResultDetail>;
}
// lib/automation/actions/index.ts
export function registerAction(executor: ActionExecutor): void;
export function getAction(type: string): ActionExecutor | undefined;
// lib/automation/engine.ts
export const AUTOMATION_CONSUMER_KEY = "automation-rules";
export async function runAutomationForEvent(admin: SupabaseClient, row: EventRow): Promise<HandlerResult>;
```

- [ ] **Step 1: Teste falhando** — `tests/invariants/automation-engine.test.ts`. Registre executores fake via `registerAction` e monte `EventRow` na mão (o engine recebe o row, não precisa de evento real no banco — mas os RUNS são gravados, então precisa de org+rule reais):

```ts
// Setup: org de teste + automation_rules via admin:
//   R1: trigger 'lead.created', conditions [], actions [{type:'fake_ok'},{type:'fake_fail'},{type:'fake_ok'}], is_active=true
//   R2: trigger 'lead.created', conditions [{field:'lead.title',op:'eq',value:'NUNCA'}], actions [{type:'fake_ok'}], is_active=true
//   R3: trigger 'lead.created', actions [{type:'fake_ok'}], is_active=FALSE
//   R4 (outra org): trigger 'lead.created', actions [{type:'fake_ok'}], is_active=true
// Executores fake: fake_ok → success; fake_fail → failed; fake_postpone →
//   postponeUntil retorna now+1h.
// Lead real na org (insert admin) p/ o engine hidratar o contexto.
//
// 1. runAutomationForEvent(admin, rowLeadCreated da org com entity_id=lead.id):
//    ASSERT retorno {consumer_key:'automation-rules', status:'ok'};
//    ASSERT automation_rule_runs: 1 run p/ R1 com status='partial' e
//      actions_result = [success, failed, success] NA ORDEM (erro no meio NÃO
//      aborta as seguintes); NENHUM run p/ R2 (condição falsa), R3 (pausada),
//      R4 (outra org);
//    ASSERT R1.run_count=1 e last_run_at atualizado.
// 2. Anti-loop: mesmo row com metadata.caused_by_rule='<uuid>' →
//    status:'skipped', ZERO runs novos.
// 3. Postpone: regra R5 com actions [{type:'fake_postpone'},{type:'fake_ok'}] →
//    retorno {status:'retry', retry_at≈+1h}; ZERO runs gravados; fake_ok NÃO
//    executou (all-or-nothing).
// 4. Ação de type desconhecido ('nope') → run com actions_result
//    [{type:'nope',status:'failed',error:'unknown_action'}], demais ações seguem.
```

- [ ] **Step 2: Rodar — FAIL.**

- [ ] **Step 3: Implementar `lib/automation/types.ts` e `lib/automation/actions/index.ts`**

`types.ts` exatamente como no bloco Interfaces acima (com os imports: `SupabaseClient` de `@supabase/supabase-js`, `EventRow` de `@/lib/event-log/dispatcher`). `actions/index.ts`:

```ts
import type { ActionExecutor } from "@/lib/automation/types";

const _actions = new Map<string, ActionExecutor>();

export function registerAction(executor: ActionExecutor): void {
  _actions.set(executor.type, executor);
}

export function getAction(type: string): ActionExecutor | undefined {
  return _actions.get(type);
}
```

- [ ] **Step 4: Implementar `lib/automation/engine.ts`**

```ts
/**
 * Motor de regras: consome eventos-gatilho do event_log e executa as
 * automation_rules ativas do tenant. Registrado no registry via engine.handler.
 *
 * Anti-loop: eventos com metadata.caused_by_rule não reprocessam (profundidade
 * 1 no v1 — cadeia regra→regra fica pra v2).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { evaluateConditions, type RuleCondition } from "@/lib/automation/conditions";
import { getAction } from "@/lib/automation/actions";
import type { ActionResultDetail } from "@/lib/automation/types";
import { logger } from "@/lib/logger";

export const AUTOMATION_CONSUMER_KEY = "automation-rules";

interface RuleRow {
  id: string;
  name: string;
  conditions: RuleCondition[];
  actions: Array<{ type: string; config?: Record<string, unknown> }>;
}

/** Hidrata o contexto avaliado pelas condições/ações a partir do entity do evento. */
async function buildContext(admin: SupabaseClient, row: EventRow): Promise<Record<string, unknown>> {
  const context: Record<string, unknown> = { event: row.payload };
  if (row.entity_kind === "crm_lead" && row.entity_id) {
    const { data: lead } = await admin.from("crm_leads").select("*").eq("id", row.entity_id).maybeSingle();
    if (lead) {
      context.lead = lead;
      if (lead.contact_id) {
        const { data: contact } = await admin.from("contacts").select("*").eq("id", lead.contact_id).maybeSingle();
        if (contact) context.contact = contact;
      }
    }
  } else if (row.entity_kind === "contact" && row.entity_id) {
    const { data: contact } = await admin.from("contacts").select("*").eq("id", row.entity_id).maybeSingle();
    if (contact) context.contact = contact;
  } else if (row.entity_kind === "message" && row.entity_id) {
    const contactId = row.payload.contact_id as string | undefined;
    if (contactId) {
      const { data: contact } = await admin.from("contacts").select("*").eq("id", contactId).maybeSingle();
      if (contact) context.contact = contact;
    }
  }
  return context;
}

export async function runAutomationForEvent(
  admin: SupabaseClient,
  row: EventRow,
): Promise<HandlerResult> {
  if (row.metadata?.caused_by_rule) {
    return { consumer_key: AUTOMATION_CONSUMER_KEY, status: "skipped", detail: "caused_by_rule" };
  }

  const { data: rules, error } = await admin
    .from("automation_rules")
    .select("id, name, conditions, actions")
    .eq("organization_id", row.organization_id)
    .eq("trigger_event", row.event_type)
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (error) {
    return { consumer_key: AUTOMATION_CONSUMER_KEY, status: "error", detail: error.message };
  }
  const matched = (rules ?? []) as unknown as RuleRow[];
  if (!matched.length) {
    return { consumer_key: AUTOMATION_CONSUMER_KEY, status: "ok", detail: "no_rules" };
  }

  const context = await buildContext(admin, row);
  const applicable = matched.filter((r) => evaluateConditions(r.conditions ?? [], context));
  if (!applicable.length) {
    return { consumer_key: AUTOMATION_CONSUMER_KEY, status: "ok", detail: "no_match" };
  }

  // Pré-checagem de postpone (throttle etc.): all-or-nothing ANTES de executar
  // qualquer ação — reexecução parcial no retry seria pior que atraso.
  for (const rule of applicable) {
    for (const action of rule.actions ?? []) {
      const executor = getAction(action.type);
      if (!executor?.postponeUntil) continue;
      const until = await executor.postponeUntil(
        { admin, organizationId: row.organization_id, ruleId: rule.id, event: row, context, requestId: row.id },
        action.config ?? {},
      );
      if (until) {
        return { consumer_key: AUTOMATION_CONSUMER_KEY, status: "retry", retry_at: until };
      }
    }
  }

  for (const rule of applicable) {
    const results: ActionResultDetail[] = [];
    for (const action of rule.actions ?? []) {
      const executor = getAction(action.type);
      if (!executor) {
        results.push({ type: action.type, status: "failed", error: "unknown_action" });
        continue;
      }
      try {
        results.push(
          await executor.execute(
            { admin, organizationId: row.organization_id, ruleId: rule.id, event: row, context, requestId: row.id },
            action.config ?? {},
          ),
        );
      } catch (err) {
        results.push({
          type: action.type,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const failed = results.filter((r) => r.status === "failed").length;
    const status = failed === 0 ? "success" : failed === results.length ? "failed" : "partial";
    const { error: runErr } = await admin.from("automation_rule_runs").insert({
      organization_id: row.organization_id,
      rule_id: rule.id,
      event_id: row.id,
      status,
      actions_result: results,
    });
    if (runErr) logger.error("[automation.engine] run insert failed", { error: runErr.message });

    // run_count sem RPC de increment: read-modify-write é aceitável aqui
    // (contador informativo de UI, não invariante).
    const { data: cur } = await admin.from("automation_rules").select("run_count").eq("id", rule.id).maybeSingle();
    await admin
      .from("automation_rules")
      .update({ last_run_at: new Date().toISOString(), run_count: (cur?.run_count ?? 0) + 1 })
      .eq("id", rule.id);
  }

  return { consumer_key: AUTOMATION_CONSUMER_KEY, status: "ok" };
}
```

Nota: `event_id: row.id` — o teste monta `EventRow` na mão; para o insert de run não violar o FK, o teste deve usar um evento REAL criado via `emit_event` (leia o id de volta em `event_log`) em vez de uuid inventado. Ajuste o teste do Step 1 nesse detalhe.

- [ ] **Step 5: Implementar `lib/automation/engine.handler.ts` e registrar**

```ts
import { createAdminClient } from "@/lib/supabase/admin";
import type { EventHandler } from "@/lib/event-log/dispatcher";
import { AUTOMATION_CONSUMER_KEY, runAutomationForEvent } from "@/lib/automation/engine";
// Importa os executores para que se registrem (side-effect imports — Tasks 9-11):
import "@/lib/automation/actions/register-all";

export const automationRulesHandler: EventHandler = {
  key: AUTOMATION_CONSUMER_KEY,
  events: ["lead.created", "lead.stage_changed", "message.received", "lead.tag_added", "contact.tag_added"],
  async handle(row) {
    return runAutomationForEvent(createAdminClient(), row);
  },
};
```

Crie também `lib/automation/actions/register-all.ts` (por ora vazio, com comentário; as Tasks 9-11 adicionam os `registerAction(...)` aqui):

```ts
/** Side-effect module: registra todos os executores de ação do motor. */
export {};
```

E em `lib/event-log/register-handlers.ts` adicione:

```ts
import { automationRulesHandler } from "@/lib/automation/engine.handler";
// ... dentro de ensureHandlersRegistered():
  registerHandler(automationRulesHandler);
```

- [ ] **Step 6: Rodar o teste — PASS.** `npm run typecheck && npm run lint`.

- [ ] **Step 7: Commit**

```bash
git add lib/automation/ lib/event-log/register-handlers.ts tests/invariants/automation-engine.test.ts
git commit -m "feat(webhooks): engine do motor de regras + anti-loop + rule_runs"
```

---

### Task 9: Ações simples — `add_tag`, `assign_owner`, `create_or_move_lead`

**Files:**
- Create: `lib/automation/actions/add-tag.ts`
- Create: `lib/automation/actions/assign-owner.ts`
- Create: `lib/automation/actions/create-or-move-lead.ts`
- Modify: `lib/automation/actions/register-all.ts`
- Test: `tests/invariants/automation-actions-crud.test.ts`

**Interfaces:**
- Consumes: `ActionExecutor`/`ActionCtx`/`ActionResultDetail` (Task 8), `moveLeadHandler`/`createLeadHandler` de `app/api/v1/leads/_handler.ts`.
- Produces: executores registrados com `type` EXATAMENTE `"add_tag"`, `"assign_owner"`, `"create_or_move_lead"`. Configs (contrato com a UI e o Zod da Task 12):
  - `add_tag`: `{ tags: string[] }` — merge idempotente nas tags do LEAD do contexto (ou do CONTATO, se o contexto não tiver lead).
  - `assign_owner`: `{ user_id: string }` — valida membership na org; seta `owner_user_id`+`assigned_at` do lead do contexto.
  - `create_or_move_lead`: `{ pipeline_id: string, stage_id: string }` — se contexto tem lead: move (mesmo pipeline via `moveLeadHandler`; pipeline diferente → `failed` com error `cross_pipeline_move_not_allowed`); se não tem lead mas tem contact: cria lead via `createLeadHandler` com `caused_by_rule` — TODA emissão derivada de ação carrega esse metadata.

- [ ] **Step 1: Teste falhando** — `tests/invariants/automation-actions-crud.test.ts`:

```ts
// Setup: org + pipeline(2 stages) + contato + lead com tags=[] no stage1.
// ActionCtx montado na mão com context={lead, contact} hidratado via select.
//
// add_tag:
// 1. execute({tags:['vip']}) → success; lead.tags no banco = ['vip'].
// 2. execute({tags:['vip','novo']}) de novo → success; tags = ['vip','novo']
//    (merge, sem duplicar 'vip').
// 3. emit lead.tag_added resultante carrega metadata.caused_by_rule (SELECT
//    event_log WHERE event_type='lead.tag_added' → metadata.caused_by_rule = ruleId).
//
// assign_owner:
// 4. execute({user_id: managerA.id}) → success; owner_user_id setado.
// 5. execute({user_id: userDeOutraOrg.id}) → failed error='user_not_in_org';
//    owner_user_id INALTERADO.
//
// create_or_move_lead:
// 6. contexto COM lead + stage2 do mesmo pipeline → success; lead.stage_id=stage2;
//    event_log tem lead.stage_changed com metadata.caused_by_rule.
// 7. contexto SEM lead (só contact) → success; lead NOVO criado no
//    pipeline/stage do config, contact_id apontando pro contato,
//    lead.created do novo lead tem metadata.caused_by_rule.
```

- [ ] **Step 2: Rodar — FAIL.**

- [ ] **Step 3: Implementar `add-tag.ts`**

```ts
import { registerAction } from "@/lib/automation/actions";
import type { ActionCtx, ActionResultDetail } from "@/lib/automation/types";

async function execute(ctx: ActionCtx, config: Record<string, unknown>): Promise<ActionResultDetail> {
  const tags = Array.isArray(config.tags) ? config.tags.map(String) : [];
  if (!tags.length) return { type: "add_tag", status: "skipped", detail: { reason: "no_tags" } };

  const lead = ctx.context.lead as { id: string; tags?: string[] } | undefined;
  const contact = ctx.context.contact as { id: string; tags?: string[] } | undefined;
  const target = lead ? { table: "crm_leads", row: lead, event: "lead.tag_added", kind: "crm_lead" }
    : contact ? { table: "contacts", row: contact, event: "contact.tag_added", kind: "contact" }
    : null;
  if (!target) return { type: "add_tag", status: "skipped", detail: { reason: "no_target" } };

  const prev = target.row.tags ?? [];
  const added = tags.filter((t) => !prev.includes(t));
  if (!added.length) return { type: "add_tag", status: "success", detail: { added: [] } };

  const merged = [...prev, ...added];
  const { error } = await ctx.admin
    .from(target.table)
    .update({ tags: merged, updated_at: new Date().toISOString() })
    .eq("id", target.row.id)
    .eq("organization_id", ctx.organizationId);
  if (error) return { type: "add_tag", status: "failed", error: error.message };

  await ctx.admin.rpc("emit_event", {
    p_event_type: target.event,
    p_entity_kind: target.kind,
    p_entity_id: target.row.id,
    p_payload: { added_tags: added, tags: merged },
    p_metadata: { caused_by_rule: ctx.ruleId },
    p_organization_id: ctx.organizationId,
  });
  return { type: "add_tag", status: "success", detail: { added } };
}

registerAction({ type: "add_tag", execute });
```

- [ ] **Step 4: Implementar `assign-owner.ts`**

Descubra a tabela de membership consultando como `fn_user_role_in_org` resolve (busque `organization_members`/`memberships` no `supabase/baseline.sql` — use o nome real):

```ts
import { registerAction } from "@/lib/automation/actions";
import type { ActionCtx, ActionResultDetail } from "@/lib/automation/types";

async function execute(ctx: ActionCtx, config: Record<string, unknown>): Promise<ActionResultDetail> {
  const userId = typeof config.user_id === "string" ? config.user_id : null;
  const lead = ctx.context.lead as { id: string } | undefined;
  if (!userId || !lead) return { type: "assign_owner", status: "skipped", detail: { reason: "missing_input" } };

  const { data: member } = await ctx.admin
    .from("organization_members") // ← confirmar nome real no baseline
    .select("user_id")
    .eq("organization_id", ctx.organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!member) return { type: "assign_owner", status: "failed", error: "user_not_in_org" };

  const { error } = await ctx.admin
    .from("crm_leads")
    .update({ owner_user_id: userId, assigned_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", lead.id)
    .eq("organization_id", ctx.organizationId);
  if (error) return { type: "assign_owner", status: "failed", error: error.message };
  return { type: "assign_owner", status: "success", detail: { user_id: userId } };
}

registerAction({ type: "assign_owner", execute });
```

- [ ] **Step 5: Implementar `create-or-move-lead.ts`**

Reusa os handlers de leads com `HandlerCtx` de actor `webhook_source`… não: o actor aqui é a REGRA. Use `{ type: "ai_agent", id: ctx.ruleId, role: "manager" }`? Não — introduza o padrão correto: os handlers aceitam `Actor`; use `{ type: "webhook_source", id: ctx.ruleId }` (variante da Task 4 — semanticamente "ator automático"; o audit metadata registra actor_type=webhook_source com o id da regra). Para o `caused_by_rule` nos eventos emitidos pelos handlers reusados, os handlers emitem com o metadata DELES (request_id/actor) — sem `caused_by_rule`. Solução mínima: após chamar o handler, o executor NÃO reemite; em vez disso, passe `requestId: \`rule:${ctx.ruleId}\`` no HandlerCtx e ajuste o ENGINE (Task 8) para também pular eventos cujo `metadata.request_id` comece com `"rule:"`. Implemente assim:

1. Em `lib/automation/engine.ts`, troque o guard anti-loop por:

```ts
  const causedByRule =
    Boolean(row.metadata?.caused_by_rule) ||
    String(row.metadata?.request_id ?? "").startsWith("rule:");
  if (causedByRule) {
    return { consumer_key: AUTOMATION_CONSUMER_KEY, status: "skipped", detail: "caused_by_rule" };
  }
```

2. Ajuste os ASSERTs 3/6/7 do teste (Step 1) para aceitar `metadata.caused_by_rule` OU `metadata.request_id` prefixado `rule:` — congele nos testes o mecanismo que você implementar.

3. O executor:

```ts
import { registerAction } from "@/lib/automation/actions";
import type { ActionCtx, ActionResultDetail } from "@/lib/automation/types";
import { createLeadHandler, moveLeadHandler } from "@/app/api/v1/leads/_handler";

async function execute(ctx: ActionCtx, config: Record<string, unknown>): Promise<ActionResultDetail> {
  const pipelineId = typeof config.pipeline_id === "string" ? config.pipeline_id : null;
  const stageId = typeof config.stage_id === "string" ? config.stage_id : null;
  if (!pipelineId || !stageId) {
    return { type: "create_or_move_lead", status: "failed", error: "missing_config" };
  }

  const handlerCtx = {
    organization_id: ctx.organizationId,
    actor: { type: "webhook_source" as const, id: ctx.ruleId },
    requestId: `rule:${ctx.ruleId}`,
  };
  const lead = ctx.context.lead as { id: string; pipeline_id: string } | undefined;
  const contact = ctx.context.contact as { id: string; name?: string; phone_number?: string } | undefined;

  try {
    if (lead) {
      if (lead.pipeline_id !== pipelineId) {
        return { type: "create_or_move_lead", status: "failed", error: "cross_pipeline_move_not_allowed" };
      }
      await moveLeadHandler(ctx.admin, handlerCtx, lead.id, { to_stage_id: stageId });
      return { type: "create_or_move_lead", status: "success", detail: { moved: lead.id } };
    }
    if (contact) {
      const created = await createLeadHandler(ctx.admin, handlerCtx, {
        pipeline_id: pipelineId,
        stage_id: stageId,
        title: contact.name ?? contact.phone_number ?? "Lead da automação",
        contact_id: contact.id,
        source: "automation",
      } as Parameters<typeof createLeadHandler>[2]);
      return { type: "create_or_move_lead", status: "success", detail: { created: String(created.id) } };
    }
    return { type: "create_or_move_lead", status: "skipped", detail: { reason: "no_lead_or_contact" } };
  } catch (err) {
    return {
      type: "create_or_move_lead",
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

registerAction({ type: "create_or_move_lead", execute });
```

- [ ] **Step 6: Registrar em `register-all.ts`**

```ts
/** Side-effect module: registra todos os executores de ação do motor. */
import "@/lib/automation/actions/add-tag";
import "@/lib/automation/actions/assign-owner";
import "@/lib/automation/actions/create-or-move-lead";
```

- [ ] **Step 7: Rodar o teste — PASS.** `npm run typecheck && npm run lint`.

- [ ] **Step 8: Commit**

```bash
git add lib/automation/ tests/invariants/automation-actions-crud.test.ts
git commit -m "feat(webhooks): ações add_tag, assign_owner e create_or_move_lead"
```

---

### Task 10: Ação `call_webhook` (outbound) + anti-SSRF

**Files:**
- Create: `lib/automation/outbound-url.ts`
- Create: `lib/automation/actions/call-webhook.ts`
- Modify: `lib/automation/actions/register-all.ts`
- Test: `lib/automation/outbound-url.test.ts` (unit) + `tests/invariants/automation-call-webhook.test.ts`

**Interfaces:**
- Produces: executor `type: "call_webhook"`, config `{ url: string, secret?: string }`. Envelope enviado: POST JSON `{ event: string, occurred_at: string, data: Record<string,unknown> }` (data = payload do evento + lead/contact do contexto; SEM organization_id). Headers: `Content-Type: application/json`, `X-Deskcomm-Event: <event_type>`, e `X-Deskcomm-Signature: <hmac sha256 hex do body>` quando houver secret.
- `assertSafeOutboundUrl(url: string): void` — lança `Error` com mensagem `unsafe_url:<motivo>` se inválida.

- [ ] **Step 1: Teste unit falhando** — `lib/automation/outbound-url.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assertSafeOutboundUrl } from "@/lib/automation/outbound-url";

describe("assertSafeOutboundUrl", () => {
  it("https público passa", () => expect(() => assertSafeOutboundUrl("https://hooks.zapier.com/x")).not.toThrow());
  it("http passa apenas fora de produção", () => {
    // NODE_ENV=test aqui — http permitido (self-host dev); produção nega.
    expect(() => assertSafeOutboundUrl("http://example.com/hook")).not.toThrow();
  });
  it("loopback nega", () => expect(() => assertSafeOutboundUrl("https://127.0.0.1/x")).toThrow(/unsafe_url/));
  it("localhost nega", () => expect(() => assertSafeOutboundUrl("https://localhost/x")).toThrow(/unsafe_url/));
  it("IP privado nega", () => {
    expect(() => assertSafeOutboundUrl("https://10.0.0.5/x")).toThrow(/unsafe_url/);
    expect(() => assertSafeOutboundUrl("https://192.168.1.1/x")).toThrow(/unsafe_url/);
    expect(() => assertSafeOutboundUrl("https://172.16.0.1/x")).toThrow(/unsafe_url/);
    expect(() => assertSafeOutboundUrl("https://169.254.1.1/x")).toThrow(/unsafe_url/);
  });
  it("esquema não-http nega", () => expect(() => assertSafeOutboundUrl("file:///etc/passwd")).toThrow(/unsafe_url/));
  it("url inválida nega", () => expect(() => assertSafeOutboundUrl("not a url")).toThrow(/unsafe_url/));
});
```

- [ ] **Step 2: Rodar — FAIL.** Depois implementar `lib/automation/outbound-url.ts`:

```ts
/**
 * Validação anti-SSRF de URL outbound. ponytail: bloqueio por literal de IP e
 * hostname; DNS-rebinding não coberto no v1 (upgrade: resolver DNS e validar
 * o IP resolvido antes do fetch).
 */
const PRIVATE_HOST_RX =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[::1\]|::1$)/i;

export function assertSafeOutboundUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("unsafe_url:invalid");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("unsafe_url:scheme");
  }
  if (parsed.protocol === "http:" && process.env.NODE_ENV === "production") {
    throw new Error("unsafe_url:https_required");
  }
  if (PRIVATE_HOST_RX.test(parsed.hostname)) {
    throw new Error("unsafe_url:private_host");
  }
}
```

Run: `npx vitest run lib/automation/outbound-url.test.ts` → PASS.

- [ ] **Step 3: Teste de integração falhando** — `tests/invariants/automation-call-webhook.test.ts`. Suba um servidor HTTP local efêmero no teste (`node:http`, porta 0) que registre as requests recebidas; como `http://127.0.0.1` é negado pelo anti-SSRF, o teste do executor injeta a exceção: exporte do módulo `call-webhook.ts` a função interna `executeCallWebhook(ctx, config, opts?: { skipUrlCheck?: boolean })` e teste por ela (a versão registrada chama sem opts):

```ts
// 1. Sucesso: servidor responde 200. execute → success; servidor recebeu POST
//    com envelope {event, occurred_at, data}; header X-Deskcomm-Event correto;
//    SEM X-Deskcomm-Signature (config sem secret); body SEM organization_id.
// 2. Com secret: header X-Deskcomm-Signature presente e igual ao
//    hmac-sha256 hex do body recebido.
// 3. Falha 500 persistente: servidor responde 500 sempre → executor tenta 3x
//    (servidor conta 3 hits) e retorna failed com detail.response_status=500.
// 4. Falha depois sucesso: servidor responde 500 na 1ª e 200 na 2ª → success
//    (retry interno funcionou), detail.attempt=2.
// 5. URL insegura (sem skipUrlCheck): execute com url https://127.0.0.1:9/x →
//    failed com error começando com 'unsafe_url'.
```

- [ ] **Step 4: Implementar `lib/automation/actions/call-webhook.ts`**

```ts
import { createHmac } from "node:crypto";
import { registerAction } from "@/lib/automation/actions";
import type { ActionCtx, ActionResultDetail } from "@/lib/automation/types";
import { assertSafeOutboundUrl } from "@/lib/automation/outbound-url";

const TIMEOUT_MS = 10_000;
const RETRY_DELAYS_MS = [1_000, 5_000]; // total 3 tentativas

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function executeCallWebhook(
  ctx: ActionCtx,
  config: Record<string, unknown>,
  opts: { skipUrlCheck?: boolean } = {},
): Promise<ActionResultDetail> {
  const url = typeof config.url === "string" ? config.url : null;
  if (!url) return { type: "call_webhook", status: "failed", error: "missing_url" };
  if (!opts.skipUrlCheck) {
    try {
      assertSafeOutboundUrl(url);
    } catch (err) {
      return { type: "call_webhook", status: "failed", error: (err as Error).message };
    }
  }

  const body = JSON.stringify({
    event: ctx.event.event_type,
    occurred_at: new Date().toISOString(),
    data: {
      ...ctx.event.payload,
      ...(ctx.context.lead ? { lead: ctx.context.lead } : {}),
      ...(ctx.context.contact ? { contact: ctx.context.contact } : {}),
    },
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Deskcomm-Event": ctx.event.event_type,
  };
  const secret = typeof config.secret === "string" ? config.secret : null;
  if (secret) {
    headers["X-Deskcomm-Signature"] = createHmac("sha256", secret).update(body).digest("hex");
  }

  let lastError = "";
  let lastStatus: number | null = null;
  for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length + 1; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      lastStatus = res.status;
      if (res.ok) {
        return { type: "call_webhook", status: "success", detail: { response_status: res.status, attempt } };
      }
      lastError = `http_${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (attempt <= RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt - 1]);
  }
  return {
    type: "call_webhook",
    status: "failed",
    error: lastError,
    detail: { response_status: lastStatus, attempts: RETRY_DELAYS_MS.length + 1 },
  };
}

registerAction({
  type: "call_webhook",
  execute: (ctx, config) => executeCallWebhook(ctx, config),
});
```

Adicionar em `register-all.ts`: `import "@/lib/automation/actions/call-webhook";`

- [ ] **Step 5: Rodar os dois testes — PASS.** `npm run typecheck && npm run lint`.

- [ ] **Step 6: Commit**

```bash
git add lib/automation/ tests/invariants/automation-call-webhook.test.ts
git commit -m "feat(webhooks): ação call_webhook com HMAC, retry e anti-SSRF"
```

---

### Task 11: Ação `send_whatsapp_message` + start-conversation + throttle anti-banimento

**Files:**
- Create: `lib/automation/throttle.ts`
- Create: `lib/automation/template.ts`
- Create: `lib/automation/start-conversation.ts`
- Create: `lib/automation/actions/send-whatsapp.ts`
- Modify: `lib/automation/actions/register-all.ts`
- Test: `lib/automation/throttle.test.ts` + `lib/automation/template.test.ts` (unit) + `tests/invariants/automation-send-whatsapp.test.ts`

**Interfaces:**
- Consumes: `sendMessageHandler` de `app/api/v1/messages/_handler.ts` (assinatura `(supabase, ctx, input: SendMessageInput)`; `SendMessageInput` tem `conversation_id`, `type`, `body` — confira em `lib/schemas/messaging.ts`); RPCs `fn_upsert_wa_contact`/`fn_upsert_wa_conversation` NÃO servem aqui (são para identidade WAHA da ingestão) — a conversa é criada por insert direto.
- Produces:

```ts
// lib/automation/throttle.ts
export interface ThrottleVerdict { allowed: boolean; retry_at?: string; reason?: string }
export function withinSendWindow(now?: Date): boolean;             // 7h-22h locais do servidor
export function nextWindowStart(now?: Date): string;               // ISO da próxima 7h
export async function checkDailyLimit(admin: SupabaseClient, channelSessionId: string): Promise<ThrottleVerdict>;
export const AUTOMATED_SEND_SPACING_MS = 1200;
export function jitterMs(): number;                                // 0..800
// lib/automation/template.ts
export function renderTemplate(template: string, context: Record<string, unknown>): string;
// lib/automation/start-conversation.ts
export async function ensureConversation(
  admin: SupabaseClient, organizationId: string, contactId: string, channelSessionId: string,
): Promise<string>; // conversation_id (acha aberta ou cria)
```

- Executor `type: "send_whatsapp_message"`, config `{ channel_session_id: string, template: string }`. Implementa `postponeUntil` (janela + limite diário) — é o consumidor do contrato all-or-nothing da Task 8 e do `retry` da Task 2.

- [ ] **Step 1: Testes unit falhando**

`lib/automation/throttle.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { withinSendWindow, nextWindowStart, jitterMs } from "@/lib/automation/throttle";

describe("withinSendWindow", () => {
  it("10h → true", () => expect(withinSendWindow(new Date("2026-07-17T10:00:00"))).toBe(true));
  it("06:59 → false", () => expect(withinSendWindow(new Date("2026-07-17T06:59:00"))).toBe(false));
  it("22:00 → false (janela é [7,22))", () => expect(withinSendWindow(new Date("2026-07-17T22:00:00"))).toBe(false));
});

describe("nextWindowStart", () => {
  it("às 23h retorna 7h de AMANHÃ", () => {
    const next = new Date(nextWindowStart(new Date("2026-07-17T23:00:00")));
    expect(next.getHours()).toBe(7);
    expect(next.getDate()).toBe(18);
  });
  it("às 5h retorna 7h de HOJE", () => {
    const next = new Date(nextWindowStart(new Date("2026-07-17T05:00:00")));
    expect(next.getHours()).toBe(7);
    expect(next.getDate()).toBe(17);
  });
});

describe("jitterMs", () => {
  it("sempre em [0, 800]", () => {
    for (let i = 0; i < 50; i++) {
      const j = jitterMs();
      expect(j).toBeGreaterThanOrEqual(0);
      expect(j).toBeLessThanOrEqual(800);
    }
  });
});
```

`lib/automation/template.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderTemplate } from "@/lib/automation/template";

const ctx = { contact: { name: "Ana" }, lead: { title: "Pedido X", custom_fields: { cupom: "BF10" } } };

describe("renderTemplate", () => {
  it("variável simples", () =>
    expect(renderTemplate("Oi {{contact.name}}!", ctx)).toBe("Oi Ana!"));
  it("path aninhado", () =>
    expect(renderTemplate("Use {{lead.custom_fields.cupom}}", ctx)).toBe("Use BF10"));
  it("alias {{nome}} resolve contact.name", () =>
    expect(renderTemplate("Oi {{nome}}", ctx)).toBe("Oi Ana"));
  it("variável ausente vira vazio, não '{{...}}' cru", () =>
    expect(renderTemplate("X{{lead.ghost}}Y", ctx)).toBe("XY"));
  it("espaços dentro das chaves tolerados", () =>
    expect(renderTemplate("Oi {{ contact.name }}", ctx)).toBe("Oi Ana"));
});
```

- [ ] **Step 2: Rodar — FAIL.** Implementar `throttle.ts`:

```ts
/**
 * Anti-banimento mínimo p/ envio AUTOMATIZADO (spec §8): janela 7h-22h,
 * limite diário da sessão, espaçamento 1.2s+jitter. O schema de warmup já
 * existe (channel_session_warmup + channel_sessions.daily_message_limit);
 * a lógica nasce aqui. ponytail: janela fixa no fuso do servidor; janela
 * por-regra/fuso do tenant é v2.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const WINDOW_START_HOUR = 7;
const WINDOW_END_HOUR = 22;

export interface ThrottleVerdict {
  allowed: boolean;
  retry_at?: string;
  reason?: string;
}

export function withinSendWindow(now: Date = new Date()): boolean {
  const h = now.getHours();
  return h >= WINDOW_START_HOUR && h < WINDOW_END_HOUR;
}

export function nextWindowStart(now: Date = new Date()): string {
  const next = new Date(now);
  next.setHours(WINDOW_START_HOUR, 0, 0, 0);
  if (now.getHours() >= WINDOW_START_HOUR) next.setDate(next.getDate() + 1);
  return next.toISOString();
}

export async function checkDailyLimit(
  admin: SupabaseClient,
  channelSessionId: string,
): Promise<ThrottleVerdict> {
  const { data: session } = await admin
    .from("channel_sessions")
    .select("daily_message_limit")
    .eq("id", channelSessionId)
    .maybeSingle();
  const limit = session?.daily_message_limit ?? 300;

  const today = new Date().toISOString().slice(0, 10);
  const { data: warmup } = await admin
    .from("channel_session_warmup")
    .select("messages_sent")
    .eq("channel_session_id", channelSessionId)
    .eq("day", today)
    .maybeSingle();
  const sent = warmup?.messages_sent ?? 0;

  if (sent >= limit) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(WINDOW_START_HOUR, 0, 0, 0);
    return { allowed: false, retry_at: tomorrow.toISOString(), reason: "daily_limit" };
  }
  return { allowed: true };
}

export const AUTOMATED_SEND_SPACING_MS = 1200;

export function jitterMs(): number {
  return Math.floor(Math.random() * 801);
}
```

Nota: confira as colunas reais de `channel_session_warmup` no `supabase/baseline.sql:1293` (`day`, `messages_sent`, chave por sessão) e ajuste nomes se divergirem.

Implementar `template.ts`:

```ts
import { resolveField } from "@/lib/automation/conditions";

const ALIASES: Record<string, string> = {
  nome: "contact.name",
  telefone: "contact.phone_number",
  email: "contact.email",
};

export function renderTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path: string) => {
    const resolved = resolveField(context, ALIASES[path] ?? path);
    return resolved === undefined || resolved === null ? "" : String(resolved);
  });
}
```

Run: `npx vitest run lib/automation/throttle.test.ts lib/automation/template.test.ts` → PASS.

- [ ] **Step 3: Teste de integração falhando** — `tests/invariants/automation-send-whatsapp.test.ts`. WAHA não está configurado no ambiente de teste — o `sendMessageHandler` então deixa a mensagem com `metadata.queued_reason='waha_not_configured'`, o que já prova o caminho inteiro sem rede:

```ts
// Setup: org + channel_session (insert admin, status='WORKING',
// daily_message_limit=300) + contato com phone + lead com contact_id.
//
// 1. ensureConversation cria conversa nova (contact+session) e retorna id;
//    chamada de novo → MESMO id (acha a existente, não duplica).
// 2. Executor com janela aberta (mock: vi.setSystemTime(10h)): execute →
//    success (ou detail.queued_reason='waha_not_configured'); messages tem
//    1 linha outbound com body renderizado do template
//    "Oi {{contact.name}}" → "Oi <nome do contato>".
// 3. postponeUntil às 23h (vi.setSystemTime) → retorna ISO ≈ 7h de amanhã.
// 4. postponeUntil com channel_session_warmup.messages_sent >= limit →
//    retorna ISO de amanhã 7h (daily_limit).
// 5. Contato is_blocked=true → execute retorna skipped (reason
//    'contact_blocked'), NENHUMA message inserida.
```

- [ ] **Step 4: Implementar `start-conversation.ts`**

```ts
/**
 * Conversa programática p/ automação: acha a conversa aberta do contato na
 * sessão ou cria uma nova. Distinto da ingestão WAHA (que usa RPCs de
 * identidade) — aqui contato e sessão já são conhecidos.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const OPEN_STATUSES = ["open", "pending", "claimed", "ai_handling"];

export async function ensureConversation(
  admin: SupabaseClient,
  organizationId: string,
  contactId: string,
  channelSessionId: string,
): Promise<string> {
  const { data: existing } = await admin
    .from("conversations")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .eq("channel_session_id", channelSessionId)
    .in("status", OPEN_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await admin
    .from("conversations")
    .insert({
      organization_id: organizationId,
      contact_id: contactId,
      channel_session_id: channelSessionId,
      channel: "whatsapp",
      status: "open",
      metadata: { created_by: "automation" },
    })
    .select("id")
    .single();
  if (error || !created) throw new Error(error?.message ?? "conversation_insert_failed");
  return created.id;
}
```

Nota: confira em `supabase/baseline.sql:1378` se `conversations` tem defaults/colunas obrigatórias além dessas (ex. `last_message_at`); adicione o mínimo que o insert exigir.

- [ ] **Step 5: Implementar `actions/send-whatsapp.ts`**

```ts
import { registerAction } from "@/lib/automation/actions";
import type { ActionCtx, ActionResultDetail } from "@/lib/automation/types";
import { renderTemplate } from "@/lib/automation/template";
import { ensureConversation } from "@/lib/automation/start-conversation";
import {
  AUTOMATED_SEND_SPACING_MS,
  checkDailyLimit,
  jitterMs,
  nextWindowStart,
  withinSendWindow,
} from "@/lib/automation/throttle";
import { sendMessageHandler } from "@/app/api/v1/messages/_handler";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Espaçamento entre envios automatizados DENTRO do mesmo tick do drain,
// por sessão (estado de módulo — suficiente p/ instância única do cron).
const _lastSendAt = new Map<string, number>();

async function postponeUntil(ctx: ActionCtx, config: Record<string, unknown>): Promise<string | null> {
  if (!withinSendWindow()) return nextWindowStart();
  const sessionId = typeof config.channel_session_id === "string" ? config.channel_session_id : null;
  if (!sessionId) return null; // config inválida falha no execute, não adia
  const daily = await checkDailyLimit(ctx.admin, sessionId);
  return daily.allowed ? null : (daily.retry_at ?? null);
}

async function execute(ctx: ActionCtx, config: Record<string, unknown>): Promise<ActionResultDetail> {
  const sessionId = typeof config.channel_session_id === "string" ? config.channel_session_id : null;
  const template = typeof config.template === "string" ? config.template : null;
  if (!sessionId || !template) {
    return { type: "send_whatsapp_message", status: "failed", error: "missing_config" };
  }
  const contact = ctx.context.contact as { id: string; is_blocked?: boolean; phone_number?: string | null } | undefined;
  if (!contact) return { type: "send_whatsapp_message", status: "skipped", detail: { reason: "no_contact" } };
  if (contact.is_blocked) return { type: "send_whatsapp_message", status: "skipped", detail: { reason: "contact_blocked" } };
  if (!contact.phone_number) return { type: "send_whatsapp_message", status: "skipped", detail: { reason: "no_phone" } };

  const last = _lastSendAt.get(sessionId) ?? 0;
  const wait = last + AUTOMATED_SEND_SPACING_MS + jitterMs() - Date.now();
  if (wait > 0) await sleep(wait);
  _lastSendAt.set(sessionId, Date.now());

  try {
    const conversationId = await ensureConversation(ctx.admin, ctx.organizationId, contact.id, sessionId);
    const body = renderTemplate(template, ctx.context);
    const message = await sendMessageHandler(
      ctx.admin,
      {
        organization_id: ctx.organizationId,
        actor: { type: "webhook_source", id: ctx.ruleId },
        requestId: `rule:${ctx.ruleId}`,
      },
      { conversation_id: conversationId, type: "text", body } as Parameters<typeof sendMessageHandler>[2],
    );
    const meta = (message as { metadata?: Record<string, unknown> }).metadata ?? {};
    return {
      type: "send_whatsapp_message",
      status: "success",
      detail: {
        message_id: (message as { id: string }).id,
        conversation_id: conversationId,
        ...(meta.queued_reason ? { queued_reason: meta.queued_reason } : {}),
      },
    };
  } catch (err) {
    return {
      type: "send_whatsapp_message",
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

registerAction({ type: "send_whatsapp_message", postponeUntil, execute });
```

Notas: (a) `sendMessageHandler` faz `sent_via: ctx.actor.type === "ai_agent" ? "ai" : "user"` — com actor `webhook_source` sai `"user"` com `sent_by_user_id=null`; se o check constraint de `messages.sent_via` aceitar `'ai'`, prefira ajustar o handler para `ctx.actor.type !== "user" ? "ai" : "user"` (mantém a métrica de TTFR humana da 0037 correta, que filtra por `sent_by_user_id IS NOT NULL` — confirme no baseline e escolha o valor que não quebre o constraint); (b) adicionar `import "@/lib/automation/actions/send-whatsapp";` em `register-all.ts`.

- [ ] **Step 6: Rodar todos — PASS.** `npx vitest run lib/automation tests/invariants/automation-send-whatsapp.test.ts` e `npm run typecheck && npm run lint`.

- [ ] **Step 7: Commit**

```bash
git add lib/automation/ tests/invariants/automation-send-whatsapp.test.ts
git commit -m "feat(webhooks): ação send_whatsapp_message com throttle anti-banimento"
```

---

### Task 12: APIs de gestão — webhook-sources e automation-rules

**Files:**
- Create: `lib/schemas/webhooks.ts`
- Create: `app/api/v1/webhook-sources/route.ts` (GET lista, POST cria)
- Create: `app/api/v1/webhook-sources/[id]/route.ts` (PATCH, DELETE)
- Create: `app/api/v1/automation-rules/route.ts` (GET lista, POST cria)
- Create: `app/api/v1/automation-rules/[id]/route.ts` (PATCH, DELETE)
- Create: `app/api/v1/automation-rules/[id]/runs/route.ts` (GET lista runs)
- Create: `app/api/v1/automation-rules/runs/[runId]/resend/route.ts` (POST reexecuta call_webhook do run)
- Test: `lib/schemas/webhooks.test.ts`

**Interfaces:**
- Consumes: `requireRole` de `@/lib/auth/require-role`, `createClient` de `@/lib/supabase/server` (client RLS-scoped — as tabelas têm policy manager_write, mas o gate de rota é `requireRole("manager")` mesmo assim, padrão do repo), `ok`/`fail`, `audit`, actions da Task 6, `executeCallWebhook` da Task 10.
- Produces: contratos REST consumidos pela UI (plano Parte 2):
  - `GET /api/v1/webhook-sources` → `{data: WebhookSource[]}`; `POST` body `{name, default_pipeline_id, default_stage_id, redirect_to?, field_map?, secret?}` → 201 com a fonte criada (path_token gerado no server: `randomBytes(24).toString("base64url")`).
  - `PATCH /api/v1/webhook-sources/[id]` aceita `{name?, is_active?, redirect_to?, field_map?, default_pipeline_id?, default_stage_id?, secret?}`; `DELETE` → 204.
  - `GET /api/v1/automation-rules` → lista; `POST` body `{name, trigger_event, conditions?, actions}` → 201 (is_active NUNCA aceito no create — regra nasce pausada); `PATCH` aceita também `{is_active}` (o switch da UI).
  - `GET /api/v1/automation-rules/[id]/runs?limit=50` → runs desc.
  - `POST /api/v1/automation-rules/runs/[runId]/resend` → reexecuta SÓ as ações `call_webhook` do run (com o event payload persistido no run? NÃO — o run referencia `event_id`; recarregue o `event_log` row; se o evento foi apagado → 409 `event_gone`), grava run NOVO, audita `automation.run_resent`.

- [ ] **Step 1: Zod schemas + teste falhando**

`lib/schemas/webhooks.ts`:

```ts
import { z } from "zod";

export const TRIGGER_EVENTS = [
  "lead.created",
  "lead.stage_changed",
  "message.received",
  "lead.tag_added",
  "contact.tag_added",
] as const;

export const conditionSchema = z.object({
  field: z.string().min(1).max(200),
  op: z.enum(["eq", "neq", "contains"]),
  value: z.string().max(500),
});

export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create_or_move_lead"), config: z.object({ pipeline_id: z.string().uuid(), stage_id: z.string().uuid() }) }),
  z.object({ type: z.literal("send_whatsapp_message"), config: z.object({ channel_session_id: z.string().uuid(), template: z.string().min(1).max(2000) }) }),
  z.object({ type: z.literal("add_tag"), config: z.object({ tags: z.array(z.string().min(1).max(60)).min(1).max(10) }) }),
  z.object({ type: z.literal("assign_owner"), config: z.object({ user_id: z.string().uuid() }) }),
  z.object({ type: z.literal("call_webhook"), config: z.object({ url: z.string().url().max(2000), secret: z.string().max(200).optional() }) }),
]);

export const createWebhookSourceSchema = z.object({
  name: z.string().min(1).max(120),
  default_pipeline_id: z.string().uuid(),
  default_stage_id: z.string().uuid(),
  redirect_to: z.string().url().max(2000).nullish(),
  field_map: z
    .object({
      name: z.array(z.string()).optional(),
      phone: z.array(z.string()).optional(),
      email: z.array(z.string()).optional(),
    })
    .optional(),
  secret: z.string().min(16).max(200).nullish(),
});
export const updateWebhookSourceSchema = createWebhookSourceSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export const createAutomationRuleSchema = z.object({
  name: z.string().min(1).max(120),
  trigger_event: z.enum(TRIGGER_EVENTS),
  conditions: z.array(conditionSchema).max(10).default([]),
  actions: z.array(actionSchema).min(1).max(10),
});
export const updateAutomationRuleSchema = createAutomationRuleSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export type CreateWebhookSourceInput = z.infer<typeof createWebhookSourceSchema>;
export type UpdateWebhookSourceInput = z.infer<typeof updateWebhookSourceSchema>;
export type CreateAutomationRuleInput = z.infer<typeof createAutomationRuleSchema>;
export type UpdateAutomationRuleInput = z.infer<typeof updateAutomationRuleSchema>;
```

`lib/schemas/webhooks.test.ts` (siga o estilo de `lib/schemas/leads.test.ts`):

```ts
// 1. createWebhookSourceSchema: happy path passa; name vazio falha; uuid
//    inválido em default_pipeline_id falha; secret com <16 chars falha.
// 2. createAutomationRuleSchema: happy path com 1 ação de cada tipo passa;
//    trigger_event fora do enum falha; actions=[] falha; action de type
//    desconhecido falha; is_active no CREATE é rejeitado (strip: verifique
//    que o output NÃO contém is_active mesmo se enviado).
// 3. conditionSchema: op fora de eq/neq/contains falha.
// 4. updateAutomationRuleSchema: {is_active: true} sozinho passa.
```

Run: `npx vitest run lib/schemas/webhooks.test.ts` → FAIL, implementar, PASS.

- [ ] **Step 2: Rotas CRUD**

Siga EXATAMENTE o padrão de `app/api/v1/settings/api-tokens/route.ts` (leia antes): `requireRole("manager", { requestId, resource })`, client `createClient()` (RLS-scoped), Zod `safeParse` do body com `fail("invalid_request", ..., 400, {details: parsed.error.flatten()})`, audit em cada mutação. Pontos específicos:

```ts
// POST /api/v1/webhook-sources — gerar o token no server:
import { randomBytes } from "node:crypto";
const pathToken = randomBytes(24).toString("base64url");
// insert com organization_id: authz.org.orgId (NUNCA do body) e
// created_by_user_id: authz.user.id. Audit: "webhook.source_created".
// A resposta do POST/GET INCLUI path_token (a UI monta a URL com ele) —
// diferente de api_tokens, o path_token não é segredo forte: ele é a
// identidade pública da fonte (como o webhook_path_token do WAHA).

// POST /api/v1/automation-rules — parsed.data NÃO contém is_active (schema
// de create não tem o campo) → insert deixa o default FALSE do banco agir.
// Audit: "automation.rule_created".

// PATCH .../automation-rules/[id] — quando is_active mudou, audit
// "automation.rule_updated" com metadata {is_active}.

// DELETE ambos → .delete().eq("id", id) + noContent(requestId). Audit
// "webhook.source_deleted" / "automation.rule_deleted".

// GET runs: select em automation_rule_runs .eq("rule_id", id)
//   .order("created_at", {ascending: false}).limit(min(limit ?? 50, 100)).
```

`POST .../runs/[runId]/resend`:

```ts
// 1. requireRole("manager"). 2. Carrega o run (RLS-scoped — se não é da org,
//    some como 404). 3. Carrega a rule e o event_log row do run.event_id;
//    sem evento → fail("event_gone", ..., 409). 4. Reconstrói o context via
//    buildContext (exporte-a de lib/automation/engine.ts) e executa
//    executeCallWebhook para CADA ação call_webhook da rule. 5. Grava run
//    novo com os resultados + audit "automation.run_resent".
```

(Exportar `buildContext` exige trocar `async function buildContext` por `export async function buildContext` em `lib/automation/engine.ts`.)

- [ ] **Step 3: Verificação manual das rotas** (não há harness de route-test no repo além dos invariantes; o E2E da Parte 2 cobre o fluxo)

Run: `npm run dev` em background e, com um cookie de sessão de manager do seed E2E (`scripts/seed-e2e-credentials.ts` gera `.e2e-creds.json`), exercite com curl:
`POST /api/v1/webhook-sources` (201, path_token presente) → `GET` (lista 1) → `PATCH is_active:false` (200) → `POST /api/v1/automation-rules` com 1 ação `add_tag` (201, is_active=false no retorno) → `PATCH {is_active:true}` (200) → `DELETE` ambos (204).
Expected: códigos acima; qualquer 500 é bug — corrija antes de commitar.

- [ ] **Step 4:** `npm run typecheck && npm run lint` zerados.

- [ ] **Step 5: Commit**

```bash
git add lib/schemas/webhooks.ts lib/schemas/webhooks.test.ts app/api/v1/webhook-sources/ app/api/v1/automation-rules/
git commit -m "feat(webhooks): APIs de gestão de fontes e regras + Zod"
```

---

### Task 13: Verificação final do backend

**Files:** nenhum novo — gate de qualidade.

- [ ] **Step 1:** Rodar TODOS os testes novos de uma vez:

Run: `npx vitest run lib/webhooks lib/automation lib/schemas/webhooks.test.ts` e o comando de invariantes para `tests/invariants/webhooks-*.test.ts tests/invariants/automation-*.test.ts tests/invariants/event-log-drain.test.ts`
Expected: tudo PASS.

- [ ] **Step 2:** Rodar a suíte PRÉ-EXISTENTE de invariantes (regressão — as RLS de 0035/0036 e os handlers de leads/contacts foram tocados):

Run: comando de invariantes do repo para `tests/invariants/` inteiro
Expected: PASS. `gov-*` quebrando = regressão SUA (provavelmente na Task 3 ou 4) — corrija.

- [ ] **Step 3:** `npm run typecheck && npm run lint && npm run test:unit` zerados.

- [ ] **Step 4:** Fluxo real de ponta a ponta via curl (npm run dev + seed E2E):

```bash
# 1. Criar fonte via API (manager) → anotar path_token.
# 2. Criar regra: trigger lead.created, ação add_tag {tags:["from-webhook"]} → PATCH is_active:true.
# 3. curl -X POST http://localhost:3000/api/v1/webhooks/in/<path_token> \
#      -H 'Content-Type: application/json' \
#      -d '{"nome":"Teste E2E","telefone":"11912345678","utm_source":"plano"}'
#    Expected: 200 {data:{lead_id}}.
# 4. curl POST /api/v1/cron/event-log-drain com Bearer $INTERNAL_SECRET.
#    Expected: 200 com summary.done >= 1.
# 5. Verificar (psql/Supabase): lead tem tags=['from-webhook'];
#    automation_rule_runs tem 1 run status='success'.
```

Expected: os 5 passos observados com evidência (cole os outputs no resumo da task).

- [ ] **Step 5: Commit final (se houve fix)** e push do branch:

```bash
git push -u origin feat/webhooks-automation
```

---

## Cobertura da spec (self-check do plano)

| Spec § | Task |
|---|---|
| §4 modelo de dados + §13 doutrina migrations | 1 |
| §6 drain genérico | 2 |
| §7 emissões de gatilho | 3 |
| §5 endpoint inbound | 4, 5, 6 |
| §7 motor (condições, anti-loop, runs) | 7, 8 |
| §8 ações | 9, 10, 11 |
| §8 throttle anti-banimento | 11 |
| §9 API de gestão (UI consome) | 12 |
| §10 segurança (RLS, rate limit, HMAC, SSRF) | 1, 5, 6, 10 |
| §11 testes | todas + 13 |
| §6 crontab kit HostGator + §9 UI + E2E Playwright | **Plano Parte 2** (`2026-07-17-webhooks-ui.md`) |





