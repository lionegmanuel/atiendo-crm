# Fase 0 — Convergência (runtime único) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** agent-engine vira o runtime único de agentes: ganha a tool `search_knowledge` (RAG pgvector com citações) e o caminho de dispatch nativo (`lib/ai/dispatcher` + cron `agent-dispatcher`) é aposentado do caminho quente.

**Architecture:** O RAG entra como tool read-only no turno do engine (o agente decide quando buscar; o prefixo estável de cache não é poluído). A config do agente publicado passa a expor `active_kb_version_id` + knobs de RAG. O drain do engine ganha guard para orgs em modo `external` (spec 14) e passa a ser o único consumidor de `ai_agent.dispatch_requested`.

**Tech Stack:** TypeScript estrito, `ai@^7` (`tool()`, `embed`), zod v3, pg Pool direto (padrão do engine), Vitest.

## Global Constraints

- **Sem mudança de schema nesta fase** — se alguma surgir, doutrina completa de migrations (arquivo + apêndice `baseline.sql` + MANIFEST).
- **Teste imediato por peça** (protocolo do épico): cada task fecha com seu teste rodado e verde ANTES da próxima; quebrou → arruma na hora.
- **Handoff doc vivo**: `HANDOFF-harness-evolution.md` na raiz, atualizado ao fim de CADA task (progresso, testes, bugs, estado atual).
- **Nunca validar via `cmd | tail`** — exit code vira o do tail (falso verde). Rode `npm run typecheck` e `npm run lint` diretos.
- **graphify antes de ler código** (hook obrigatório do repo): `graphify query "<pergunta>"` antes de abrir arquivos que você ainda não conhece.
- Convenção de tool do engine: resultado sempre `{ ok: boolean, ... }`; erro é ENSINO ao modelo (`{ ok:false, error:{ code, message } }`), nunca exceção do SDK.
- Copy/strings do agente em pt-br.
- Commits frequentes, mensagens `feat(harness-f0): ...` / `test(harness-f0): ...`.

---

### Task 1: Handoff doc + campos de RAG no `PublishedAgentConfig`

**Files:**
- Create: `HANDOFF-harness-evolution.md`
- Modify: `lib/agent-engine/agent/agent-config.ts`
- Test: `lib/agent-engine/agent/agent-config.test.ts` (novo)

**Interfaces:**
- Consumes: tabelas `ai_agents` (`active_kb_version_id uuid null`, `config jsonb`) e `ai_agent_versions` (já existem; knobs validados por `lib/ai/guardrails-schema.ts`: `rag_top_k` default 5, `rag_similarity_threshold` default 0.72).
- Produces: `PublishedAgentConfig` ganha `activeKbVersionId: string | null`, `ragTopK: number`, `ragSimilarityThreshold: number` — consumidos na Task 3.

- [ ] **Step 1: Criar o handoff doc**

```markdown
<!-- HANDOFF-harness-evolution.md -->
# HANDOFF — Épico Evolução do Harness

> LEIA no início de toda sessão. ALIMENTE ao fim de cada task: progresso, testes rodados, bugs achados/corrigidos, o que ficou pra trás, estado atual.

**Spec:** docs/superpowers/specs/2026-07-23-harness-evolution-design.md
**Plano da fase atual:** docs/superpowers/plans/2026-07-23-harness-fase0-convergencia.md

## Estado atual
- Fase 0 iniciada. Nenhuma task concluída ainda.

## Log
- (data) — (o que foi feito, prova, pendências)
```

- [ ] **Step 2: Escrever o teste que falha (campos novos do config)**

