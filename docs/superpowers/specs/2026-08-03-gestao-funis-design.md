# Gestão de funis pela tela — design

**Data:** 2026-08-03 · **Branch:** `feat/gestao-funis` · **Base:** `origin/main@5a8f4a7`

## O problema

O produto tem multi-funil no banco desde o dia 1 (`crm_pipelines` com `position`,
`is_archived`, `is_default`, `vocabulary`), mas **nenhuma tela, rota ou action
cria, renomeia, reordena ou remove um funil**. O único criador é o gatilho
`trg_seed_default_pipeline_for_org` (`baseline.sql:2766`), que semeia um funil de
e-commerce ("Pedidos", 8 etapas) em toda organização nova.

Duas consequências, e a segunda é pior que a primeira:

1. Quem quer um segundo funil não tem caminho nenhum. `/app/kanban` é um seletor
   read-only de 63 linhas.
2. **Toda instalação nova nasce com o funil errado** para quem não é e-commerce.
   Uma clínica abre o CRM e lê "Carrinho abandonado". A gestão de *etapas* já
   resolveu isso um nível abaixo; a de *funis* ficou para trás.

O código já sabia: `settings/tenant/pipelines/_client.tsx:50` ("⚠️ NÃO PROMETA UM
CAMINHO QUE NÃO EXISTE") e `lib/leads/stage-editing.ts:6` documentam o buraco.

### O bug que o print expõe

O relato veio com cinco linhas "Pedidos · /pedidos" na tela. Não são duplicatas:
`uniq_crm_pipelines_org_slug` é `UNIQUE (organization_id, slug)`, logo cinco linhas
com o mesmo slug são **cinco organizações diferentes**.

A causa é `app/app/kanban/page.tsx:11-15` — a query não filtra `organization_id`
e confia só na RLS, mas `crm_pipelines_select` libera todas as orgs do usuário
(`organization_id in fn_user_org_ids()`) e libera *tudo* para
`fn_is_platform_admin()`. A tela irmã (`settings/tenant/pipelines/page.tsx:37`)
filtra por `activeOrg.orgId` e não sofre disso.

**RLS responde "pode ver?"; a tela precisa responder "quer ver agora?".** São
perguntas diferentes, e é por isso que o CLAUDE.md exige filtro explícito de
`organization_id` mesmo com RLS ligada.

### O que "deletar um funil" realmente encosta

Três dependências, duas delas invisíveis a quem só olha a tabela:

| Dependente | Vínculo | Efeito de um `DELETE` |
|---|---|---|
| `crm_leads.pipeline_id` | FK `ON DELETE RESTRICT` | o banco recusa — funil com negócio não sai |
| `crm_stages.pipeline_id` | FK `ON DELETE CASCADE` | etapas somem junto (correto) |
| `webhook_sources.default_pipeline_id` | FK `ON DELETE CASCADE` | **a fonte de webhook é apagada em silêncio** — o formulário público do cliente para de receber lead |
| `automation_rules.actions[].config.pipeline_id` | **jsonb, sem FK** | a regra continua existindo apontando para o nada e falha em runtime |

Por isso a operação padrão é **arquivar**, não apagar.

## Decisões

| Decisão | Escolha | Por quê |
|---|---|---|
| Onde mora a gestão | Na própria tela `/app/kanban` | é onde a falta é sentida; Configurações › Funis segue como config profunda (etapas, vocabulário, mapeamento do agente), sem duplicar |
| Remoção | Arquivar sempre; excluir de vez só se nunca foi usado | arquivar preserva histórico e é reversível; excluir só quando 0 negócios, não é padrão, 0 webhooks e 0 regras — o caso "criei sem querer" |
| Reordenação | Setas ↑↓ | mesma interação das etapas (`vizinhoAoMover` + `midpoint`), acessível por teclado, testável sem simular drag, zero dependência nova |
| Funil novo nasce com | 4 etapas neutras: Novo · Em andamento · Ganho (`is_won`) · Perdido (`is_lost`) | funil sem etapa é quadro morto (Sistema Vivo), e sem etapa de ganho `/leads/[id]/win` responde 422 `pipeline_no_won_stage`. Nomes neutros, renomeáveis na tela que já existe |

## Arquitetura: simetria com o andar de baixo

A gestão de etapas já estabeleceu o padrão desta casa. Reproduzo um nível acima,
reusando o que já é genérico em vez de inventar arquitetura nova.

| Camada | Etapas (existe) | Funis (novo) |
|---|---|---|
| Núcleo puro testado | `lib/leads/stage-editing.ts` | `lib/pipelines/pipeline-editing.ts` |
| Leitura compartilhada | `app/api/v1/pipelines/[id]/stages/_funil.ts` | `app/api/v1/pipelines/_funis.ts` |
| Rotas REST manager+ | `.../stages` + `.../stages/[stageId]` | `POST /api/v1/pipelines` · `PATCH`/`DELETE` em `/[id]` |
| Hooks react-query | `hooks/pipelines/useStages.ts` | `hooks/pipelines/usePipelines.ts` |
| UI | `_stages.tsx` | `app/app/kanban/_client.tsx` |
| Audit | `pipeline.stage_*` | `pipeline.created` · `pipeline.updated` · `pipeline.archived` · `pipeline.deleted` |

Reuso direto, sem reescrever: `slugDeNome()` e a normalização de nome que dobra
acento (`chaveDeNome` — "Pos venda" ≡ "Pós-venda"), e `midpoint()` de
`lib/kanban/fractional-indexing`, que já é o motor de posição do board.

**Sem migration.** Todas as colunas necessárias existem e
`crm_pipelines_manager_write` já autoriza manager+. O trabalho é inteiro de
aplicação.

### `lib/pipelines/pipeline-editing.ts` — as regras, sem banco

Funções puras, testadas, que devolvem `{ok:true}` ou `{ok:false, erro}` com texto
em português citando o **nome** do funil (nunca o código do Postgres):

- `validarNomeDeFunil(nome, funis, funilId)` — recusa duplicata pela chave que
  dobra acento; `funilId` evita colisão consigo mesmo ao renomear.
- `validarArquivamento(funil, deps)` — recusa quando:
  - é o **último funil ativo** da org (o Kanban ficaria sem quadro);
  - é o **padrão** (`uniq_crm_pipelines_org_default` é índice parcial: eleja outro antes);
  - é destino de **fonte de webhook** ativa — nomeia a fonte;
  - é alvo de **regra de automação** ativa — nomeia a regra.
  Funil com negócios **arquiva** (some do quadro, histórico intacto), avisando quantos.
- `podeExcluirDeVez(funil, deps)` — só com 0 negócios, 0 webhooks, 0 regras e não
  sendo o padrão.
- `updatesDePadrao(funis, novoId)` — libera o `is_default` do anterior **antes** de
  marcar o novo. O índice único é imediato, não deferível; a ordem inversa é um
  `23505` cru na cara do usuário. Mesmo formato de `updatesDeMarcacao` para etapas.

### Contrato das rotas

Todas: sessão por cookie, `requireRole("manager")`, `organization_id` do JWT
(**nunca** do body), Zod no corpo, `audit()` fire-and-forget, e releitura do banco
na resposta (a tela mostra o que o banco tem, não o que foi pedido).

```
POST   /api/v1/pipelines            { name, description? }        → 201 { pipelines: [...] }
PATCH  /api/v1/pipelines/[id]       { name?, description?,
                                      is_default?, depois_de? }   → 200 { pipelines: [...] }
DELETE /api/v1/pipelines/[id]       ?definitivo=1 (opcional)      → 200 { pipelines: [...] }
```

**Nenhuma rota de leitura nova, e isso não é economia — é correção.** O
`GET /api/v1/pipelines` que existe exige `manager` (`route.ts:17`), mas
`/app/kanban` é aberta a qualquer papel autenticado: um `agent` que relesse a
lista por ali levaria 403 e ficaria sem quadro. A lista continua vindo do Server
Component (RLS-scoped, papel nenhum barrado) e, depois de cada mutação, a tela
chama `router.refresh()`. Uma fonte de verdade só, e o papel que pode ler
continua diferente do papel que pode escrever. As rotas devolvem a lista relida
mesmo assim — é a convenção das rotas de etapa e o que os testes conferem.

`depois_de` é o vizinho **de cima** (`null` = primeiro da lista) — mesmo contrato
do PATCH de etapa, para a tela não precisar saber o que é fração de `position`.

O `DELETE` sem `definitivo` arquiva. Com `definitivo=1`, exclui — e só passa se
`podeExcluirDeVez` deixar; caso contrário responde 422 explicando qual dependência
barrou.

**Criação é duas escritas, e a segunda não pode falhar em silêncio.** O `POST`
insere o funil e depois as 4 etapas; se as etapas falharem, ele **apaga o funil
recém-criado** (que ainda não tem negócio, então o `RESTRICT` não atrapalha) e
responde erro. Sem essa compensação, um erro de rede deixaria um funil vazio —
quadro sem coluna, o estado morto que a doutrina do Sistema Vivo proíbe. A
alternativa correta-por-construção seria um RPC transacional, que custaria
migration + apêndice no baseline + MANIFEST para cobrir um caso que a compensação
resolve em três linhas.

### UI: `/app/kanban` vira gerenciadora

A page continua Server Component (busca inicial com filtro de org), e a lista vira
client component para as mutações:

```
┌ Pipelines ─────────────────────────────── [+ Novo funil] ┐
│  ↑↓  Pedidos          Padrão              ⋯    → abrir   │
│  ↑↓  Clínica                              ⋯    → abrir   │
│         ⋯ = renomear · tornar padrão · arquivar          │
└──────────────────────────────────────────────────────────┘
```

- Clique no corpo da linha continua abrindo o board — o caminho que já existe não muda.
- **Os controles de escrita só são renderizados para manager+.** A page resolve o
  papel e passa `podeGerenciar`, como `podeEditarConfig` faz em Configurações ›
  Funis: esconder o que a rota recusaria é honestidade, não permissão nova. Quem é
  `viewer` ou `agent` vê a lista da sua org e abre o board, como hoje.
- Renomear é inline (mesmo padrão das etapas), não modal.
- Arquivar pede confirmação e mostra a recusa **explicada** quando há dependência.
- Estado vazio: em vez do texto atual que manda "Ir para Configurações" (pingue-pongue
  fechado, denunciado em `_client.tsx:50`), o botão **cria o primeiro funil ali mesmo**.

### Correção do escopo por organização

`app/app/kanban/page.tsx` passa a resolver a org ativa (`requireAuth` +
`resolveActiveOrg`, como a tela de settings) e filtrar `.eq("organization_id",
activeOrg.orgId)`. É o mesmo filtro que as rotas novas aplicam, então lista e
escrita passam a concordar sobre o que é "meu funil".

## Living System Checklist

- **Entrada e saída:** funil nasce da tela e do onboarding; sai no board, no seletor
  de webhooks, nas regras de automação e no mapeamento do agente.
- **Log:** quatro ações de audit novas em `lib/audit/actions.ts`.
- **Aparece na tela:** é a própria feature.
- **Anti-morte:** funil novo nasce com etapas (nunca quadro vazio); nunca é possível
  ficar sem funil ativo nem sem etapa de ganho.
- **Mapa vivo:** `docs/architecture/` ganha a aresta tela → rotas → `crm_pipelines`.

## Plano de prova (DoD 3, 4, 5, 12)

1. **Unit do núcleo puro** — `lib/pipelines/pipeline-editing.test.ts`: duplicata com
   acento, último funil, funil padrão, dependência de webhook, dependência de regra,
   ordem dos updates de padrão.
2. **Unit das rotas** — no padrão `route.test.ts` já usado pelas rotas de etapa:
   403 sem manager, 422 nas recusas, audit emitido, compensação do POST.
3. **E2E Playwright pela tela** (`tests/e2e/pipelines-gestao.spec.ts`): criar → abrir
   o board novo → renomear → reordenar → tornar padrão → arquivar → conferir a recusa
   do último funil. Screenshot em `evidence/`.
4. **Escopo por org** — teste que prova que a lista mostra só a org ativa (o bug do print).

## Fora de escopo

- Duplicar funil / templates por nicho (clínica, imobiliária). O funil novo nasce
  neutro; escolher modelo é feature própria.
- Editar `vocabulary`/`custom fields` daqui — continua em Configurações › Funis, admin-only.
- Desarquivar pela tela: `is_archived` volta a `false` por SQL. Entra se pedirem.
- Reordenar arrastando.
