# Fase 1 — Memória Geral da Org Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Toda organização ganha uma memória geral versionada (doc-mãe estilo CLAUDE.md + entradas de aprendizado) injetada no prefixo estável de TODOS os agents, editável em `app/app/ai/memory`, e alimentável pelo flywheel com aprovação humana.

**Architecture:** Padrão versão-imutável+ponteiro do playbook replicado em `org_memory_versions`/`org_memory_pointers` + tabela `org_memory_entries`; loader `loadOrgMemory` resolvido a cada turno (zero cache, igual `loadPlaybook`); o bloco renderizado entra no `system` entre `playbook.prompt` e o índice de skills (prefixo estável — bytes novos só quando publica). Flywheel ganha um segundo destino (`org_memory_entry`) no distiller e no apply.

**Tech Stack:** Postgres/Supabase (RLS), pg Pool no engine, Next.js App Router + React Query + `apiClient`, Zod, Vitest.

## Global Constraints

- **Doutrina de migrations (OBRIGATÓRIA)**: arquivo versionado `supabase/migrations/<ts>_0054_org_memory.sql` idempotente + apêndice idempotente no fim de `supabase/baseline.sql` (bloco `-- ---- memória geral da org: org_memory_versions/pointers/entries (migration 0054) ----`) + linha na tabela do `supabase/migrations/MANIFEST.md`.
- **RLS em toda tabela nova** via o loop `tenant_isolation_<t>_all` existente; teste de isolamento (`tests/invariants/rls-isolation.test.ts`) cobre as tabelas novas.
- **Prefixo estável é sagrado**: nada volátil no `system`; a memória entra versionada+determinística (ordenação estável de entries) — byte-idêntica entre runs da mesma versão.
- **Zero cache de processo**: `loadOrgMemory` é chamado a cada turno, como `loadPlaybook` — publicar ⇒ próximo turno vale.
- **API**: `ok()`/`fail()` de `@/lib/api/wrappers` — `ok()` já embrulha em `{data}`; **NUNCA** `ok({data: ...})` (double-nest). Zod em todo input. `requireRole` + `audit` em mutação.
- **Aprovação humana**: proposta do flywheel NUNCA vira entry sem apply explícito.
- **Teste imediato por peça** (protocolo do épico): front = Playwright clicando + avaliação de experiência (completa? clara? leigo entende?), qualquer "não" corrige antes de seguir; back = teste funcional na hora; nunca acumular pro fim.
- **Handoff vivo**: `HANDOFF-harness-evolution.md` alimentado ao fim de CADA task.
- **Nunca validar via `cmd | tail`**; `graphify query` antes de ler código desconhecido; copy pt-br; sem `console.log`; commits `feat(harness-f1): ...`.
- **Ambiente compartilhado**: antes de provas reais, inventariar processos vivos (`lsof -iTCP:3000/-iTCP:8787` + `ps -o lstart`) e coordenar com o Rafael — nunca disputar fila/tela com testes dele.

---

### Task 1: Migration 0054 (schema + RLS + baseline + MANIFEST + types)

**Files:**
- Create: `supabase/migrations/20260723200000_0054_org_memory.sql`
- Modify: `supabase/baseline.sql` (apêndice no fim; array do loop RLS em ~L6110-6124)
- Modify: `supabase/migrations/MANIFEST.md` (nova linha na tabela)
- Modify: `tests/invariants/rls-isolation.test.ts` (TABLES + seed)
- Modify: `lib/database.types.ts` (regenerado)

**Interfaces:**
- Produces: tabelas `org_memory_versions` (doc-mãe imutável), `org_memory_pointers` (1 ponteiro por org), `org_memory_entries` (aprendizados; `status` `proposed|active|archived`, `source` `manual|flywheel`, `proposal_id` FK) e o novo valor `'org_memory_entry'` no check de `flywheel_distiller_proposals.type`. Consumidas pelas Tasks 2-6.

- [ ] **Step 1: Escrever a migration** (`supabase/migrations/20260723200000_0054_org_memory.sql`):

