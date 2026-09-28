# Fase 3 — Intent Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um canal de WhatsApp pode ter um *router* que classifica a intenção da mensagem e entrega a conversa ao agente certo entre vários — com aderência por conversa (stickiness), fallback e telemetria de cada decisão.

**Architecture:** Duas tabelas editáveis (`ai_routers` 1:1 com `channel_session`, `ai_router_members` N agentes com intenções declaradas) + um resolvedor único `resolveTurnAgent` que substitui a chamada direta a `loadPublishedAgentConfig` no turno. O resolvedor decide nesta ordem: sticky (conversa já tem agente e a mensagem não mudou de assunto) → classificação Haiku com saída JSON → fallback → comportamento atual. Cada decisão vira uma linha em `ai_router_decisions` (sem PII).

**Tech Stack:** Postgres/Supabase (RLS + triggers de audit/updated_at), pg Pool no engine, `runModelCall` (seam de LLM existente), Next.js App Router + React Query + `apiClient`, Zod, Vitest, Playwright.

## Global Constraints

- **Migration NNNN = 0085** (⚠️ NÃO 0070: a branch atual tem 0067-0069 e a `main` tem 0067+0070-0084 — as linhas divergiram; `ls | tail` local dá resposta errada e colidiria com 5 arquivos da main). Timestamp `20260726000000`. Doutrina: arquivo versionado idempotente + apêndice idempotente no `baseline.sql` + linha no `MANIFEST.md` (declarando NNNN=0085 e a verificação anti-colisão **em todas as refs, incluindo `main`**).
- **RLS em toda tabela nova** (`tenant_isolation_<t>_all` via o loop padrão) + teste de isolamento cobre as tabelas novas. Triggers `fn_audit_log_row()` e `fn_set_updated_at` anexados às tabelas editáveis (a 0067 esqueceu o de updated_at — não repetir).
- **ORDEM DOS GUARDS (inegociável)**: o router entra EXATAMENTE onde hoje está `loadPublishedAgentConfig` (`inbound-turn.ts:538`), ou seja, DEPOIS de `isLeadInHandoff` (linha 530). Quem está em `force_human`/`bot_silenced_until` **nunca** é classificado. Os guards de pedido-de-humano (600) e STOP/opt-out (620) continuam onde estão — aceita-se o custo de 1 chamada Haiku num turno que morre depois (decisão registrada; reordenar quebraria 5 dependências cruzadas, entre elas `matchesHandoffKeyword` que consome `agentConfig`).
- **DECISÃO DE PRODUTO (Rafael, 2026-07-26): sem match e sem fallback ⇒ RESPONDE COM O GENÉRICO** — mantém o comportamento atual (`agentConfig === null` ⇒ o turno segue com playbook de plataforma + `settings.llm` da org). NÃO implementar silêncio; NÃO adicionar early-return. A spec dizia "sem resposta de IA" e está desatualizada em relação ao código; este plano governa.
- **DECISÃO DE PRODUTO (Rafael, 2026-07-26): stickiness = só troca com mudança clara de assunto** — a conversa guarda o agente escolhido; turnos seguintes o mantêm sem reclassificar, salvo quando a classificação devolver outra intenção com confiança ≥ `min_confidence`. Handoff/fechamento limpa a atribuição.
- **Classificador**: modelo vem de `ai_routers.config.classifier_model` (default `claude-haiku-4-5`) — config de banco, nunca id hardcoded no código do runtime. `purpose: 'intent_router'` no `runModelCall` (custo entra em `llm_calls` automaticamente). Saída JSON parseada com o padrão tolerante do flywheel (`indexOf('{')`/`lastIndexOf('}')`).
- **Degradação nunca quebra o turno**: qualquer falha do classificador (erro de modelo, `LlmModelNotEnabledError` quando a org restringe `enabled_models`, JSON inválido, timeout) ⇒ cai no `fallback_agent_id`; sem fallback ⇒ comportamento atual. Try/catch com log, nunca throw.
- **Sem PII na telemetria**: `ai_router_decisions` NÃO grava o texto do lead (regra dura do repo). Para exibir "o que o cliente disse", a UI puxa de `messages` pelo `conversation_id`.
- **API**: `ok()`/`fail()` de `@/lib/api/wrappers` — `ok()` já embrulha em `{data}`, nunca `ok({data:...})`. Zod em todo input. `organization_id` SEMPRE de `requireRole`, nunca do body. Audit em toda mutação.
- **Teste imediato por peça** (protocolo do épico): front = Playwright clicando + avaliação de experiência (leigo entende?), qualquer "não" corrige antes de seguir; back = teste funcional na hora. **Ambiente compartilhado**: inventariar processos vivos antes de provas (`lsof -iTCP:3000/-iTCP:8787` + `ps -o lstart`), worker de prova é o do REPO PRINCIPAL, limpar dado de teste do banco ao fim (a org de dev tem um agente REAL do Rafael no WhatsApp).
- **Vínculo agente↔canal**: membros de router são carregados por `agent_id` (`loadPublishedAgentConfigById`), então um agente membro NÃO precisa de `channel_session_id` na sua versão publicada — a spec pede isso e é atendido pela variante, sem mudar a query antiga (canais sem router continuam usando `loadPublishedAgentConfig` por sessão, intacta). A única pendência é de UI (aviso na tela do agente, Task 7 Step 4).
- **Handoff vivo** `HANDOFF-harness-evolution.md` alimentado ao fim de CADA task. Doutrina **sistema vivo**: router entra no mapa `docs/architecture/` com ≥2 arestas. Nunca `cmd | tail`; `graphify query` antes de ler código; copy pt-br; commits `feat(harness-f3): ...`.

---

### Task 1: Migration 0085 (routers, members, decisions, stickiness)