```ts
// lib/agent-engine/agent/agent-config.test.ts
import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';

import { loadPublishedAgentConfig } from './agent-config';

const baseRow = {
  agent_id: 'a1', version_id: 'v1', agent_name: 'Vendedor', system_prompt: 'p',
  provider: 'anthropic', model: 'claude-sonnet-4-6', credential_id: null,
  max_steps: 8, history_message_window: 30, history_token_window: 8000,
  handoff_keywords: null, handoff_tool_enabled: true, tool_ids: null,
  version_created_by: null, agent_created_by: null,
  active_kb_version_id: 'kb-1',
  config: { rag_top_k: 7, rag_similarity_threshold: 0.8 },
};

function poolWith(row: Record<string, unknown> | undefined): pg.Pool {
  return { query: vi.fn().mockResolvedValue({ rows: row ? [row] : [] }) } as unknown as pg.Pool;
}

describe('loadPublishedAgentConfig — campos de RAG', () => {
  it('expõe active_kb_version_id e knobs de RAG do config', async () => {
    const cfg = await loadPublishedAgentConfig(poolWith(baseRow), 'org1', 'cs1');
    expect(cfg?.activeKbVersionId).toBe('kb-1');
    expect(cfg?.ragTopK).toBe(7);
    expect(cfg?.ragSimilarityThreshold).toBe(0.8);
  });

  it('cai nos defaults (5 / 0.72) quando config é nulo ou fora da faixa', async () => {
    const cfg = await loadPublishedAgentConfig(
      poolWith({ ...baseRow, config: { rag_top_k: 999, rag_similarity_threshold: -1 } }),
      'org1', 'cs1',
    );
    expect(cfg?.ragTopK).toBe(5);
    expect(cfg?.ragSimilarityThreshold).toBe(0.72);
  });

  it('activeKbVersionId nulo quando o agente não tem KB ativa', async () => {
    const cfg = await loadPublishedAgentConfig(poolWith({ ...baseRow, active_kb_version_id: null }), 'org1', 'cs1');
    expect(cfg?.activeKbVersionId).toBeNull();
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run lib/agent-engine/agent/agent-config.test.ts`
Expected: FAIL (propriedades `activeKbVersionId`/`ragTopK` não existem no tipo/retorno).

- [ ] **Step 4: Implementar**

Em `lib/agent-engine/agent/agent-config.ts`:

1. Interface `PublishedAgentConfig` — adicionar após `toolIds`:

```ts
  /** KB ativa do agente (ai_agents.active_kb_version_id) — null = sem RAG. */
  activeKbVersionId: string | null;
  /** knobs de RAG do ai_agents.config (defaults do guardrails-schema: 5 / 0.72). */
  ragTopK: number;
  ragSimilarityThreshold: number;
```

2. Interface `Row` — adicionar:

```ts
  active_kb_version_id: string | null;
  config: Record<string, unknown> | null;
```

3. Query — adicionar ao SELECT (junto dos campos de `a.`):

```sql
            a.active_kb_version_id,
            a.config,
```

4. Mapeamento no retorno — antes do `return`, e os campos no objeto:

```ts
  const cfg = (r.config ?? {}) as { rag_top_k?: unknown; rag_similarity_threshold?: unknown };
  const ragTopK =
    typeof cfg.rag_top_k === 'number' && Number.isInteger(cfg.rag_top_k) && cfg.rag_top_k >= 1 && cfg.rag_top_k <= 20
      ? cfg.rag_top_k
      : 5;
  const ragSimilarityThreshold =
    typeof cfg.rag_similarity_threshold === 'number' && cfg.rag_similarity_threshold >= 0 && cfg.rag_similarity_threshold <= 1
      ? cfg.rag_similarity_threshold
      : 0.72;
```

```ts
    activeKbVersionId: r.active_kb_version_id,
    ragTopK,
    ragSimilarityThreshold,
```

- [ ] **Step 5: Rodar teste (verde) + typecheck**

Run: `npx vitest run lib/agent-engine/agent/agent-config.test.ts` → PASS
Run: `npm run typecheck` → exit 0 (vai acusar os pontos que constroem `PublishedAgentConfig` em teste/mocks, se houver — corrigir adicionando os campos).

- [ ] **Step 6: Atualizar handoff + commit**