```sql
-- 0054: Memória Geral da Org (Fase 1 do épico harness — spec 2026-07-23).
-- Doc-mãe versionado (padrão versões-imutáveis+ponteiro do playbook 0004/0050)
-- + entradas de aprendizado individuais (manual | flywheel com aprovação humana).

create table if not exists org_memory_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  version_number int not null,
  content text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (organization_id, version_number)
);

drop trigger if exists trg_org_memory_versions_immutable on org_memory_versions;
create trigger trg_org_memory_versions_immutable
  before update on org_memory_versions
  for each row execute function fn_agent_versions_immutable();

create table if not exists org_memory_pointers (
  organization_id uuid not null unique references organizations(id) on delete cascade,
  version_id uuid not null references org_memory_versions(id),
  updated_at timestamptz not null default now()
);

create table if not exists org_memory_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  title text not null check (length(title) > 0),
  body text not null check (length(body) > 0),
  source text not null check (source in ('manual', 'flywheel')),
  status text not null default 'active' check (status in ('proposed', 'active', 'archived')),
  proposal_id uuid references flywheel_distiller_proposals(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_org_memory_entries_org_status
  on org_memory_entries (organization_id, status, created_at);

-- Flywheel: novo destino de proposta (entry de memória da org).
alter table flywheel_distiller_proposals drop constraint if exists flywheel_distiller_proposals_type_check;
alter table flywheel_distiller_proposals add constraint flywheel_distiller_proposals_type_check
  check (type in ('playbook_bullet', 'golden_case', 'reentry_trigger', 'org_memory_entry'));

-- RLS (mesmo shape do loop tenant_isolation_* do baseline).
do $$
declare t text;
begin
  foreach t in array array['org_memory_versions', 'org_memory_pointers', 'org_memory_entries'] loop
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

- [ ] **Step 2: Apêndice idempotente no `baseline.sql`** — adicionar AO FIM do arquivo o bloco abaixo (é a migration inteira, que já é idempotente, precedida do marcador):

```sql
-- ---- memória geral da org: org_memory_versions/pointers/entries (migration 0054) ----
```

(seguido do MESMO conteúdo SQL do Step 1, verbatim.)

- [ ] **Step 3: Linha no MANIFEST** (`supabase/migrations/MANIFEST.md`, fim da tabela):

```
| `20260723200000` | `0054_org_memory` | Épico Harness (F1): memória geral da org — `org_memory_versions` (doc-mãe imutável, padrão playbook 0004), `org_memory_pointers` (1 ponteiro/org), `org_memory_entries` (aprendizados manual/flywheel, status proposed/active/archived, FK proposal_id). Check de `flywheel_distiller_proposals.type` ganha `org_memory_entry`. RLS `tenant_isolation_*_all` nas 3 tabelas. NNNN=0054 (último era 0053; verificado contra as branches). `database.types.ts` regenerado. |
```

- [ ] **Step 4: Aplicar no banco dev e provar**

Run: `DBURL=$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-); psql "$DBURL" -f supabase/migrations/20260723200000_0054_org_memory.sql`
Expected: sem erros. Depois: `psql "$DBURL" -tAc "select count(*) from org_memory_entries;"` → `0`. Re-aplicar o MESMO arquivo → sem erro (idempotência provada).

- [ ] **Step 5: Regenerar `lib/database.types.ts`**

Run: `npx supabase gen types typescript --db-url "$DBURL" > lib/database.types.ts` (se o CLI reclamar, conferir script equivalente em `package.json`; o arquivo DEVE passar a conter `org_memory_entries`). Depois `npm run typecheck` → exit 0.

- [ ] **Step 6: Teste de isolamento RLS**

Em `tests/invariants/rls-isolation.test.ts`: adicionar `"org_memory_versions", "org_memory_entries"` ao array `TABLES` e, no seed do `beforeAll`, inserir 1 linha por org em cada (via o mesmo `sql()` service-role do arquivo):

```sql
insert into org_memory_versions (organization_id, version_number, content) values ('<ORG_A>', 1, 'doc A');
insert into org_memory_versions (organization_id, version_number, content) values ('<ORG_B>', 1, 'doc B');
insert into org_memory_entries (organization_id, title, body, source) values ('<ORG_A>', 't', 'b', 'manual');
insert into org_memory_entries (organization_id, title, body, source) values ('<ORG_B>', 't', 'b', 'manual');
```

(usar as constantes `ORG_A`/`ORG_B` já definidas no arquivo, no mesmo bloco de seed existente.)

Run: `npm run test:db` (exige docker; ver `scripts/test-db.sh`) → PASS incluindo as tabelas novas. Se o runner de test:db não estiver disponível na máquina, rodar ao menos o smoke manual: com `psql` + `set role authenticated` + `set_config('request.jwt.claims', ...)` de um user da org A, `select count(*) from org_memory_entries where organization_id='<ORG_B>'` → 0.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260723200000_0054_org_memory.sql supabase/baseline.sql supabase/migrations/MANIFEST.md tests/invariants/rls-isolation.test.ts lib/database.types.ts
git commit -m "feat(harness-f1): schema da memória geral da org (0054) + RLS + baseline + types"
```

---

### Task 2: Loader `org-memory.ts` (trio versão/ponteiro + render + compose)

**Files:**
- Create: `lib/agent-engine/agent/org-memory.ts`
- Test: `lib/agent-engine/agent/org-memory.test.ts`

**Interfaces:**
- Consumes: tabelas da Task 1; padrão de `lib/agent-engine/agent/playbook.ts:63/87/116` (ler antes de escrever).
- Produces (Tasks 3-5 consomem):

```ts
export interface OrgMemoryEntry { id: string; title: string; body: string }
export interface LoadedOrgMemory { content: string | null; entries: OrgMemoryEntry[] }
export async function insertOrgMemoryVersion(db: pg.Pool, input: { tenantId: string; content: string; createdBy?: string | null }): Promise<{ id: string; versionNumber: number }>
export async function setOrgMemoryPointer(db: pg.Pool, input: { tenantId: string; versionId: string }): Promise<void>
export async function loadOrgMemory(db: pg.Pool, tenantId: string): Promise<LoadedOrgMemory>
export function renderOrgMemory(mem: LoadedOrgMemory): string           // '' quando não há nada
export function composeSystemPrompt(input: { playbookPrompt: string; orgMemoryBlock: string; skillIndex: string }): string
```

