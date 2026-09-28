# Gerenciar as etapas do funil — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans. Steps usam checkbox (`- [ ]`).

**Goal:** o dono do negócio consegue montar o funil dele — renomear, criar, reordenar e arquivar etapas, e dizer qual é a de fechamento e a de perda — sem pedir ajuda a quem instalou o sistema.

**Por que existe:** hoje **nenhuma tela do produto escreve em `crm_stages`**. O gatilho `trg_seed_default_pipeline_for_org` (`baseline.sql:684`) semeia um funil "Pedidos" com oito etapas de **e-commerce** em toda organização criada — então uma clínica abre o sistema e vê *"Carrinho abandonado", "Aguardando pagamento", "Em separacao", "Pos-venda"*. Ela não tem como corrigir. E a tela de mapeamento (entregue em 2026-07-27) tem duas linhas — «cliente fechou» e «cliente desistiu» — que respondem *"quem montou o funil precisa marcar a etapa de ganho"*, apontando para uma configuração que não existe em lugar nenhum.

**Escopo, e por que nesta ordem:** este plano cobre **as etapas**, não a criação de funis. Criar um segundo funil sem conseguir montar as etapas dele entrega uma casca vazia; e o funil semeado já existe em toda organização, então editá-lo resolve a dor de quem instalou hoje. Criação de funil é a continuação natural, e fica mais simples depois desta.

**Architecture:** uma seção nova em `app/app/settings/tenant/pipelines` (a mesma tela que já ganhou o mapeamento), com uma rota REST por operação. As regras de negócio ficam numa camada pura testável (`lib/leads/stage-editing.ts`), no mesmo desenho que `lib/leads/agent-mapping.ts` provou funcionar: **validar antes do banco**, porque erro de constraint cru é incompreensível para quem não programa.

**Tech Stack:** Next.js 16 App Router · TypeScript estrito · Supabase (RLS) · Zod · shadcn/ui · `midpoint()` de `lib/kanban/fractional-indexing.ts`

## Global Constraints

**As seis regras do banco que a feature inteira tem que respeitar.** Não são sugestões — são índices e FKs que já existem, e cada uma vira comportamento de tela:

1. **`crm_leads_stage_id_fkey ... ON DELETE RESTRICT`** — uma etapa com negócios **não pode ser apagada**. Por isso a operação é *arquivar*, nunca *excluir*, e arquivar precisa dizer para onde vão os negócios.
2. **`uniq_crm_stages_pipeline_won`** e **`uniq_crm_stages_pipeline_lost`** (índices parciais, `where is_won/is_lost and not is_archived`) — **no máximo UMA** etapa de ganho e UMA de perda por funil. Marcar uma nova exige desmarcar a antiga, e **a ordem importa**: desmarcar antes de marcar, senão o índice recusa. É exatamente a lição da feature de mapeamento — lá o mesmo erro gerava `23505` cru na cara do usuário.
3. **`uniq_crm_stages_pipeline_slug`** — o `slug` é único por funil. Renomear tem que decidir o que fazer com o slug (ver Task 1).
4. **`crm_stages_hint_coerente_com_won_lost`** (migration 0084) — etapa marcada como ganho só aceita o passo «cliente fechou» do agente, e vice-versa. **Desmarcar o ganho de uma etapa que representa esse passo viola o CHECK.**
5. **`crm_stages_agent_stage_hint_check`** — vocabulário fechado do `agent_stage_hint`.
6. **`position numeric`** — reordenação por *fractional indexing*, com `midpoint()` (existe nos dois lados: `lib/kanban/fractional-indexing.ts:7` e a função SQL em `baseline.sql:879`). **Nunca `int`**, nunca renumerar a lista inteira.