```bash
git add HANDOFF-harness-evolution.md lib/agent-engine/agent/agent-config.ts lib/agent-engine/agent/agent-config.test.ts
git commit -m "feat(harness-f0): PublishedAgentConfig expõe KB ativa e knobs de RAG"
```

---

### Task 2: Módulo `searchKnowledge` (embed + RPC pgvector)

**Files:**
- Create: `lib/agent-engine/agent/search-knowledge.ts`
- Test: `lib/agent-engine/agent/search-knowledge.test.ts` (novo)

**Interfaces:**
- Consumes: `embedText(content, { organizationId })` de `@/lib/ai/embed` (retorna `{ embedding: number[] }`; lança `Error("embed_unavailable: ...")` sem provider); RPC SQL `retrieve_top_k_chunks(p_organization_id uuid, p_kb_version_id uuid, p_embedding vector, p_k int, p_threshold real)` → `(chunk_id, knowledge_source_id, content, similarity, metadata)`.
- Produces (Task 3 consome):

```ts
export interface KnowledgeHit {
  chunk_id: string;
  knowledge_source_id: string | null;
  content: string;
  similarity: number;
  metadata: Record<string, unknown> | null;
}
export type SearchKnowledgeResult =
  | { ok: true; results: KnowledgeHit[] }
  | { ok: false; error: { code: string; message: string } };
export async function searchKnowledge(
  pool: pg.Pool,
  args: { organizationId: string; kbVersionId: string; query: string; topK: number; threshold: number },
  deps?: { embed?: typeof embedText },
): Promise<SearchKnowledgeResult>;
export function citationsFromHits(hits: KnowledgeHit[]): Citation[]; // shape de lib/ai/citations/types.ts
```

- [ ] **Step 1: Escrever os testes que falham**

```ts
// lib/agent-engine/agent/search-knowledge.test.ts
import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';

import { citationsFromHits, searchKnowledge } from './search-knowledge';

const hit = {
  chunk_id: 'c1', knowledge_source_id: 's1',
  content: 'Frete grátis acima de R$ 199.', similarity: 0.91, metadata: { source_type: 'faq' },
};

describe('searchKnowledge', () => {
  it('embeda a query e devolve os hits da RPC', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [hit] });
    const embed = vi.fn().mockResolvedValue({ embedding: [0.1, 0.2], promptTokens: 3, model: 'm' });
    const out = await searchKnowledge(
      { query } as unknown as pg.Pool,
      { organizationId: 'org1', kbVersionId: 'kb1', query: 'frete', topK: 5, threshold: 0.72 },
      { embed },
    );
    expect(out).toEqual({ ok: true, results: [hit] });
    expect(embed).toHaveBeenCalledWith('frete', { organizationId: 'org1' });
    // embedding vai à RPC como literal pgvector '[0.1,0.2]'
    expect(query.mock.calls[0][1]).toEqual(['org1', 'kb1', '[0.1,0.2]', 5, 0.72]);
  });

  it('erro de embedding vira erro de ENSINO, nunca exceção', async () => {
    const embed = vi.fn().mockRejectedValue(new Error('embed_unavailable: no key'));
    const out = await searchKnowledge(
      { query: vi.fn() } as unknown as pg.Pool,
      { organizationId: 'org1', kbVersionId: 'kb1', query: 'frete', topK: 5, threshold: 0.72 },
      { embed },
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('knowledge_unavailable');
  });
});

describe('citationsFromHits', () => {
  it('mapeia hit para o shape Citation da UI (snippet truncado, score)', () => {
    const [c] = citationsFromHits([{ ...hit, content: 'x'.repeat(500) }]);
    expect(c).toMatchObject({ chunk_id: 'c1', knowledge_source_id: 's1', score: 0.91 });
    expect((c.snippet ?? '').length).toBeLessThanOrEqual(240);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/agent-engine/agent/search-knowledge.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```ts
