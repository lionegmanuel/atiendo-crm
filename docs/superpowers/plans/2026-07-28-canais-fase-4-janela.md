# Fase 4 — Janela de 24h e o Template como Saída — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o sistema **saber** que a janela de 24h fechou e agir — usando template aprovado em vez de falhar no envio — sem que nada do WAHA mude.

**Architecture:** Um gate irmão do anti-ban na cadeia `before_send`, armado por capability. A janela é **derivada** de `conversations.last_inbound_at`, nunca guardada. O veto volta ao modelo como erro instrutivo (a cadeia já faz isso), e o agente ganha a saída: disparar template. Ver `docs/doctrine/restricao-de-canal.md`.

**Tech Stack:** Next.js 16, TypeScript 6 estrito, Supabase/Postgres com RLS, Vitest, Playwright.

## Global Constraints

- **Zero mudança de comportamento no WAHA.** `caps.freeformOutsideWindow` é `true` lá, o gate não arma, e o `gates.csv` da jornada sai idêntico à baseline. Este é o critério de aceite, não uma meta.
- **A janela NUNCA vira coluna.** Ver "A decisão que abre esta fase".
- `pnpm typecheck` / `pnpm lint` zerados por task. `set -o pipefail` + `$?`; **nunca `${PIPESTATUS[0]}`** (no zsh expande vazio).
- **`pnpm run test:unit -- <filtro>` é falso verde** — use `pnpm exec vitest run <filtro>`.
- Migration = arquivo em `supabase/migrations/` **+** apêndice idempotente no `baseline.sql` **+** linha no `MANIFEST.md`. **Meça o próximo NNNN em TODAS as branches** — e note que a `main` hoje tem **dois `0068`** (colisão pré-existente, registrada em `git notes` do merge `fbf601a`).
- Nenhum nome de provider fora de `lib/channels/` — `pnpm exec tsx scripts/lint-channels.ts` é catraca; a dívida (53) só encolhe.
- Régua atual: **`test:unit` 1453 ✓ / 0 ✗**, lint 158 warnings, typecheck 0.

---

## A decisão que abre esta fase: a janela é derivada, não guardada

O TomikCRM guarda `messaging_conversations.conversation_window_expires_at`, e o desenho inicial desta fase copiou isso. **Está errado para este repo**, e o motivo é a doutrina DIRC do próprio `CLAUDE.md`:

`conversations.last_inbound_at` **já existe** (medido no `baseline.sql`). A janela é uma função pura dele:

```ts
janelaAberta = agora.getTime() - lastInboundAt.getTime() < 24 * 60 * 60 * 1000
```

Guardar `window_expires_at` seria:
- **segunda fonte da verdade** — precisa de cron para expirar, e deriva no minuto em que alguém esquece de atualizar num caminho de escrita;
- **falsamente tranquilizador** — uma coluna com data no futuro parece autoritativa mesmo quando o `last_inbound_at` já a contradiz.

Para "a janela está aberta?", a resposta DIRC é **Calcular**. É a mesma lição do contrato de parâmetros da Fase 3a, num eixo diferente: o que é derivável não se armazena.

---

## ⚠️ Uma premissa do repo que se revelou FALSA (e esta fase conserta)

`lib/agent-engine/guardrails/before-send.ts:13` afirma:

> "mudar a ordem sem bumpar a versão **quebra o CI**"

**Não quebra.** Medido: `grep -rl "BEFORE_SEND_CHAIN_VERSION" --include="*.ts" .` devolve **só o próprio arquivo de definição**. Nenhum teste referencia a constante nem a lista `BEFORE_SEND_GATES`. A ordem da cadeia — que o cabeçalho chama de "invariante de segurança (regra dura nº 2)" — não é verificada por nada.

É a terceira vez nesta branch que um comentário promete um mecanismo ausente (as outras: `scripts/lint-pacing.ts`, que não existe neste repo; e o `evidencia-citada` que eu supus cobrir o que não cobria). **Comentário é afirmação de terceiro, não evidência.**