**Files:**
- Create: `supabase/migrations/20260726000000_0085_intent_router.sql`
- Modify: `supabase/baseline.sql` (apêndice; array do loop RLS)
- Modify: `supabase/migrations/MANIFEST.md`
- Modify: `tests/invariants/rls-isolation.test.ts`
- Modify: `lib/database.types.ts` (regenerado)

**Interfaces:**
- Produces: tabelas `ai_routers`, `ai_router_members`, `ai_router_decisions`; colunas `conversations.active_ai_agent_id`, `conversations.active_intent`, `conversations.active_agent_set_at`. Consumidas pelas Tasks 2-6.

- [ ] **Step 1: Escrever a migration**

```sql
-- 0085: Intent Router (Fase 3 do épico harness — spec 2026-07-23).
-- Um router pluga num channel_session e roteia a conversa para o agente cuja
-- intenção declarada casa com a mensagem. Tabelas EDITÁVEIS (não versão+ponteiro):
-- mutação é auditada por trigger, como ai_agents.

create table if not exists ai_routers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null check (length(name) > 0),
  channel_session_id uuid not null references channel_sessions(id) on delete cascade,
  is_active boolean not null default true,
  config jsonb not null default jsonb_build_object(
    'classifier_model', 'claude-haiku-4-5',
    'sticky', true,
    'min_confidence', 0.6
  ),
  fallback_agent_id uuid references ai_agents(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Um router ativo por sessão de canal (dois routers disputando o mesmo número
-- seria ambiguidade de roteamento — o índice parcial impede).
create unique index if not exists uniq_ai_routers_active_session
  on ai_routers (channel_session_id) where is_active;

create table if not exists ai_router_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  router_id uuid not null references ai_routers(id) on delete cascade,
  agent_id uuid not null references ai_agents(id) on delete cascade,
  intent_name text not null check (length(intent_name) > 0),
  intent_description text not null check (length(intent_description) > 0),
  examples text[] not null default '{}',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (router_id, intent_name)
);

create index if not exists idx_ai_router_members_router
  on ai_router_members (router_id, position);

-- Telemetria de decisão (append-only, SEM PII — o texto do lead nunca entra aqui).
create table if not exists ai_router_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  router_id uuid references ai_routers(id) on delete set null,
  conversation_id uuid,
  intent_name text,
  confidence numeric(4,3),
  agent_id uuid references ai_agents(id) on delete set null,
  outcome text not null check (outcome in ('classified', 'sticky', 'reclassified', 'fallback', 'no_match', 'classifier_failed')),
  job_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_router_decisions_org_created
  on ai_router_decisions (organization_id, created_at);
create index if not exists idx_ai_router_decisions_router
  on ai_router_decisions (router_id, created_at);

-- Stickiness por conversa: qual agente o router entregou e qual intenção.
alter table conversations add column if not exists active_ai_agent_id uuid references ai_agents(id) on delete set null;
alter table conversations add column if not exists active_intent text;
alter table conversations add column if not exists active_agent_set_at timestamptz;

-- Triggers: audit de mutação + updated_at (padrão de ai_agents).
drop trigger if exists trg_ai_routers_audit on ai_routers;
create trigger trg_ai_routers_audit
  after insert or update or delete on ai_routers
  for each row execute function fn_audit_log_row();
drop trigger if exists trg_ai_routers_updated_at on ai_routers;
create trigger trg_ai_routers_updated_at
  before update on ai_routers
  for each row execute function fn_set_updated_at();

drop trigger if exists trg_ai_router_members_audit on ai_router_members;
create trigger trg_ai_router_members_audit
  after insert or update or delete on ai_router_members
  for each row execute function fn_audit_log_row();
drop trigger if exists trg_ai_router_members_updated_at on ai_router_members;
create trigger trg_ai_router_members_updated_at
  before update on ai_router_members
  for each row execute function fn_set_updated_at();

-- RLS (mesmo shape do loop tenant_isolation_* do baseline).
do $$
declare t text;
begin
  foreach t in array array['ai_routers', 'ai_router_members', 'ai_router_decisions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation_%s_all on public.%I', t, t);
    execute format(
      'create policy tenant_isolation_%s_all on public.%I for all
         using (organization_id in (select * from public.fn_user_org_ids()))
         with check (organization_id in (select * from public.fn_user_org_ids()))',
      t, t
    );
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
```

- [ ] **Step 2: Apêndice idempotente no `baseline.sql`** — AO FIM do arquivo, o mesmo SQL do Step 1 verbatim, precedido de:

```sql
-- ---- intent router: ai_routers/members/decisions + stickiness (migration 0085) ----
```

- [ ] **Step 3: Linha no MANIFEST** (`supabase/migrations/MANIFEST.md`):

```
| `20260726000000` | `0085_intent_router` | Épico Harness (F3): `ai_routers` (1 ativo por channel_session, config classifier_model/sticky/min_confidence, fallback_agent_id), `ai_router_members` (agente + intenção declarada + exemplos), `ai_router_decisions` (telemetria append-only sem PII); `conversations` ganha `active_ai_agent_id`/`active_intent`/`active_agent_set_at` (stickiness). Triggers de audit + updated_at nas editáveis. RLS `tenant_isolation_*_all`. NNNN=0085 — verificado em TODAS as refs (locais + origin): branch atual tem 0067-0069, `main` tem 0070-0084; 0085 é o primeiro livre em ambas as linhas. `database.types.ts` regenerado. |
```

- [ ] **Step 4: Aplicar e provar idempotência**

Aplicar contra o banco dev (`SUPABASE_DB_URL` do `.env.local`; se a role não tiver DDL, usar `supabase db query --linked` como nas fases anteriores). Depois:

Run: `psql "$DBURL" -tAc "select count(*) from ai_routers; select count(*) from ai_router_decisions; select column_name from information_schema.columns where table_name='conversations' and column_name like 'active_%' order by column_name;"`
Expected: `0`, `0`, e as 3 colunas `active_agent_set_at`/`active_ai_agent_id`/`active_intent`.
Re-aplicar o MESMO arquivo → sem erro (idempotência).

- [ ] **Step 5: Regenerar `lib/database.types.ts`** — como nas fases anteriores; se a regen trouxer tabelas de outras branches (banco dev é compartilhado), REDUZIR o diff ao que 0085 adiciona (3 tabelas novas + as 3 colunas de `conversations`). O arquivo DEVE conter `ai_router_decisions`; `npm run typecheck` → exit 0.

- [ ] **Step 6: Teste de isolamento RLS** — em `tests/invariants/rls-isolation.test.ts`: adicionar `"ai_routers"`, `"ai_router_decisions"` ao array `TABLES` e semear 1 linha por org no `beforeAll` (usar as constantes `ORG_A`/`ORG_B` do arquivo). `ai_routers` precisa de um `channel_session_id` válido — se o seed do teste não tiver um, criar um `channel_sessions` mínimo por org no mesmo bloco, ou semear só `ai_router_decisions` (que não tem FK obrigatória além de org) e anotar no report qual caminho usou e por quê.

Run: `npm run test:db` (docker) → PASS. Se docker indisponível, smoke manual (cross-tenant count=0, own-org ≥1) e reportar.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260726000000_0085_intent_router.sql supabase/baseline.sql supabase/migrations/MANIFEST.md tests/invariants/rls-isolation.test.ts lib/database.types.ts
git commit -m "feat(harness-f3): schema do intent router (0085) — routers, members, decisions, stickiness"
```

---

### Task 2: Carregar router + config do agente por id

**Files:**
- Modify: `lib/agent-engine/agent/agent-config.ts` (nova função ao lado de `loadPublishedAgentConfig`)
- Create: `lib/agent-engine/agent/router-config.ts`
- Test: `lib/agent-engine/agent/router-config.test.ts`

**Interfaces:**
- Consumes: tabelas da Task 1; `PublishedAgentConfig` (interface existente em `agent-config.ts`, com `agentId/versionId/agentName/systemPrompt/provider/model/credentialId/maxSteps/historyMessageWindow/historyTokenWindow/handoffKeywords/handoffToolEnabled/toolIds/activeKbVersionId/ragTopK/ragSimilarityThreshold/versionCreatedBy/agentCreatedBy`).
- Produces (Tasks 3-5 consomem):

```ts
// em agent-config.ts — variante por agent_id (membros de router NÃO exigem vínculo com a sessão)
export async function loadPublishedAgentConfigById(
  db: pg.Pool, organizationId: string, agentId: string,
): Promise<PublishedAgentConfig | null>;

// em router-config.ts
export interface RouterMember { agentId: string; intentName: string; intentDescription: string; examples: string[] }
export interface LoadedRouter {
  id: string;
  name: string;
  classifierModel: string;
  sticky: boolean;
  minConfidence: number;
  fallbackAgentId: string | null;
  members: RouterMember[];
}
export async function loadActiveRouter(
  db: pg.Pool, organizationId: string, channelSessionId: string,
): Promise<LoadedRouter | null>;   // null = canal sem router (fluxo atual)
```

- [ ] **Step 1: Testes que falham**

```ts
// lib/agent-engine/agent/router-config.test.ts
import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';

import { loadActiveRouter } from './router-config';

function poolSeq(responses: Array<{ rows: unknown[] }>): pg.Pool {
  const query = vi.fn();
  for (const r of responses) query.mockResolvedValueOnce(r);
  return { query } as unknown as pg.Pool;
}

