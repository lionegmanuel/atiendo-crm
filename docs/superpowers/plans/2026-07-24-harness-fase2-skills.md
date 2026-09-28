# Fase 2 — Skills Instaláveis + Marketplace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evoluir as skills situacionais do agente de "playbook texto" para PACOTE instalável (`SKILL.md` + `references/` + `assets/`, sem código executável), com upload de `.zip`, um marketplace servindo skills de fábrica por nicho, e telemetria de ativação — mantendo o mecanismo de disclosure progressivo que já funciona.

**Architecture:** Reusa o schema versão-imutável+ponteiro (`skill_versions`/`skill_pointers`) e o runtime matcher (`lib/agent-engine/agent/skills.ts`) já existentes. Acrescenta: manifest de arquivos na versão, bucket `skill-assets`, parser de pacote `.zip` (módulo puro), rotas de import/list/install/uninstall, tool `read_skill_reference` no turno, tabela `skill_activations`, tela `app/app/ai/skills` e seed de plataforma. Decisão de design: **instalar do catálogo = fork-on-install** (a org ganha sua própria `skill_version` copiada da de plataforma) — não mexe na cláusula de tenant do `setSkillPointer` e mantém o loader inalterado. **"Personalizar" na v1 = re-enviar um `.zip` com o mesmo `name`** (o import cria uma `skill_version` nova da org e move o pointer; o loader já faz a versão da org vencer a de plataforma no mesmo nome — o override que a spec pede, sem editor in-app). Editor in-app de body fica para uma fase futura.

**Tech Stack:** Postgres/Supabase (RLS + Storage), pg Pool no engine, Next.js App Router + React Query + `apiClient`, Zod, `fflate` (unzip, dep nova zero-dependência), Vitest, Playwright.

## Global Constraints

- **Doutrina de migrations**: próximo número livre = **0068** (maior real em todas as branches = 0067; convenção do repo é incrementar do maior, não preencher buracos). Arquivo `supabase/migrations/<ts>_0068_*.sql` idempotente + apêndice idempotente no `baseline.sql` + linha no `MANIFEST.md` (declarando o NNNN e a verificação anti-colisão entre branches). Buckets de Storage vão no bloco de storage do fim do baseline.
- **Sem código executável nas skills (decisão da spec)**: pacote = `SKILL.md` + `references/*.md` + `assets/*`. Nada roda. O que a v1 NÃO faz: enviar `assets/` como mídia (depende do outbound multimodal de outra branch) — assets são armazenados + manifestados, o ENVIO fica atrás de flag/deferido; a tool `read_skill_reference` cobre só `references/` (texto).
- **RLS em toda tabela nova**; teste de isolamento cobre as tabelas novas. Skills de plataforma (`organization_id null`) precisam de policy SELECT extra `organization_id is null` para o catálogo ser legível por cliente user-scoped (hoje só o service role lê plataforma).
- **Service role bypassa RLS**: toda query e todo path de storage carrega `organization_id` de fonte confiável (`requireRole`/row do job), nunca do body. Path de storage: `{org_id}/{skill}/{version}/...` para skills de org; `platform/{skill}/{version}/...` para plataforma.
- **Prefixo estável é sagrado**: o índice de skills (name+description) continua no prefixo; corpos e referências carregam sob demanda. Ordenação estável (`name` asc) preservada.
- **API**: `ok()`/`fail()` de `@/lib/api/wrappers` — `ok()` já embrulha em `{data}`, nunca `ok({data:...})`. Zod em todo input. `requireRole` + `audit` em mutação.
- **Limites de segurança do `.zip`** (input não-confiável): tamanho total ≤ 5 MB, ≤ 64 arquivos, cada arquivo ≤ 1 MB descomprimido, sem path traversal (`..`, path absoluto), extensões de asset em whitelist. Zip-bomb: recusar se a soma dos tamanhos descomprimidos passar o teto ANTES de materializar.
- **Teste imediato por peça** (protocolo do épico): front = Playwright clicando + avaliação de experiência (leigo entende?), qualquer "não" corrige antes de seguir; back = teste funcional na hora; nunca acumular pro fim. **Ambiente compartilhado**: antes de provas reais, inventariar processos vivos (`lsof -iTCP:3000/-iTCP:8787` + `ps -o lstart`) e coordenar com o Rafael; o worker de prova é o do REPO PRINCIPAL (não worktree). Limpar dado de teste do banco/storage compartilhado ao fim.
- **Handoff vivo** `HANDOFF-harness-evolution.md` alimentado ao fim de CADA task. Doutrina **sistema vivo** (`docs/doctrine/sistema-vivo.md`): a peça skills entra no mapa `docs/architecture/` com ≥2 arestas. Nunca `cmd | tail`; `graphify query` antes de ler código; copy pt-br; commits `feat(harness-f2): ...`.