// lib/agent-engine/agent/search-knowledge.ts
/**
 * RAG no turno do engine (Fase 0 da convergência — spec 2026-07-23).
 *
 * Busca top-K na KB publicada do agente via RPC retrieve_top_k_chunks
 * (SECURITY DEFINER + filtro programático de org — o caller passa o org da
 * ROW do job, fonte confiável). Erros viram ensino ao modelo, convenção do
 * harness: { ok:false, error } — nunca exceção.
 */
import type pg from 'pg';

import { embedText } from '@/lib/ai/embed';
import type { Citation } from '@/lib/ai/citations/types';

export interface KnowledgeHit {
  chunk_id: string;
  knowledge_source_id: string | null;
  content: string;
  similarity: number;
  metadata: Record<string, unknown> | null;
}

export type SearchKnowledgeResult =
  | { ok: true; results: KnowledgeHit[] }
  | { ok: false; error: { code: string; message: string } };

export async function searchKnowledge(
  pool: pg.Pool,
  args: { organizationId: string; kbVersionId: string; query: string; topK: number; threshold: number },
  deps?: { embed?: typeof embedText },
): Promise<SearchKnowledgeResult> {
  const embed = deps?.embed ?? embedText;
  let embedding: number[];
  try {
    ({ embedding } = await embed(args.query, { organizationId: args.organizationId }));
  } catch {
    return {
      ok: false,
      error: {
        code: 'knowledge_unavailable',
        message: 'a base de conhecimento está indisponível agora — responda com o que você já sabe e não invente fatos.',
      },
    };
  }
  const vec = `[${embedding.join(',')}]`;
  const { rows } = await pool.query<KnowledgeHit>(
    `select chunk_id, knowledge_source_id, content, similarity, metadata
     from retrieve_top_k_chunks($1, $2, $3::vector, $4, $5)`,
    [args.organizationId, args.kbVersionId, vec, args.topK, args.threshold],
  );
  return { ok: true, results: rows };
}

/** Shape que a UI do inbox já renderiza (CitationsPanel — lib/ai/citations/types). */
export function citationsFromHits(hits: KnowledgeHit[]): Citation[] {
  return hits.map((h) => ({
    chunk_id: h.chunk_id,
    knowledge_source_id: h.knowledge_source_id,
    score: h.similarity,
    snippet: h.content.slice(0, 240),
    ...(h.metadata !== null ? { metadata: h.metadata } : {}),
  }));
}
```

- [ ] **Step 4: Rodar testes (verde) + typecheck + commit**

Run: `npx vitest run lib/agent-engine/agent/search-knowledge.test.ts` → PASS
Run: `npm run typecheck` → exit 0

```bash
git add lib/agent-engine/agent/search-knowledge.ts lib/agent-engine/agent/search-knowledge.test.ts
git commit -m "feat(harness-f0): searchKnowledge — RAG pgvector no engine com erro de ensino"
```

---

### Task 3: Tool `search_knowledge` no turno + breaker + citações na mensagem

**Files:**
- Modify: `lib/agent-engine/agent/tool-breaker.ts:102` (READ_ONLY_TOOLS)
- Modify: `lib/agent-engine/agent/inbound-turn.ts` (AGENT_TOOL_DEFS ~L110-195; rawTools ~L750; gate pós-montagem ~L1036)
- Test: `lib/agent-engine/agent/tool-breaker.test.ts` (novo, mínimo) — a integração do turno é provada na Task 6 (prova real)

**Interfaces:**
- Consumes: `searchKnowledge`/`citationsFromHits` (Task 2); `agentConfig.activeKbVersionId`/`ragTopK`/`ragSimilarityThreshold` (Task 1); no `execute` de `send_message`, o resultado do envio (`ChannelSendResult` de `lib/agent-engine/channel-adapter.ts` — variante `{ kind: 'sent', messageId }`).
- Produces: tool `search_knowledge` disponível ao modelo quando o agente tem KB ativa; `messages.metadata.citations[]` na outbound (a UI `CitationsPanel`/`MessageBubble` já renderiza esse shape).

- [ ] **Step 1: Teste do breaker (read-only inclui a nova tool)**

```ts
// lib/agent-engine/agent/tool-breaker.test.ts
import { describe, expect, it } from 'vitest';
import { READ_ONLY_TOOLS } from './tool-breaker';

