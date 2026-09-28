# Mapeamento do funil do agente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) ou superpowers:executing-plans. Steps usam checkbox (`- [ ]`).

**Goal:** dar ao dono do negócio uma tela para dizer **em qual etapa do funil dele o agente coloca o cliente** em cada passo do atendimento — a configuração que hoje só existe no banco e que nenhuma interface escreve.

**Por que existe (e por que agora):** a migration `0084` criou `crm_stages.agent_stage_hint`, a ponte que traduz os 7 passos do agente para as etapas que o tenant nomeou. A Fase 4 ligou essa ponte no turno, então **o agente já move o card em produção**. Só que a coluna é escrita hoje **apenas por sondas de teste** — nenhuma tela do produto a toca. Resultado: o Painel de Evolução mostra a lacuna ("N passos do atendimento não têm etapa que os receba") e o produto **não oferece onde consertá-la**. É a única lacuna do painel sem saída.

**Architecture:** uma tela por pipeline que **inverte a forma do banco**. No banco a relação é `etapa → passo do agente` (uma coluna em `crm_stages`); na tela é `passo do agente → etapa`, que é o modelo mental de quem configura ("quando o agente qualificar o cliente, mova o card para…"). A inversão também torna o índice único natural: cada passo aparece uma vez só na lista, então é impossível pedir dois destinos para o mesmo passo.

**Tech Stack:** Next.js 16 App Router · TypeScript estrito · Supabase (RLS) · Zod · shadcn/ui

## Global Constraints

- **A coluna já existe.** Nada de migration nova, salvo se o review achar necessidade real — `0084` já entregou a coluna, o índice único parcial `uniq_crm_stages_pipeline_hint` e os dois CHECKs.
- **Os dois CHECKs do banco são a fonte da verdade e a UI tem que respeitá-los antes de gravar:**
  1. vocabulário fechado: `agent_stage_hint ∈ {new, contacted, qualifying, qualified, negotiating, won, lost}` ou `null`;
  2. coerência com o que já existia: `hint='won'` só em etapa com `is_won`; `hint='lost'` só em etapa com `is_lost`; e etapa marcada `is_won`/`is_lost` não pode receber hint de outro passo. `is_won` **sem** hint continua válido — é como todo clone começa.
- **`null` é resposta legítima, não erro.** Um passo sem etapa é uma decisão do tenant ("não quero que o agente mexa no card aqui"), e a tela tem que deixar isso claro em vez de tratar como pendência.
- `organization_id` do JWT, nunca do body. `requireRole` — papel **manager** (é configuração de operação, mesma régua de pipelines).
- Zod em todo input. `ok()`/`fail()` de `lib/api/wrappers.ts`. Audit log na mutação.
- **Zero jargão na tela.** Nunca "hint", "stage", "lead_state", "mapeamento". O vocabulário que o Painel de Evolução já estabeleceu: **"passo do atendimento"** (o que o agente faz) e **"etapa do funil"** (a coluna do quadro do tenant).
- Sem `console.log`. Exit code capturado direto, nunca por `| tail`.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `app/api/v1/pipelines/[id]/agent-mapping/route.ts` | `GET` devolve o mapeamento atual + as etapas do pipeline; `PUT` substitui o mapeamento inteiro |
| `lib/leads/agent-mapping.ts` | Regras puras: validar a coerência com `is_won`/`is_lost` **antes** do banco, e traduzir `passo → etapa` para os `UPDATE`s de `crm_stages` |
| `app/app/settings/tenant/pipelines/_mapping.tsx` | A seção de mapeamento dentro da tela de pipelines que já existe |
| `hooks/pipelines/useAgentMapping.ts` | Leitura + gravação (molde de `hooks/ai/useRouters.ts`) |

---

### Task 1: Regras puras do mapeamento

**Files:** Create `lib/leads/agent-mapping.ts` · Test `lib/leads/agent-mapping.test.ts`

**Interfaces:**
- Consumes: `LEAD_STAGES` de `@/lib/agent-engine/agent/lead-state` (tupla dos 7 passos).
- Produces: `validarMapeamento(entrada, etapas): ResultadoValidacao` e `diffParaUpdates(atual, desejado): Array<{stageId, hint}>`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
import { describe, expect, it } from 'vitest';
import { validarMapeamento, diffParaUpdates } from './agent-mapping';