**Além disso:**
- `organization_id` do JWT, nunca do body. `requireRole` — papel **manager** (mesmo da tela de mapeamento e do painel, para o ciclo não quebrar por permissão: já aconteceu).
- Zod em todo input. `ok()`/`fail()` — e `ok()` **já envelopa em `{data}`**; `ok({data:x})` é double-nest e é defeito.
- Audit em toda mutação.
- **Zero jargão na tela:** nunca "stage", "slug", "pipeline", "position", "is_won". O vocabulário fixado pelas duas telas anteriores é **"etapa do funil"** e **"passo do atendimento"**.
- Sem `console.log`. Exit code capturado direto, nunca por `| tail`.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `lib/leads/stage-editing.ts` | Regras puras: validar renomear/criar/arquivar/marcar, e calcular a ordem dos `UPDATE`s quando a marcação de ganho/perda muda de dono |
| `app/api/v1/pipelines/[id]/stages/route.ts` | `POST` cria etapa |
| `app/api/v1/pipelines/[id]/stages/[stageId]/route.ts` | `PATCH` renomeia / marca ganho-perda / reordena · `DELETE` arquiva (com destino dos negócios) |
| `app/app/settings/tenant/pipelines/_stages.tsx` | A seção de etapas |
| `hooks/pipelines/useStages.ts` | Leitura e mutações (molde de `hooks/pipelines/useAgentMapping.ts`) |

---

### Task 1: Regras puras da edição de etapas

**Files:** Create `lib/leads/stage-editing.ts` · Test `lib/leads/stage-editing.test.ts`

**Interfaces:**
- Consumes: `LEAD_STAGES` e `ROTULO_DO_PASSO` de `@/lib/leads/agent-mapping` (reuse — **não crie segunda tradução dos passos**); `midpoint` de `@/lib/kanban/fractional-indexing`.
- Produces: `validarNomeDeEtapa`, `slugDeNome`, `validarMarcacao`, `updatesDeMarcacao`, `posicaoEntre`, `validarArquivamento`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
import { describe, expect, it } from 'vitest';
import {
  validarNomeDeEtapa, slugDeNome, validarMarcacao, updatesDeMarcacao,
  posicaoEntre, validarArquivamento,
} from './stage-editing';

const etapas = [
  { id: 'e1', name: 'Novo',     slug: 'novo',     position: 1000, is_won: false, is_lost: false, is_archived: false, agent_stage_hint: null },
  { id: 'e2', name: 'Proposta', slug: 'proposta', position: 2000, is_won: false, is_lost: false, is_archived: false, agent_stage_hint: 'negotiating' },
  { id: 'e3', name: 'Fechado',  slug: 'fechado',  position: 3000, is_won: true,  is_lost: false, is_archived: false, agent_stage_hint: 'won' },
];

describe('validarNomeDeEtapa', () => {
  it('recusa nome vazio e nome só de espaços', () => {
    expect(validarNomeDeEtapa('', etapas, null).ok).toBe(false);
    expect(validarNomeDeEtapa('   ', etapas, null).ok).toBe(false);
  });

  it('recusa nome repetido no mesmo funil, citando o nome', () => {
    const r = validarNomeDeEtapa('Proposta', etapas, null);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.erro).toMatch(/Proposta/);
  });

  it('aceita o próprio nome ao renomear (não colide consigo mesma)', () => {
    expect(validarNomeDeEtapa('Proposta', etapas, 'e2').ok).toBe(true);
  });

  it('compara ignorando caixa e espaços nas pontas — "  proposta " colide', () => {
    // Sem isto o usuário cria duas etapas que ele lê como a mesma.
    expect(validarNomeDeEtapa('  proposta ', etapas, null).ok).toBe(false);
  });
});

describe('slugDeNome', () => {
  it('gera slug estável a partir do nome', () => {
    expect(slugDeNome('Em negociação')).toBe('em_negociacao');
    expect(slugDeNome('Pós-venda!')).toBe('pos_venda');
  });

  it('desempata acrescentando sufixo quando o slug já existe', () => {
    // "Pós venda" e "Pós-venda" viram o mesmo slug; o índice único recusaria.
    expect(slugDeNome('Pós venda', ['pos_venda'])).toBe('pos_venda_2');
  });

  it('nunca devolve slug vazio', () => {
    // Nome só de emoji/pontuação não pode virar slug '' e violar o índice.
    expect(slugDeNome('🎯').length).toBeGreaterThan(0);
  });
});

