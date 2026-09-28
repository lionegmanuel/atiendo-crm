# Fase 4 — Painel de Evolução da IA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tela onde o dono do negócio responde sozinho, sem ajuda, "o que meu agente aprendeu este mês e o que melhorou?".

**Architecture:** O painel é **leitor**, não coletor — as fases 0-3 já depositam tudo que ele mostra. Duas costuras faltam e entram aqui: (a) a busca de conhecimento (Fase 0) não registra nada, então buscas que falham são invisíveis; (b) a ponte que faz o agente mover o card no funil do tenant existe (`sincronizaEstagioDoAgente`, provada por sonda) e o encaixe no turno existe (`mirrorLeadStageToCrm`, chamado na transição), mas o encaixe é um **stub** que sempre devolve `not_configured` — os dois foram construídos por épicos diferentes e nunca se encontraram. Agregação em TypeScript puro (molde de `lib/ai/usage/aggregate.ts`), uma API `/api/v1/ai/evolution`, uma tela `app/app/ai/evolution`.

**Tech Stack:** Next.js 16 App Router · TypeScript estrito · Supabase (RLS) · Zod · recharts `^3.9.2` · Vitest · Playwright

## Global Constraints

- **Nada de sistema novo de coleta** além do já instrumentado — a spec (linha 95) é explícita. As duas exceções deste plano (Tasks 1-3) são costuras faltantes de fases anteriores, não coleta nova.
- **Toda mudança de schema**: arquivo em `supabase/migrations/` **+** apêndice idempotente no `supabase/baseline.sql` **+** linha no `supabase/migrations/MANIFEST.md`. Os três artefatos andam juntos — migration que não chega ao baseline não chega a quem faz self-host.
- **Multi-tenancy**: `organization_id uuid not null` + RLS `tenant_isolation_<tabela>_all` via `fn_user_org_ids()` em toda tabela nova.
- **Telemetria sem PII** — precedente de `ai_router_decisions` (Fase 3): nunca gravar texto de mensagem, de pergunta ou de resposta.
- **Zod** em todo input externo; `ok()`/`fail()` de `lib/api/wrappers.ts` em toda resposta; nunca `ok({data: x})` (double-nest — `ok()` já envelopa).
- **`getUser()` no backend, nunca `getSession()`**. Rotas usam `requireRole` e resolvem `organization_id` do JWT, jamais do body.
- **Todo número na tela leva a uma ação** (doutrina `docs/doctrine/sistema-vivo.md`) — número que não muda decisão não entra.
- **Teste imediato por peça**: cada tarefa fecha com seu teste rodando verde. Peça de frontend é provada em Playwright clicando, e avaliada também na EXPERIÊNCIA (está clara? o leigo entende?) — qualquer "não" vira correção antes de avançar.
- **Handoff vivo**: `HANDOFF-harness-evolution.md` alimentado ao fim de cada tarefa.
- Migration desta fase: **0086** (a última no repo é `20260726000000_0085_intent_router.sql`).
- Sem `console.log` esquecido — o repo usa logger estruturado / `console.warn` nas rotas.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260727000000_0086_knowledge_searches.sql` | Tabela de telemetria de busca de conhecimento + RLS |
| `lib/agent-engine/agent/search-knowledge.ts` (modificar) | Passa a registrar cada busca (fire-and-forget) |
| `lib/agent-engine/edge/crm/move-lead-stage.ts` (modificar) | Stub vira a implementação real, delegando a `sincronizaEstagioDoAgente` |
| `lib/ai/evolution/aggregate.ts` | Agregador **puro** — recebe linhas, devolve `EvolutionPayload` |
| `app/api/v1/ai/evolution/route.ts` | GET: busca as fontes, chama o agregador |
| `hooks/ai/useEvolution.ts` | Hook de leitura (molde de `hooks/ai/useSkills.ts`) |
| `app/app/ai/evolution/page.tsx` + `_client.tsx` | A tela |
| `components/ai/EvolutionTimeline.tsx` | Linha do tempo de aprendizado |
| `components/ai/EvolutionGaps.tsx` | Bloco "o que está travando" — as lacunas acionáveis |

---

### Task 1: Telemetria de busca de conhecimento (migration 0086)

**Por que existe:** hoje `searchKnowledge` (Fase 0) não grava nada. Uma busca que volta vazia — ou que quase acertou e foi cortada pelo limiar — é invisível. Esse é o sinal mais acionável do painel inteiro: "14 buscas quase acertaram" vira "melhore a base ou baixe o limiar", enquanto hoje o tenant só percebe que o agente não sabe responder.

**Files:**
- Create: `supabase/migrations/20260727000000_0086_knowledge_searches.sql`
- Modify: `supabase/baseline.sql` (apêndice no fim do arquivo)
- Modify: `supabase/migrations/MANIFEST.md`
- Modify: `tests/db/rls-isolation.test.ts` (semear a tabela nova no invariante de isolamento)

**Interfaces:**
- Produces: tabela `knowledge_searches` com as colunas `id, organization_id, job_id, kb_version_id, hits, top_score, threshold, created_at` — consumida pela Task 2 (escrita) e pela Task 5 (leitura).

- [ ] **Step 1: Escrever a migration**

Crie `supabase/migrations/20260727000000_0086_knowledge_searches.sql`:

```sql
-- 0086 — telemetria de busca de conhecimento (Fase 4 do épico do Harness)
--
-- POR QUE UMA TABELA E NÃO `metrics`: a pergunta que o painel precisa responder
-- é "quantas buscas QUASE acertaram", e ela exige o `top_score` da busca ao lado
-- do `threshold` que estava valendo naquele momento. Métrica agregada perde
-- exatamente essa distância, que é o número que vira ação.
--
-- SEM PII, pelo mesmo contrato de `ai_router_decisions` (0085): não gravamos o
-- texto da pergunta. `hits`/`top_score` respondem à pergunta do painel sem
-- carregar conteúdo de conversa para uma tabela de telemetria de retenção longa.

create table if not exists knowledge_searches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  job_id uuid,
  kb_version_id uuid,
  -- Quantos chunks passaram do limiar. 0 = o agente perguntou e a base não tinha.
  hits int not null default 0,
  -- Similaridade do MELHOR candidato, mesmo que abaixo do limiar. É o que
  -- distingue "a base não tem isso" (top_score baixo) de "a base tem e o limiar
  -- cortou" (top_score logo abaixo do threshold).
  top_score numeric,
  -- O limiar vigente na busca. Guardado junto porque ele é configurável por
  -- agente: comparar `top_score` com o limiar de HOJE mentiria sobre buscas de
  -- ontem.
  threshold numeric not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_knowledge_searches_org_created
  on knowledge_searches (organization_id, created_at desc);

alter table knowledge_searches enable row level security;

drop policy if exists tenant_isolation_knowledge_searches_all on knowledge_searches;
create policy tenant_isolation_knowledge_searches_all on knowledge_searches
  for all
  using (organization_id in (select fn_user_org_ids()))
  with check (organization_id in (select fn_user_org_ids()));
```

- [ ] **Step 2: Espelhar no baseline**

Acrescente no **fim** de `supabase/baseline.sql`, depois do bloco da 0085, o mesmo SQL do Step 1 precedido do rótulo:

```sql
-- ---- knowledge_searches: telemetria de busca de conhecimento (migration 0086) ----
```

Copie o corpo do Step 1 **inteiro e sem alteração** — ele já é idempotente (`create table if not exists`, `create index if not exists`, `drop policy if exists` + `create policy`), então o `update.sh` de um clone existente reaplica sem erro.

- [ ] **Step 3: Registrar no MANIFEST**

Acrescente a linha na tabela "Applied" de `supabase/migrations/MANIFEST.md`, mantendo a ordenação por timestamp:

```
| 20260727000000 | 0086_knowledge_searches | Telemetria de busca de conhecimento (hits, top_score, threshold) — leitor é o Painel de Evolução da Fase 4. Sem PII. |
```

- [ ] **Step 4: Aplicar no banco e provar idempotência**

```bash
supabase db query --linked --file supabase/migrations/20260727000000_0086_knowledge_searches.sql
supabase db query --linked --file supabase/migrations/20260727000000_0086_knowledge_searches.sql
```

Esperado: as duas rodadas terminam sem erro (a segunda prova a idempotência). Depois confirme a tabela e a policy:

```bash
supabase db query --linked --query "select count(*) from knowledge_searches; select polname from pg_policies where tablename='knowledge_searches';"
```

Esperado: `0` linhas e a policy `tenant_isolation_knowledge_searches_all` listada.

- [ ] **Step 5: Semear no teste de isolamento**

Em `tests/db/rls-isolation.test.ts`, ao lado de onde `ai_router_decisions` é semeada, acrescente a semeadura de `knowledge_searches` para as duas orgs do teste:

```ts
await seed(`insert into knowledge_searches (organization_id, hits, top_score, threshold)
            values ($1, 1, 0.81, 0.72)`, [orgA]);