describe('READ_ONLY_TOOLS', () => {
  it('search_knowledge é read-only (isenta dos gates de mutação do breaker)', () => {
    expect(READ_ONLY_TOOLS).toContain('search_knowledge');
  });
});
```

Run: `npx vitest run lib/agent-engine/agent/tool-breaker.test.ts` → FAIL.

- [ ] **Step 2: Incluir no READ_ONLY_TOOLS**

Em `lib/agent-engine/agent/tool-breaker.ts:102`:

```ts
export const READ_ONLY_TOOLS = ['get_lead_context', 'get_lead_note', 'search_knowledge'] as const;
```

Run: `npx vitest run lib/agent-engine/agent/tool-breaker.test.ts` → PASS.

- [ ] **Step 3: Def estática da tool (prefixo estável)**

Em `lib/agent-engine/agent/inbound-turn.ts`, dentro de `AGENT_TOOL_DEFS` (após `get_lead_note`, antes de `request_human_handoff`):

```ts
  search_knowledge: {
    description:
      'Busca na BASE DE CONHECIMENTO da organização (FAQ, políticas, catálogo) os trechos mais ' +
      'relevantes para uma pergunta. Use ANTES de responder qualquer dúvida factual sobre produto, ' +
      'preço, prazo, política ou funcionamento — responda com base nos trechos retornados e não ' +
      'invente o que não encontrar. Sem resultados = diga que vai confirmar, nunca chute.',
    inputSchema: z.object({
      query: z.string().min(2).describe('a pergunta ou termos a buscar, em pt-br'),
    }).passthrough(),
  },
```

- [ ] **Step 4: Execute da tool + acumulador de citações**

Em `inbound-turn.ts`, imports:

```ts
import { citationsFromHits, searchKnowledge } from './search-knowledge';
```

Junto das variáveis de estado do run (perto de `const outcomes: ChannelSendResult[] = []`, ~L744):

```ts
  // Citações acumuladas por buscas de conhecimento DESTE turno — anexadas à
  // próxima outbound enviada (shape de lib/ai/citations/types, que a UI já lê).
  let pendingCitations: ReturnType<typeof citationsFromHits> = [];
```

Em `rawTools` (junto das demais tools):

```ts
    search_knowledge: tool({
      ...AGENT_TOOL_DEFS.search_knowledge,
      execute: async ({ query }) => {
        if (agentConfig?.activeKbVersionId == null) {
          return {
            ok: false,
            error: { code: 'no_knowledge_base', message: 'este agente não tem base de conhecimento ativa — siga sem ela.' },
          };
        }
        const out = await searchKnowledge(pool, {
          organizationId: tenantId,
          kbVersionId: agentConfig.activeKbVersionId,
          query,
          topK: agentConfig.ragTopK,
          threshold: agentConfig.ragSimilarityThreshold,
        });
        if (out.ok && out.results.length > 0) {
          pendingCitations = citationsFromHits(out.results);
        }
        return out;
      },
    }),
```

- [ ] **Step 5: Gate pós-montagem (tool só entra com KB ativa)**

Logo após o bloco que deleta `request_human_handoff` (~L1036), mesmo padrão:

```ts
  // Fase 0 (convergência): a tool de conhecimento só entra quando o agente
  // publicado tem KB ativa — def estática permanece no AGENT_TOOL_DEFS (prefixo).
  if (agentConfig?.activeKbVersionId == null) {
    delete rawTools.search_knowledge;
  }