A Task 1 cria o guarda **antes** de eu mexer na cadeia — porque é exatamente a mudança que ele existe para vigiar.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `tests/unit/before-send-chain-shape.test.ts` | **Criar.** Trava ordem + versão da cadeia. |
| `lib/agent-engine/guardrails/messaging-window.ts` | **Criar.** Decisão pura da janela. |
| `lib/agent-engine/guardrails/before-send.ts` | **Modificar.** Novo gate + `GateContext.messagingWindow` + versão 5. |
| `lib/channels/meta/send-template.ts` | **Criar.** Disparo de template pelo adapter (usa `buildComponents`). |
| `lib/ai/runtime/tools/send-template.ts` | **Criar.** A saída do agente quando o gate veta. |

---

## Task 1: O guarda que faltava (antes de tocar na cadeia)

**Files:**
- Create: `tests/unit/before-send-chain-shape.test.ts`

**Interfaces:**
- Consumes: `BEFORE_SEND_GATES`, `BEFORE_SEND_CHAIN_VERSION`.
- Produces: nada. É só a trava.

> Escrever a trava **depois** de mexer na cadeia seria escrevê-la já conformada à mudança — ela passaria por construção e não provaria nada. Primeiro o guarda, com a ordem atual; depois a mudança, que o faz vermelhar de propósito.

- [ ] **Step 1: Escrever o teste — contra a ordem ATUAL (8 gates, versão 4)**

```ts
// tests/unit/before-send-chain-shape.test.ts
import { describe, expect, it } from "vitest";
import {
  BEFORE_SEND_CHAIN_VERSION,
  BEFORE_SEND_GATES,
} from "@/lib/agent-engine/guardrails/before-send";

/**
 * O cabeçalho de before-send.ts afirmava que mudar a ordem sem bumpar a versão
 * "quebra o CI". Medido em 2026-07-28: nada referenciava as duas constantes fora
 * do próprio arquivo. Este é o guarda que a frase descrevia.
 */
const ORDEM_ESPERADA = [
  "stop",
  "lgpd",
  "pacing",
  "spinning",
  "promise",
  "semantic_promise",
  "case_promise",
  "disclosure",
] as const;

describe("forma da cadeia before_send", () => {
  it("a ordem é exatamente esta — mudá-la é mudar comportamento de segurança", () => {
    expect(BEFORE_SEND_GATES.map((g) => g.name)).toEqual([...ORDEM_ESPERADA]);
  });

  it("stop é SEMPRE o primeiro — opt-out é irrevogável e não se avalia depois de gastar janela", () => {
    expect(BEFORE_SEND_GATES[0]!.name).toBe("stop");
  });

  it("a versão acompanha a lista: mudou a cadeia, bumpa a versão", () => {
    // O par (tamanho, versão) é o que amarra os dois. Acrescentar um gate sem
    // bumpar deixa o trace de auditoria mentindo sobre qual cadeia rodou.
    expect(BEFORE_SEND_GATES).toHaveLength(8);
    expect(BEFORE_SEND_CHAIN_VERSION).toBe(4);
  });

  it("nenhum gate repetido — nome duplicado quebraria a leitura do trace", () => {
    const nomes = BEFORE_SEND_GATES.map((g) => g.name);
    expect(new Set(nomes).size).toBe(nomes.length);
  });
});
```

- [ ] **Step 2: Rodar — tem que passar de primeira**

```bash
pnpm exec vitest run before-send-chain-shape
```

Expected: **4 passed**. Ele descreve o estado atual; se vermelhar aqui, a ordem já não é a que o cabeçalho documenta, e isso é achado a reportar antes de seguir.

- [ ] **Step 3: Sabotar — a trava tem que pegar**