await seed(`insert into knowledge_searches (organization_id, hits, top_score, threshold)
            values ($1, 0, 0.55, 0.72)`, [orgB]);
```

Rode: `npm run test:db`
Esperado: PASS — a leitura como org A devolve 1 linha de `knowledge_searches` e 0 da org B.

> Se o Docker não estiver disponível para `test:db`, prove a RLS manualmente contra o banco dev **dentro de uma transação com ROLLBACK**, como a Task 1 da Fase 3 fez, e registre no relatório que o gate automatizado ficou pendente.

- [ ] **Step 6: Regenerar os tipos**

```bash
supabase gen types typescript --linked > /tmp/types-novo.ts
```

Reduza o resultado ao **diff da 0086 apenas** antes de escrever em `lib/database.types.ts` — o banco dev é compartilhado e traz tabelas de outras branches (armadilha que já mordeu nas Fases 1, 2 e 3).

> **Exceção obrigatória nesta fase:** inclua TAMBÉM a coluna `crm_stages.agent_stage_hint`. Ela existe no banco e no `baseline.sql` desde a migration 0084 (veio da main no merge), mas **está ausente de `lib/database.types.ts`** justamente porque as fases anteriores reduziram os tipos ao próprio diff. Sem ela, a Task 5 não compila ao selecionar o mapeamento do funil — e o implementador vai perder uma rodada procurando um erro que não é dele. Confirme com `grep -n agent_stage_hint lib/database.types.ts` antes de fechar a tarefa: tem que aparecer.

Rode: `npm run typecheck`
Esperado: 0 erros.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260727000000_0086_knowledge_searches.sql supabase/baseline.sql supabase/migrations/MANIFEST.md tests/db/rls-isolation.test.ts lib/database.types.ts
git commit -m "feat(harness-f4): telemetria de busca de conhecimento (migration 0086)"
```

---

### Task 2: `searchKnowledge` passa a registrar a busca

**Por que existe:** a tabela da Task 1 nasce vazia se ninguém escrever nela. Este é o único escritor.

**Files:**
- Modify: `lib/agent-engine/agent/search-knowledge.ts`
- Test: `lib/agent-engine/agent/search-knowledge.test.ts`

**Interfaces:**
- Consumes: tabela `knowledge_searches` (Task 1).
- Produces: `searchKnowledge(pool, args, deps?)` mantém o mesmo **retorno** (`{ ok: true; results: KnowledgeHit[] } | { ok: false; error }`) e o mesmo conjunto de resultados. `args` ganha **um campo opcional** `jobId?: string | null` (só telemetria) — todos os chamadores de hoje seguem válidos sem alteração.

**O problema central desta tarefa, e ele não é óbvio:** o corte pelo limiar acontece **dentro do RPC**, não no TypeScript. `retrieve_top_k_chunks` é:

```sql
where c.organization_id = p_organization_id
  and c.kb_version_id   = p_kb_version_id
  and (1 - (c.embedding <=> p_embedding)) >= p_threshold
order by c.embedding <=> p_embedding asc
limit greatest(p_k, 0);
```

Então **não existem "linhas cruas antes do filtro"** no código de hoje: busca que não passa do limiar volta um array vazio, e o `top_score` — a razão de a tabela da Task 1 existir — é informação que nunca chegou ao Node.

**A saída (e por que ela é segura):** chame o RPC com o piso real da similaridade de cosseno (`-1`) e aplique o limiar no TypeScript. O conjunto devolvido ao chamador é **provadamente idêntico** ao de hoje:

- Se **K ou mais** chunks estão acima do limiar, os K melhores globais já estão todos acima dele — os dois caminhos devolvem os mesmos K.
- Se **menos de K** estão acima, ambos devolvem exatamente esses.

O `order by` é por distância e o `limit` vem depois do `where`, então não há caso em que o corte interno mude a seleção. Uma chamada de RPC só, sem consulta extra, e o `top_score` sai de graça.

- [ ] **Step 1: Escrever o teste que falha**

Em `lib/agent-engine/agent/search-knowledge.test.ts`, acrescente:

```ts
it('devolve ao chamador SÓ o que passa do limiar, mesmo pedindo tudo ao banco', async () => {
  const pool = {
    query: async (sql: string) => {
      if (sql.includes('retrieve_top_k_chunks')) {
        return {
          rows: [
            { chunk_id: 'c1', knowledge_source_id: null, content: 'passa', similarity: 0.91, metadata: null },
            { chunk_id: 'c2', knowledge_source_id: null, content: 'nao passa', similarity: 0.70, metadata: null },
          ],
        };
      }
      return { rows: [] };
    },
  };

  const r = await searchKnowledge(
    pool as never,
    { organizationId: 'org-1', kbVersionId: 'kb-1', query: 'oi', topK: 5, threshold: 0.72 },
    { embed: async () => ({ embedding: [0.1, 0.2] }) } as never,
  );

  expect(r.ok).toBe(true);
  // O contrato com o modelo não muda: 0.70 continua fora.
  expect(r.ok && r.results.map((h) => h.chunk_id)).toEqual(['c1']);
});

it('registra a busca com o top_score REAL, mesmo quando nada passa do limiar', async () => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (sql.includes('retrieve_top_k_chunks')) {
        return {
          rows: [
            { chunk_id: 'c1', knowledge_source_id: null, content: 'quase', similarity: 0.703, metadata: null },
          ],
        };
      }
      return { rows: [] };
    },
  };

  await searchKnowledge(
    pool as never,
    { organizationId: 'org-1', kbVersionId: 'kb-1', query: 'entregam sábado?', topK: 5, threshold: 0.72 },
    { embed: async () => ({ embedding: [0.1, 0.2] }) } as never,
  );

  const registro = queries.find((q) => q.sql.includes('knowledge_searches'));
  expect(registro, 'a busca não foi registrada').toBeDefined();
  expect(registro!.params[0]).toBe('org-1');
  // Este é o teste que sustenta a tabela inteira: 0 hits E 0.703 de melhor
  // candidato. Se o top_score vier null aqui, o painel não consegue distinguir
  // "a base não tem" de "o limiar cortou" — e a Task 1 vira peso morto.
  expect(registro!.params).toContain(0.703);
  expect(registro!.params).toContain(0.72);
});

it('o RPC é chamado com o piso da similaridade, não com o limiar do agente', async () => {
  let paramsRpc: unknown[] = [];
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('retrieve_top_k_chunks')) paramsRpc = params;
      return { rows: [] };
    },
  };

  await searchKnowledge(
    pool as never,
    { organizationId: 'org-1', kbVersionId: 'kb-1', query: 'oi', topK: 5, threshold: 0.72 },
    { embed: async () => ({ embedding: [0.1] }) } as never,
  );

  expect(paramsRpc[4]).toBe(-1);
});

it('falha ao registrar NUNCA derruba a busca', async () => {
  const pool = {
    query: async (sql: string) => {
      if (sql.includes('knowledge_searches')) throw new Error('tabela não existe');
      return {
        rows: [{ chunk_id: 'c1', knowledge_source_id: null, content: 'texto', similarity: 0.9, metadata: null }],
      };
    },
  };

  const r = await searchKnowledge(
    pool as never,
    { organizationId: 'org-1', kbVersionId: 'kb-1', query: 'oi', topK: 5, threshold: 0.72 },
    { embed: async () => ({ embedding: [0.1] }) } as never,
  );

  expect(r.ok).toBe(true);
  expect(r.ok && r.results).toHaveLength(1);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/agent-engine/agent/search-knowledge.test.ts`
Expected: FAIL — "a busca não foi registrada" e o RPC recebendo `0.72` em vez de `-1`.

- [ ] **Step 3: Implementar**

Substitua o corpo do `try` em `lib/agent-engine/agent/search-knowledge.ts` (a assinatura pública **não muda** — o parâmetro continua `args`, o retorno continua `{ ok: true; results }`):