```

- [ ] **Step 6: Anexar citações na outbound enviada**

Dentro do `execute` de `send_message`, no ponto onde o resultado do envio é conhecido (após `runBeforeSend` + envio pelo adapter — o resultado é um `ChannelSendResult`; ancorar onde `outcomes.push(...)` registra o desfecho), adicionar:

```ts
        if (sendResult.kind === 'sent' && pendingCitations.length > 0) {
          try {
            await pool.query(
              `update messages
               set metadata = coalesce(metadata, '{}'::jsonb)
                 || jsonb_build_object('citations', $3::jsonb, 'ai_generated', true)
               where organization_id = $1 and id = $2`,
              [tenantId, sendResult.messageId, JSON.stringify(pendingCitations)],
            );
          } catch (err) {
            // citação é enriquecimento, não invariante — falha só loga.
            runLog.warn('citations não anexadas à outbound', {
              message_id: sendResult.messageId,
              error: (err instanceof Error ? err.message : String(err)).slice(0, 120),
            });
          }
          pendingCitations = [];
        }
```

(`sendResult` = o nome da variável local que recebe o `ChannelSendResult` nesse trecho — usar o nome existente no arquivo.)

- [ ] **Step 7: Typecheck + suite + commit**

Run: `npm run typecheck` → exit 0
Run: `npx vitest run lib/agent-engine` → PASS

```bash
git add lib/agent-engine/agent/inbound-turn.ts lib/agent-engine/agent/tool-breaker.ts lib/agent-engine/agent/tool-breaker.test.ts
git commit -m "feat(harness-f0): tool search_knowledge no turno do engine + citações na outbound"
```

Atualizar `HANDOFF-harness-evolution.md`.

---

### Task 4: Guard de modo `external` no drain (spec 14 preservada)

**Files:**
- Modify: `lib/agent-engine/edge/crm/drain.ts:106-131` (função `processEvent`)
- Test: `lib/agent-engine/edge/crm/drain.test.ts` (novo)

**Interfaces:**
- Consumes: `organizations.settings->>'ai_dispatch_mode'` (`'external'` = agente externo via MCP é o dono da conversa — spec `docs/specs/14-contrato-governanca-agentes-externos.md`).
- Produces: evento de org em modo `external` vira `done` sem job (o engine não responde por cima do agente externo).

- [ ] **Step 1: Teste que falha**

```ts
// lib/agent-engine/edge/crm/drain.test.ts
import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';

import { drainTick } from './drain';

const knobs = { batchSize: 10, intervalMs: 0, idleIntervalMs: 0, debounceMs: 0, reapTimeoutMs: 60000 };
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;
const event = {
  id: 'e1', organization_id: 'org1', attempts: 1,
  payload: {
    conversation_id: '11111111-1111-4111-8111-111111111111',
    contact_id: '22222222-2222-4222-8222-222222222222',
    channel_session_id: '33333333-3333-4333-8333-333333333333',
    inbound_message_id: '44444444-4444-4444-8444-444444444444',
  },
};

it('org em ai_dispatch_mode=external: evento vira done SEM enfileirar job', async () => {
  const calls: string[] = [];
  const query = vi.fn().mockImplementation((sql: string) => {
    calls.push(sql);
    if (sql.includes('returning e.id')) return { rows: [event] };            // claim
    if (sql.includes("ai_dispatch_mode")) return { rows: [{ mode: 'external' }] }; // guard
    if (sql.includes('is_group')) return { rows: [{ is_group: false }] };
    return { rows: [] };                                                      // reaper / done
  });
  await drainTick({ query } as unknown as pg.Pool, knobs, log);
  // o guard TEM que consultar o modo (garante FAIL antes da implementação)...
  expect(calls.some((s) => s.includes('ai_dispatch_mode'))).toBe(true);
  // ...e nenhum job pode ser enfileirado (enqueueJob nunca roda).
  expect(calls.some((s) => s.includes('job_queue'))).toBe(false);
  expect(calls.some((s) => s.includes("status = 'done'"))).toBe(true);
});
```

Run: `npx vitest run lib/agent-engine/edge/crm/drain.test.ts` → FAIL (guard não existe; job seria enfileirado).

- [ ] **Step 2: Implementar o guard**

Em `processEvent` (`drain.ts`), logo após o parse do payload (antes do check de grupo):

```ts
  // Spec 14: org em modo 'external' tem agente EXTERNO como dono da conversa —
  // o engine não responde por cima. Evento é consumido (done) sem job.
  const { rows: modeRows } = await pool.query<{ mode: string | null }>(
    `select settings->>'ai_dispatch_mode' as mode from organizations where id = $1`,
    [event.organization_id],
  );
  if (modeRows[0]?.mode === 'external') {
    log.info('drain: org em modo external (spec 14) — evento pulado', { event_id: event.id });
    return;
  }