Troque `pacingGate` e `spinningGate` de lugar em `BEFORE_SEND_GATES` → o 1º caso vermelha. Acrescente um gate no fim sem bumpar a versão → o 3º vermelha. Restaure e prove com `git diff` vazio.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/before-send-chain-shape.test.ts
git commit -m "test(canais): a trava de ordem da cadeia before_send, que o comentário prometia e não existia"
```

---

## Task 2: A decisão pura da janela

**Files:**
- Create: `lib/agent-engine/guardrails/messaging-window.ts`
- Test: `tests/unit/messaging-window.test.ts`

**Interfaces:**
- Consumes: nada (puro).
- Produces:
  - `WINDOW_MS = 24 * 60 * 60 * 1000`
  - `isWindowOpen(now: Date, lastInboundAt: Date | null): boolean`
  - `windowRemainingMs(now: Date, lastInboundAt: Date | null): number`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// tests/unit/messaging-window.test.ts
import { describe, expect, it } from "vitest";
import { isWindowOpen, windowRemainingMs } from "@/lib/agent-engine/guardrails/messaging-window";

const T0 = new Date("2026-07-28T12:00:00Z");
const h = (n: number) => new Date(T0.getTime() + n * 3_600_000);

describe("janela de 24h — derivada de last_inbound_at, nunca guardada", () => {
  it("aberta logo após o inbound", () => {
    expect(isWindowOpen(h(1), T0)).toBe(true);
  });

  it("aberta em 23h59", () => {
    expect(isWindowOpen(new Date(T0.getTime() + 24 * 3_600_000 - 1000), T0)).toBe(true);
  });

  it("FECHADA exatamente em 24h — a borda é exclusiva, como a Meta trata", () => {
    expect(isWindowOpen(h(24), T0)).toBe(false);
  });

  it("fechada em 25h", () => {
    expect(isWindowOpen(h(25), T0)).toBe(false);
  });

  it("SEM inbound nenhum = FECHADA, não aberta", () => {
    // Fail-closed: contato que nunca escreveu não tem janela. Tratar null como
    // "aberta" faria toda prospecção fria passar como se fosse resposta.
    expect(isWindowOpen(h(1), null)).toBe(false);
  });

  it("inbound no FUTURO não estende a janela além de 24h", () => {
    // Relógio torto de um webhook não pode virar licença de envio.
    expect(windowRemainingMs(T0, h(5))).toBeLessThanOrEqual(24 * 3_600_000);
  });

  it("o tempo restante é 0 quando fechada, nunca negativo", () => {
    expect(windowRemainingMs(h(30), T0)).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm exec vitest run messaging-window`

Expected: `Failed to resolve import "@/lib/agent-engine/guardrails/messaging-window"`.

- [ ] **Step 3: Implementar** — puro, sem I/O, com o cabeçalho explicando por que não é coluna (ver "A decisão que abre esta fase").

- [ ] **Step 4: Verde + sabotar**

Troque `<` por `<=` na borda → o caso de 24h vermelha. Faça `null` valer `true` → o caso fail-closed vermelha. Restaure.

- [ ] **Step 5: Commit**

---

## Task 3: O gate irmão

**Files:**
- Modify: `lib/agent-engine/guardrails/before-send.ts`
- Modify: `tests/unit/before-send-chain-shape.test.ts` (a trava da Task 1 vai vermelhar — é o ponto)
- Test: `tests/unit/gate-messaging-window.test.ts`

**Interfaces:**
- Consumes: `isWindowOpen` (Task 2), `capabilitiesOf` (Fase 0–2).
- Produces: `messagingWindowGate`; `GateContext.messagingWindow: { lastInboundAt: Date | null }`; `BEFORE_SEND_CHAIN_VERSION = 5`.

> **Posição na cadeia: logo APÓS `pacing`.** Os dois são irmãos — "posso falar agora?" — com física invertida (ver a doutrina). Vêm depois de `stop` e `lgpd`, que são irrevogáveis, e antes de `spinning`, que só faz sentido se o envio for acontecer.

- [ ] **Step 1: Ver a trava da Task 1 vermelhar**

Acrescente `messagingWindowGate` à lista e rode `pnpm exec vitest run before-send-chain-shape`.

Expected: **2 casos vermelhos** (ordem e tamanho/versão). **Este é o momento que justifica a Task 1** — a mudança que ela existe para vigiar é vista, não presumida. Anote a mensagem real no HANDOFF.

- [ ] **Step 2: Atualizar a trava para a nova forma**