- [ ] **Step 1: Testes que falham**

```ts
// lib/agent-engine/agent/org-memory.test.ts
import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';

import { composeSystemPrompt, loadOrgMemory, renderOrgMemory } from './org-memory';

function poolSeq(responses: Array<{ rows: unknown[] }>): pg.Pool {
  const query = vi.fn();
  for (const r of responses) query.mockResolvedValueOnce(r);
  return { query } as unknown as pg.Pool;
}

describe('loadOrgMemory', () => {
  it('resolve doc pelo ponteiro e entries active em ordem estável', async () => {
    const pool = poolSeq([
      { rows: [{ content: 'Regras da org.' }] },
      { rows: [{ id: 'e1', title: 'Horário', body: 'Atendemos 8h-18h.' }] },
    ]);
    const mem = await loadOrgMemory(pool, 'org1');
    expect(mem).toEqual({ content: 'Regras da org.', entries: [{ id: 'e1', title: 'Horário', body: 'Atendemos 8h-18h.' }] });
  });

  it('org sem memória: content null e entries vazias', async () => {
    const mem = await loadOrgMemory(poolSeq([{ rows: [] }, { rows: [] }]), 'org1');
    expect(mem).toEqual({ content: null, entries: [] });
  });
});

describe('renderOrgMemory', () => {
  it('vazio quando não há doc nem entries', () => {
    expect(renderOrgMemory({ content: null, entries: [] })).toBe('');
  });
  it('doc + entries viram bloco determinístico', () => {
    const out = renderOrgMemory({ content: 'Doc.', entries: [{ id: 'e1', title: 'T', body: 'B' }] });
    expect(out).toContain('=== memória da organização ===');
    expect(out).toContain('Doc.');
    expect(out).toContain('- T: B');
  });
});

describe('composeSystemPrompt', () => {
  it('ordem: playbook → memória → índice de skills; blocos vazios somem sem separadores órfãos', () => {
    expect(composeSystemPrompt({ playbookPrompt: 'P', orgMemoryBlock: '', skillIndex: '' })).toBe('P');
    const full = composeSystemPrompt({ playbookPrompt: 'P', orgMemoryBlock: 'M', skillIndex: 'S' });
    expect(full.indexOf('P')).toBeLessThan(full.indexOf('M'));
    expect(full.indexOf('M')).toBeLessThan(full.indexOf('S'));
    expect(full).toContain('=== skills (índice — o corpo carrega no turno quando a situação dispara) ===');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/agent-engine/agent/org-memory.test.ts` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar** (`lib/agent-engine/agent/org-memory.ts`) — seguir o estilo de `playbook.ts` (doc-comment de doutrina, sem cache, escopo por org):

```ts
/**
 * Memória Geral da Org (Fase 1 do épico harness — spec 2026-07-23).
 *
 * Doc-mãe versionado+ponteiro (mesmo padrão do playbook 0004) + entradas de
 * aprendizado (manual | flywheel aprovado). Resolvida no início de CADA run —
 * sem cache de processo, de propósito: publicar ⇒ próximo turno já vê.
 * O bloco renderizado entra no PREFIXO ESTÁVEL: determinístico byte-a-byte
 * para a mesma versão+entries (ordem estável por created_at, id).
 */
import type pg from 'pg';

export interface OrgMemoryEntry {
  id: string;
  title: string;
  body: string;
}

export interface LoadedOrgMemory {
  content: string | null;
  entries: OrgMemoryEntry[];
}

export async function insertOrgMemoryVersion(
  db: pg.Pool,
  input: { tenantId: string; content: string; createdBy?: string | null },
): Promise<{ id: string; versionNumber: number }> {
  const { rows } = await db.query<{ id: string; version_number: number }>(
    `insert into org_memory_versions (organization_id, version_number, content, created_by)
     values ($1,
             coalesce((select max(version_number) from org_memory_versions where organization_id = $1), 0) + 1,
             $2, $3)
     returning id, version_number`,
    [input.tenantId, input.content, input.createdBy ?? null],
  );
  const r = rows[0];
  if (r === undefined) throw new Error('insertOrgMemoryVersion: insert não retornou linha');
  return { id: r.id, versionNumber: r.version_number };
}

export async function setOrgMemoryPointer(
  db: pg.Pool,
  input: { tenantId: string; versionId: string },
): Promise<void> {
  // Escopo vem DA VERSÃO no SQL (padrão do playbook): ponteiro nunca aponta
  // para versão de outra org.
  const { rowCount } = await db.query(
    `insert into org_memory_pointers (organization_id, version_id, updated_at)
     select v.organization_id, v.id, now()
     from org_memory_versions v
     where v.id = $2 and v.organization_id = $1
     on conflict (organization_id) do update set version_id = excluded.version_id, updated_at = now()`,
    [input.tenantId, input.versionId],
  );
  if (rowCount === 0) throw new Error('setOrgMemoryPointer: versão não encontrada para esta org');
}

export async function loadOrgMemory(db: pg.Pool, tenantId: string): Promise<LoadedOrgMemory> {
  const { rows: docRows } = await db.query<{ content: string }>(
    `select v.content
     from org_memory_pointers p join org_memory_versions v on v.id = p.version_id
     where p.organization_id = $1`,
    [tenantId],
  );
  const { rows: entryRows } = await db.query<OrgMemoryEntry>(
    `select id, title, body
     from org_memory_entries
     where organization_id = $1 and status = 'active'
     order by created_at asc, id asc`,
    [tenantId],
  );
  return { content: docRows[0]?.content ?? null, entries: entryRows };
}

/** Bloco do prefixo estável — '' quando a org não tem memória (zero custo). */
export function renderOrgMemory(mem: LoadedOrgMemory): string {
  if (mem.content === null && mem.entries.length === 0) return '';
  const parts: string[] = ['=== memória da organização (regras e aprendizados — valem para TODO atendimento) ==='];
  if (mem.content !== null) parts.push(mem.content.trim());
  if (mem.entries.length > 0) {
    parts.push('--- aprendizados ---');
    for (const e of mem.entries) parts.push(`- ${e.title}: ${e.body}`);
  }
  return parts.join('\n');
}

/** Ordem canônica do prefixo: playbook → memória da org → índice de skills. */
export function composeSystemPrompt(input: {
  playbookPrompt: string;
  orgMemoryBlock: string;
  skillIndex: string;
}): string {
  const blocks = [input.playbookPrompt];
  if (input.orgMemoryBlock !== '') blocks.push(input.orgMemoryBlock);
  if (input.skillIndex !== '') {
    blocks.push(
      `=== skills (índice — o corpo carrega no turno quando a situação dispara) ===\n${input.skillIndex}`,
    );
  }
  return blocks.join('\n\n');
}
```