```ts
/** Piso real da similaridade de cosseno — `1 - distância`, com distância em [0,2]. */
const PISO_SIMILARIDADE = -1;

export async function searchKnowledge(
  pool: pg.Pool,
  args: {
    organizationId: string;
    kbVersionId: string;
    query: string;
    topK: number;
    threshold: number;
    /** Só para telemetria — opcional, os chamadores de hoje seguem válidos. */
    jobId?: string | null;
  },
  deps?: { embed?: typeof embedText },
): Promise<SearchKnowledgeResult> {
  const embed = deps?.embed ?? embedText;
  try {
    const { embedding } = await embed(args.query, { organizationId: args.organizationId });
    const vec = `[${embedding.join(',')}]`;

    // Pedimos ao banco SEM limiar (piso da similaridade) e cortamos aqui. O
    // conjunto entregue ao modelo é idêntico ao de antes — `order by` é por
    // distância e o `limit` vem depois do `where`, então os K melhores globais
    // já são os K melhores acima do limiar sempre que existirem K deles.
    //
    // O que ganhamos é o `top_score`: a similaridade do melhor candidato mesmo
    // quando ela não passa. Sem isso, "a base não tem essa informação" e "a base
    // tem e o corte está apertado demais" são indistinguíveis — e são problemas
    // com consertos opostos.
    const { rows } = await pool.query<KnowledgeHit>(
      `select chunk_id, knowledge_source_id, content, similarity, metadata
       from retrieve_top_k_chunks($1, $2, $3::vector, $4, $5)`,
      [args.organizationId, args.kbVersionId, vec, args.topK, PISO_SIMILARIDADE],
    );

    const results = rows.filter((r) => r.similarity >= args.threshold);
    const topScore = rows.length > 0 ? rows[0]!.similarity : null;

    // Fire-and-forget: perder telemetria é infinitamente melhor que perder a
    // resposta ao cliente.
    try {
      await pool.query(
        `insert into knowledge_searches
           (organization_id, job_id, kb_version_id, hits, top_score, threshold)
         values ($1, $2, $3, $4, $5, $6)`,
        [args.organizationId, args.jobId ?? null, args.kbVersionId, results.length, topScore, args.threshold],
      );
    } catch {
      // Silencioso de propósito: o `catch` externo transformaria isto em
      // `knowledge_unavailable` e o modelo diria ao cliente que a base caiu —
      // por causa de uma linha de telemetria.
    }

    return { ok: true, results };
  } catch {
    return {
      ok: false,
      error: {
        code: 'knowledge_unavailable',
        message: 'a base de conhecimento está indisponível agora — responda com o que você já sabe e não invente fatos.',
      },
    };
  }
}
```

> **Cuidado com o `catch` interno:** ele precisa envolver **só** o insert. Se a falha da telemetria escapar para o `catch` externo, o modelo recebe `knowledge_unavailable` e responde ao cliente que a base está fora do ar — por causa de uma linha de telemetria que ninguém sente falta. O quarto teste do Step 1 é exatamente esse guarda.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/agent-engine/agent/search-knowledge.test.ts`
Expected: PASS (todos, incluindo os testes pré-existentes do arquivo).

- [ ] **Step 5: Rodar a suíte do engine**

Run: `npx vitest run lib/agent-engine`
Expected: PASS — nenhum teste pré-existente do engine muda de cor.

- [ ] **Step 6: Commit**

```bash
git add lib/agent-engine/agent/search-knowledge.ts lib/agent-engine/agent/search-knowledge.test.ts
git commit -m "feat(harness-f4): searchKnowledge registra hits/top_score/threshold"
```

---

### Task 3: Ligar a ponte do funil (o stub vira a implementação real)

**Por que existe:** `lib/agent-engine/edge/crm/move-lead-stage.ts::mirrorLeadStageToCrm` é chamado no turno **exatamente** onde o agente avança de estágio (`inbound-turn.ts:1199`), mas o corpo é um stub que devolve `not_configured` sempre — nenhum card se move. A implementação que funciona existe e foi provada por sonda contra o banco real: `lib/leads/agent-stage-sync.ts::sincronizaEstagioDoAgente`, que traduz o passo do agente para o estágio do tenant via `crm_stages.agent_stage_hint` (migration 0084). Os dois foram construídos por épicos diferentes. Esta tarefa os apresenta.

**Isto NÃO cria um segundo resolvedor.** O próprio `agent-stage-sync.ts` avisa no cabeçalho que um segundo resolvedor de "qual negócio deste contato" seria "a doença desta entrega criada de propósito". Aqui o stub **delega** — continua existindo uma implementação só.

**Files:**
- Modify: `lib/agent-engine/edge/crm/move-lead-stage.ts`
- Test: `lib/agent-engine/edge/crm/move-lead-stage.test.ts` (criar se não existir)

**Interfaces:**
- Consumes: `sincronizaEstagioDoAgente(admin: SupabaseClient, input: { organizationId: string; contactId: string; passo: string }): Promise<ResultadoDaSincronizacao>` de `@/lib/leads/agent-stage-sync`, onde `ResultadoDaSincronizacao = { moveu: boolean; motivo: "movido" | "sem_mapeamento" | "ja_esta_la" | "sem_negocio" | "ambiguo"; leadId?: string; stageName?: string }`.
- Produces: `mirrorLeadStageToCrm` mantém **exatamente** a assinatura e o tipo `MirrorResult` de hoje — nenhum call site muda.

**Mapeamento de resultados (decidido, não deduza):**

| `motivo` | `MirrorResult` | Por quê |
|---|---|---|
| `movido` | `{ ok: true }` | o card andou |
| `ja_esta_la` | `{ ok: true }` | nada a fazer não é falha |
| `sem_mapeamento` | `{ ok: false, reason: 'not_configured', detail: … }` | o tenant não declarou destino — é configuração, não incidente |
| `sem_negocio` | `{ ok: false, reason: 'not_configured', detail: … }` | contato sem negócio aberto é estado legítimo |
| `ambiguo` | `{ ok: false, reason: 'not_configured', detail: … }` | dois negócios abertos: mover o errado é pior que não mover |

Todos os não-movimentos caem em `not_configured` **de propósito**: o chamador já trata esse valor como warn-only, sem criar item de inbox. Qualquer outro `reason` faria o turno abrir um alerta de inconsistência para um estado que é normal — ruído que treinaria o usuário a ignorar o inbox.

- [ ] **Step 1: Escrever o teste que falha**

Crie `lib/agent-engine/edge/crm/move-lead-stage.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { mirrorLeadStageToCrm } from './move-lead-stage';

const cfg = { supabase: {} as never };
const db = {} as never;