describe('validarMarcacao', () => {
  it('recusa desmarcar ganho de etapa que representa o passo "cliente fechou"', () => {
    // O CHECK crm_stages_hint_coerente_com_won_lost proibiria, com erro cru.
    const r = validarMarcacao(etapas, 'e3', { is_won: false });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.erro).toMatch(/Fechado/);
  });

  it('recusa marcar como ganho uma etapa que já representa outro passo', () => {
    const r = validarMarcacao(etapas, 'e2', { is_won: true });
    expect(r.ok).toBe(false);
  });

  it('aceita mover a marcação de ganho para uma etapa livre', () => {
    expect(validarMarcacao(etapas, 'e1', { is_won: true }).ok).toBe(true);
  });

  it('recusa marcar a mesma etapa como ganho E perda', () => {
    expect(validarMarcacao(etapas, 'e1', { is_won: true, is_lost: true }).ok).toBe(false);
  });
});

describe('updatesDeMarcacao', () => {
  it('DESMARCA a antiga antes de marcar a nova — o índice único é imediato', () => {
    const ups = updatesDeMarcacao(etapas, 'e1', { is_won: true });
    expect(ups[0]).toEqual({ stageId: 'e3', patch: { is_won: false } });
    expect(ups[1]).toEqual({ stageId: 'e1', patch: { is_won: true } });
    expect(ups).toHaveLength(2);
  });

  it('não emite update nenhum quando a marcação já é a desejada', () => {
    expect(updatesDeMarcacao(etapas, 'e3', { is_won: true })).toEqual([]);
  });
});

describe('posicaoEntre', () => {
  it('devolve o meio entre as duas vizinhas', () => {
    expect(posicaoEntre(1000, 2000)).toBe(1500);
  });

  it('aceita as pontas da lista', () => {
    expect(posicaoEntre(null, 1000)).toBeLessThan(1000);
    expect(posicaoEntre(3000, null)).toBeGreaterThan(3000);
  });
});

