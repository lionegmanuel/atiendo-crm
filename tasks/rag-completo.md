# Plano — RAG completo (feat/rag-completo)

Base: `origin/main` @ 8112377a. Worktree: `/Users/rafaelmelgaco/DeskcommCRM-rag`.
Diagnóstico completo: `/private/tmp/.../scratchpad/diagnostico-rag.md` (7 mapas + consolidação).

## A inversão que resolve quase tudo

Hoje a base de conhecimento **pertence a um agente** e o acervo do agente é **uma versão
monolítica**. Daí saem os defeitos: pipelines competindo pelo mesmo ponteiro, fonte que só
existe para o agente padrão, impossibilidade de compartilhar material, um documento por
categoria por agente.

**Depois: o acervo é da ORGANIZAÇÃO; o agente ESCOLHE o que lê.**

- fonte de conhecimento → biblioteca da organização (`agent_id` vira histórico, nullable)
- versão de índice → **por fonte** (`ai_knowledge_versions.knowledge_source_id`,
  `ai_knowledge_sources.active_kb_version_id`)
- agente → `ai_agent_versions.knowledge_source_ids uuid[]`, molde exato de `pipeline_ids`
- busca → RPC nova que recebe `uuid[]` de fontes

## Restrições que NÃO mudam (do diagnóstico)

1. Config do agente é lida em UMA query, sem cache → o vínculo é coluna na VERSÃO, não junção.
2. Escopo de permissão mora na versão publicada e entra no trigger de imutabilidade.
3. Nunca ativar versão vazia.
4. Erro de tool é ensino ao modelo, nunca exceção.
5. A busca pede sem limiar (PISO −1) e corta em JS, para preservar `top_score`.
6. O engine roda com `bypassrls`: o isolamento é o `organization_id = $1` escrito à mão.
7. Migration versionada + apêndice idempotente no baseline + MANIFEST.
8. Função nova em `public` leva os DOIS revokes (`from public, anon`).

## Ondas

### O1 — Schema (migration 0181 + apêndice + MANIFEST)
- `ai_knowledge_sources`: `agent_id` nullable; `active_kb_version_id uuid` (FK);
  derrubar `ai_knowledge_sources_unique_per_agent`; novo único
  `(organization_id, lower(name)) where is_active`; `is_active` sincronizado com `status`
  (arquivar desliga); CHECK de `source_type` removido (vocabulário vai para o TS, precedente 0127)
  com backfill `policy→documento`, `conversation(s)→conversas`,
  `catalog|nuvemshop_catalog→catalogo`; `last_index_status` aceita `indexando` e `sem_credencial`.
- `ai_knowledge_versions`: `knowledge_source_id uuid` (FK), `embedding_model text`,
  `embedding_dims int`; trocar `ai_kbv_one_active_per_agent` por um-ativo-por-FONTE.
- FKs que faltam: `ai_chunks.kb_version_id`, `ai_agents.active_kb_version_id`.
- `ai_agent_versions.knowledge_source_ids uuid[] not null default '{}'` + trigger de
  imutabilidade + backfill a partir de `ai_knowledge_sources.agent_id`.
- RPC `retrieve_top_k_chunks_de_fontes(org, source_ids[], embedding, k, threshold, embedding_model)`.
- `ai_models`: colunas `supports_embedding boolean`, `embedding_dims int`; seed do
  `text-embedding-3-small`.
- Segurança: par SELECT-tenancy + write-com-`fn_role_at_least` (formato 0150) nas 4 tabelas de
  RAG, `revoke all from anon`, trigger `fn_audit_log_row`.
- Backfills: ponteiro por fonte a partir das versões ativas existentes.

### O2 — Chave de embedding por organização
- `lib/ai/embeddings/chave.ts`: `resolverChaveDeEmbedding(orgId, ponto)` —
  binding do ponto → credencial OpenAI ativa+validada da org → `AI_GATEWAY_API_KEY` →
  `OPENAI_API_KEY` → null. Devolve `origem` para a tela explicar.
- `embedText` passa a usá-la; `isEmbeddingProviderConfigured(orgId)` async.
- Pontos `embedding_*` deixam de ser `fixo` quanto à CHAVE (modelo segue travado).
- `prova-painel-provedores.spec.ts` reescrita (não apagada).