```

- [ ] **Step 3: Verde + commit**

Run: `npx vitest run lib/agent-engine/edge/crm/drain.test.ts` → PASS
Run: `npm run typecheck` → exit 0

```bash
git add lib/agent-engine/edge/crm/drain.ts lib/agent-engine/edge/crm/drain.test.ts
git commit -m "feat(harness-f0): drain pula orgs em ai_dispatch_mode=external (spec 14)"
```

Atualizar `HANDOFF-harness-evolution.md`.

---

### Task 5: Aposentar o caminho de dispatch nativo

**Files:**
- Modify: `workers/agent-worker/main.ts:184-201` (drain liga sempre)
- Modify: `app/api/v1/cron/agent-dispatcher/route.ts` (no-op permanente com aviso de deprecation)
- Modify: `app/api/v1/cron/agent-dispatcher/route.test.ts` (caso `native` agora também no-opa)
- Modify: `lib/ai/dispatcher/index.ts:1` e `lib/ai/runtime/agent.ts:1` (header `@deprecated`)

**Interfaces:**
- Consumes: env `AGENT_DISPATCH_CONSUMER` (`lib/env.ts:85` e `lib/agent-engine/env.ts:46`, default já é `'engine'`) — o enum é MANTIDO (self-hosters com `native` setado não podem quebrar no boot), mas o valor passa a ser inerte.
- Produces: engine é o único consumidor de `ai_agent.dispatch_requested`; rota cron preservada (não 404 em cron configs) porém no-op.

- [ ] **Step 1: Ajustar o teste do cron primeiro**

Em `app/api/v1/cron/agent-dispatcher/route.test.ts`: o caso com `AGENT_DISPATCH_CONSUMER = "native"` deve passar a esperar o MESMO no-op do caso `engine` (resposta ok com `skipped`/`deprecated`, `dispatchAgents` NUNCA chamado). Ajustar as expectations desse caso.

Run: `npx vitest run app/api/v1/cron/agent-dispatcher/route.test.ts` → FAIL (rota ainda despacha em native).

- [ ] **Step 2: Rota cron vira no-op permanente**

Em `app/api/v1/cron/agent-dispatcher/route.ts`: remover o branch que chama `dispatchAgents` e responder sempre:

```ts
  // Fase 0 (convergência, spec 2026-07-23): o dispatch nativo foi aposentado —
  // o agent-worker (drain) é o único consumidor de ai_agent.dispatch_requested.
  // A rota permanece para não quebrar cron configs existentes.
  return ok({ skipped: true, deprecated: true, reason: "native dispatcher retired (Fase 0)" });
```

(manter a validação de auth do cron que a rota já tem; usar o helper `ok()` como o arquivo já usa.)

- [ ] **Step 3: Worker liga o drain incondicionalmente**

Em `workers/agent-worker/main.ts:184-201`: remover a condicional `env.AGENT_DISPATCH_CONSUMER === 'engine'` — o drain liga SEMPRE. Se `env.AGENT_DISPATCH_CONSUMER === 'native'`, logar uma vez:

```ts
  if (env.AGENT_DISPATCH_CONSUMER === 'native') {
    log.warn('AGENT_DISPATCH_CONSUMER=native é OBSOLETO (Fase 0) — o drain do engine é o único consumidor; valor ignorado', {});
  }