`ORDEM_ESPERADA` ganha `messaging_window` após `pacing`; `toHaveLength(9)`; `CHAIN_VERSION` vai a `5`. Atualize também o cabeçalho de `before-send.ts` (a "Ordem FINAL v4" vira v5) e **corrija a frase sobre o CI**, que agora é verdade.

- [ ] **Step 3: O gate**

```ts
export const messagingWindowGate: Gate = {
  name: "messaging_window",
  evaluate: (ctx) => {
    const caps = capabilitiesOf(ctx.provider);
    // Canal que fala livre a qualquer hora não tem janela — registra, não some.
    if (caps.freeformOutsideWindow) return { pass: true, skipped: "not_applicable" };
    if (isWindowOpen(ctx.now, ctx.messagingWindow.lastInboundAt)) return { pass: true };
    return {
      pass: false,
      code: "messaging_window_closed",
      reason:
        "a janela de 24 horas com este contato fechou; texto livre será recusado " +
        "pelo canal. Use um template aprovado (ferramenta send_template) ou encerre o turno.",
    };
  },
};
```

A `reason` volta ao modelo como erro instrutivo — é assim que a cadeia já funciona. **Ela precisa dizer a saída**, não só o problema: um veto que só nega faz o modelo tentar de novo igual.

- [ ] **Step 4: Testes do gate**

Casos: (a) WAHA → `skipped: 'not_applicable'`; (b) Meta + janela aberta → `pass` sem `skipped`; (c) Meta + fechada → veto com `messaging_window_closed`; (d) Meta + sem inbound → veto; (e) a `reason` do veto **cita a saída** (`send_template`) — um teste que asserta a instrução, não só a negação.

- [ ] **Step 5: Preencher `messagingWindow` no ctx de produção**

No construtor (~`before-send.ts:507`), carregar `conversations.last_inbound_at` da conversa do turno. Em produção o provider é `waha` até haver sessão Meta, então o gate registra `skipped` e **nada muda**.

- [ ] **Step 6: Prova de não-regressão**

Rejogue a jornada e `diff` do `gates.csv` contra a baseline. **Atenção:** o CSV agora tem **9 linhas de gate**, não 8 — a linha `messaging_window,skipped,not_applicable` é esperada e correta. **Regrave a baseline** com uma nota explicando por quê, em vez de "consertar" o diff.

Isto é mudança de trace, não de comportamento: nenhuma mensagem muda de destino. Registre a distinção no HANDOFF.

- [ ] **Step 7: Commit**

---

## Task 4: A saída — disparar template

**Files:**
- Create: `lib/channels/meta/send-template.ts`
- Test: `tests/unit/meta-send-template.test.ts`

**Interfaces:**
- Consumes: `deriveTemplateContract`, `buildComponents`, `missingSlots`, `bindingState` (Fase 3a).
- Produces: `sendTemplate(input): Promise<{ externalId: string | null }>`.

> Sem isto, o gate da Task 3 é uma parede sem porta: o modelo é vetado e não tem o que fazer. Gate que só nega transforma follow-up em silêncio — o oposto do invariante 4 do sistema vivo.

- [ ] **Step 1: Testes que falham**

Casos: (a) bind `ok` monta o payload por `buildComponents` e chama a Graph API; (b) bind `stale` **não envia** e devolve o estado; (c) valor faltando **não envia** (usa `missingSlots`); (d) template não aprovado não envia.

- [ ] **Step 2–4:** implementar, verde, sabotar.

- [ ] **Step 5: Prova real**

Com o destinatário `5531998966398` já registrado e o template `deskcomm_prova_webhook_0088` (pt_BR, 2 parâmetros) aprovado na WABA de teste: envie **por este caminho** e prove o `wamid`. Grave em `evidence/canais/fase4/`.

**Seja econômico** — é o celular de uma pessoa. Um envio bem-sucedido basta.

- [ ] **Step 6: Commit**

---

## ⚠️ Task 5 BLOQUEADA pela Fase 3b — descoberto ao tentar implementá-la