### O3 — Indexação por fonte
- `workers/rag-indexer.ts`: indexa a FONTE do `payload.knowledge_source_id`; versão por fonte;
  sem chave → `retry` + `last_index_status='sem_credencial'` + aviso na Central.
- `documento`: worker baixa o blob, extrai (pdf/md/txt), chunka, embeda, grava.
  `ingestPolicyFile` deixa de descartar.
- `conversas`: `onConflict` correto; `ingested` só com chunk gravado.
- `catalogo`: `knowledge_source_id` real.
- `lib/event-log/drain.ts`: preserva `detail` de `skipped` em `last_error`.
- `agent_inbox_items`: kinds `indexacao_sem_credencial` e `indexacao_falhou`.

### O4 — Recuperação multi-fonte
- `agent-config.ts`: `knowledgeSourceIds`; `search_knowledge` usa a RPC nova;
  fallback para `activeKbVersionId` quando a lista vem vazia.
- `lib/ai/knowledge/busca.ts` e `lib/mcp/tools/evolucao.ts`: mesma operação, mesmos knobs.
- Limiar: UM default (0.40, o do banco desde a 0097) nos três sítios de código.

### O5 — Tela
- `/app/ai/knowledge` — biblioteca da organização: listar, criar (texto ou arquivo),
  reindexar, arquivar, ver trechos indexados, ver quais agentes usam.
- Aviso de chave ANTES do cadastro, com atalho para colar a chave ali mesmo.
- `BasesDoAgente` no `AgentForm` (seção "O que ele sabe").
- Fim dos botões decorativos.
- Navegação (`lib/navigation/registry.ts`).

### O6 — Provas
- unit: worker por fonte, documento grava, conversas, `resolverChaveDeEmbedding`, drain.
- invariantes: RLS das 4 tabelas, RPC nova, imutabilidade da coluna nova, backfill.
- e2e: jornada criar base → indexar → agente cita o trecho.
- `docs/architecture/rag.architecture.json`, `docs/testing/user-journey-map.md`, CHANGELOG.

## Fora de escopo (declarado)
- Índice vetorial HNSW / tuning de recall — a busca é correta e linear; vira issue.
- Telemetria e orçamento de embedding (`llm_calls`) — vira issue.
- `.docx`, `.csv`, `.xlsx`, URL/sitemap.
- Rerank, busca híbrida, indexação incremental.

## Doutrina de packaging (o Rafael declarou: este é um **minor**)

Alvo: **o que os fragmentos de `.changes/` calcularem** — hoje `1.6.0 + minor = 1.7.0`,
conferível com `pnpm release:conferir`. Este PR chegou a digitar `## [1.7.0]` no CHANGELOG à
mão; enquanto ele estava aberto, a `main` mergeou o PR #357 e o número passou a ser CALCULADO
dos fragmentos, nunca digitado — justamente para duas sessões paralelas não escolherem o mesmo
número. A seção escrita à mão virou os 13 fragmentos em `.changes/`, e o `release:conferir`,
que lia a minha seção como versão já lançada e ia cortar 1.8.0, voltou a calcular 1.7.0.

Obrigações que entram NESTE PR (não no "polimento final"):

1. Migration `0181` + apêndice idempotente no `baseline.sql` + linha no MANIFEST — **feito**.
   É o que faz a mudança alcançar quem roda `update.sh` numa VPS.
2. Seção no `CHANGELOG.md` sob `[Não lançado]`, escrita para quem já instalou.
3. **Nenhuma variável de ambiente nova obrigatória.** A chave de embedding passa a sair de
   `ai_provider_credentials`/`ai_purpose_bindings` com fallback para `AI_GATEWAY_API_KEY` e
   `OPENAI_API_KEY` — quem já tem `.env` preenchido não muda nada.
4. Atualizar não pode exigir edição manual de arquivo. Nada aqui pede.
5. `pnpm test:shell` verde (único gate que exercita o kit).
6. DoD 15 respondido no PR.

O corte da release (tag, GHCR, `stable`, ensaio de `update.sh` numa VPS real) é ato
posterior ao merge — checklist em `docs/doctrine/packaging.md §Checklist de release`.