- [ ] **Step 4: Verde + typecheck + commit**

Run: `npx vitest run lib/agent-engine/agent/org-memory.test.ts` → PASS; `npm run typecheck` → exit 0.

```bash
git add lib/agent-engine/agent/org-memory.ts lib/agent-engine/agent/org-memory.test.ts
git commit -m "feat(harness-f1): loader da memória da org (versão+ponteiro, render, compose)"
```

---

### Task 3: Injeção no turno (camada 2 do prefixo estável)

**Files:**
- Modify: `lib/agent-engine/agent/inbound-turn.ts:548-562` (montagem do `system`)

**Interfaces:**
- Consumes: `loadOrgMemory`, `renderOrgMemory`, `composeSystemPrompt` (Task 2); no arquivo, `pool`, `tenantId`, `playbook.prompt`, `skillIndex` já existem no escopo.
- Produces: `system` do turno passa a conter a memória da org entre o playbook e o índice de skills. (A composição em si já está coberta pelos testes da Task 2 — esta task é a costura.)

- [ ] **Step 1: Editar a montagem do `system`**

Em `inbound-turn.ts`, adicionar o import junto dos demais do diretório:

```ts
import { composeSystemPrompt, loadOrgMemory, renderOrgMemory } from './org-memory';
```

Logo após a carga de skills (~L557, `const skillIndex = renderSkillIndex(skills);`), carregar a memória (mesmo padrão zero-cache do playbook):

```ts
  // Fase 1 (harness): memória geral da org — prefixo estável, resolvida a cada
  // turno como o playbook (publicar ⇒ próximo turno vale).
  const orgMemory = await loadOrgMemory(pool, tenantId);
```

E SUBSTITUIR a concatenação existente (L559-562):

```ts
  const system =
    skillIndex === ''
      ? playbook.prompt
      : `${playbook.prompt}\n\n=== skills (índice — o corpo carrega no turno quando a situação dispara) ===\n${skillIndex}`;
```

por:

```ts
  const system = composeSystemPrompt({
    playbookPrompt: playbook.prompt,
    orgMemoryBlock: renderOrgMemory(orgMemory),
    skillIndex,
  });
```

- [ ] **Step 2: Suite do engine + typecheck**

Run: `npx vitest run lib/agent-engine` → PASS (o teste de byte-identidade do prefixo, `llm-cache.test.ts`, DEVE continuar verde — se quebrar, a mudança introduziu algo volátil: investigar antes de seguir); `npm run typecheck` → exit 0.

- [ ] **Step 3: Prova funcional imediata (banco dev)**

Com o banco dev: inserir uma memória de teste e conferir a composição SEM subir o worker:

```bash
DBURL=$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)
psql "$DBURL" -tAc "insert into org_memory_versions (organization_id, version_number, content) values ('6e567068-fd1c-4f94-ae1f-40e0334be190', (select coalesce(max(version_number),0)+1 from org_memory_versions where organization_id='6e567068-fd1c-4f94-ae1f-40e0334be190'), 'TESTE F1: prova de composição.') returning id;"
# usar o id retornado:
psql "$DBURL" -tAc "insert into org_memory_pointers (organization_id, version_id) values ('6e567068-fd1c-4f94-ae1f-40e0334be190', '<ID>') on conflict (organization_id) do update set version_id=excluded.version_id;"
```