A tool `send_template` não pode ser concluída **corretamente** antes do adapter Meta
(`lib/channels/index.ts:10` → `meta_cloud: null // Fase 3b`).

**Por quê.** O `send` que a tool injetaria em `runBeforeSend` precisa passar por
`channel.send({tenantId, leadId, jobId, seq, conversationId, body})`, que faz duas
coisas indispensáveis:

1. **Registra a mensagem em `messages`** — sem isso o template sai e não aparece na
   conversa. Ilha, e violação dos invariantes 3 e 6 do sistema vivo.
2. **Avança o ledger `(job_id, seq)`** — que é o que impede reenvio depois de um
   crash. Sem ele, um re-run **reenvia o template**. E template **custa dinheiro**:
   diferente de texto livre, cada entrega é cobrada.

Chamar `sendTemplate` direto, contornando o `channel.send`, compraria a tool ao preço
de mensagem invisível e cobrança duplicada em retry. Não é o tipo de atalho que se
paga.

**Ordem correta:** Fase 3b (adapter Meta, com `send` que sabe despachar template) →
então a Task 5 vira ligação de poucas linhas.

**O que JÁ está pronto e não se perde:** toda a lógica que decide algo está fora do
`inbound-turn.ts` e testada — `sendTemplate` (8 casos + envio real provado),
`explainSendResult` (6 casos), `renderTemplateBody` (6 casos) e o gate reconhecendo
`isTemplate` (10 casos). Falta só o fio, e ele depende do adapter.

---

## Task 5 (após a Fase 3b): A ferramenta do agente

**Files:**
- Create: `lib/ai/runtime/tools/send-template.ts`
- Test: `tests/unit/agent-tool-send-template.test.ts`

**Interfaces:**
- Consumes: `sendTemplate` (Task 4), o registro de ferramentas do runtime.
- Produces: a tool `send_template` disponível ao modelo.

> Descubra como o runtime registra ferramentas **lendo o código**, não presumindo: o `search_knowledge` da Fase 0 é o exemplo vivo mais próximo.

- [ ] **Step 1–4:** TDD + sabotagem, como as anteriores.

- [ ] **Step 5: O ciclo fechado**

Prove que o modelo, vetado pelo gate, **usa a ferramenta**: um turno com janela fechada em canal Meta termina com template enviado, não com silêncio. É o invariante 2 do sistema vivo (continuidade) e o 4 (anti-morte) no mesmo teste.

- [ ] **Step 6: Commit**

---

## Living System Checklist — Janela de 24h

```
[ ] Quem me alimenta?  conversations.last_inbound_at (derivado, nunca guardado)
[ ] Quem eu alimento?  a cadeia before_send → o modelo (veto instrutivo) → send_template
[ ] Que atividade/log eu emito?  before_send_traces (pass | veto | skipped)
[ ] Onde eu apareço na tela?  o veto vira estado da conversa no inbox — SE não aparecer,
                              é ilha e precisa de superfície antes do merge
[ ] Qual meu mecanismo anti-morte?  a Task 4 É o anti-morte: sem a saída, o gate
                                    transforma follow-up em silêncio
[ ] Qual a continuidade IA↔humano?  template sem bind configurado escala ao humano
                                    (usa bindingState da Fase 3a)
[ ] Onde se CONFIGURA o que eu uso?  a tela da Fase 3a (/app/settings/templates)
[ ] Atualizei o mapa vivo?  docs/architecture/*.json ganha o gate com aresta → send_template
```

---

## O que esta fase NÃO faz

- **Não propõe template pelo agente** — ficou para a Fase 4b. Submeter template à Meta é ação externa com custo e risco de rejeição de categoria; merece plano próprio com gate humano.
- **Não faz onboarding de canal pela tela** — **Fase 5 — credencial por sessão, com tela** (NÃO Embedded Signup; ver `docs/doctrine/restricao-de-canal.md`, seção "Embedded Signup não cabe em self-host").
- **Não muda nada do WAHA.** Se o `gates.csv` mostrar diferença que não seja a linha nova de `messaging_window`, é regressão: pare.