---

### Task 1: Migration 0068 (manifest + skill_activations + bucket + RLS)

**Files:**
- Create: `supabase/migrations/<timestamp>_0068_skills_marketplace.sql`
- Modify: `supabase/baseline.sql` (apêndice schema + bloco storage; array do loop RLS)
- Modify: `supabase/migrations/MANIFEST.md`
- Modify: `tests/invariants/rls-isolation.test.ts`
- Modify: `lib/database.types.ts` (regenerado)

**Interfaces:**
- Produces: `skill_versions` ganha `manifest jsonb not null default '[]'` (lista `{path,size,sha256,kind}`) e `forked_from_version_id uuid null references skill_versions(id) on delete set null`; tabela nova `skill_activations` (`organization_id`, `skill_name`, `skill_version_id`, `trigger` `hard|probe`, `job_id`, `created_at`); bucket privado `skill-assets`; policy SELECT de catálogo em `skill_versions`/`skill_pointers` para `organization_id is null`.

- [ ] **Step 1: Escrever a migration** (`<timestamp>` = use um timestamp após `20260724010000`, ex.: `20260724120000`):

```sql
-- 0068: Skills instaláveis + marketplace (Fase 2 do épico harness — spec 2026-07-23).
-- Manifest de arquivos na versão de skill + telemetria de ativação + bucket de
-- assets + leitura do catálogo de plataforma por clientes user-scoped.

alter table skill_versions add column if not exists manifest jsonb not null default '[]'::jsonb;
alter table skill_versions add column if not exists forked_from_version_id uuid references skill_versions(id) on delete set null;

create table if not exists skill_activations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  skill_name text not null,
  skill_version_id uuid references skill_versions(id) on delete set null,
  trigger text not null check (trigger in ('hard', 'probe')),
  job_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_skill_activations_org_created
  on skill_activations (organization_id, created_at);
create index if not exists idx_skill_activations_skill
  on skill_activations (organization_id, skill_name, created_at);

-- RLS das tabelas org-scoped novas (skill_activations). skill_versions/pointers já
-- estão no loop tenant_isolation do baseline; a leitura de catálogo é policy extra abaixo.
do $$
declare t text;
begin
  foreach t in array array['skill_activations'] loop
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

-- Catálogo do marketplace: qualquer usuário autenticado LÊ as skills de plataforma
-- (organization_id null). Só SELECT; escrita de plataforma continua service-role.
drop policy if exists catalog_read_skill_versions on skill_versions;
create policy catalog_read_skill_versions on skill_versions for select
  to authenticated using (organization_id is null);
drop policy if exists catalog_read_skill_pointers on skill_pointers;
create policy catalog_read_skill_pointers on skill_pointers for select
  to authenticated using (organization_id is null);
```

- [ ] **Step 2: Bloco de bucket no `baseline.sql`** (no bloco de storage do fim do arquivo, após os buckets existentes; a migration acima NÃO cria bucket — buckets vivem só no baseline/bloco storage por serem infra de Storage, seguindo o padrão do repo). Adicionar:

```sql
-- ---- bucket de assets de skills (migration 0068) ----
insert into storage.buckets (id, name, public, file_size_limit)
values ('skill-assets', 'skill-assets', false, 5242880)
on conflict (id) do nothing;

-- Leitura por org (path {org_id}/...) OU plataforma (path platform/...) por qualquer
-- usuário autenticado (assets de plataforma são públicos p/ tenants; conteúdo é curado).
create policy "skill_assets_read" on storage.objects for select to authenticated
  using (
    bucket_id = 'skill-assets'
    and (
      split_part(name, '/', 1) = 'platform'
      or exists (
        select 1 from public.user_organizations uo
        where uo.user_id = auth.uid() and uo.revoked_at is null
          and uo.organization_id = (split_part(name, '/', 1))::uuid
      )
    )
  );
-- Escrita/DELETE de assets é sempre via service role (rota de import) — sem policy de write.
```

- [ ] **Step 3: Apêndice schema no `baseline.sql`** — o conteúdo do Step 1 (ALTERs + skill_activations + policies), verbatim e idempotente, precedido de:

```sql
-- ---- skills instaláveis: manifest + skill_activations + catálogo (migration 0068) ----
```

- [ ] **Step 4: Linha no MANIFEST** (`supabase/migrations/MANIFEST.md`):

```
| `20260724120000` | `0068_skills_marketplace` | Épico Harness (F2): `skill_versions` ganha `manifest` (lista de arquivos {path,size,sha256,kind}) + `forked_from_version_id`; tabela `skill_activations` (telemetria hard/probe por turno); bucket `skill-assets` (privado, 5MB); policy SELECT de catálogo (`organization_id is null`) em skill_versions/pointers p/ o marketplace ser legível user-scoped. RLS `tenant_isolation` em skill_activations. NNNN=0068 (maior real era 0067; verificado em todas as branches). `database.types.ts` regenerado. |
```