describe('mirrorLeadStageToCrm', () => {
  it('move o card quando o pipeline declara destino para o passo', async () => {
    const sync = vi.fn().mockResolvedValue({
      moveu: true, motivo: 'movido', leadId: 'lead-1', stageName: 'Negociação',
    });

    const r = await mirrorLeadStageToCrm(
      db, cfg as never,
      { tenantId: 'org-1', leadId: 'contato-1', toStage: 'negotiating' },
      { sync },
    );

    expect(r).toEqual({ ok: true });
    // O `leadId` do engine É o contact_id do CRM — trocar isso move o card errado.
    expect(sync).toHaveBeenCalledWith(cfg.supabase, {
      organizationId: 'org-1', contactId: 'contato-1', passo: 'negotiating',
    });
  });

  it('estágio já ocupado é sucesso, não falha', async () => {
    const sync = vi.fn().mockResolvedValue({ moveu: false, motivo: 'ja_esta_la' });
    const r = await mirrorLeadStageToCrm(
      db, cfg as never, { tenantId: 'o', leadId: 'c', toStage: 'won' }, { sync },
    );
    expect(r).toEqual({ ok: true });
  });

  it.each(['sem_mapeamento', 'sem_negocio', 'ambiguo'])(
    'motivo %s vira not_configured (warn-only, sem item de inbox)',
    async (motivo) => {
      const sync = vi.fn().mockResolvedValue({ moveu: false, motivo });
      const r = await mirrorLeadStageToCrm(
        db, cfg as never, { tenantId: 'o', leadId: 'c', toStage: 'qualified' }, { sync },
      );
      expect(r.ok).toBe(false);
      expect(r).toMatchObject({ reason: 'not_configured' });
    },
  );

  it('erro da sincronização vira crm_error e NUNCA lança', async () => {
    const sync = vi.fn().mockRejectedValue(new Error('supabase fora'));
    const r = await mirrorLeadStageToCrm(
      db, cfg as never, { tenantId: 'o', leadId: 'c', toStage: 'won' }, { sync },
    );
    expect(r).toMatchObject({ ok: false, reason: 'crm_error' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/agent-engine/edge/crm/move-lead-stage.test.ts`
Expected: FAIL — o stub devolve `not_configured` no primeiro teste, que espera `{ ok: true }`.

- [ ] **Step 3: Implementar**

Substitua o corpo de `lib/agent-engine/edge/crm/move-lead-stage.ts` (preserve o cabeçalho de documentação do arquivo, atualizando-o para dizer que o espelho **está ligado**):

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

import { sincronizaEstagioDoAgente } from '@/lib/leads/agent-stage-sync';
import type { Queryable } from '../../queue/queue';
import type { CrmEdgeConfig } from './mcp-client';
import type { LeadStage } from '../../agent/lead-state';

export type MirrorResult =
  | { ok: true }
  | { ok: false; reason: 'not_configured' | 'crm_error' | 'crm_unavailable'; detail: string };

/** Injetável só para teste — em produção é sempre a implementação real. */
interface Deps {
  sync?: typeof sincronizaEstagioDoAgente;
}

export async function mirrorLeadStageToCrm(
  _db: Queryable,
  cfg: CrmEdgeConfig,
  input: { tenantId: string; leadId: string; toStage: LeadStage; reason?: string },
  deps: Deps = {},
): Promise<MirrorResult> {
  const sync = deps.sync ?? sincronizaEstagioDoAgente;
  try {
    // `input.leadId` é o contact_id do CRM: o funil do agente é por CONTATO
    // (lead_state.contact_id) e quem resolve "qual negócio deste contato" é o
    // `resolveActiveLeadForContact` lá dentro — não aqui.
    const r = await sync(cfg.supabase as SupabaseClient, {
      organizationId: input.tenantId,
      contactId: input.leadId,
      passo: input.toStage,
    });

    if (r.moveu || r.motivo === 'ja_esta_la') return { ok: true };

    // Os três não-movimentos são estados LEGÍTIMOS do produto, e por isso todos
    // caem em `not_configured`: o chamador trata esse valor como warn-only, sem
    // abrir item de inbox. Marcá-los como erro treinaria o usuário a ignorar o
    // inbox — o preço de um alerta que quase sempre não é incidente.
    const detalhe: Record<string, string> = {
      sem_mapeamento: `nenhum estágio do pipeline declara agent_stage_hint = "${input.toStage}"`,
      sem_negocio: 'o contato não tem negócio aberto para mover',
      ambiguo: 'o contato tem mais de um negócio aberto — nenhum foi movido',
    };
    return { ok: false, reason: 'not_configured', detail: detalhe[r.motivo] ?? r.motivo };
  } catch (err) {
    return {
      ok: false,
      reason: 'crm_error',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/agent-engine/edge/crm/move-lead-stage.test.ts`
Expected: PASS — 6 testes.

- [ ] **Step 5: Rodar a suíte do engine e o typecheck**

Run: `npx vitest run lib/agent-engine && npm run typecheck`
Expected: PASS e 0 erros de tipo.

> Verifique especificamente que nenhum teste que dependia do stub sempre devolver `not_configured` mudou de cor. Se algum tinha essa expectativa embutida, ele estava fixando o **defeito**, não o contrato — corrija-o para o comportamento novo e diga isso no relatório.

- [ ] **Step 6: Prova real contra o banco (a sonda que já existe)**

O repo já tem a sonda que prova este caminho ponta-a-ponta em dois nichos:

```bash
npx tsx tests/sonda-agente-move-card.ts
```

Expected: a saída mostra o card andando no funil do tenant nos dois nichos (nomes de estágio diferentes, mesmo passo do agente).

- [ ] **Step 7: Commit**

```bash
git add lib/agent-engine/edge/crm/move-lead-stage.ts lib/agent-engine/edge/crm/move-lead-stage.test.ts
git commit -m "feat(harness-f4): o espelho de funil deixa de ser stub e move o card do tenant"
```

---

### Task 4: Agregador puro `lib/ai/evolution/aggregate.ts`

**Por que existe:** a rota fica burra e testável — todo o raciocínio do painel mora numa função sem efeito colateral, no mesmo molde de `lib/ai/usage/aggregate.ts`.

**Files:**
- Create: `lib/ai/evolution/aggregate.ts`
- Test: `lib/ai/evolution/aggregate.test.ts`

**Interfaces:**
- Consumes: `toUtcDay(d: Date): string` e `daysBetween(from: Date, to: Date): string[]` de `@/lib/ai/usage/aggregate` (já exportadas — **não reimplemente**); `LEAD_STAGES` de `@/lib/agent-engine/agent/lead-state` (tupla `['new','contacted','qualifying','qualified','negotiating','won','lost']`).
- Produces: `aggregateEvolution(input: EvolutionInput): EvolutionPayload` — consumida pela Task 5 e pela Task 6.

- [ ] **Step 1: Escrever o teste que falha**

Crie `lib/ai/evolution/aggregate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { aggregateEvolution, type EvolutionInput } from './aggregate';

const range = { from: new Date('2026-07-01T00:00:00Z'), to: new Date('2026-07-03T00:00:00Z') };

function base(): EvolutionInput {
  return {
    range,
    memoryEntries: [],
    proposalsApplied: [],
    skillInstalls: [],
    skillActivations: [],
    routerDecisions: [],
    knowledgeSearches: [],
    stageTransitions: [],
    costCents: 0,
    inboundCount: 0,
    handoffCount: 0,
    pipelines: [],
  };
}

describe('aggregateEvolution', () => {
  it('monta a linha do tempo de aprendizado ordenada do mais recente para o mais antigo', () => {
    const p = aggregateEvolution({
      ...base(),
      memoryEntries: [{ created_at: '2026-07-01T10:00:00Z', title: 'Nunca prometer prazo' }],
      proposalsApplied: [{ applied_at: '2026-07-03T09:00:00Z', type: 'playbook_bullet', content: 'Confirmar por escrito' }],
      skillInstalls: [{ updated_at: '2026-07-02T08:00:00Z', name: 'objecao-preco' }],
    });

    expect(p.learned.memory_entries).toBe(1);
    expect(p.learned.proposals_applied).toBe(1);
    expect(p.learned.skills_installed).toBe(1);
    expect(p.learned.timeline.map((t) => t.kind)).toEqual(['proposal', 'skill', 'memory']);
    expect(p.learned.timeline[0]!.day).toBe('2026-07-03');
  });

  it('série diária cobre TODOS os dias do intervalo, inclusive os vazios', () => {
    const p = aggregateEvolution({
      ...base(),
      skillActivations: [{ created_at: '2026-07-02T12:00:00Z', skill_name: 'agendamento' }],
    });

    // Dia sem atividade tem que valer 0, não sumir: buraco no gráfico vira
    // "acabou o dado", zero vira "não aconteceu".
    expect(p.activity.series.skill_activations).toEqual([
      { day: '2026-07-01', value: 0 },
      { day: '2026-07-02', value: 1 },
      { day: '2026-07-03', value: 0 },
    ]);
    expect(p.activity.by_skill).toEqual({ agendamento: 1 });
  });

  it('conta como "quase acertou" só a busca sem hit cujo melhor candidato ficou ABAIXO do limiar', () => {
    const p = aggregateEvolution({
      ...base(),
      knowledgeSearches: [
        { created_at: '2026-07-01T10:00:00Z', hits: 0, top_score: 0.703, threshold: 0.72 }, // quase
        { created_at: '2026-07-01T11:00:00Z', hits: 0, top_score: 0.12, threshold: 0.72 },  // a base não tem
        { created_at: '2026-07-01T12:00:00Z', hits: 3, top_score: 0.91, threshold: 0.72 },  // achou
        { created_at: '2026-07-01T13:00:00Z', hits: 0, top_score: null, threshold: 0.72 },  // base vazia
      ],
    });

    expect(p.gaps.knowledge_near_misses).toBe(1);
    expect(p.gaps.knowledge_empty).toBe(3);
  });

  it('conta certo mesmo quando o driver entrega numeric como STRING', () => {
    // Este teste não é paranoia: a prova real da Task 2 mediu `top_score` voltando
    // como '0.910667' — `numeric` não tem parser default no node-postgres. Sem
    // coerção, a comparação vira string×string, não lança, e acerta metade dos
    // casos por acidente. Os tipos declarados são `number`, então o TypeScript
    // não protege: é o defeito que passa no verde.
    const p = aggregateEvolution({
      ...base(),
      knowledgeSearches: [
        // '0.703' está a 0.017 do limiar => quase acertou.
        { created_at: '2026-07-01T10:00:00Z', hits: 0, top_score: '0.703' as never, threshold: '0.72' as never },
        // '0.12' está longe => a base não tem.
        { created_at: '2026-07-01T11:00:00Z', hits: 0, top_score: '0.12' as never, threshold: '0.72' as never },
      ],
    });

    expect(p.gaps.knowledge_near_misses).toBe(1);
    expect(p.gaps.knowledge_empty).toBe(2);
  });

  it('aponta os passos do agente que nenhum estágio do pipeline recebe', () => {
    const p = aggregateEvolution({
      ...base(),
      pipelines: [
        { name: 'Vendas', hints: ['new', 'contacted', 'won', 'lost'] },
        { name: 'Pós-venda', hints: ['new', 'contacted', 'qualifying', 'qualified', 'negotiating', 'won', 'lost'] },
      ],
    });

    // Vendas não recebe qualifying/qualified/negotiating — o agente vai querer
    // avançar e o card vai ficar parado sem ninguém saber por quê.
    expect(p.gaps.unmapped_agent_steps).toEqual([
      { pipeline_name: 'Vendas', steps: ['qualifying', 'qualified', 'negotiating'] },
    ]);
  });

  it('taxa de handoff é sobre conversas recebidas, e 0 recebidas não vira divisão por zero', () => {
    const cheio = aggregateEvolution({ ...base(), inboundCount: 200, handoffCount: 20 });
    expect(cheio.outcome.handoff_rate).toBeCloseTo(0.1);

    const vazio = aggregateEvolution({ ...base(), inboundCount: 0, handoffCount: 0 });
    expect(vazio.outcome.handoff_rate).toBe(0);
  });

  it('conta ganhos e perdas pelas transições terminais do funil do agente', () => {
    const p = aggregateEvolution({
      ...base(),
      stageTransitions: [
        { created_at: '2026-07-01T10:00:00Z', to_stage: 'won' },
        { created_at: '2026-07-02T10:00:00Z', to_stage: 'won' },
        { created_at: '2026-07-02T11:00:00Z', to_stage: 'lost' },
        { created_at: '2026-07-02T12:00:00Z', to_stage: 'qualifying' },
      ],
    });

    expect(p.outcome.won).toBe(2);
    expect(p.outcome.lost).toBe(1);
    expect(p.outcome.stage_transitions).toBe(4);
  });

  it('roteamento sem match entra nas lacunas, não na atividade normal', () => {
    const p = aggregateEvolution({
      ...base(),
      routerDecisions: [
        { created_at: '2026-07-01T10:00:00Z', outcome: 'classified', intent_name: 'agendamento' },
        { created_at: '2026-07-01T11:00:00Z', outcome: 'no_match', intent_name: null },
        { created_at: '2026-07-01T12:00:00Z', outcome: 'classifier_failed', intent_name: null },
      ],
    });

    expect(p.activity.by_intent).toEqual({ agendamento: 1 });
    expect(p.gaps.router_no_match).toBe(1);
    expect(p.gaps.router_failed).toBe(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/ai/evolution/aggregate.test.ts`
Expected: FAIL — "Cannot find module './aggregate'".

- [ ] **Step 3: Implementar o agregador**

Crie `lib/ai/evolution/aggregate.ts`:

```ts
/**
 * Agregador puro do Painel de Evolução (Fase 4 do épico do Harness).
 *
 * Recebe linhas cruas das seis fontes que as fases 0-3 depositaram e devolve o
 * payload que a tela consome. Sem efeito colateral, sem acesso a banco — a
 * rota busca, isto raciocina, e o teste não precisa de Postgres.
 *
 * A doutrina do sistema vivo pede que TODO número leve a uma ação. Por isso o
 * payload separa `activity` (o que aconteceu) de `gaps` (o que está travando):
 * o segundo bloco é o que o dono do negócio pode ir consertar hoje.
 */
import { daysBetween, toUtcDay } from '@/lib/ai/usage/aggregate';
import { LEAD_STAGES } from '@/lib/agent-engine/agent/lead-state';

export interface EvolutionInput {
  range: { from: Date; to: Date };
  memoryEntries: Array<{ created_at: string; title: string }>;
  proposalsApplied: Array<{ applied_at: string; type: string; content: string }>;
  /**
   * `skill_pointers` NÃO tem `created_at` — só `updated_at`, e ele é exatamente o
   * momento em que o ponteiro se moveu, isto é, quando a skill foi instalada ou
   * atualizada. É o que a spec chama de "skills instaladas/atualizadas".
   */
  skillInstalls: Array<{ updated_at: string; name: string }>;
  skillActivations: Array<{ created_at: string; skill_name: string }>;
  routerDecisions: Array<{ created_at: string; outcome: string; intent_name: string | null }>;
  knowledgeSearches: Array<{
    created_at: string;
    hits: number;
    top_score: number | null;
    threshold: number;
  }>;
  stageTransitions: Array<{ created_at: string; to_stage: string }>;
  costCents: number;
  inboundCount: number;
  handoffCount: number;
  pipelines: Array<{ name: string; hints: Array<string | null> }>;
}

export interface TimelineItem {
  day: string;
  kind: 'memory' | 'proposal' | 'skill';
  title: string;
}

export interface EvolutionPayload {
  range: { from: string; to: string };
  learned: {
    memory_entries: number;
    proposals_applied: number;
    skills_installed: number;
    timeline: TimelineItem[];
  };
  activity: {
    series: {
      skill_activations: Array<{ day: string; value: number }>;
      router_decisions: Array<{ day: string; value: number }>;
      knowledge_searches: Array<{ day: string; value: number }>;
    };
    by_skill: Record<string, number>;
    by_intent: Record<string, number>;
  };
  outcome: {
    stage_transitions: number;
    won: number;
    lost: number;
    handoff_rate: number;
    cost_cents: number;
  };
  gaps: {
    unmapped_agent_steps: Array<{ pipeline_name: string; steps: string[] }>;
    knowledge_near_misses: number;
    knowledge_empty: number;
    router_no_match: number;
    router_failed: number;
  };
}

/** Série diária densa: dia sem evento vale 0, nunca some do eixo. */
function serie(days: string[], rows: Array<{ created_at: string }>): Array<{ day: string; value: number }> {
  const contagem = new Map<string, number>();
  for (const r of rows) {
    const d = r.created_at.slice(0, 10);
    contagem.set(d, (contagem.get(d) ?? 0) + 1);
  }
  return days.map((day) => ({ day, value: contagem.get(day) ?? 0 }));
}

function contaPor<T>(rows: T[], chave: (r: T) => string | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = chave(r);
    if (k === null) continue;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export function aggregateEvolution(input: EvolutionInput): EvolutionPayload {
  const days = daysBetween(input.range.from, input.range.to);

  const timeline: TimelineItem[] = [
    ...input.memoryEntries.map((m) => ({
      day: m.created_at.slice(0, 10),
      kind: 'memory' as const,
      title: m.title,
    })),
    ...input.proposalsApplied.map((p) => ({
      day: p.applied_at.slice(0, 10),
      kind: 'proposal' as const,
      title: p.content.slice(0, 120),
    })),
    ...input.skillInstalls.map((s) => ({
      day: s.updated_at.slice(0, 10),
      kind: 'skill' as const,
      title: s.name,
    })),
  ].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));

  // "Quase acertou" é a busca que NÃO trouxe nada e cujo melhor candidato ficou
  // logo abaixo do limiar. É o sinal que separa "a base não tem isso" de "a base
  // tem e o corte está apertado demais" — dois problemas com consertos opostos.
  const PERTO = 0.1;
  let nearMisses = 0;
  let empty = 0;
  for (const k of input.knowledgeSearches) {
    if (k.hits > 0) continue;
    empty += 1;
    // ⚠️ COERÇÃO OBRIGATÓRIA. `top_score` e `threshold` são `numeric` no Postgres,
    // e `numeric` não tem parser default no node-postgres — chega como STRING
    // ('0.910667'). A comparação string×string não lança e não erra sempre:
    // `'0.144' >= '0.62'` dá false pelo motivo errado, e `'0.9' >= '0.72'` dá
    // true também pelo motivo errado. O tipo declarado aqui é `number`, então o
    // TypeScript não pega — é o pior formato de defeito, o que acerta por acaso.
    // Medido na prova real da Task 2, contra o banco.
    const nota = k.top_score === null ? null : Number(k.top_score);
    const limiar = Number(k.threshold);
    if (nota !== null && Number.isFinite(nota) && nota >= limiar - PERTO) nearMisses += 1;
  }

  const unmapped = input.pipelines
    .map((p) => {
      const declarados = new Set(p.hints.filter((h): h is string => h !== null));
      return {
        pipeline_name: p.name,
        steps: LEAD_STAGES.filter((s) => !declarados.has(s)),
      };
    })
    .filter((p) => p.steps.length > 0)
    .map((p) => ({ pipeline_name: p.pipeline_name, steps: [...p.steps] }));

  return {
    range: { from: toUtcDay(input.range.from), to: toUtcDay(input.range.to) },
    learned: {
      memory_entries: input.memoryEntries.length,
      proposals_applied: input.proposalsApplied.length,
      skills_installed: input.skillInstalls.length,
      timeline,
    },
    activity: {
      series: {
        skill_activations: serie(days, input.skillActivations),
        router_decisions: serie(days, input.routerDecisions),
        knowledge_searches: serie(days, input.knowledgeSearches),
      },
      by_skill: contaPor(input.skillActivations, (r) => r.skill_name),
      by_intent: contaPor(
        input.routerDecisions.filter((r) => r.outcome === 'classified' || r.outcome === 'sticky' || r.outcome === 'reclassified'),
        (r) => r.intent_name,
      ),
    },
    outcome: {
      stage_transitions: input.stageTransitions.length,
      won: input.stageTransitions.filter((t) => t.to_stage === 'won').length,
      lost: input.stageTransitions.filter((t) => t.to_stage === 'lost').length,
      handoff_rate: input.inboundCount > 0 ? input.handoffCount / input.inboundCount : 0,
      cost_cents: input.costCents,
    },
    gaps: {
      unmapped_agent_steps: unmapped,
      knowledge_near_misses: nearMisses,
      knowledge_empty: empty,
      router_no_match: input.routerDecisions.filter((r) => r.outcome === 'no_match').length,
      router_failed: input.routerDecisions.filter((r) => r.outcome === 'classifier_failed').length,
    },
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/ai/evolution/aggregate.test.ts`
Expected: PASS — 7 testes.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/evolution/aggregate.ts lib/ai/evolution/aggregate.test.ts
git commit -m "feat(harness-f4): agregador puro do painel de evolucao"
```

---

### Task 5: API `GET /api/v1/ai/evolution`

**Files:**
- Create: `app/api/v1/ai/evolution/route.ts`
- Test: `app/api/v1/ai/evolution/route.test.ts`

**Interfaces:**
- Consumes: `aggregateEvolution(input: EvolutionInput): EvolutionPayload` (Task 4); `ok`/`fail` de `@/lib/api/wrappers`; `requireRole` de `@/lib/auth/require-role`; `createClient` de `@/lib/supabase/server`.
- Produces: `GET /api/v1/ai/evolution?from=YYYY-MM-DD&to=YYYY-MM-DD` → `{ data: EvolutionPayload }`, consumida pela Task 6.

- [ ] **Step 1: Escrever o teste que falha**

Crie `app/api/v1/ai/evolution/route.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const requireRole = vi.fn();
vi.mock('@/lib/auth/require-role', () => ({ requireRole: (...a: unknown[]) => requireRole(...a) }));

const from = vi.fn();
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from }) }));

import { GET } from './route';
import { NextRequest } from 'next/server';

function req(qs = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v1/ai/evolution${qs}`);
}

/** Encadeamento do query builder do Supabase: tudo devolve `this`, o await resolve. */
function tabela(rows: unknown[]) {
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'not', 'gte', 'lte', 'order', 'limit', 'in']) {
    b[m] = () => b;
  }
  b.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
  return b;
}

beforeEach(() => {
  requireRole.mockReset();
  from.mockReset();
  requireRole.mockResolvedValue({ ok: true, org: { orgId: 'org-1' } });
  from.mockImplementation(() => tabela([]));
});

describe('GET /api/v1/ai/evolution', () => {
  it('recusa quem não é manager', async () => {
    requireRole.mockResolvedValue({ ok: false, response: new Response('nao', { status: 403 }) });
    const r = await GET(req());
    expect(r.status).toBe(403);
  });

  it('recusa intervalo malformado com 422', async () => {
    const r = await GET(req('?from=ontem'));
    expect(r.status).toBe(422);
  });

  it('devolve o payload agregado sem double-nest', async () => {
    const r = await GET(req('?from=2026-07-01&to=2026-07-03'));
    expect(r.status).toBe(200);
    const body = await r.json();
    // `ok()` já envelopa em { data } — um `data.data` aqui é o bug de double-nest.
    expect(body.data.range).toEqual({ from: '2026-07-01', to: '2026-07-03' });
    expect(body.data.data).toBeUndefined();
    expect(body.data.gaps).toBeDefined();
  });

  it('toda consulta filtra a organização do JWT', async () => {
    const eqs: Array<[string, unknown]> = [];
    from.mockImplementation(() => {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'not', 'gte', 'lte', 'order', 'limit', 'in']) b[m] = () => b;
      b.eq = (col: string, val: unknown) => { eqs.push([col, val]); return b; };
      b.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
      return b;
    });

    await GET(req('?from=2026-07-01&to=2026-07-03'));
    const orgFilters = eqs.filter(([c]) => c === 'organization_id');
    expect(orgFilters.length).toBeGreaterThan(0);
    expect(orgFilters.every(([, v]) => v === 'org-1')).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run app/api/v1/ai/evolution/route.test.ts`
Expected: FAIL — "Cannot find module './route'".

- [ ] **Step 3: Implementar a rota**

Crie `app/api/v1/ai/evolution/route.ts`:

```ts
/**
 * GET /api/v1/ai/evolution — o Painel de Evolução da IA (Fase 4 do Harness).
 *
 * Lê o que as fases 0-3 depositaram — memória da org, propostas aplicadas do
 * flywheel, skills instaladas e ativadas, decisões de roteamento, buscas de
 * conhecimento, transições do funil e custo — e devolve tudo agregado.
 *
 * Auth: sessão por cookie, papel manager+. `organization_id` sai do JWT.
 * Usamos o client com escopo de usuário para a RLS valer; o filtro explícito de
 * `organization_id` é defesa em profundidade exigida pela convenção do repo.
 *
 * A agregação mora em `lib/ai/evolution/aggregate.ts` (puro e testável) — aqui
 * só há busca de dados.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { aggregateEvolution, type EvolutionInput } from "@/lib/ai/evolution/aggregate";

export const dynamic = "force-dynamic";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 90;
const ROW_CAP = 50_000;

const querySchema = z.object({
  from: z.string().regex(DAY_RE).optional(),
  to: z.string().regex(DAY_RE).optional(),
});

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function endOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}
function parseDayUtc(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

function resolveRange(qs: { from?: string; to?: string }): { from: Date; to: Date } {
  const now = new Date();
  const to = qs.to ? parseDayUtc(qs.to) : startOfUtcDay(now);
  let from = qs.from ? parseDayUtc(qs.from) : startOfUtcDay(new Date(now.getTime() - 29 * 86_400_000));
  const diffDays = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  if (diffDays > MAX_RANGE_DAYS - 1) from = new Date(to.getTime() - (MAX_RANGE_DAYS - 1) * 86_400_000);
  if (from.getTime() > to.getTime()) from = to;
  return { from: startOfUtcDay(from), to: startOfUtcDay(to) };
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("manager", { requestId, resource: "ai_evolution" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  if (!parsed.success) {
    return fail("validation_failed", "Filtros inválidos.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const range = resolveRange(parsed.data);
  const fromIso = range.from.toISOString();
  const toIso = endOfUtcDay(range.to).toISOString();
  const supabase = await createClient();

  /** Toda leitura passa por aqui: mesmo filtro de org, mesmo teto, falha vira lista vazia. */
  async function ler<T>(
    tabela: string,
    colunas: string,
    coluna_data: string,
    extra?: (q: never) => never,
  ): Promise<T[]> {
    let q = supabase
      .from(tabela)
      .select(colunas)
      .eq("organization_id", orgId)
      .gte(coluna_data, fromIso)
      .lte(coluna_data, toIso)
      .limit(ROW_CAP) as never;
    if (extra) q = extra(q);
    const { data, error } = (await q) as { data: T[] | null; error: { message: string } | null };
    if (error) {
      // Uma fonte fora do ar não pode apagar o painel inteiro: o bloco dela
      // aparece zerado e os outros continuam contando a história.
      console.warn(`[ai-evolution] leitura de ${tabela} falhou`, { error: error.message });
      return [];
    }
    return data ?? [];
  }

  const [
    memoryEntries,
    proposalsApplied,
    skillActivations,
    routerDecisions,
    knowledgeSearches,
    stageTransitions,
    llmCalls,
  ] = await Promise.all([
    ler<{ created_at: string; title: string }>("org_memory_entries", "created_at, title", "created_at"),
    ler<{ applied_at: string; type: string; content: string }>(
      "flywheel_distiller_proposals",
      "applied_at, type, content",
      "applied_at",
    ),
    ler<{ created_at: string; skill_name: string }>("skill_activations", "created_at, skill_name", "created_at"),
    ler<{ created_at: string; outcome: string; intent_name: string | null }>(
      "ai_router_decisions",
      "created_at, outcome, intent_name",
      "created_at",
    ),
    ler<{ created_at: string; hits: number; top_score: number | null; threshold: number }>(
      "knowledge_searches",
      "created_at, hits, top_score, threshold",
      "created_at",
    ),
    ler<{ created_at: string; to_stage: string }>(
      "lead_state_transitions",
      "created_at, to_stage",
      "created_at",
    ),
    ler<{ cost_cents: number | null }>("llm_calls", "cost_cents", "created_at"),
  ]);

  // Skills instaladas no período: os ponteiros da PRÓPRIA org (catálogo de
  // plataforma tem organization_id nulo e não conta como instalação do tenant).
  // A tabela não tem `created_at` — `updated_at` É o momento em que o ponteiro
  // se moveu, ou seja, a instalação/atualização.
  const skillInstalls = await ler<{ updated_at: string; name: string }>(
    "skill_pointers",
    "updated_at, name",
    "updated_at",
  );

  // Conversas recebidas e handoffs — denominador e numerador da taxa de handoff.
  const inbound = await ler<{ created_at: string }>("messages", "created_at", "created_at", ((q: never) =>
    (q as unknown as { eq: (c: string, v: string) => never }).eq("direction", "inbound")) as never);
  const handoffs = await ler<{ created_at: string }>("event_log", "created_at", "created_at", ((q: never) =>
    (q as unknown as { eq: (c: string, v: string) => never }).eq("event_type", "ai.handoff_triggered")) as never);

  // Mapeamento declarado do funil: quais passos do agente cada pipeline recebe.
  const { data: stageRows } = await supabase
    .from("crm_stages")
    .select("agent_stage_hint, crm_pipelines!inner(name, organization_id)")
    .eq("organization_id", orgId)
    .eq("is_archived", false)
    .limit(ROW_CAP);

  const porPipeline = new Map<string, Array<string | null>>();
  for (const r of (stageRows ?? []) as Array<{
    agent_stage_hint: string | null;
    crm_pipelines: { name: string } | { name: string }[];
  }>) {
    const p = Array.isArray(r.crm_pipelines) ? r.crm_pipelines[0] : r.crm_pipelines;
    if (!p) continue;
    const lista = porPipeline.get(p.name) ?? [];
    lista.push(r.agent_stage_hint);
    porPipeline.set(p.name, lista);
  }

  const input: EvolutionInput = {
    range,
    memoryEntries,
    // A coluna `applied_at` é nula enquanto a proposta não é aplicada; o filtro
    // de data já derruba as nulas, mas o guard deixa a intenção explícita.
    proposalsApplied: proposalsApplied.filter((p) => p.applied_at !== null),
    skillInstalls,
    skillActivations,
    routerDecisions,
    knowledgeSearches,
    stageTransitions,
    costCents: llmCalls.reduce((acc, c) => acc + (c.cost_cents ?? 0), 0),
    inboundCount: inbound.length,
    handoffCount: handoffs.length,
    pipelines: [...porPipeline.entries()].map(([name, hints]) => ({ name, hints })),
  };

  return ok(aggregateEvolution(input), { requestId });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run app/api/v1/ai/evolution/route.test.ts`
Expected: PASS — 4 testes.

- [ ] **Step 5: Provar contra o banco real**

Com o dev server de pé (`lsof -tiTCP:3000`; se não houver, `npm run dev` em background e esperar `/api/v1/health` responder), logue como manager e chame a rota pelo navegador autenticado (a rota exige cookie de sessão — `curl` sem cookie devolve 403, o que também é uma prova válida da autorização).

Expected: 200 com `data.range`, `data.learned`, `data.activity`, `data.outcome` e `data.gaps` presentes.

- [ ] **Step 6: Commit**

```bash
git add app/api/v1/ai/evolution/route.ts app/api/v1/ai/evolution/route.test.ts
git commit -m "feat(harness-f4): API do painel de evolucao"
```

---

### Task 6: A tela `app/app/ai/evolution`

**Por que existe:** é o critério de aceite da fase — "um tenant consegue responder na tela, sem ajuda, *o que meu agente aprendeu este mês e o que melhorou?*". Se o dono do negócio precisar de alguém para interpretar a tela, a tarefa não está pronta.

**Files:**
- Create: `hooks/ai/useEvolution.ts`
- Create: `app/app/ai/evolution/page.tsx`
- Create: `app/app/ai/evolution/_client.tsx`
- Create: `components/ai/EvolutionTimeline.tsx`
- Create: `components/ai/EvolutionGaps.tsx`
- Modify: `components/shell/Sidebar.tsx` (item de navegação)
- Modify: o provider de permissões (`ai.evolution.view`, papel manager) — o mesmo arquivo onde `ai.routers.view` foi declarado na Fase 3
- Modify: `lib/ui/icons.ts` (ícone novo, se necessário — **confira antes se já existe**, a Fase 3 duplicou um ícone assim)

**Interfaces:**
- Consumes: `GET /api/v1/ai/evolution` → `{ data: EvolutionPayload }` (Task 5); tipo `EvolutionPayload` importado de `@/lib/ai/evolution/aggregate`.
- Produces: rota `/app/ai/evolution`.

- [ ] **Step 1: Criar o hook**

Crie `hooks/ai/useEvolution.ts` (molde: `hooks/ai/useSkills.ts` — react-query + `apiClient`):

```ts
"use client";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { EvolutionPayload } from "@/lib/ai/evolution/aggregate";

export interface EvolutionRange {
  from: string;
  to: string;
}

/**
 * O intervalo entra na CHAVE de cache, não só na URL: sem isso, trocar as datas
 * devolveria o payload do intervalo anterior enquanto o novo carrega, e o
 * usuário leria números velhos com rótulo novo.
 */
export function useEvolution(range?: EvolutionRange) {
  const qs = range ? `?from=${range.from}&to=${range.to}` : "";
  return useQuery({
    queryKey: ["evolution", range?.from ?? null, range?.to ?? null],
    queryFn: () =>
      apiClient
        .get<{ data: EvolutionPayload }>(`/api/v1/ai/evolution${qs}`)
        .then((r) => r.data),
  });
}
```

O retorno de `useQuery` já expõe `data`, `isLoading` e `error` — a tela consome esses três.

- [ ] **Step 2: Construir a tela**

`app/app/ai/evolution/page.tsx` é o server component fino (molde: `app/app/ai/skills/page.tsx`), e `_client.tsx` tem o conteúdo. A tela tem **quatro blocos, nesta ordem**:

1. **"O que seu agente aprendeu"** — três números grandes (regras de memória, melhorias aplicadas, skills instaladas) + a linha do tempo (`EvolutionTimeline`).
2. **"O que ele fez"** — três gráficos de linha (recharts `^3.9.2`, molde de `components/ai/UsageChart.tsx`): skills usadas, decisões de roteamento, buscas na base. Mais duas listas: por skill e por intenção.
3. **"O que mudou no resultado"** — negócios ganhos, perdidos, avanços de funil, taxa de handoff, custo do período.
4. **"O que está travando"** (`EvolutionGaps`) — o bloco acionável.

**Regras de escrita da tela (não-negociáveis):**
- Todo rótulo em português de dono de negócio, **zero jargão**: nunca "outcome", "sticky", "threshold", "no_match", "top_score". Escreva "o agente não soube para quem mandar", "perguntas que a base não respondeu".
- Todo número tem uma frase de uma linha dizendo **o que ele significa** — número sozinho não é informação para quem não construiu o sistema.
- Estado vazio é obrigatório em cada bloco, e ele **ensina**: "Seu agente ainda não aprendeu nada neste período. Ele aprende quando você publica uma regra na Memória da Organização, aceita uma sugestão de melhoria ou instala uma skill." — com link para a tela correspondente.

`components/ai/EvolutionGaps.tsx` transforma cada lacuna numa frase com conserto:

```tsx
// Cada lacuna vira UMA frase que diz o problema e o conserto — número sem ação
// é o "dado que não muda decisão" que a doutrina do sistema vivo proíbe.
const CONSERTOS = {
  unmapped: (pipeline: string, passos: string[]) =>
    `No funil "${pipeline}", ${passos.length} etapa(s) do atendimento não têm para onde ir. ` +
    `Quando o agente chega nelas, o card fica parado. Configure em Funis → ${pipeline}.`,
  nearMiss: (n: number) =>
    `${n} pergunta(s) quase foram respondidas: a base tinha algo parecido, mas não perto o bastante. ` +
    `Vale revisar a base de conhecimento ou afrouxar o limite de semelhança do agente.`,
  empty: (n: number) =>
    `${n} pergunta(s) não encontraram nada na base. Estas são as lacunas de conteúdo.`,
  noMatch: (n: number) =>
    `${n} conversa(s) não se encaixaram em nenhuma intenção do roteador e foram para o atendimento padrão. ` +
    `Se isso repete, falta uma intenção.`,
};
```

- [ ] **Step 3: Ligar a navegação e a permissão**

Acrescente `ai.evolution.view` (papel **manager**) ao provider de permissões, ao lado de `ai.routers.view`, e o item "Evolução da IA" na `Sidebar.tsx`, no grupo onde moram Skills, Roteadores e Memória.

> Antes de acrescentar ícone em `lib/ui/icons.ts`, **procure se ele já está lá**. O merge da main revelou `DownloadSimple` duplicado exatamente por essa falta de checagem — o TypeScript acusa (`TS2300 Duplicate identifier`), mas só depois.

- [ ] **Step 4: Typecheck e lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 erros nos dois.

- [ ] **Step 5: Prova em Playwright, CLICANDO (protocolo obrigatório do épico)**

Suba o dev server (`lsof -tiTCP:3000`; se não houver, `npm run dev` em background e espere `/api/v1/health`). Logue como `e2e-admin@deskcomm.test` (senha em `.e2e-creds.json`; o MFA é TOTP — secret no scratchpad, código via `generateTotp` de `./tests/e2e/utils/totp`, seis caixas de um dígito).

Navegue até **Evolução da IA** e prove, clicando:
1. A tela carrega com os quatro blocos.
2. Cada bloco vazio mostra o texto que ENSINA o que fazer (não um "—" mudo).
3. As lacunas aparecem como frase acionável, não como número cru.
4. O intervalo de datas muda os números.

**AVALIE A EXPERIÊNCIA, e isto é gate:** um dono de clínica que nunca programou entende, sozinho, o que cada bloco diz e o que fazer com as lacunas? Ele consegue responder "o que meu agente aprendeu este mês"? Qualquer **"não"** vira correção **antes** de seguir — não anote como dívida.

- [ ] **Step 6: Commit**

```bash
git add hooks/ai/useEvolution.ts app/app/ai/evolution components/ai/EvolutionTimeline.tsx components/ai/EvolutionGaps.tsx components/shell/Sidebar.tsx lib/ui/icons.ts
git commit -m "feat(harness-f4): tela do painel de evolucao da IA"
```

---

### Task 7: Mapa vivo, prova ponta-a-ponta e fechamento

**Por que existe:** o item 13 do Definition of Done exige o Living System Checklist, e a fase só fecha com demonstração real na tela — não com testes verdes.

**Files:**
- Modify: `docs/architecture/agent-turn.workflow.json` (ou o mapa correspondente)
- Modify: `HANDOFF-harness-evolution.md`
- Modify: `docs/superpowers/specs/2026-07-23-harness-evolution-design.md` (marcar a Fase 4 como concluída)

- [ ] **Step 1: Pôr o painel no mapa vivo**

Acrescente ao mapa os nós do painel e **no mínimo duas arestas reais**: `knowledge_searches → evolution_panel` (a telemetria alimenta o painel) e `evolution_panel → orgmemory/skills/routers` (o painel manda o usuário para a tela onde ele conserta a lacuna). A segunda aresta é o que torna o painel um órgão e não uma vitrine.

Run: `npx archify validate` (ou o comando que o repo usa — confira em `docs/architecture/README.md`)
Expected: 0 erros. Re-renderize o HTML.

- [ ] **Step 2: Prova real ponta-a-ponta**

Prove os três caminhos novos com dados reais, em ordem:

1. **Busca de conhecimento** — mande uma mensagem real no WhatsApp que force o agente a consultar a base. Depois confirme a linha nova: `select hits, top_score, threshold from knowledge_searches order by created_at desc limit 1`. Prove os **dois** casos: uma pergunta que a base responde (`hits > 0`) e uma que ela não responde (`hits = 0` com `top_score` preenchido).
2. **Funil** — faça o agente avançar de estágio numa conversa real e confirme que o card **andou** no board do tenant. Depois prove a contra-prova: um pipeline sem `agent_stage_hint` para aquele passo mantém o card parado e o painel passa a listar a lacuna.
3. **Painel** — abra a tela e confirme que os números dos passos 1 e 2 aparecem lá.

> **Ambiente compartilhado:** antes de provar, inventarie workers e dev servers vivos e a idade do código que eles rodam (`healthz` na 8787 é exclusivo — dois workers competem pela mesma fila). Rafael roda testes e gravações em paralelo: coordene, não dispute.

- [ ] **Step 3: Limpar o ambiente**

Remova todo dado de teste criado (regras, skills, roteadores, buscas sintéticas) e confirme a contagem zerada. Nunca deixe artefato de teste no agente de produção do Rafael.

- [ ] **Step 4: Alimentar o handoff**

Acrescente a `HANDOFF-harness-evolution.md` o registro da fase: o que foi feito, os testes rodados com números, bugs achados e corrigidos, o que ficou para trás e o estado atual.

- [ ] **Step 5: Verificação final**

```bash
npm run typecheck
npm run lint
npx vitest run
```
Expected: typecheck 0, lint 0 erros, suíte inteira verde.

> Capture o exit code de cada comando **diretamente** (`echo $?` logo depois), nunca por `cmd | tail` — o pipe entrega o código de saída do `tail` e produz verde falso.

- [ ] **Step 6: Commit**

```bash
git add docs/architecture HANDOFF-harness-evolution.md docs/superpowers/specs/2026-07-23-harness-evolution-design.md
git commit -m "docs(harness-f4): painel no mapa vivo + closure da fase 4"
```

---

## Notas de auto-revisão

**Cobertura da spec (linhas 93-101):**
- "Linha do tempo de aprendizado" → Task 4 (`learned.timeline`, as três fontes) + Task 6 bloco 1. ✅
- "Atividade: ativações de skill, decisões de roteamento, buscas de conhecimento" → Tasks 1-2 (a telemetria de busca que faltava), 4 e 6 bloco 2. ✅
- "Qualidade e resultado: taxa de handoff, funil `lead_state` (won/lost), custo" → Task 4 (`outcome`) + Task 6 bloco 3. ✅
- "UI `app/app/ai/evolution`" → Task 6. ✅
- "Critério de aceite: o tenant responde na tela sem ajuda" → gate de experiência no Step 5 da Task 6. ✅

**Fora do escopo, deliberadamente:**
- **`flywheel_judge_verdicts` ao longo do tempo** (spec linha 99) fica de fora da v1. A tabela existe, mas o veredito do juiz é sobre *dataset de avaliação*, não sobre conversa real do tenant — colocá-lo ao lado de "negócios ganhos" convidaria a ler uma nota técnica interna como resultado de negócio. Entra quando houver uma leitura honesta dele para leigo. **Registrado como dívida no handoff, não esquecido.**
- **Comparativo antes/depois ancorado nas datas de aplicação** (spec linha 100): a linha do tempo já marca as datas, e o usuário compara visualmente com os gráficos. O comparativo estatístico automático exige mais dado do que qualquer tenant terá no primeiro mês — e um "melhorou 12%" calculado sobre trinta conversas seria um número que mente com aparência de rigor.
- **Follow-ups executados** (spec linha 98) só entram se `followup_enrollment_events` já tiver um evento de execução legível; confirme antes e, se não tiver, registre como dívida em vez de inventar coleta nova — a spec proíbe coletor novo na linha 95.

**Ordem das tarefas:** 1→2 é obrigatória (a tabela antes do escritor). 3 é independente e pode ir a qualquer momento. 4 depende de nada (é pura) mas seus testes descrevem o formato que 5 e 6 consomem. 7 é o fechamento.