Depois um teste rápido de integração com tsx (descartável, não commitar):

```bash
npx tsx --env-file=.env --env-file=.env.local -e "
import pg from 'pg';
import { loadOrgMemory, renderOrgMemory } from './lib/agent-engine/agent/org-memory';
const pool = new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL });
const mem = await loadOrgMemory(pool, '6e567068-fd1c-4f94-ae1f-40e0334be190');
console.log(renderOrgMemory(mem));
await pool.end();
"
```

Expected: o bloco com "TESTE F1: prova de composição.". Ao final, limpar: `psql "$DBURL" -c "delete from org_memory_pointers where organization_id='6e567068-fd1c-4f94-ae1f-40e0334be190'; delete from org_memory_versions where organization_id='6e567068-fd1c-4f94-ae1f-40e0334be190';"`

- [ ] **Step 4: Commit + handoff**

```bash
git add lib/agent-engine/agent/inbound-turn.ts
git commit -m "feat(harness-f1): memória da org injetada no prefixo estável do turno"
```

Atualizar `HANDOFF-harness-evolution.md`.

---

### Task 4: API `/api/v1/ai/memory`

**Files:**
- Create: `app/api/v1/ai/memory/route.ts` (GET estado completo; POST publica versão nova)
- Create: `app/api/v1/ai/memory/entries/route.ts` (POST cria entry manual)
- Create: `app/api/v1/ai/memory/entries/[id]/route.ts` (PATCH status archive/active)
- Create: `app/api/v1/ai/memory/versions/[id]/route.ts` (GET conteúdo de uma versão — para o Dialog de histórico da UI; role `agent`, filtro `organization_id` sempre; → `ok({ id, version_number, content, created_at })`)
- Test: `app/api/v1/ai/memory/route.test.ts`

**Interfaces:**
- Consumes: `ok`/`fail` de `@/lib/api/wrappers`; `requireRole` de `@/lib/auth/require-role`; `createAdminClient` de `@/lib/supabase/admin`; `audit` (mesmo helper usado em `app/api/v1/ai/agents/[id]/proposals/[pid]/apply/route.ts` — ler o import de lá e replicar); tabelas da Task 1. IMPORTANTE: usar SQL direto via admin client (`.from(...)`) com filtro explícito `organization_id` (service role bypassa RLS).
- Produces (a UI da Task 6 consome):
  - `GET /api/v1/ai/memory` → `ok({ document: { version_id, version_number, content, created_at } | null, versions: [{ id, version_number, created_at }], entries: [{ id, title, body, source, status, created_at }] })` (role mínima `agent` para leitura)
  - `POST /api/v1/ai/memory` body `{ content: string }` → publica versão + move ponteiro → `ok({ version_id, version_number })` (role `admin`, audit `ai.org_memory_published`)
  - `POST /api/v1/ai/memory/entries` body `{ title, body }` → `ok({ id })` (role `manager`, source `manual`, status `active`, audit `ai.org_memory_entry_created`)
  - `PATCH /api/v1/ai/memory/entries/[id]` body `{ status: 'archived' | 'active' }` → `ok({ id, status })` (role `manager`, audit `ai.org_memory_entry_updated`)

- [ ] **Step 1: Ler os padrões** — `app/api/v1/ai/agents/[id]/proposals/route.ts` (GET) e `.../proposals/[pid]/apply/route.ts` (POST com audit). Replicar estrutura: `randomUUID()` como requestId, `requireRole`, Zod `safeParse` → `fail("validation_failed", ..., 422, { requestId, details })`, erro DB → `fail("internal_error", ..., 500, { requestId })`.

- [ ] **Step 2: Teste que falha** (padrão do repo — mock de `requireRole` e do admin client, como em `app/api/v1/cron/agent-dispatcher/route.test.ts`; ler esse arquivo antes):

```ts
// app/api/v1/ai/memory/route.test.ts — casos mínimos:
// 1. GET sem auth → repassa authz.response (mock requireRole ok:false).
// 2. GET com org: retorna document null + entries [] quando vazio (mocks de .from() encadeados).
// 3. POST publica: insere versão com version_number incrementado e faz upsert do pointer;
//    responde { data: { version_id, version_number } } (SEM double-nest).
// 4. POST body inválido (content vazio) → 422 validation_failed.
```

(Escrever os 4 casos com `vi.mock("@/lib/auth/require-role")` e `vi.mock("@/lib/supabase/admin")`; o mock do admin devolve builders encadeáveis `{ from: () => ({ select/insert/upsert/eq/order/single... }) }` — copiar o helper de mock do teste do agent-dispatcher e adaptar.)

Run: `npx vitest run app/api/v1/ai/memory/route.test.ts` → FAIL (rota não existe).

- [ ] **Step 3: Implementar as 3 rotas.** Publicação de versão no POST (usar admin client; o incremento de versão é atômico o suficiente para UI de admin — colisão de unique retorna erro tratado):