const etapas = [
  { id: 'e1', name: 'Novo',      is_won: false, is_lost: false, agent_stage_hint: null },
  { id: 'e2', name: 'Proposta',  is_won: false, is_lost: false, agent_stage_hint: 'negotiating' },
  { id: 'e3', name: 'Fechado',   is_won: true,  is_lost: false, agent_stage_hint: null },
  { id: 'e4', name: 'Perdido',   is_won: false, is_lost: true,  agent_stage_hint: null },
];

describe('validarMapeamento', () => {
  it('aceita passo sem etapa — é decisão legítima, não pendência', () => {
    const r = validarMapeamento({ new: 'e1', contacted: null }, etapas);
    expect(r.ok).toBe(true);
  });

  it('recusa "ganho" apontando para etapa que não é de ganho, citando a etapa', () => {
    const r = validarMapeamento({ won: 'e2' }, etapas);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.erros[0]).toMatch(/Proposta/);
  });

  it('recusa etapa de ganho recebendo passo que não é "ganho"', () => {
    // O CHECK do banco proíbe nos DOIS sentidos: etapa is_won só aceita hint 'won'.
    const r = validarMapeamento({ qualifying: 'e3' }, etapas);
    expect(r.ok).toBe(false);
  });

  it('recusa a mesma etapa recebendo dois passos (o índice único do banco)', () => {
    const r = validarMapeamento({ new: 'e1', contacted: 'e1' }, etapas);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.erros[0]).toMatch(/Novo/);
  });

  it('recusa etapa que não é deste pipeline', () => {
    const r = validarMapeamento({ new: 'etapa-de-outro-funil' }, etapas);
    expect(r.ok).toBe(false);
  });
});