```

- [ ] **Step 4: Headers de deprecation**

No topo de `lib/ai/dispatcher/index.ts` e `lib/ai/runtime/agent.ts` (doc-comment existente):

```ts
/**
 * @deprecated Fase 0 da convergência (spec 2026-07-23): fora do caminho quente.
 * O runtime canônico é lib/agent-engine (workers/agent-worker). Remoção física
 * planejada após um ciclo de estabilidade. Não adicionar features aqui.
 */
```

- [ ] **Step 5: Verde + commit**

Run: `npx vitest run app/api/v1/cron/agent-dispatcher/route.test.ts` → PASS
Run: `npm run typecheck` → exit 0
Run: `npm run lint` → exit 0

```bash
git add workers/agent-worker/main.ts app/api/v1/cron/agent-dispatcher/route.ts app/api/v1/cron/agent-dispatcher/route.test.ts lib/ai/dispatcher/index.ts lib/ai/runtime/agent.ts
git commit -m "feat(harness-f0): dispatch nativo aposentado — engine é o único consumidor"
```

Atualizar `HANDOFF-harness-evolution.md`.

---

### Task 6: Verificação completa + prova real ponta-a-ponta

**Files:**
- Modify: `HANDOFF-harness-evolution.md` (estado final da fase + evidências)

**Interfaces:**
- Consumes: tudo das Tasks 1-5; ambiente dev com WAHA (memória do projeto: WAHA Core público `devlikeapro/waha:noweb` na porta 3030 para dev), org com KB indexada (`app/app/ai/knowledge`) e agente publicado com `active_kb_version_id` + sessão vinculada.

- [ ] **Step 1: Suite completa**

Run (cada um DIRETO, sem pipe): `npm run typecheck` → exit 0; `npm run lint` → exit 0; `npx vitest run` → PASS.

- [ ] **Step 2: Preparar cenário real**

1. Subir stack local (`docker compose up -d`, `npm run dev`, worker: `npm run worker:agent` — conferir script exato em `package.json`).
2. Na UI: org de teste com fonte de conhecimento indexada (FAQ com um fato verificável, ex.: "frete grátis acima de R$ 199") e agente publicado com essa KB ativa, vinculado à sessão WAHA conectada.

- [ ] **Step 3: Prova real (protocolo do épico — conversa REAL, nunca número fake)**

1. De um WhatsApp real (contato com `wa_identity` real), perguntar o fato da KB (ex.: "qual o valor mínimo pra frete grátis?").
2. Verificar: resposta chega NO WhatsApp com o fato correto (`external_id` do WAHA + `ack>=2` na row de `messages`).
3. No inbox do CRM (Playwright, CLICANDO): abrir a conversa, ver a bolha da resposta com o indicador de citações (`CitationsPanel`), screenshot como evidência (`SendUserFile`).
4. Verificar no worker log: tool `search_knowledge` chamada no turno.
5. Contra-prova do guard: setar `ai_dispatch_mode='external'` na org de teste, mandar nova mensagem, confirmar que o engine NÃO responde (evento `done`, sem job); reverter o modo.

- [ ] **Step 4: Avaliação de experiência (não só funcionalidade)**

- A resposta do agente está natural e cita o fato correto (não um despejo de chunks)?
- As citações no inbox estão claras para um atendente leigo (dá pra entender de onde veio)?
- Qualquer "não" → corrigir AGORA (prompt da tool, truncamento do snippet, copy) antes de fechar a fase.

- [ ] **Step 5: Fechar a fase**

Atualizar `HANDOFF-harness-evolution.md`: Fase 0 concluída, evidências (screenshots, ids de mensagens reais), pendências deixadas (ex.: remoção física do runtime nativo).

```bash
git add HANDOFF-harness-evolution.md
git commit -m "docs(harness-f0): fase 0 fechada com prova real ponta-a-ponta"
```