```ts
// trecho central do POST /api/v1/ai/memory
const body = await req.json().catch(() => null);
const parsed = z.object({ content: z.string().min(1).max(50_000) }).safeParse(body);
if (!parsed.success) return fail("validation_failed", "content é obrigatório.", 422, { requestId, details: parsed.error.flatten() });
const admin = createAdminClient();
const { data: maxRow } = await admin.from("org_memory_versions")
  .select("version_number").eq("organization_id", org.orgId)
  .order("version_number", { ascending: false }).limit(1).maybeSingle();
const nextVersion = ((maxRow?.version_number as number | null) ?? 0) + 1;
const { data: ver, error: verErr } = await admin.from("org_memory_versions")
  .insert({ organization_id: org.orgId, version_number: nextVersion, content: parsed.data.content, created_by: org.userId })
  .select("id, version_number").single();
if (verErr || !ver) return fail("internal_error", "Erro ao publicar versão da memória.", 500, { requestId });
const { error: ptrErr } = await admin.from("org_memory_pointers")
  .upsert({ organization_id: org.orgId, version_id: ver.id, updated_at: new Date().toISOString() }, { onConflict: "organization_id" });
if (ptrErr) return fail("internal_error", "Erro ao ativar a versão.", 500, { requestId });
// audit fire-and-forget (padrão do apply route) + ok({ version_id: ver.id, version_number: ver.version_number }, { requestId })
```

(GET monta document via join pointer→version com dois selects; entries com `.eq("organization_id", org.orgId).neq("status", "proposed").order("created_at")`. PATCH de entry: `.update({ status, updated_at }).eq("id", id).eq("organization_id", org.orgId)` — filtro de org SEMPRE.)

- [ ] **Step 4: Verde + typecheck + lint + commit**

Run: `npx vitest run app/api/v1/ai/memory` → PASS; `npm run typecheck` → 0; `npx eslint app/api/v1/ai/memory` → 0 errors.

```bash
git add app/api/v1/ai/memory
git commit -m "feat(harness-f1): API da memória da org (publicar versão, entries, arquivar)"
```

Atualizar `HANDOFF-harness-evolution.md`.

---

### Task 5: Flywheel → memória da org (distiller + apply)

**Files:**
- Modify: `lib/agent-engine/flywheel/live.ts:97` (distillerPrompt) e `:190-201` (insert da proposta)
- Modify: `lib/ai/apply-proposal.ts:57` (ramo `org_memory_entry`)
- Modify: `app/app/ai/agents/[id]/_components/ProposalsPanel.tsx:18` (`TYPE_LABEL`)
- Test: `lib/ai/apply-proposal.test.ts` (se existir, estender; senão criar com o caso novo)

**Interfaces:**
- Consumes: check de `type` já aceita `'org_memory_entry'` (Task 1); tabela `org_memory_entries` (Task 1).
- Produces: proposta do distiller pode nascer com `type='org_memory_entry'`, `target='org'`; `applyProposal` com proposta desse tipo insere `org_memory_entries` (`source='flywheel'`, `status='active'`, `proposal_id`) e marca `applied_at`/`applied_by` (SEM `applied_version_id` — não há versão de agent envolvida). Retorno do apply nesse caso: `{ entryId: string }` — ajustar `ApplyProposalResult` para união discriminada ou campos opcionais (ver assinatura atual antes; manter compat com a rota).

- [ ] **Step 1: Distiller decide o destino.** Em `live.ts`, ajustar o `distillerPrompt` (L97) para pedir JSON `{ "content": string, "scope": "agent" | "org" }` com a regra: `scope: "org"` quando o aprendizado vale para TODO atendimento da organização (política, tom, fato do negócio); `"agent"` quando é específico do comportamento deste agente. No insert (L190-201):

```ts
const proposal = parseJson<{ content: string; scope?: string }>(distilled.result.text);
const isOrg = proposal.scope === 'org';
await pool.query(
  `insert into flywheel_distiller_proposals
     (organization_id, run_id, dataset, type, target, content, evidence)
   values ($1,$2,$3,$4,$5,$6,$7)`,
  [
    turn.organization_id,
    runId,
    DATASET,
    isOrg ? 'org_memory_entry' : 'playbook_bullet',
    isOrg ? 'org' : 'tenant',
    proposal.content,
    JSON.stringify({ trace_ids: [turn.job_id], dimension: DIMENSION, verdict_run_id: runId }),
  ],
);
```

- [ ] **Step 2: Teste do apply que falha.** Caso novo: proposta `type='org_memory_entry'` → `applyProposal` insere em `org_memory_entries` com `source='flywheel'`, `status='active'`, `proposal_id`, e marca `applied_at`/`applied_by`; NÃO cria versão de agent. Mock do admin client no padrão do teste existente do módulo (ler `lib/ai/` por testes vizinhos; senão criar `lib/ai/apply-proposal.test.ts` com builders mockados).

Run: `npx vitest run lib/ai/apply-proposal.test.ts` → FAIL.