- [ ] **Step 5: Aplicar e provar idempotência** (banco dev cloud — `SUPABASE_DB_URL` do `.env.local`; se a role do env não tiver privilégio de DDL, aplicar via `supabase db query --linked` como na Fase 1):

Run: aplicar o arquivo; depois re-aplicar → sem erro. `psql "$DBURL" -tAc "select count(*) from skill_activations;"` → `0`. `psql "$DBURL" -tAc "select id from storage.buckets where id='skill-assets';"` → 1 linha.

- [ ] **Step 6: Regenerar types** (padrão da Fase 1 — regenerar do banco e, se vier poluído com tabelas de outras branches, reduzir o diff ao que 0068 adiciona: colunas de `skill_versions` + tabela `skill_activations`). `npm run typecheck` → exit 0.

- [ ] **Step 7: Teste de isolamento RLS** — em `tests/invariants/rls-isolation.test.ts`: adicionar `"skill_activations"` ao array `TABLES` e semear 1 linha por org no `beforeAll` (usar as constantes `ORG_A`/`ORG_B` existentes):

```sql
insert into skill_activations (organization_id, skill_name, trigger) values ('<ORG_A>', 's', 'hard');
insert into skill_activations (organization_id, skill_name, trigger) values ('<ORG_B>', 's', 'hard');
```

Run: `npm run test:db` (docker) OU o smoke manual do padrão da Fase 1 (cross-tenant count=0, own-org ≥1).

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/<timestamp>_0068_skills_marketplace.sql supabase/baseline.sql supabase/migrations/MANIFEST.md tests/invariants/rls-isolation.test.ts lib/database.types.ts
git commit -m "feat(harness-f2): schema skills instaláveis (0068) — manifest, skill_activations, bucket, catálogo RLS"
```

---

### Task 2: Expor `version_id` no loader de skills

**Files:**
- Modify: `lib/agent-engine/agent/skills.ts` (`LoadedSkill` ~L64, `loadSkills` SELECT ~L158)
- Test: `lib/agent-engine/agent/skills.test.ts` (estender; se não existir, criar com o caso abaixo)

**Interfaces:**
- Consumes: schema de `skill_versions` (tem `id`).
- Produces: `LoadedSkill` ganha `versionId: string`; `loadSkills` passa a selecionar `v.id`. Consumido pela telemetria (Task 6). Assinaturas de `loadSkills`/`renderSkillIndex`/`matchSkills`/`renderMatchedSkillBodies` inalteradas exceto o campo novo.

- [ ] **Step 1: Teste que falha**

```ts
// lib/agent-engine/agent/skills.test.ts — caso novo
import { describe, expect, it, vi } from 'vitest';
import { loadSkills } from './skills';

it('loadSkills expõe versionId de cada skill', async () => {
  const rows = [{ organization_id: null, id: 'ver-1', name: 'frete', description: 'd', body: 'b', matcher: { any_keywords: ['frete'] } }];
  const db = { query: vi.fn().mockResolvedValue({ rows }) } as never;
  const skills = await loadSkills(db, 'org1');
  expect(skills[0]?.versionId).toBe('ver-1');
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run lib/agent-engine/agent/skills.test.ts` → FAIL (`versionId` undefined).

- [ ] **Step 3: Implementar** — em `skills.ts`:
  - `LoadedSkill`: adicionar `versionId: string;`.
  - `loadSkills` SELECT: incluir `v.id`: `select v.id, v.organization_id, v.name, v.description, v.body, v.matcher from skill_pointers p join skill_versions v on v.id = p.version_id where ...`.
  - No monte do `Map`, incluir `versionId: r.id` no objeto `LoadedSkill`.

- [ ] **Step 4: Verde + typecheck + commit**

Run: `npx vitest run lib/agent-engine/agent/skills.test.ts` → PASS; `npm run typecheck` → 0.

```bash
git add lib/agent-engine/agent/skills.ts lib/agent-engine/agent/skills.test.ts
git commit -m "feat(harness-f2): loadSkills expõe versionId (pré-requisito da telemetria)"
```

---

### Task 3: Parser de pacote de skill (`.zip` → objeto validado)

**Files:**
- Modify: `package.json` (add `fflate`)
- Create: `lib/ai/skills/package.ts` (parser puro)
- Test: `lib/ai/skills/package.test.ts`

**Interfaces:**
- Consumes: `fflate` (`unzipSync`); `zod`.
- Produces (Tasks 4-5 consomem):

```ts
export interface SkillManifestEntry { path: string; size: number; sha256: string; kind: 'reference' | 'asset' }
export interface ParsedSkillPackage {
  name: string;
  description: string;
  matcher: { any_keywords: string[]; probe_keywords?: string[] };
  body: string;                              // corpo do SKILL.md (sem o frontmatter), ≤200 linhas
  files: Array<{ path: string; bytes: Uint8Array; entry: SkillManifestEntry }>;  // references/ + assets/
}
export type ParseSkillResult =
  | { ok: true; pkg: ParsedSkillPackage }
  | { ok: false; error: { code: string; message: string } };   // erro de ENSINO ao usuário (pt-br)
export function parseSkillPackage(zipBytes: Uint8Array): ParseSkillResult;
```

- [ ] **Step 1: Add dep** — `npm install fflate` (é dep de runtime, zero-dependency). Confirmar em `package.json` `dependencies`.

- [ ] **Step 2: Testes que falham**

```ts
// lib/ai/skills/package.test.ts
import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parseSkillPackage } from './package';

function makeZip(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [p, c] of Object.entries(files)) entries[p] = strToU8(c);
  return zipSync(entries);
}