describe('validarArquivamento', () => {
  it('exige destino quando a etapa tem negócios', () => {
    const r = validarArquivamento(etapas, 'e2', { negocios: 7, destinoId: null });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.erro).toMatch(/7/);
  });

  it('dispensa destino quando a etapa está vazia', () => {
    expect(validarArquivamento(etapas, 'e2', { negocios: 0, destinoId: null }).ok).toBe(true);
  });

  it('recusa destino igual à própria etapa', () => {
    expect(validarArquivamento(etapas, 'e2', { negocios: 3, destinoId: 'e2' }).ok).toBe(false);
  });

  it('recusa arquivar a ÚLTIMA etapa do funil', () => {
    // Funil sem etapa nenhuma não recebe negócio novo e some do board.
    const so = [etapas[0]!];
    expect(validarArquivamento(so, 'e1', { negocios: 0, destinoId: null }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run lib/leads/stage-editing.test.ts` → FAIL ("Cannot find module").

- [ ] **Step 3: Implementar.** Duas decisões que o teste fixa e que você não deve inverter:
  - **O `slug` NÃO muda ao renomear.** Ele é chave técnica com índice único; trocá-lo em renomeação quebraria qualquer referência externa e forçaria tratar colisão a cada edição de texto. O nome é o que o usuário vê; o slug nasce com a etapa e morre com ela. Escreva isso no cabeçalho.
  - **Mensagens de erro são texto de tela** — português de dono de negócio, citando o **nome** da etapa, nunca o id nem o nome da constraint.

- [ ] **Step 4: Rodar e ver passar** — 18/18.

- [ ] **Step 5: Sabotar cada regra**, uma por vez, **confirmando por `grep` que a mutilação entrou no arquivo antes de ler o resultado**. Prefira mutações não-explosivas (remover um `push`, alargar uma condição, inverter uma ordem): sabotagem que vermelha por `TypeError` prova só que a linha executa.

- [ ] **Step 6: Commit** — `feat(funil): regras puras da edicao de etapas`

---

### Task 2: API das etapas

**Files:** Create `app/api/v1/pipelines/[id]/stages/route.ts` e `.../[stageId]/route.ts` · Testes ao lado

**Interfaces:**
- Consumes: as seis funções da Task 1; `requireRole`, `ok`/`fail`, `createClient` de `@/lib/supabase/server`.
- Produces: `POST /stages` (cria) · `PATCH /stages/[stageId]` (renomeia, marca, reordena) · `DELETE /stages/[stageId]` (arquiva com destino).

- [ ] **Step 1: Escrever os testes que falham.** Cobertura obrigatória, e o primeiro é o que mais importa:
  - **Etapa de OUTRA organização → 404, e nenhum `UPDATE` emitido.** Não basta assertar o status: prove que o banco não foi tocado. Use um dublê que **aplique os filtros de verdade** — um dublê de linha fixa deixaria este teste passar mesmo com o filtro de `organization_id` apagado da rota, e aí ele pareceria proteger sem proteger.
  - Papel abaixo de manager → 403, **asserindo o papel exigido** (`expect(vi.mocked(requireRole).mock.calls[0]?.[0]).toBe("manager")`) num caminho com auth OK. Um teste que mocka a checagem para falhar sempre passa com qualquer papel.
  - Marcação movendo de dono → **os dois `UPDATE`s em sequência, desmarcar primeiro**, medido com folga real entre início e fim (execução paralela produziria os dois inícios antes do primeiro fim).
  - Arquivar etapa com negócios sem destino → 422 com a contagem na mensagem.
  - Arquivar com destino → os negócios mudam de etapa **antes** de a etapa ser arquivada.
  - `23505` do índice único → 409 com frase em português, **asserindo também `not.toContain("unique")`**: sem essa metade, um 500 devolvendo a mensagem crua do Postgres também conteria o nome da etapa e passaria.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Implementar.** Regras:
  - Validar **antes** de tocar o banco. As constraints são rede de segurança, não primeira linha.
  - Aplicar os `UPDATE`s **em sequência**, na ordem que a Task 1 devolve. Paralelizar reintroduz a colisão com o índice único.
  - Ao arquivar com destino: **mover os negócios primeiro, arquivar depois**. A ordem inversa deixaria negócios apontando para etapa arquivada se a segunda escrita falhasse.
  - Audit: `pipeline.stage_created`, `pipeline.stage_updated`, `pipeline.stage_archived`.

- [ ] **Step 4: Rodar e ver passar.**

- [ ] **Step 5: Provar contra o banco real.** Num funil de teste criado para isto: criar etapa, renomear, mover a marcação de ganho de uma etapa para outra **numa única requisição** (é o caso que o índice único pune), arquivar com destino conferindo que os negócios andaram. **Meça as recusas do banco, não as afirme** — tente marcar duas etapas como ganho por fora e capture o código do erro. Apague o funil de teste e confirme as contagens antes/depois.

- [ ] **Step 6: Commit** — `feat(funil): API de criacao, edicao e arquivamento de etapas`

---

### Task 3: A tela das etapas

**Files:** Create `app/app/settings/tenant/pipelines/_stages.tsx` e `hooks/pipelines/useStages.ts` · Modify `_client.tsx`

- [ ] **Step 1: O hook**, no molde de `hooks/pipelines/useAgentMapping.ts` (react-query + `apiClient`). **Após qualquer erro do servidor, releia** antes de deixar o usuário tentar de novo — não há concorrência otimista, e duas abas editando geram "o último ganha".

- [ ] **Step 2: A seção.** Uma lista das etapas na ordem do funil, cada linha com: o nome (editável no lugar), um seletor de "esta é a etapa de fechamento / de perda / nenhuma das duas", e a ação de arquivar. Mais um botão de acrescentar etapa ao fim.

Textos obrigatórios, porque são o que torna a tela auto-explicativa:

> Topo: *"Estas são as colunas do seu quadro, na ordem em que o cliente avança. Você pode renomear, criar, reordenar e arquivar."*

> Ao marcar fechamento: *"Só uma etapa pode ser a de fechamento. Marcar esta desmarca «{nome da atual}»."* — mostre o nome, não um aviso genérico.

> Ao arquivar etapa com negócios: *"{N} negócios estão nesta etapa. Para onde eles vão?"* com o seletor. **Nunca ofereça arquivar e perder o rastro.**

**Regras de comportamento:**
- **Etapa que representa um passo do agente não pode ter a marcação de fechamento removida** — a tela explica citando o passo e **oferece o link para a tela de mapeamento**, que é onde se desfaz o vínculo. As duas telas se referenciam.
- **A última etapa do funil não pode ser arquivada** — explique por quê (o funil ficaria sem coluna nenhuma), não desabilite mudo.
- Renomear salva ao confirmar (Enter ou blur), não a cada tecla.
- Reordenar por arrastar; se o arrastar não couber no tempo desta task, **botões de subir/descer resolvem e são honestos** — melhor uma interação simples que funciona do que arrastar pela metade.

- [ ] **Step 3: Ligar as duas pontas.** A linha «cliente fechou» / «cliente desistiu` da tela de mapeamento hoje diz *"Quem montou o funil precisa marcar a etapa de ganho"*. Passa a **linkar para esta seção**. É o que fecha o segundo ciclo: o mapeamento aponta a falta, esta tela resolve.

- [ ] **Step 4: Typecheck e lint** — 0 nos dois.

- [ ] **Step 5: Prova pela tela, clicando (gate).** Servidor de produção, login como **manager**. Prove: renomear uma etapa e ver persistir após recarregar; criar etapa nova e vê-la no fim; mover a marcação de fechamento de uma etapa para outra e **conferir no banco** que só uma ficou marcada; arquivar uma etapa com negócios escolhendo destino e conferir que os negócios andaram; tentar desmarcar o fechamento de uma etapa vinculada a um passo do agente e ver a explicação **com o link funcionando**. Meça o front por ferramenta (`getBoundingClientRect`), nunca a olho. **Restaure o funil ao estado inicial** e confirme por consulta.

  **AVALIE A EXPERIÊNCIA, e isto é gate:** uma dona de clínica que abriu o sistema e viu "Carrinho abandonado" consegue transformar isso no funil dela sozinha? Ela entende o que é a "etapa de fechamento"? Qualquer "não" vira correção **antes** de reportar.

- [ ] **Step 6: Commit** — `feat(funil): tela de gerenciamento das etapas`

---

### Task 4: Fechamento

- [ ] **Step 1: Mapa vivo** — `docs/architecture/agent-turn.workflow.json` (o rastreado; **não toque** em `deskcomm-system.*` nem `flywheel-proposal.*`, que são untracked de outra sessão). A tela entra com ao menos 2 arestas, e uma tem que ser `tela de etapas → mapa do funil` — as duas se completam. Rode o validador e re-renderize o HTML.

- [ ] **Step 2: A prova do ciclo completo, que é a razão da feature existir.** Numa organização **recém-criada** (o gatilho semeia "Pedidos" com nomes de e-commerce): renomeie as etapas para o vocabulário de uma clínica, marque a de fechamento, mapeie os passos do agente na tela de mapeamento, e prove que o agente move o card para a etapa que você nomeou. **Declare o caminho de cada afirmação** — "chamei a função que o turno chama, com o pool real" e "passei por HTTP com sessão" são coisas diferentes. Apague a organização de teste e confirme as contagens.

- [ ] **Step 3: Verificação final** — `npm run typecheck`, `npm run lint`, `npx vitest run`, `npm run test:db`, `npm run build`, cada um com exit code capturado direto.

- [ ] **Step 4: Handoff** atualizado, registrando também o que ficou de fora (abaixo).

---

## Fora de escopo, com razão declarada

**Criação e arquivamento de FUNIS.** O gatilho garante que toda organização nasce com um, e editar as etapas dele resolve a dor de quem instalou hoje. Um segundo funil só faz sentido para quem já dominou o primeiro — e depois desta feature ele é quase de graça, porque a metade difícil (etapas) já existe. É a continuação natural.

**Vocabulário do funil** (`crm_pipelines.vocabulary`, que renomeia "lead/negócio/ganho/perdido"). Já existe editor, hoje restrito a admin. Mexer nele junto misturaria duas conversas na mesma tela.

**Sugerir nomes de etapa por nicho** ("clínica: Avaliação, Orçamento, Agendado"). Tentador e perigoso: é a mesma adivinhação que o cabeçalho de `lib/leads/agent-stage-sync.ts` proíbe. Se entrar um dia, tem que ser **sugestão que o usuário confirma**, nunca aplicação automática — e é uma feature de onboarding, não de configuração.