- [ ] **Step 3: Implementar o ramo em `applyProposal`.** No ponto onde hoje há `if (proposal.type !== "playbook_bullet") → proposal_type_unsupported` (L57):

```ts
if (proposal.type === "org_memory_entry") {
  const title = proposal.content.length > 80 ? `${proposal.content.slice(0, 77)}...` : proposal.content;
  const { data: entry, error: entryErr } = await admin
    .from("org_memory_entries")
    .insert({
      organization_id: params.orgId,
      title,
      body: proposal.content,
      source: "flywheel",
      status: "active",
      proposal_id: params.proposalId,
      created_by: params.userId,
    })
    .select("id")
    .single();
  if (entryErr || !entry) return { ok: false, code: "internal_error" };
  const { error: markErr } = await admin
    .from("flywheel_distiller_proposals")
    .update({ applied_at: new Date().toISOString(), applied_by: params.userId })
    .eq("id", params.proposalId)
    .eq("organization_id", params.orgId);
  if (markErr) return { ok: false, code: "internal_error" };
  return { ok: true, entryId: entry.id };
}
if (proposal.type !== "playbook_bullet") { /* proposal_type_unsupported — inalterado */ }
```

(Ajustar `ApplyProposalResult` e o handler da rota `apply` para aceitar o retorno com `entryId` — a rota responde `ok({ entry_id })` nesse caso.)

- [ ] **Step 4: Label na UI.** `ProposalsPanel.tsx` `TYPE_LABEL`: adicionar `org_memory_entry: "Memória da organização"`.

- [ ] **Step 5: Verde + commit**

Run: `npx vitest run lib/ai lib/agent-engine/flywheel 2>/dev/null || npx vitest run lib/ai` → PASS; `npm run typecheck` → 0.

```bash
git add lib/agent-engine/flywheel/live.ts lib/ai/apply-proposal.ts lib/ai/apply-proposal.test.ts app/app/ai/agents/[id]/_components/ProposalsPanel.tsx app/api/v1/ai/agents/[id]/proposals/[pid]/apply/route.ts
git commit -m "feat(harness-f1): flywheel propõe e aplica entradas de memória da org (gate humano mantido)"
```

Atualizar `HANDOFF-harness-evolution.md`.

---

### Task 6: UI `app/app/ai/memory`

**Files:**
- Create: `app/app/ai/memory/page.tsx` (server component)
- Create: `app/app/ai/memory/_client.tsx` (client component)
- Create: `hooks/ai/useOrgMemory.ts`
- Modify: componente de navegação lateral (achar com `grep -rn "Agentes IA" components app --include="*.tsx" -l`) — link "Memória da IA" na seção de IA, url `/app/ai/memory`

**Interfaces:**
- Consumes: API da Task 4 (contratos exatos listados lá); padrões de `app/app/ai/knowledge/sources/page.tsx` (server: `requireAuth` + `resolveActiveOrg` + guard `ROLE_RANK[activeOrg.role] < ROLE_RANK.manager` → `redirect("/403")` + fetch inicial via `createClient()` server) e `hooks/ai/useAgentProposals.ts` (React Query + `apiClient`).
- Produces: página com (a) editor do doc-mãe (textarea monoespaçada + botão "Publicar versão" com confirmação; badge da versão ativa; histórico de versões com data), (b) linha do tempo de aprendizados (entries com badge de origem manual/flywheel, botão arquivar/reativar, form de nova entrada manual título+corpo).

- [ ] **Step 1: Hooks** (`hooks/ai/useOrgMemory.ts`) — padrão exato de `useAgentProposals`:

```ts
"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";

export interface OrgMemoryDocument { version_id: string; version_number: number; content: string; created_at: string }
export interface OrgMemoryVersionMeta { id: string; version_number: number; created_at: string }
export interface OrgMemoryEntryRow { id: string; title: string; body: string; source: "manual" | "flywheel"; status: "active" | "archived"; created_at: string }
export interface OrgMemoryState { document: OrgMemoryDocument | null; versions: OrgMemoryVersionMeta[]; entries: OrgMemoryEntryRow[] }

const KEY = ["org-memory"];

export function useOrgMemory(initialData?: OrgMemoryState) {
  return useQuery({
    queryKey: KEY,
    ...(initialData !== undefined ? { initialData } : {}),
    queryFn: () => apiClient.get<{ data: OrgMemoryState }>("/api/v1/ai/memory").then((r) => r.data),
  });
}

export function usePublishOrgMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      apiClient.post<{ data: { version_id: string; version_number: number } }>("/api/v1/ai/memory", { content }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useCreateOrgMemoryEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; body: string }) =>
      apiClient.post<{ data: { id: string } }>("/api/v1/ai/memory/entries", input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useSetOrgMemoryEntryStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; status: "archived" | "active" }) =>
      apiClient.patch<{ data: { id: string; status: string } }>(`/api/v1/ai/memory/entries/${input.id}`, { status: input.status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}
```

(Conferir se `apiClient` expõe `.patch`; se não, usar o método genérico que ele tiver — ler `lib/api/client.ts:211` antes.)