const validSkillMd = `---
name: frete-gratis
description: Explica a política de frete grátis ao cliente.
matcher:
  any_keywords: [frete, entrega]
  probe_keywords: [envio]
---
Quando o cliente perguntar sobre frete, explique a regra e confirme o CEP.`;

describe('parseSkillPackage', () => {
  it('lê SKILL.md (frontmatter → matcher/name/description, corpo) + references', () => {
    const zip = makeZip({ 'SKILL.md': validSkillMd, 'references/tabela.md': '# Tabela de frete\nSP: grátis' });
    const out = parseSkillPackage(zip);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.pkg.name).toBe('frete-gratis');
      expect(out.pkg.matcher.any_keywords).toEqual(['frete', 'entrega']);
      expect(out.pkg.body).toContain('confirme o CEP');
      expect(out.pkg.body).not.toContain('---'); // frontmatter removido
      const ref = out.pkg.files.find((f) => f.path === 'references/tabela.md');
      expect(ref?.entry.kind).toBe('reference');
      expect(ref?.entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('SKILL.md ausente → erro de ensino', () => {
    const out = parseSkillPackage(makeZip({ 'leia.txt': 'oi' }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('skill_md_missing');
  });

  it('frontmatter inválido (sem any_keywords) → erro de ensino', () => {
    const bad = `---\nname: x\ndescription: y\nmatcher: {}\n---\ncorpo`;
    const out = parseSkillPackage(makeZip({ 'SKILL.md': bad }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('skill_frontmatter_invalid');
  });

  it('path traversal é recusado', () => {
    const out = parseSkillPackage(makeZip({ 'SKILL.md': validSkillMd, '../evil.md': 'x' }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('skill_unsafe_path');
  });

  it('excesso de arquivos é recusado', () => {
    const files: Record<string, string> = { 'SKILL.md': validSkillMd };
    for (let i = 0; i < 65; i++) files[`references/f${i}.md`] = 'x';
    const out = parseSkillPackage(makeZip(files));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('skill_too_many_files');
  });
});
```

- [ ] **Step 3: Rodar e ver falhar** — `npx vitest run lib/ai/skills/package.test.ts` → FAIL (módulo não existe).

- [ ] **Step 4: Implementar** (`lib/ai/skills/package.ts`) — regras: frontmatter YAML mínimo parseado à mão (só os campos `name`, `description`, `matcher.any_keywords`, `matcher.probe_keywords` — NÃO adicionar dep de YAML; um parser de frontmatter simples de chaves conhecidas basta e é mais seguro que YAML arbitrário), validado com `skillMatcherSchema` (reusar de `lib/agent-engine/agent/skills.ts` — exportá-lo se não estiver exportado) + Zod para name/description; `body` = tudo após o segundo `---`, com `validateSkillBody` (≤200 linhas — reusar); arquivos sob `references/` = kind `reference`, sob `assets/` = kind `asset`, extensões de asset em whitelist (`png,jpg,jpeg,webp,gif,pdf,mp3,ogg,mp4`), demais paths recusados; limites (≤64 arquivos, ≤5MB total, cada ≤1MB, sem `..`/absolutos); `sha256` via `node:crypto`. Erros como `{ ok:false, error:{ code, message } }` em pt-br.

- [ ] **Step 5: Verde + typecheck + commit**

Run: `npx vitest run lib/ai/skills/package.test.ts` → PASS; `npm run typecheck` → 0.

```bash
git add package.json package-lock.json lib/ai/skills/package.ts lib/ai/skills/package.test.ts
git commit -m "feat(harness-f2): parser de pacote de skill (.zip → SKILL.md + references + assets, com limites)"
```

(Se o repo usa pnpm/npm lockfile diferente, ajustar o path do lockfile no `git add`.)

---

### Task 4: Import writer (storage + skill_version com manifest) + fork-on-install

**Files:**
- Create: `lib/ai/skills/install.ts`
- Test: `lib/ai/skills/install.test.ts`

**Interfaces:**
- Consumes: `ParsedSkillPackage` (Task 3); `insertSkillVersion`/`setSkillPointer` de `lib/agent-engine/agent/skills.ts` (nota: `insertSkillVersion` precisa aceitar `manifest` — estendê-lo nesta task, mantendo compat); admin Supabase client (`createAdminClient`) para storage; pg Pool.
- Produces (Task 5 consome):

```ts
export async function importSkillPackage(deps: { db: pg.Pool; admin: SupabaseClient }, input: {
  organizationId: string; pkg: ParsedSkillPackage; createdBy: string | null;
}): Promise<{ versionId: string; name: string }>;   // sobe arquivos em {org}/{skill}/{versionId}/... + cria version(manifest)+pointer

export async function installPlatformSkill(deps: { db: pg.Pool }, input: {
  organizationId: string; name: string; createdBy: string | null;
}): Promise<{ versionId: string }>;   // fork-on-install: copia a skill_version de plataforma (name) para uma da org + pointer, forked_from_version_id preenchido
```

- [ ] **Step 1: Testes que falham** — cobrir: (a) `importSkillPackage` sobe cada arquivo do pkg para o path `{org}/{skill}/{versionId}/{path}` e cria a `skill_version` com o `manifest` do pkg + pointer da org (mock do admin client no padrão dos testes de rota `app/api/v1/ai/memory/`; mock do pg pool capturando o insert); (b) `installPlatformSkill` lê a versão de plataforma pelo `name`, insere uma `skill_version` da org com o mesmo body/manifest e `forked_from_version_id` = id da versão de plataforma, e mode o pointer da org; (c) org_id nunca vem do pkg — é sempre `input.organizationId`.

Run: `npx vitest run lib/ai/skills/install.test.ts` → FAIL.

- [ ] **Step 2: Estender `insertSkillVersion`** (`skills.ts`) para aceitar `manifest?: unknown[]` e `forkedFromVersionId?: string | null`, gravando nas colunas novas (default `[]`/null — compat com chamadas existentes).

- [ ] **Step 3: Implementar `install.ts`.** `importSkillPackage`: para cada `f` em `pkg.files`, `admin.storage.from('skill-assets').upload(\`${organizationId}/${pkg.name}/${versionId}/${f.path}\`, Buffer.from(f.bytes), { upsert: false })`; em falha, remover os já subidos e lançar; depois `insertSkillVersion(db, { tenantId: organizationId, name, description, body, matcher, manifest: pkg.files.map(f=>f.entry), forkedFromVersionId: null })` + `setSkillPointer`. Ordem: gerar o versionId ANTES (a `insertSkillVersion` retorna a versão; para o path do storage precisar do id, ou inserir a versão primeiro e então subir arquivos com o id retornado — inverter a ordem: insere versão → sobe arquivos → set pointer; se o upload falhar, a versão órfã é inofensiva, mas logar). `installPlatformSkill`: `select` da versão de plataforma (`where organization_id is null and name=$1` na `skill_pointers`→`skill_versions`), `insertSkillVersion(tenantId=org, ..., forkedFromVersionId=platformVersionId)`, `setSkillPointer(org, name, novaVersao)`.

- [ ] **Step 4: Verde + typecheck + commit**

Run: `npx vitest run lib/ai/skills/install.test.ts` → PASS; `npm run typecheck` → 0.

```bash
git add lib/ai/skills/install.ts lib/ai/skills/install.test.ts lib/agent-engine/agent/skills.ts
git commit -m "feat(harness-f2): import de pacote (storage+manifest) e fork-on-install do catálogo"
```

---

### Task 5: Rotas API de skills

**Files:**
- Create: `app/api/v1/ai/skills/route.ts` (GET: instaladas + catálogo)
- Create: `app/api/v1/ai/skills/import/route.ts` (POST multipart)
- Create: `app/api/v1/ai/skills/[name]/install/route.ts` (POST: instalar do catálogo)
- Create: `app/api/v1/ai/skills/[name]/route.ts` (DELETE: remover pointer da org / desinstalar)
- Test: `app/api/v1/ai/skills/route.test.ts`, `app/api/v1/ai/skills/import/route.test.ts`

**Interfaces:**
- Consumes: `importSkillPackage`/`installPlatformSkill` (Task 4); `parseSkillPackage` (Task 3); `requireRole`, `ok`/`fail`, `audit`, `createAdminClient`, molde multipart de `app/api/v1/ai/knowledge/sources/upload/route.ts`.
- Produces (Task 7 consome):
  - `GET /api/v1/ai/skills` → `ok({ installed: [{ name, description, version_id, source: 'manual'|'catalog', updated_at }], catalog: [{ name, description }] })` (role `agent`; `installed` = skills da org resolvidas; `catalog` = skills de plataforma NÃO instaladas pela org). Auditar não.
  - `POST /api/v1/ai/skills/import` multipart `file=<zip>` → `ok({ name, version_id })` (role `manager`; parseSkillPackage → importSkillPackage; erro de parse vira `fail(error.code, error.message, 422)`; audit `ai.skill_imported`).
  - `POST /api/v1/ai/skills/[name]/install` → `ok({ version_id })` (role `manager`; installPlatformSkill; audit `ai.skill_installed`).
  - `DELETE /api/v1/ai/skills/[name]` → `ok({ name })` (role `manager`; remove o `skill_pointers` da org para esse name — a skill some do agente; audit `ai.skill_uninstalled`). NÃO apaga versões (histórico imutável).

- [ ] **Step 1: Ler os moldes** — `app/api/v1/ai/knowledge/sources/upload/route.ts` (multipart), `app/api/v1/ai/memory/route.ts` (GET+audit). Adicionar as 3 novas ações ao union `AuditAction` em `lib/audit/actions.ts` (`ai.skill_imported`, `ai.skill_installed`, `ai.skill_uninstalled`).

- [ ] **Step 2: Testes que falham** — `route.test.ts`: GET retorna `installed`/`catalog` separados corretamente (mock admin); `import/route.test.ts`: POST com um zip válido (montado com `fflate` no teste) chama importSkillPackage e responde `{data:{name,version_id}}` sem double-nest; zip inválido → 422 com o code do parser; org sempre do `requireRole`, nunca do form. (mock de `requireRole` + `createAdminClient` no padrão dos testes de `app/api/v1/ai/memory/`.)

Run: `npx vitest run app/api/v1/ai/skills` → FAIL.

- [ ] **Step 3: Implementar as 4 rotas** seguindo os moldes (Zod nos inputs; `organization_id` sempre de `requireRole`; parse multipart nativo; `fail("validation_failed",...,422,{requestId,details})`).

- [ ] **Step 4: Verde + typecheck + lint + commit**

Run: `npx vitest run app/api/v1/ai/skills` → PASS; `npm run typecheck` → 0; `npx eslint app/api/v1/ai/skills` → 0.

```bash
git add app/api/v1/ai/skills lib/audit/actions.ts
git commit -m "feat(harness-f2): API de skills (import .zip, listar instaladas+catálogo, instalar, desinstalar)"
```

---

### Task 6: Tool `read_skill_reference` no turno + telemetria `skill_activations`

**Files:**
- Modify: `lib/agent-engine/agent/inbound-turn.ts` (AGENT_TOOL_DEFS; rawTools; ponto do `matchSkills` ~L1134-1143)
- Modify: `lib/agent-engine/agent/tool-breaker.ts` (READ_ONLY_TOOLS)
- Create: `lib/agent-engine/agent/skill-references.ts` (helper que lê uma reference do storage por skill casada no turno)
- Test: `lib/agent-engine/agent/skill-references.test.ts`

**Interfaces:**
- Consumes: `skillMatch.matched` (com `versionId` da Task 2); `manifest` da `skill_version` (paths das references); admin storage client para baixar a reference.
- Produces: tool `read_skill_reference(skill_name, ref_path)` — só lê references de skills CASADAS neste turno (sem vazamento entre skills), retorna o texto (ou erro de ensino); `skill_activations` gravada (uma linha por skill casada `trigger='hard'` + uma por near-miss `trigger='probe'`) no ponto do `matchSkills`, fire-and-forget (falha só loga).

- [ ] **Step 1: READ_ONLY_TOOLS** — adicionar `'read_skill_reference'` em `tool-breaker.ts` (com teste, padrão da Fase 0).

- [ ] **Step 2: Helper + tool** — `skill-references.ts` expõe `readSkillReference(deps, { matchedSkills, skillName, refPath })`: valida que `skillName` está em `matchedSkills` (senão erro de ensino `skill_not_active`), valida que `refPath` está no `manifest` da skill como kind `reference` (senão `reference_not_found`), baixa do storage (`admin.storage.from('skill-assets').download(...)`) e devolve o texto. Def estática em `AGENT_TOOL_DEFS` (prefixo estável); executa por closure em `rawTools`; gate: só entra quando há ≥1 skill casada com references.

- [ ] **Step 3: Telemetria** — no ponto do `matchSkills` (~L1134-1143), após montar `skillMatch`, inserir fire-and-forget:

```ts
// Fase 2: telemetria de ativação de skill (hard match + near-miss probe).
try {
  const rows: Array<[string, string | null, string]> = [
    ...skillMatch.matched.map((s) => [s.name, s.versionId, 'hard'] as [string, string | null, string]),
    ...skillMatch.missCandidates.map((m) => [m.skill, null, 'probe'] as [string, string | null, string]),
  ];
  for (const [name, verId, trig] of rows) {
    await pool.query(
      `insert into skill_activations (organization_id, skill_name, skill_version_id, trigger, job_id)
       values ($1,$2,$3,$4,$5)`,
      [tenantId, name, verId, trig, job.id],
    );
  }
} catch (err) {
  runLog.warn('skill_activations não gravadas', { error: (err instanceof Error ? err.message : String(err)).slice(0, 120) });
}
```

(`missCandidates` traz `{ skill, reason }` — usar `m.skill`; se precisar do versionId do near-miss, ele não está no `missCandidates` hoje, então `null` é aceitável — near-miss é sinal, não ativação plena.)

- [ ] **Step 4: Verde + typecheck + suite do engine + commit**

Run: `npx vitest run lib/agent-engine` → PASS (byte-identidade do prefixo intacta); `npm run typecheck` → 0.

```bash
git add lib/agent-engine/agent/inbound-turn.ts lib/agent-engine/agent/tool-breaker.ts lib/agent-engine/agent/tool-breaker.test.ts lib/agent-engine/agent/skill-references.ts lib/agent-engine/agent/skill-references.test.ts
git commit -m "feat(harness-f2): tool read_skill_reference + telemetria skill_activations no turno"
```

---

### Task 7: Marketplace UI `app/app/ai/skills`

**Files:**
- Create: `app/app/ai/skills/page.tsx` (server), `app/app/ai/skills/_client.tsx` (client)
- Create: `hooks/ai/useSkills.ts`
- Modify: `components/shell/Sidebar.tsx` (item "Skills da IA" → `/app/ai/skills`), `hooks/auth/AuthProvider.tsx` (`ai.skills.view: manager`, `ai.skills.manage: manager`)

**Interfaces:**
- Consumes: API da Task 5; padrões de `app/app/ai/memory` (server guard + initialData) e `hooks/ai/useOrgMemory.ts` (React Query + apiClient). Query key `["skills"]`.
- Produces: tela com duas seções — **Instaladas** (cards de skill com nome, descrição, origem manual/catálogo, botão Desinstalar) e **Catálogo** (skills de plataforma não instaladas, botão Instalar) — e um botão "Enviar skill (.zip)" que faz upload multipart para `/import`.

- [ ] **Step 1: Hooks** (`hooks/ai/useSkills.ts`) — `useSkills(initial?)` (GET), `useInstallSkill()` (POST install), `useUninstallSkill()` (DELETE), `useImportSkill()` (POST multipart com `FormData`). Todos invalidam `["skills"]`. Padrão exato de `useOrgMemory.ts`.

- [ ] **Step 2: Page + client** — `page.tsx` espelha `memory/page.tsx` (auth, guard manager, fetch inicial). `_client.tsx`: seção "Skills instaladas" (empty state ensina "instale do catálogo ou envie um .zip"), seção "Catálogo" (cards com Instalar), botão de upload (input file `.zip` → useImportSkill; toast de sucesso/erro com a mensagem do parser). Copy pt-br de leigo, visual consistente com as telas de IA vizinhas. Sub-título: "Habilidades especializadas que seus agentes carregam só quando a conversa pede — instale prontas do catálogo ou envie a sua." Incluir um texto curto de ajuda explicando que **para personalizar uma skill instalada, basta reenviar um `.zip` com o mesmo nome** (a sua versão passa a valer no lugar da do catálogo) — sem editor in-app nesta fase.

- [ ] **Step 3: Sidebar + permissões** — item "Skills da IA" junto de "Memória da IA"; permissões declaradas em `AuthProvider` consumidas via `usePermission` (padrão da Fase 1 T6 — sem gate inline duplicado).

- [ ] **Step 4: Teste em Playwright (CLICANDO — protocolo).** Login manager (`.e2e-creds.json`; se aponta p/ ambiente local desligado, usar os users e2e no cloud com a senha do arquivo — ver HANDOFF). Fluxo: abrir a tela → ver o catálogo (após Task 8 haver seed) → Instalar uma skill do catálogo → ela aparece em Instaladas → Desinstalar. E: enviar um `.zip` de skill (montar um zip mínimo válido localmente) → aparece em Instaladas. Avaliar experiência (leigo entende o que é uma "skill"? o catálogo convida?). Qualquer "não" → corrigir. Screenshot `f2-skills-tela.png`. **Cleanup**: remover do banco/storage as skills de teste que a org instalou/enviou; confirmar.

- [ ] **Step 5: Verde + commit**

Run: `npm run typecheck` → 0; `npx eslint app/app/ai/skills hooks/ai/useSkills.ts` → 0.

```bash
git add app/app/ai/skills hooks/ai/useSkills.ts components/shell/Sidebar.tsx hooks/auth/AuthProvider.tsx
git commit -m "feat(harness-f2): marketplace de skills (instaladas + catálogo + upload .zip)"
```

---

### Task 8: Seed de skills de plataforma por nicho

**Files:**
- Create: `supabase/migrations/<timestamp>_0069_seed_platform_skills.sql`
- Modify: `supabase/baseline.sql` (apêndice), `supabase/migrations/MANIFEST.md`

**Interfaces:**
- Consumes: `skill_versions`/`skill_pointers` (org_id null = plataforma).
- Produces: 2 skills de fábrica bem-feitas (qualidade > quantidade), idempotentes, visíveis no catálogo de toda org: ex. `objecao-preco` (contornar objeção de preço — nicho vendas/genérico) e `agendamento` (marcar horário — nicho clínicas/serviços). Cada uma: `SKILL.md` inline no SQL como `insert into skill_versions (organization_id=null, name, description, body, matcher, manifest='[]')` + `insert into skill_pointers (organization_id=null, name, version_id)`, idempotente (`on conflict do nothing` no pointer; versão só inserida se o pointer ainda não existir — usar um `where not exists` guard).

- [ ] **Step 1: Escrever o seed** (idempotente — não duplica em re-aplicação; a imutabilidade da versão + unique do pointer garantem, mas o guard `where not exists (select 1 from skill_pointers where organization_id is null and name=...)` evita versões órfãs em re-run). Bodies de qualidade (≤200 linhas, pt-br, com if-then situacional real; matcher com `any_keywords` fortes).

- [ ] **Step 2: MANIFEST + baseline apêndice** (mesmo padrão; NNNN=0069).

- [ ] **Step 3: Aplicar + provar** — aplicar; `psql -tAc "select name from skill_pointers where organization_id is null order by name;"` → as 2 skills; re-aplicar → sem duplicação.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/<timestamp>_0069_seed_platform_skills.sql supabase/baseline.sql supabase/migrations/MANIFEST.md
git commit -m "feat(harness-f2): seed de skills de plataforma (catálogo inicial por nicho)"
```

---

### Task 9: Prova real ponta-a-ponta + fechamento

**Files:**
- Modify: `HANDOFF-harness-evolution.md`; `docs/architecture/` (skills no mapa vivo, ≥2 arestas: tela/import→skill, skill→turno)

**Interfaces:**
- Consumes: tudo das Tasks 1-8; ambiente dev (dev server + worker do REPO PRINCIPAL; sessão WAHA real; agente publicado; crédito Anthropic).

- [ ] **Step 1: Suite completa** — `npm run typecheck` → 0; `npm run lint` → 0; `npx vitest run` → PASS.

- [ ] **Step 2: Coordenação de ambiente** (lição das fases anteriores) — inventariar processos vivos; worker de prova = repo principal; registrar estado do agente/config ANTES.

- [ ] **Step 3: Prova real.** (a) Pela TELA: instalar uma skill do catálogo (ex.: `objecao-preco`) OU enviar um `.zip` com uma skill que tenha uma `reference` e uma keyword verificável. (b) Do WhatsApp real, mandar uma mensagem que dispare a keyword da skill. (c) PROVA: a resposta reflete o conteúdo do corpo da skill (que só carrega no match) — comportamento que o agente NÃO teria sem a skill instalada; e se a skill tem reference, verificar no log do worker que `read_skill_reference` foi chamada. (d) Verificar `skill_activations`: `select skill_name, trigger from skill_activations where organization_id=... order by created_at desc` mostra a ativação `hard` da skill no turno. (e) Contra-prova: mandar mensagem SEM a keyword → a skill NÃO ativa (sem linha `hard` para ela), provando o disclosure sob demanda.
- [ ] **Step 4: Avaliação de experiência** — o catálogo/tela é claro para um leigo? A skill mudou a resposta de forma perceptível e correta? Qualquer "não" → corrigir antes de fechar.
- [ ] **Step 5: Fechar** — screenshots (tela + conversa) como evidência; **restaurar** config do agente e **remover** skills de teste da org (banco + storage) — mas MANTER o seed de plataforma (é catálogo, não lixo); skills no mapa vivo; atualizar `HANDOFF-harness-evolution.md`; commit `docs(harness-f2): fase 2 fechada com prova real`.