describe('diffParaUpdates', () => {
  it('só mexe no que mudou, e limpa o que saiu do mapa', () => {
    // 'negotiating' sai de e2 e vai para e1; nada mais muda.
    const ups = diffParaUpdates(etapas, { negotiating: 'e1' });
    expect(ups).toEqual(
      expect.arrayContaining([
        { stageId: 'e2', hint: null },
        { stageId: 'e1', hint: 'negotiating' },
      ]),
    );
    expect(ups).toHaveLength(2);
  });

  it('mapa idêntico não gera update nenhum', () => {
    expect(diffParaUpdates(etapas, { negotiating: 'e2' })).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run lib/leads/agent-mapping.test.ts` → FAIL ("Cannot find module").
- [ ] **Step 3: Implementar** as duas funções puras, com o vocabulário dos erros em português de dono de negócio (a mensagem vai direto para a tela: cite o **nome** da etapa, nunca o id).
- [ ] **Step 4: Rodar e ver passar** — 7/7.
- [ ] **Step 5: Sabotar cada regra** (uma por vez, confirmando por `grep` que a mutilação entrou no arquivo) e conferir que o teste correspondente vermelha. Só então commitar.
- [ ] **Step 6: Commit** — `feat(funil): regras puras do mapeamento passo→etapa`

---

### Task 2: API do mapeamento

**Files:** Create `app/api/v1/pipelines/[id]/agent-mapping/route.ts` · Test ao lado

**Interfaces:**
- Consumes: `validarMapeamento`/`diffParaUpdates` (Task 1); `requireRole`, `ok`/`fail`, `createClient` de `@/lib/supabase/server`.
- Produces: `GET` → `{ data: { etapas: Array<{id, name, is_won, is_lost}>, mapeamento: Record<passo, stageId|null> } }`; `PUT` recebe `{ mapeamento }` e devolve o estado novo.

- [ ] **Step 1: Escrever os testes que falham** — cobrindo: 403 para papel abaixo de manager; 404 para pipeline de outra org (**o teste que mais importa**: monte o cenário com o pipeline existindo em outra organização e confirme que a resposta é 404 e que nenhum `UPDATE` foi emitido); 422 para mapeamento que viola coerência, com a mensagem da Task 1 chegando ao corpo da resposta; 200 no caminho feliz emitindo **só** os updates do diff.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** Valide **antes** de tocar o banco — o CHECK é a rede de segurança, não a primeira linha de defesa: erro `23514` cru vira mensagem incompreensível para o usuário. Trate `23505` (índice único) como 409 com o nome da etapa em conflito. Audit `pipeline.agent_mapping_updated`.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Provar contra o banco real** com um pipeline de teste: gravar um mapa, ler de volta, e **provar a recusa** tentando `won` numa etapa que não é de ganho. Apagar o pipeline de teste e confirmar a contagem.
- [ ] **Step 6: Commit** — `feat(funil): API de mapeamento passo do agente → etapa`

---

### Task 3: A tela

**Files:** Create `app/app/settings/tenant/pipelines/_mapping.tsx` e `hooks/pipelines/useAgentMapping.ts` · Modify `app/app/settings/tenant/pipelines/_client.tsx`

- [ ] **Step 1: O hook**, no molde de `hooks/ai/useRouters.ts` (react-query + `apiClient`).

- [ ] **Step 2: A seção**, dentro da tela de pipelines que já existe. Forma: **uma linha por passo do atendimento**, na ordem em que o cliente avança, cada uma com um seletor das etapas daquele funil mais a opção **"Não mover o card"**.

Texto obrigatório no topo da seção, porque é o que torna a tela auto-explicativa:

> *"Quando o agente avança no atendimento, o card do cliente pode andar sozinho no seu funil. Escolha para qual etapa ele vai em cada momento. Deixar em «não mover» é uma escolha válida — o card fica onde está e o agente segue trabalhando."*

Regras de comportamento:
- **Ganho e perdido só oferecem etapas compatíveis.** Em vez de deixar o usuário escolher errado e mostrar erro depois, o seletor de "cliente fechou" lista só as etapas marcadas como ganho. Se não houver nenhuma, o seletor explica: *"Nenhuma etapa deste funil está marcada como fechamento — marque uma na configuração de etapas."*
- **Etapa já usada some das outras opções** (o índice único vira ausência, não erro).
- Salvar é **explícito** (botão), não a cada mudança — é configuração que o usuário quer revisar inteira antes de aplicar.

- [ ] **Step 3: Ligar o Painel de Evolução a esta tela.** Em `components/ai/EvolutionGaps.tsx`, o CTA da lacuna de funil hoje aponta para `/app/kanban` com o verbo **"Ver"** — porque não havia onde consertar. Passa a apontar para esta seção com verbo de ação. **Este passo é o que fecha o ciclo:** o painel deixa de só relatar a lacuna e passa a levar até o conserto.

- [ ] **Step 4: Typecheck e lint** — 0 nos dois.

- [ ] **Step 5: Prova pela tela, clicando (gate).** Servidor de produção (`npm run build` + `next start`), login como manager. Mapear dois passos, salvar, recarregar e confirmar que persistiu; tentar mapear "cliente fechou" para uma etapa comum e confirmar que a tela **não oferece** a opção; desfazer um mapeamento e confirmar que a etapa volta a aparecer nas outras opções. **Clique o CTA do painel** e confirme que ele chega nesta seção.

  **AVALIE A EXPERIÊNCIA, e isto é gate:** um dono de clínica entende, sozinho, o que está configurando? Ele entende que "não mover" é uma escolha e não um erro? Qualquer "não" vira correção antes de reportar.

- [ ] **Step 6: Commit** — `feat(funil): tela de mapeamento do funil do agente`

---

### Task 4: Fechamento

- [ ] **Step 1: Mapa vivo** — a tela nova entra em `docs/architecture/` com ao menos 2 arestas: `painel → tela de mapeamento` (a lacuna vira ação) e `tela de mapeamento → turno do agente` (a configuração muda o comportamento). Rodar o validador e re-renderizar.
- [ ] **Step 2: Prova de que o ciclo fecha** — com um mapeamento configurado pela tela, exercitar a ponte (`tests/sonda-agente-move-card.ts` já tem o cenário `pelaPonte()`) e confirmar que o card anda para a etapa **escolhida na tela**. É a prova de que a configuração do usuário chega ao comportamento do agente.
- [ ] **Step 3: Verificação final** — `npm run typecheck`, `npm run lint`, `npx vitest run`, `npm run test:db`, cada um com exit code capturado direto.
- [ ] **Step 4: Handoff** atualizado.

---

## Notas

**Por que não um wizard no onboarding:** tentador, mas o tenant recém-instalado ainda não nomeou as etapas dele — mapear antes de existir o que mapear inverteria a ordem natural. A tela vive onde as etapas são configuradas, e o Painel de Evolução puxa o usuário até lá **quando a lacuna começa a custar** (o agente quis mover e não teve para onde). Esse é o gatilho honesto.

**Fora de escopo:** sugerir mapeamento automático por semelhança de nome ("Proposta" → `negotiating`). É tentador e é exatamente o tipo de adivinhação que o cabeçalho de `lib/leads/agent-stage-sync.ts` proíbe — mover o card por semântica que o tenant não declarou. Se um dia entrar, tem que ser **sugestão que o usuário confirma**, nunca aplicação automática.