describe('loadActiveRouter', () => {
  it('devolve null quando o canal não tem router ativo', async () => {
    const router = await loadActiveRouter(poolSeq([{ rows: [] }]), 'org1', 'cs1');
    expect(router).toBeNull();
  });

  it('monta router com membros ordenados por position', async () => {
    const pool = poolSeq([
      { rows: [{ id: 'r1', name: 'Atendimento', config: { classifier_model: 'claude-haiku-4-5', sticky: true, min_confidence: 0.6 }, fallback_agent_id: 'a-fb' }] },
      { rows: [
        { agent_id: 'a2', intent_name: 'suporte', intent_description: 'Problemas técnicos', examples: ['não consigo entrar'] },
        { agent_id: 'a1', intent_name: 'vendas', intent_description: 'Quer comprar', examples: [] },
      ] },
    ]);
    const router = await loadActiveRouter(pool, 'org1', 'cs1');
    expect(router?.id).toBe('r1');
    expect(router?.classifierModel).toBe('claude-haiku-4-5');
    expect(router?.sticky).toBe(true);
    expect(router?.minConfidence).toBe(0.6);
    expect(router?.fallbackAgentId).toBe('a-fb');
    expect(router?.members.map((m) => m.intentName)).toEqual(['suporte', 'vendas']);
  });

  it('config malformada cai nos defaults (haiku, sticky, 0.6)', async () => {
    const pool = poolSeq([
      { rows: [{ id: 'r1', name: 'X', config: { min_confidence: 'muito' }, fallback_agent_id: null }] },
      { rows: [] },
    ]);
    const router = await loadActiveRouter(pool, 'org1', 'cs1');
    expect(router?.classifierModel).toBe('claude-haiku-4-5');
    expect(router?.sticky).toBe(true);
    expect(router?.minConfidence).toBe(0.6);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run lib/agent-engine/agent/router-config.test.ts` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar `router-config.ts`** — no estilo de `agent-config.ts` (doc-comment de doutrina, zero cache, escopo por org sempre no SQL). Duas queries: router ativo (`where organization_id = $1 and channel_session_id = $2 and is_active`) e membros (`where router_id = $1 and organization_id = $2 order by position asc, intent_name asc`). Leitura DEFENSIVA do `config` jsonb (campo com shape errado cai no default, nunca derruba o turno): `classifier_model` string não-vazia senão `'claude-haiku-4-5'`; `sticky` boolean senão `true`; `min_confidence` número entre 0 e 1 senão `0.6`.

- [ ] **Step 4: Implementar `loadPublishedAgentConfigById`** em `agent-config.ts` — MESMO SELECT de `loadPublishedAgentConfig` (as 17 colunas + o mapeamento de `config`/rag knobs — extrair o mapeamento numa função interna compartilhada `mapAgentConfigRow(r)` para não duplicar o bloco), trocando o filtro `and v.channel_session_id = $2` por `and a.id = $2`, e sem `order by/limit` (id é único). Comentário pt-br explicando por que a variante existe: membros de router não exigem vínculo com a sessão.

- [ ] **Step 5: Verde + typecheck + commit**

Run: `npx vitest run lib/agent-engine/agent` → PASS; `npm run typecheck` → 0.

```bash
git add lib/agent-engine/agent/router-config.ts lib/agent-engine/agent/router-config.test.ts lib/agent-engine/agent/agent-config.ts
git commit -m "feat(harness-f3): loader do router + config do agente por id"
```

---

### Task 3: Classificador de intenção (Haiku, JSON, degradação)

**Files:**
- Create: `lib/agent-engine/agent/intent-classifier.ts`
- Test: `lib/agent-engine/agent/intent-classifier.test.ts`

**Interfaces:**
- Consumes: `LoadedRouter`/`RouterMember` (Task 2); `runModelCall(db, cfg, input, deps)` de `lib/agent-engine/edge/llm/run-model-call.ts` — `input` aceita `{ tenantId, leadId?, jobId?, purpose?, system?, messages: ModelMessage[], model?, maxSteps? }` e o retorno tem `result.text`.
- Produces (Task 4 consome):

```ts
export interface IntentVerdict { intentName: string | null; confidence: number }
export function buildClassifierPrompt(members: RouterMember[], signal: string): string;
export function parseIntentVerdict(text: string, members: RouterMember[]): IntentVerdict;  // desconhecido/inválido → { intentName: null, confidence: 0 }
export async function classifyIntent(
  db: pg.Pool,
  llmCfg: LlmEdgeConfig,
  input: { tenantId: string; leadId: string; jobId: string; router: LoadedRouter; signal: string },
  deps: { log: Logger },
): Promise<IntentVerdict | null>;   // null = classificador FALHOU (chamador cai no fallback)
```

- [ ] **Step 1: Testes que falham**

```ts
// lib/agent-engine/agent/intent-classifier.test.ts
import { describe, expect, it, vi } from 'vitest';
import { buildClassifierPrompt, parseIntentVerdict, classifyIntent } from './intent-classifier';

const members = [
  { agentId: 'a1', intentName: 'vendas', intentDescription: 'Quer comprar ou saber preço', examples: ['quanto custa'] },
  { agentId: 'a2', intentName: 'suporte', intentDescription: 'Problema técnico', examples: [] },
];
const router = { id: 'r1', name: 'R', classifierModel: 'claude-haiku-4-5', sticky: true, minConfidence: 0.6, fallbackAgentId: null, members };

describe('buildClassifierPrompt', () => {
  it('lista as intenções com descrição e a opção none', () => {
    const p = buildClassifierPrompt(members, 'quanto custa o plano?');
    expect(p).toContain('vendas');
    expect(p).toContain('Quer comprar ou saber preço');
    expect(p).toContain('suporte');
    expect(p).toContain('none');
    expect(p).toContain('quanto custa o plano?');
  });
});

describe('parseIntentVerdict', () => {
  it('extrai intenção e confiança do JSON', () => {
    expect(parseIntentVerdict('{"intent":"vendas","confidence":0.9}', members)).toEqual({ intentName: 'vendas', confidence: 0.9 });
  });
  it('aceita JSON cercado de texto', () => {
    expect(parseIntentVerdict('Claro!\n{"intent":"suporte","confidence":0.7}\n', members)).toEqual({ intentName: 'suporte', confidence: 0.7 });
  });
  it('none vira intentName null', () => {
    expect(parseIntentVerdict('{"intent":"none","confidence":0.2}', members)).toEqual({ intentName: null, confidence: 0.2 });
  });
  it('intenção que não existe no router é recusada (modelo alucinou)', () => {
    expect(parseIntentVerdict('{"intent":"financeiro","confidence":0.95}', members)).toEqual({ intentName: null, confidence: 0 });
  });
  it('JSON inválido vira veredito nulo, sem throw', () => {
    expect(parseIntentVerdict('desculpe, não sei', members)).toEqual({ intentName: null, confidence: 0 });
  });
  it('confiança fora de 0..1 é clampada', () => {
    expect(parseIntentVerdict('{"intent":"vendas","confidence":7}', members).confidence).toBe(1);
  });
});

describe('classifyIntent', () => {
  it('usa o modelo do router e purpose intent_router', async () => {
    const runModelCall = vi.fn().mockResolvedValue({ result: { text: '{"intent":"vendas","confidence":0.88}' } });
    const out = await classifyIntent({} as never, {} as never,
      { tenantId: 'o1', leadId: 'l1', jobId: 'j1', router, signal: 'quanto custa' },
      { log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never, runModelCall } as never);
    expect(out).toEqual({ intentName: 'vendas', confidence: 0.88 });
    const call = runModelCall.mock.calls[0][2];
    expect(call.model).toBe('claude-haiku-4-5');
    expect(call.purpose).toBe('intent_router');
  });

  it('falha do modelo devolve null (chamador cai no fallback) e NÃO lança', async () => {
    const runModelCall = vi.fn().mockRejectedValue(new Error('model not enabled'));
    const warn = vi.fn();
    const out = await classifyIntent({} as never, {} as never,
      { tenantId: 'o1', leadId: 'l1', jobId: 'j1', router, signal: 'oi' },
      { log: { info: vi.fn(), warn, error: vi.fn() } as never, runModelCall } as never);
    expect(out).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run lib/agent-engine/agent/intent-classifier.test.ts` → FAIL.

- [ ] **Step 3: Implementar.** `deps` aceita `runModelCall` injetável (default = o real, para o teste não precisar de rede — mesmo padrão de `searchKnowledge` da Fase 0 com `deps.embed`). Prompt em pt-br pedindo JSON estrito: instrução final `Responda SOMENTE JSON: {"intent": "<nome exato de uma intenção da lista ou none>", "confidence": <0 a 1>}`. Parse com o padrão tolerante (`indexOf('{')` / `lastIndexOf('}')` + `JSON.parse` em try/catch); intenção fora da lista de membros ⇒ `{ intentName: null, confidence: 0 }` (defesa contra alucinação); `confidence` não-numérico ⇒ 0, fora de faixa ⇒ clamp em [0,1]. `classifyIntent` envolve tudo em try/catch: qualquer erro ⇒ `log.warn` + `return null`.

- [ ] **Step 4: Verde + typecheck + commit**

Run: `npx vitest run lib/agent-engine/agent/intent-classifier.test.ts` → PASS; `npm run typecheck` → 0.

```bash
git add lib/agent-engine/agent/intent-classifier.ts lib/agent-engine/agent/intent-classifier.test.ts
git commit -m "feat(harness-f3): classificador de intenção (haiku, JSON tolerante, degrada sem quebrar)"
```

---

### Task 4: Resolvedor `resolveTurnAgent` (sticky → classificação → fallback)

**Files:**
- Create: `lib/agent-engine/agent/resolve-turn-agent.ts`
- Test: `lib/agent-engine/agent/resolve-turn-agent.test.ts`

**Interfaces:**
- Consumes: `loadActiveRouter`, `loadPublishedAgentConfigById` (Task 2); `classifyIntent` (Task 3); `loadPublishedAgentConfig` (existente).
- Produces (Task 5 consome):

```ts
export interface TurnAgentResolution {
  config: PublishedAgentConfig | null;     // null ⇒ turno segue no genérico (comportamento atual)
  routerId: string | null;
  intentName: string | null;
  confidence: number | null;
  outcome: 'no_router' | 'classified' | 'sticky' | 'reclassified' | 'fallback' | 'no_match' | 'classifier_failed';
}
export async function resolveTurnAgent(
  db: pg.Pool,
  llmCfg: LlmEdgeConfig,
  input: {
    tenantId: string; leadId: string; jobId: string;
    channelSessionId: string; conversationId: string;
    signal: string | null;                  // última mensagem inbound; null ⇒ não classifica
    stickyAgentId: string | null;           // conversations.active_ai_agent_id
    stickyIntent: string | null;
  },
  deps: { log: Logger },
): Promise<TurnAgentResolution>;
```

**Regra de decisão (implementar exatamente assim):**
1. `loadActiveRouter` → null ⇒ `{ config: await loadPublishedAgentConfig(...), routerId: null, intentName: null, confidence: null, outcome: 'no_router' }` (fluxo atual intacto).
2. Router existe. Se `router.sticky && stickyAgentId` e o agente ainda é membro do router: classifica assim mesmo (barato, é o que detecta mudança de assunto). Se a classificação devolver `intentName` **diferente** do `stickyIntent` **e** `confidence >= minConfidence` ⇒ troca (`outcome: 'reclassified'`). Senão ⇒ mantém o sticky (`outcome: 'sticky'`, `confidence` do veredito para telemetria).
3. Sem sticky: classifica. `intentName` não-nulo e `confidence >= minConfidence` ⇒ agente do membro (`outcome: 'classified'`).
4. Classificação nula (falha) ⇒ fallback se houver (`outcome: 'classifier_failed'`).
5. Sem match / confiança baixa ⇒ fallback se houver (`outcome: 'fallback'`), senão `config: null` + `outcome: 'no_match'` (⇒ genérico, decisão do Rafael).
6. `signal === null` (sem mensagem inbound — ex.: follow-up) ⇒ sticky se houver, senão fallback, senão genérico; nunca classifica.

- [ ] **Step 1: Testes que falham** — cobrir os 6 caminhos acima com `loadActiveRouter`/`classifyIntent`/`loadPublishedAgentConfigById`/`loadPublishedAgentConfig` injetados via `deps` (adicionar esses 4 como deps opcionais com default real, mesmo padrão da Task 3). Casos mínimos:

```ts
// lib/agent-engine/agent/resolve-turn-agent.test.ts — casos:
// 1. canal sem router → outcome 'no_router', usa loadPublishedAgentConfig (por sessão)
// 2. router + classificação alta confiança → 'classified', config do agente da intenção
// 3. sticky + mesma intenção → 'sticky', NÃO troca de agente (config do stickyAgentId)
// 4. sticky + intenção diferente com confiança >= min → 'reclassified', config do novo agente
// 5. sticky + intenção diferente com confiança ABAIXO do min → 'sticky' (não troca)
// 6. classificador falhou (null) + fallback configurado → 'classifier_failed', config do fallback
// 7. sem match + SEM fallback → 'no_match' e config === null (genérico)
// 8. signal null (follow-up) → nunca chama classifyIntent
```

Cada caso asserta `outcome` E qual `agentId` acabou em `config` (não só o outcome).

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run lib/agent-engine/agent/resolve-turn-agent.test.ts` → FAIL.

- [ ] **Step 3: Implementar** conforme a regra de decisão acima. Nenhuma exceção escapa: envolver a parte de router em try/catch que, em erro inesperado, cai em `loadPublishedAgentConfig` (fluxo atual) com `outcome: 'classifier_failed'` e log — o router nunca pode derrubar um turno.

- [ ] **Step 4: Verde + typecheck + commit**

```bash
git add lib/agent-engine/agent/resolve-turn-agent.ts lib/agent-engine/agent/resolve-turn-agent.test.ts
git commit -m "feat(harness-f3): resolvedor do turno (sticky, classificação, fallback, genérico)"
```

---

### Task 5: Costura no turno + persistência do sticky + telemetria

**Files:**
- Modify: `lib/agent-engine/agent/inbound-turn.ts` (~L538, onde hoje está `loadPublishedAgentConfig`)
- Modify: `lib/agent-engine/agent/human-handoff.ts` (`performHumanHandoff` limpa o sticky)

**Interfaces:**
- Consumes: `resolveTurnAgent` (Task 4); no arquivo já existem `pool`, `tenantId`, `leadId`, `job`, `input.channelSessionId`, `input.conversationId`, `runLog`, `deps.llmCfg`.
- Produces: `agentConfig` continua sendo a mesma variável que o resto do turno usa (nada mais muda); `conversations.active_ai_agent_id/active_intent/active_agent_set_at` atualizados; 1 linha em `ai_router_decisions` por turno com router.

- [ ] **Step 1: Ler o ponto de costura** — `graphify query "onde inbound-turn chama loadPublishedAgentConfig e o que usa agentConfig depois"`, depois ler `inbound-turn.ts` em torno de L520-560. Confirmar que `isLeadInHandoff` (≈L530) roda ANTES — se não rodar, PARAR e reportar NEEDS_CONTEXT (o guard é inegociável).

- [ ] **Step 2: Buscar o sticky e o sinal.** ANTES da resolução, carregar o estado da conversa (uma query, barata):

```ts
  // Fase 3: stickiness do router — qual agente já atende esta conversa.
  const { rows: convRows } = await pool.query<{ active_ai_agent_id: string | null; active_intent: string | null }>(
    'select active_ai_agent_id, active_intent from conversations where organization_id = $1 and id = $2',
    [tenantId, input.conversationId],
  );
  const sticky = convRows[0] ?? { active_ai_agent_id: null, active_intent: null };
```

O `signal` (última mensagem inbound) NÃO está disponível em L538 — `getLeadContext` só roda em ~L582. Usar uma leitura direta e barata da última inbound desta conversa:

```ts
  const { rows: sigRows } = await pool.query<{ body: string | null }>(
    `select body from messages
     where organization_id = $1 and conversation_id = $2 and direction = 'inbound'
     order by created_at desc limit 1`,
    [tenantId, input.conversationId],
  );
  const routingSignal = sigRows[0]?.body ?? null;
```

- [ ] **Step 3: Substituir a chamada.** Trocar a linha `const agentConfig = await loadPublishedAgentConfig(pool, tenantId, input.channelSessionId);` por:

```ts
  const routed = await resolveTurnAgent(
    pool,
    deps.llmCfg,
    {
      tenantId,
      leadId,
      jobId: job.id,
      channelSessionId: input.channelSessionId,
      conversationId: input.conversationId,
      signal: routingSignal,
      stickyAgentId: sticky.active_ai_agent_id,
      stickyIntent: sticky.active_intent,
    },
    { log: runLog },
  );
  const agentConfig = routed.config;
```

Manter o `runLog.info('config do agente publicada em uso', ...)` existente logo abaixo, acrescentando `router_outcome: routed.outcome` e `intent: routed.intentName` aos campos.

- [ ] **Step 4: Persistir sticky + telemetria** (logo após, fire-and-forget — falha só loga, nunca quebra o turno):

```ts
  // Fase 3: grava a decisão de roteamento e a aderência da conversa ao agente.
  if (routed.routerId !== null) {
    try {
      if (agentConfig !== null) {
        await pool.query(
          `update conversations
           set active_ai_agent_id = $3, active_intent = $4, active_agent_set_at = now()
           where organization_id = $1 and id = $2`,
          [tenantId, input.conversationId, agentConfig.agentId, routed.intentName],
        );
      }
      await pool.query(
        `insert into ai_router_decisions
           (organization_id, router_id, conversation_id, intent_name, confidence, agent_id, outcome, job_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [tenantId, routed.routerId, input.conversationId, routed.intentName, routed.confidence, agentConfig?.agentId ?? null, routed.outcome, job.id],
      );
    } catch (err) {
      runLog.warn('decisão do router não gravada', { error: (err instanceof Error ? err.message : String(err)).slice(0, 120) });
    }
  }
```

- [ ] **Step 5: Limpar sticky no handoff.** Em `human-handoff.ts`, dentro de `performHumanHandoff` (que já recebe `{ tenantId, leadId, conversationId }`), acrescentar ao lado dos updates existentes:

```sql
update conversations
set active_ai_agent_id = null, active_intent = null, active_agent_set_at = null
where organization_id = $1 and id = $2
```

Comentário pt-br: quem foi para humano perde a aderência ao agente — se o bot for reativado, o router decide de novo.

- [ ] **Step 6: Suite do engine + typecheck**

Run: `npx vitest run lib/agent-engine` → PASS (nenhum teste existente pode quebrar: canal SEM router deve seguir idêntico — é o caminho `no_router`); `npm run typecheck` → 0.

- [ ] **Step 7: Commit + handoff**

```bash
git add lib/agent-engine/agent/inbound-turn.ts lib/agent-engine/agent/human-handoff.ts
git commit -m "feat(harness-f3): router decide o agente do turno + stickiness e telemetria"
```

---

### Task 6: API `/api/v1/ai/routers`

**Files:**
- Create: `app/api/v1/ai/routers/route.ts` (GET lista + POST cria)
- Create: `app/api/v1/ai/routers/[id]/route.ts` (GET detalhe + PATCH + DELETE)
- Create: `app/api/v1/ai/routers/[id]/members/route.ts` (PUT substitui a lista de membros)
- Create: `app/api/v1/ai/routers/[id]/test/route.ts` (POST classifica uma mensagem de teste)
- Test: `app/api/v1/ai/routers/route.test.ts`, `app/api/v1/ai/routers/[id]/test/route.test.ts`

**Interfaces:**
- Consumes: `ok`/`fail` de `@/lib/api/wrappers`; `requireRole` de `@/lib/auth/require-role`; `createAdminClient`; `audit` (mesmo helper das rotas de `ai/memory`/`ai/skills`); `classifyIntent`/`loadActiveRouter` (Tasks 2-3) para a rota de teste; `getSkillsPool()` de `lib/ai/skills/db.ts` (o acessor de `pg.Pool` em route handler criado na Fase 2 — reusar, não criar outro).
- Produces (Task 7 consome):
  - `GET /api/v1/ai/routers` → `ok({ routers: [{ id, name, channel_session_id, is_active, fallback_agent_id, member_count, updated_at }] })` (role `agent`)
  - `POST /api/v1/ai/routers` `{ name, channel_session_id, fallback_agent_id?, config? }` → `ok({ id })` (role `admin`, audit `ai.router_created`)
  - `GET /api/v1/ai/routers/[id]` → `ok({ router: { id, name, channel_session_id, is_active, config, fallback_agent_id }, members: [{ id, agent_id, intent_name, intent_description, examples, position }] })` (role `agent`)
  - `PATCH /api/v1/ai/routers/[id]` `{ name?, is_active?, fallback_agent_id?, config? }` → `ok({ id })` (role `admin`, audit `ai.router_updated`)
  - `DELETE /api/v1/ai/routers/[id]` → `ok({ id })` (role `admin`, audit `ai.router_deleted`)
  - `PUT /api/v1/ai/routers/[id]/members` `{ members: [{ agent_id, intent_name, intent_description, examples }] }` → `ok({ count })` (role `admin`, audit `ai.router_members_updated`; substitui a lista inteira, `position` = índice do array)
  - `POST /api/v1/ai/routers/[id]/test` `{ message }` → `ok({ intent_name, confidence, agent_id, agent_name })` (role `manager`; NÃO grava em `ai_router_decisions` — é teste)

- [ ] **Step 1: Ler os moldes** — `app/api/v1/ai/skills/route.ts` (GET+POST, requireRole, ok/fail) e `app/api/v1/ai/agents/[id]/versions/[vid]/test/route.ts` (o "teste" de agente, molde da rota de teste). Adicionar as 5 ações novas ao union `AuditAction` em `lib/audit/actions.ts`.

- [ ] **Step 2: Testes que falham** (padrão de mock de `requireRole` + admin client dos testes de `app/api/v1/ai/skills/`):

```
// route.test.ts:
// 1. GET lista routers da org com member_count
// 2. POST cria router; organization_id vem do requireRole mesmo que o body mande outro
// 3. POST com body inválido (name vazio) → 422 validation_failed
// 4. POST em channel_session que já tem router ativo → erro tratado (unique index), não 500 cru
// [id]/test/route.test.ts:
// 5. POST /test devolve intent_name/confidence/agent_id sem gravar em ai_router_decisions
```

- [ ] **Step 3: Implementar as 5 rotas.** Zod em todos os inputs; `organization_id` sempre de `requireRole`; toda query filtra `organization_id` explicitamente (service role bypassa RLS). No POST, capturar violação do unique index (`code === '23505'`) e devolver `fail('router_already_exists', 'Este número já tem um roteador ativo.', 409, { requestId })`. No PUT de members, transação: apagar os membros do router e inserir os novos (ambos filtrando `organization_id`).

- [ ] **Step 4: Verde + typecheck + lint + commit**

Run: `npx vitest run app/api/v1/ai/routers` → PASS; `npm run typecheck` → 0; `npx eslint app/api/v1/ai/routers` → 0.

```bash
git add app/api/v1/ai/routers lib/audit/actions.ts
git commit -m "feat(harness-f3): API de routers (CRUD, membros, teste de classificação)"
```

---

### Task 7: UI `app/app/ai/routers`

**Files:**
- Create: `app/app/ai/routers/page.tsx`, `_client.tsx`
- Create: `app/app/ai/routers/[id]/page.tsx`, `[id]/_client.tsx`
- Create: `hooks/ai/useRouters.ts`
- Modify: `components/shell/Sidebar.tsx`, `hooks/auth/AuthProvider.tsx` (`ai.routers.view: manager`, `ai.routers.manage: admin`)

**Interfaces:**
- Consumes: API da Task 6; padrões de `app/app/ai/skills` (lista) e `app/app/ai/agents/[id]` (editor com `Select` de canal — copiar o bloco de `channel_session_id` do `AgentForm.tsx` e o carregamento de `channelSessions` do `page.tsx` do agente). Query keys `["routers"]` e `["router", id]`.
- Produces: tela de lista (routers com número/canal, nº de intenções, ativo) + tela de edição (nome, canal, fallback, lista de intenções com agente/descrição/exemplos, e um painel "Testar classificação").

- [ ] **Step 1: Hooks** (`hooks/ai/useRouters.ts`) — `useRouters(initial?)`, `useRouter(id, initial?)`, `useCreateRouter()`, `useUpdateRouter(id)`, `useDeleteRouter()`, `useSaveMembers(id)`, `useTestRouter(id)`. Padrão exato de `hooks/ai/useSkills.ts` (React Query + `apiClient` + invalidação das query keys).

- [ ] **Step 2: Página de lista** — server component com guard `manager` + initialData (padrão de `app/app/ai/skills/page.tsx`); client com cards de router (nome, número do canal, "N intenções", badge ativo/inativo) + botão "Novo roteador". Empty state ENSINA: "Um roteador entende o que o cliente quer e entrega a conversa para o agente certo. Crie um para o seu número e escolha quais agentes ele aciona."

- [ ] **Step 3: Página de edição** — nome, `Select` de canal (copiar o padrão do `AgentForm.tsx`), `Select` de agente de fallback (opcional, com opção "Nenhum — responde com o atendimento padrão"), e a lista de intenções: cada linha com `Select` de agente + `Input` de nome da intenção + `Textarea` de descrição ("quando esta intenção deve ser escolhida — escreva como explicaria para um atendente novo") + campo de exemplos (molde: `HandoffKeywordsInput.tsx`). Botões adicionar/remover intenção, salvar. Painel "Testar classificação": `Textarea` + botão → mostra qual intenção casou, a confiança e qual agente atenderia.

- [ ] **Step 4: Sidebar + permissões** — item "Roteadores" ao lado de "Agentes IA"; permissões declaradas no `AuthProvider` e consumidas via `usePermission` (sem gate inline duplicado — lição da Fase 1 T6). Na tela do agente, adicionar um aviso quando o agente for membro de algum router: "Este agente é acionado pelo roteador «X» — o campo de número abaixo não se aplica." (resolve o conflito de UX mapeado: agente de router não precisa de `channel_session_id`).

- [ ] **Step 5: Teste em Playwright (CLICANDO — protocolo).** Dev server (`lsof -tiTCP:3000`; senão `npm run dev` background + esperar `/api/v1/health`). Login `e2e-admin@deskcomm.test` (senha em `.e2e-creds.json`; MFA: secret em `/private/tmp/claude-501/.../scratchpad/admin-mfa-secret.txt`, código via `generateTotp` de `./tests/e2e/utils/totp`, 6 caixas de 1 dígito). Fluxo: criar roteador → adicionar 2 intenções apontando para agentes diferentes → salvar → testar classificação com uma frase de cada intenção e ver o agente certo. Screenshot da tela de roteadores (prova inline; nenhum arquivo de imagem foi entregue nesta fase — a prova versionada da Fase 3 é o registro ponta-a-ponta no ledger). AVALIAR EXPERIÊNCIA: um dono de negócio entende o que é um roteador e como preencher uma intenção? Qualquer "não" → corrigir ANTES de reportar. **CLEANUP**: apagar o roteador de teste (e membros) da org; confirmar `select count(*) from ai_routers where organization_id=...` = 0.

- [ ] **Step 6: Verde + commit**

Run: `npm run typecheck` → 0; `npx eslint app/app/ai/routers hooks/ai/useRouters.ts` → 0.

```bash
git add app/app/ai/routers hooks/ai/useRouters.ts components/shell/Sidebar.tsx hooks/auth/AuthProvider.tsx app/app/ai/agents
git commit -m "feat(harness-f3): tela de roteadores (intenções, fallback, teste de classificação)"
```

---

### Task 8: Prova real ponta-a-ponta + fechamento

**Files:**
- Modify: `HANDOFF-harness-evolution.md`; `docs/architecture/` (router no mapa vivo, ≥2 arestas)

**Interfaces:**
- Consumes: tudo das Tasks 1-7; ambiente dev (dev server + worker do REPO PRINCIPAL; sessão WAHA real; 2 agentes publicados; crédito Anthropic).

- [ ] **Step 1: Suite completa** — `npm run typecheck` → 0; `npm run lint` → 0; `npx vitest run` → PASS.

- [ ] **Step 2: Coordenação de ambiente** — inventariar processos (`lsof -tiTCP:3000`/`:8787` + `ps -o lstart`); worker de prova = repo principal (worker de worktree roda código velho); registrar `published_version_id`/persona do agente ANTES para restaurar depois.

- [ ] **Step 3: Preparar o cenário.** Criar (pela TELA) um roteador no canal da sessão real com DUAS intenções apontando para dois agentes distinguíveis — reusar o agente existente do Rafael (v24 Lia AgendaPlus) como uma intenção e criar/duplicar um segundo agente com persona claramente diferente (ex.: "Suporte Técnico — responde curto e técnico, assina «— Suporte»") como a outra. Assinatura/estilo distinto é o que torna a prova legível no WhatsApp.

- [ ] **Step 4: Prova real.** (a) Mensagem 1 no WhatsApp real com a intenção A (ex.: "quero saber sobre preços") → responde o agente A. (b) Mensagem 2 na MESMA conversa, ainda no assunto A → responde o mesmo agente (stickiness — `outcome: 'sticky'`). (c) Mensagem 3 com mudança clara de assunto para a intenção B (ex.: "na verdade meu sistema não abre") → responde o agente B (`outcome: 'reclassified'`). (d) Conferir `select outcome, intent_name, confidence, agent_id from ai_router_decisions order by created_at` — a sequência conta a história. (e) Contra-prova: desativar o roteador (`is_active=false`) pela tela, mandar nova mensagem → volta ao comportamento por canal (sem router), provando que o router é aditivo e reversível.
- [ ] **Step 5: Avaliação de experiência** — as respostas dos dois agentes são distinguíveis? A troca de assunto foi natural (não robótica)? A tela deixa claro o que cada intenção faz? Qualquer "não" → corrigir antes de fechar.
- [ ] **Step 6: Fechar** — screenshots (tela + conversa); **restaurar** o ambiente (apagar roteador e agente de teste; `published_version_id` do agente do Rafael como estava; conferir `ai_routers` = 0 na org); router no mapa vivo (`docs/architecture/agent-turn.workflow.json`, nó `router` com arestas tela→router e router→turno, `archify validate` limpo); atualizar `HANDOFF-harness-evolution.md`; commit `docs(harness-f3): fase 3 fechada com prova real`.