- [ ] **Step 2: Page + client.** `page.tsx` espelha `knowledge/sources/page.tsx` (auth, guard manager, fetch inicial de document/entries via `createClient()` server passado como `initialState`). `_client.tsx`: duas seções empilhadas — "Documento da organização" (textarea com o conteúdo da versão ativa, contagem de caracteres, botão Publicar desabilitado sem mudança; toast de sucesso com número da versão; lista compacta do histórico onde clicar numa versão antiga abre o conteúdo dela num Dialog somente-leitura com botão "Restaurar como nova versão" — que preenche o textarea para o admin publicar; diff colorido lado-a-lado fica como polish da Fase 4) e "Aprendizados" (timeline: título, corpo, badge origem, data, ação arquivar; form colapsável "+ Novo aprendizado"). Usar componentes shadcn existentes (`Card`, `Button`, `Textarea`, `Badge`) — visual consistente com as páginas vizinhas de IA; copy pt-br clara para leigo (ex.: sub-título "Regras e aprendizados que TODOS os agentes de IA desta organização seguem em qualquer conversa").

- [ ] **Step 3: Link na navegação.** No componente da sidebar (achado no grep), adicionar o item "Memória da IA" → `/app/ai/memory` junto de "Agentes IA".

- [ ] **Step 4: Teste imediato em Playwright (CLICANDO — protocolo do épico).** Com dev server + login manager (creds `.e2e-creds.json` — usuários também são membros da org 6e567068): navegar ao item novo do menu → digitar um doc → Publicar → ver badge "v1" e toast → criar aprendizado manual → vê-lo na timeline → arquivar → some. AVALIAR EXPERIÊNCIA: um leigo entende o que essa tela controla? O texto explica que vale para TODOS os agentes? Qualquer "não" → corrigir copy/layout AGORA. Capturar screenshot (`browser_take_screenshot`) como evidência.

- [ ] **Step 5: Verde + commit**

Run: `npm run typecheck` → 0; `npx eslint app/app/ai/memory hooks/ai/useOrgMemory.ts` → 0 errors.

```bash
git add app/app/ai/memory hooks/ai/useOrgMemory.ts <arquivo-da-sidebar>
git commit -m "feat(harness-f1): tela Memória da IA (doc-mãe + aprendizados) com publicação versionada"
```

Atualizar `HANDOFF-harness-evolution.md` (com o screenshot referenciado).

---

### Task 7: Prova real ponta-a-ponta + fechamento

**Files:**
- Modify: `HANDOFF-harness-evolution.md`

**Interfaces:**
- Consumes: tudo das Tasks 1-6; ambiente dev (WAHA container + sessão real "Lia"; agente publicado da sessão `c8953dc3`; worker `npm run worker`; dev server `npm run dev`).

- [ ] **Step 1: Suite completa** — `npm run typecheck` → 0; `npm run lint` → 0 errors; `npx vitest run` → PASS.

- [ ] **Step 2: Coordenação de ambiente (OBRIGATÓRIA — lição da Fase 0).** Inventariar processos: `lsof -tiTCP:3000 -sTCP:LISTEN`/`lsof -tiTCP:8787 -sTCP:LISTEN` + `ps -o lstart= -p <pid>`. Worker/dev server com start ANTERIOR aos commits desta fase = código velho. Se houver processo do Rafael, PERGUNTAR antes de matar (pode ser teste/vídeo dele). Registrar no handoff o estado da config do agente ANTES da prova (`published_version_id`, persona) para restaurar depois.

- [ ] **Step 3: Prova real.** (a) Na TELA `app/app/ai/memory` (não via SQL): publicar um doc-mãe com uma regra comportamental verificável e inofensiva à persona atual, ex.: `"REGRA OBRIGATÓRIA: encerre TODA resposta com a assinatura exata: — Equipe <NomeDaEmpresa> 💚"`. (b) Subir worker da branch + dev server. (c) Rafael manda mensagem real de WhatsApp (qualquer pergunta). (d) PROVA: a resposta chega no WhatsApp com a assinatura da memória (`sent` + `external_id`), SEM ter tocado no prompt do agente — é a camada da org agindo sobre o agente existente. (e) Editar a regra na tela (ex.: trocar 💚 por ✅), publicar v2, nova mensagem → resposta reflete v2 no turno seguinte (prova do "publicar ⇒ próximo turno"). (f) Criar um aprendizado manual com um fato (ex.: "Estacionamento: temos convênio com o estacionamento da esquina") e perguntar sobre isso no WhatsApp → resposta usa o fato.
- [ ] **Step 4: Avaliação de experiência** — a assinatura aparece natural (não robótica)? A tela deixa claro o alcance org-wide? Histórico de versões legível? Qualquer "não" → corrigir antes de fechar.
- [ ] **Step 5: Fechar** — screenshots (tela + conversa) via `SendUserFile`; restaurar config/persona do Rafael se alterada; atualizar `HANDOFF-harness-evolution.md` (fase concluída, evidências, pendências); commit `docs(harness-f1): fase 1 fechada com prova real`.
