# Webhooks Universais + Motor de Regras — Plano de Implementação (Parte 2: UI + Kit + E2E)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Item "Webhooks" no sidebar com página em 3 abas (Receber dados / Automações / Atividade) leigo-friendly, crontab do drain no kit HostGator, e E2E Playwright do fluxo completo.

**Architecture:** Consome as APIs do plano Parte 1 (`docs/superpowers/plans/2026-07-17-webhooks-backend.md` — PRÉ-REQUISITO: Parte 1 mergeada/no branch). Página segue o padrão do repo: server page (`requireAuth` + `resolveActiveOrg`) + client component em `_components/`. Design system travado: Sage + Atkinson Hyperlegible + Phosphor + estética aerada (ver `app/design/lib/` e memória Design System Locked) — nada de shadcn cru sem os tokens do projeto.

**Tech Stack:** Next.js 15 App Router, shadcn/ui (componentes já em `components/ui/`: tabs, dialog, switch, select, table, badge, sonner, tooltip...), Phosphor icons via `@/lib/ui/icons`, Playwright.

## Global Constraints

- Herda TODAS as Global Constraints da Parte 1 (branch `feat/webhooks-automation`, typecheck/lint zerados por task, 1 commit atômico por task).
- TOM leigo em TODO texto de UI: pt-br simples, zero jargão ("fonte de captação", "regra", "quando/se/então" — nunca "payload", "trigger", "HMAC" sem explicação). Textos de ajuda sempre presentes nos empty-states.
- Permissão: página e sidebar visíveis para `manager+` via permissão nova `webhooks.manage`.
- URLs públicas exibidas montadas com `env.NEXT_PUBLIC_APP_URL` (já validada em `lib/env.ts:121`) — nunca hardcode de domínio.
- Antes de codar cada tela, leia uma página de referência do repo e siga o padrão dela: `app/app/metrics/page.tsx` + `_components/MetricsClient.tsx` (fetch client-side) e `app/app/ai/agents/` (CRUD com dialogs e `_actions.ts`).

---

### Task 1: Permissão + sidebar + shell da página com 3 abas

**Files:**
- Modify: `hooks/auth/AuthProvider.tsx` (mapa `ACTION_MIN_ROLE`)
- Modify: `components/shell/Sidebar.tsx`
- Create: `app/app/webhooks/page.tsx`
- Create: `app/app/webhooks/_components/WebhooksClient.tsx`

**Interfaces:**
- Produces: rota `/app/webhooks` com `<Tabs>` de 3 abas (`sources` | `rules` | `activity`), cada aba renderizando o componente das Tasks 2/3/4 (por ora placeholders vazios que as tasks seguintes substituem). Permissão `webhooks.manage` → `"manager"`.

- [ ] **Step 1:** Em `hooks/auth/AuthProvider.tsx`, adicionar ao mapa `ACTION_MIN_ROLE` (fim do objeto):

```ts
  "webhooks.manage": "manager",
```

- [ ] **Step 2:** Em `components/shell/Sidebar.tsx`:

1. Import do ícone: adicionar `WebhooksLogo` à lista importada de `@/lib/ui/icons` (se `lib/ui/icons` não reexportar `WebhooksLogo`, adicione o reexport lá — é o barrel do Phosphor).
2. `NAV_ITEMS`: inserir após "Agentes IA":

```ts
  { href: "/app/webhooks", label: "Webhooks", icon: WebhooksLogo, permission: "webhooks.manage" },
```

3. No corpo do componente: `const canWebhooks = usePermission("webhooks.manage");` e no `.filter()` adicionar o branch:

```ts
          if (item.permission === "webhooks.manage") return canWebhooks;
```

- [ ] **Step 3:** `app/app/webhooks/page.tsx` (padrão da página de métricas):

```tsx
import { redirect } from "next/navigation";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { WebhooksClient } from "./_components/WebhooksClient";

export const dynamic = "force-dynamic";

export default async function WebhooksPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  const canManage = !!activeOrg && ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager;
  if (!canManage) redirect("/app/inbox");

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Webhooks</h1>
        <p className="text-sm text-muted-foreground">
          Receba contatos de fora (landing pages, formulários) e crie automações que agem sozinhas.
        </p>
      </header>
      <WebhooksClient />
    </div>
  );
}
```

- [ ] **Step 4:** `_components/WebhooksClient.tsx`:

```tsx
"use client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SourcesTab } from "./SourcesTab";
import { RulesTab } from "./RulesTab";
import { ActivityTab } from "./ActivityTab";

export function WebhooksClient() {
  return (
    <Tabs defaultValue="sources" className="flex-1">
      <TabsList>
        <TabsTrigger value="sources">Receber dados</TabsTrigger>
        <TabsTrigger value="rules">Automações</TabsTrigger>
        <TabsTrigger value="activity">Atividade</TabsTrigger>
      </TabsList>
      <TabsContent value="sources"><SourcesTab /></TabsContent>
      <TabsContent value="rules"><RulesTab /></TabsContent>
      <TabsContent value="activity"><ActivityTab /></TabsContent>
    </Tabs>
  );
}
```

Crie `SourcesTab.tsx`, `RulesTab.tsx`, `ActivityTab.tsx` como stubs `export function XTab() { return null; }` — substituídos nas Tasks 2/3/4.

- [ ] **Step 5:** Verificação: `npm run dev`, logar como manager (seed E2E) → item "Webhooks" aparece no sidebar; `/app/webhooks` renderiza as 3 abas; logar como agent → item NÃO aparece e a URL direta redireciona pro inbox.

- [ ] **Step 6:** `npm run typecheck && npm run lint` e commit:

```bash
git add hooks/auth/AuthProvider.tsx components/shell/Sidebar.tsx app/app/webhooks/
git commit -m "feat(webhooks): sidebar + shell da página /app/webhooks"
```

---

### Task 2: Aba "Receber dados" — fontes de captação

**Files:**
- Create: `app/app/webhooks/_components/SourcesTab.tsx` (substitui o stub)
- Create: `app/app/webhooks/_components/SourceDetail.tsx`
- Create: `app/app/webhooks/_components/CreateSourceDialog.tsx`
- Create: `app/api/v1/webhook-sources/[id]/events/route.ts` (feed de recebimentos)

**Interfaces:**
- Consumes: `GET/POST /api/v1/webhook-sources`, `PATCH/DELETE /api/v1/webhook-sources/[id]` (Parte 1 Task 12); `GET /api/v1/pipelines` (existente — confira o shape real da resposta antes de usar).
- Produces: `GET /api/v1/webhook-sources/[id]/events?limit=20` → `{data: Array<{id, created_at, valid_signature, payload_parsed, status}>}` (select RLS-scoped em `webhook_events_log` filtrando `webhook_path_token` = token da fonte; gate `requireRole("manager")`).

- [ ] **Step 1:** Rota do feed — `app/api/v1/webhook-sources/[id]/events/route.ts`: `requireRole("manager")`, carrega a fonte (RLS-scoped; 404 se não é da org), depois `webhook_events_log` `.eq("webhook_path_token", source.path_token).order("created_at", {ascending:false}).limit(20)`. Retorna com `ok()`.

- [ ] **Step 2:** `SourcesTab.tsx` — comportamento (siga o padrão de fetch/estado do `MetricsClient.tsx`):

- Fetch `GET /api/v1/webhook-sources` no mount.
- **Empty-state didático** (nenhuma fonte): card central com título "Conecte sua landing page em 2 minutos", os 3 passos numerados ("1. Crie uma fonte e diga em qual funil o contato entra · 2. Copie o endereço ou o formulário pronto · 3. Cole no seu site — cada envio vira um lead aqui dentro") e botão primário "Criar primeira fonte".
- Com fontes: lista em cards (nome, badge ativa/pausada, "último recebimento há X" de `last_received_at` ou "nunca recebeu"), clique abre `SourceDetail`.
- Botão "Nova fonte" abre `CreateSourceDialog`.

- [ ] **Step 3:** `CreateSourceDialog.tsx` — `Dialog` com: nome (Input), pipeline (Select carregado de `/api/v1/pipelines`), estágio (Select dependente do pipeline), URL de obrigado opcional (Input, ajuda: "Para onde enviar a pessoa depois que ela preencher seu formulário"). Submit → `POST /api/v1/webhook-sources` → toast de sucesso (sonner) → abre direto o `SourceDetail` da fonte criada.

- [ ] **Step 4:** `SourceDetail.tsx` — o coração leigo-friendly. Sheet/painel com:

1. **URL pronta**: `` `${process.env.NEXT_PUBLIC_APP_URL}/api/v1/webhooks/in/${source.path_token}` `` em `<code>` com botão copiar (`navigator.clipboard.writeText` + toast "Endereço copiado").
2. **Snippet de formulário HTML** pronto (textarea readonly + copiar):

```html
<form action="URL_DA_FONTE" method="POST">
  <input name="nome" placeholder="Seu nome" required />
  <input name="telefone" placeholder="Seu WhatsApp" required />
  <input name="email" type="email" placeholder="Seu e-mail" />
  <button type="submit">Quero receber contato</button>
</form>
```

3. **Exemplo técnico** (colapsado, `<details>`/accordion "Para desenvolvedores ou Zapier"): `curl -X POST <url> -H 'Content-Type: application/json' -d '{"nome":"...","telefone":"..."}'`.
4. **Instruções por cenário** (accordion): WordPress/Elementor ("cole a URL no campo Action do seu formulário"), Zapier/n8n ("use a ação Webhooks → POST"), form próprio (snippet acima).
5. **Botão "Enviar lead de teste"**: faz `fetch(urlPublica, {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({nome:"Lead de Teste", telefone:"11999990000", utm_source:"teste"})})`; sucesso → toast "Funcionou! Um lead de teste entrou no seu funil." + link "Ver no Kanban" (`/app/kanban`); erro → mensagem clara com o que checar.
6. **Feed de recebimentos**: `GET .../events` — lista com hora relativa + dot verde (processado) / vermelho (assinatura inválida), refresh após o teste.
7. Ações: switch ativa/pausada (PATCH `is_active`), excluir com `AlertDialog` de confirmação (DELETE).

- [ ] **Step 5:** Verificação manual: criar fonte no browser → copiar URL → "Enviar lead de teste" → toast de sucesso → lead visível no Kanban → feed mostra o recebimento.

- [ ] **Step 6:** `npm run typecheck && npm run lint` e commit:

```bash
git add app/app/webhooks/ app/api/v1/webhook-sources/
git commit -m "feat(webhooks): aba Receber dados — fontes, snippets e lead de teste"
```

---

### Task 3: Aba "Automações" — builder QUANDO / SE / ENTÃO

**Files:**
- Create: `app/app/webhooks/_components/RulesTab.tsx` (substitui o stub)
- Create: `app/app/webhooks/_components/RuleEditor.tsx`
- Create: `app/app/webhooks/_components/ActionConfigForm.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/v1/automation-rules`, `PATCH/DELETE .../[id]`; `/api/v1/pipelines` (pipelines+stages); lista de sessões WhatsApp e de membros do time — descubra as rotas/fontes que as páginas `app/app/connections` e `app/app/team` já usam (leia os `_components` delas) e reuse as MESMAS.
- Produces: labels pt-br canônicos dos gatilhos/ações (congelar aqui, a UI é a única fonte desses textos):
  - Gatilhos: `lead.created` "Quando entrar um contato novo (webhook)"; `lead.stage_changed` "Quando um lead mudar de etapa"; `message.received` "Quando chegar mensagem no WhatsApp"; `lead.tag_added` "Quando um lead ganhar uma tag"; `contact.tag_added` "Quando um contato ganhar uma tag".
  - Ações: `create_or_move_lead` "Criar/mover lead no funil"; `send_whatsapp_message` "Enviar mensagem no WhatsApp"; `add_tag` "Adicionar tag"; `assign_owner` "Atribuir a um atendente"; `call_webhook` "Avisar outro sistema (webhook)".

- [ ] **Step 1:** `RulesTab.tsx` — lista de regras (nome, label do gatilho, contagem de ações, `Switch` ativa/pausada com PATCH otimista + toast). Empty-state: "Crie sua primeira automação — ex.: quando entrar um contato novo, enviar uma mensagem de boas-vindas." Botão "Nova automação" abre `RuleEditor` (Sheet largo). Excluir com AlertDialog.

- [ ] **Step 2:** `RuleEditor.tsx` — três blocos verticais com títulos grandes:

1. **QUANDO** — Select com os 5 gatilhos (labels acima).
2. **SE (opcional)** — linhas de condição `[Select campo] [Select é/não é/contém] [Input valor]` + "adicionar condição" (máx 10). Campos oferecidos no Select variam por gatilho (curadoria fixa, não free-text — o leigo não conhece paths):
   - `lead.*`: `lead.title` "Nome do lead", `lead.tags` "Tags do lead" (op contains), `lead.custom_fields.utm_source` "Origem (utm_source)", `event.to_stage_id` "Etapa de destino" (só p/ stage_changed; renderizar como Select de stages, gravando o uuid como value);
   - `message.received`: `event.body_preview` "Texto da mensagem", `contact.tags` "Tags do contato";
   - `*.tag_added`: `event.added_tags` "Tag adicionada" (op contains).
   Um link discreto "usar campo avançado" troca o Select por Input livre (poder sem poluir o padrão).
3. **ENTÃO** — lista ordenada de ações; "adicionar ação" abre Select com as 5; cada ação renderiza seu `ActionConfigForm`; remover/reordenar (setas cima/baixo bastam — sem drag-and-drop no v1).

Salvar → `POST` (create) ou `PATCH` (edit); create mostra aviso fixo: "A automação nasce pausada. Revise e ligue quando estiver pronta." Validar client-side com os MESMOS schemas Zod (`import { createAutomationRuleSchema } from "@/lib/schemas/webhooks"`).

- [ ] **Step 3:** `ActionConfigForm.tsx` — por type:

- `create_or_move_lead`: Select pipeline → Select stage.
- `send_whatsapp_message`: Select da sessão WhatsApp (mostrar nome + status; desabilitar não-WORKING com hint) + Textarea do template com helper de variáveis clicáveis (chips `{{nome}}`, `{{telefone}}`, `{{lead.title}}` que inserem no cursor) + hint fixo: "Enviamos só entre 7h e 22h e respeitamos o limite diário do número — fora disso a mensagem espera a próxima janela."
- `add_tag`: Input de tags (separadas por vírgula → array).
- `assign_owner`: Select de membros do time.
- `call_webhook`: Input URL (validação https) + Input secret opcional (ajuda: "Se preencher, enviaremos uma assinatura para o outro sistema conferir que fomos nós").

- [ ] **Step 4:** Verificação manual: criar regra "Quando entrar contato novo → Adicionar tag boas-vindas" no browser, ligar o switch, disparar lead de teste pela aba 1, rodar o cron drain (curl) e conferir a tag no lead.

- [ ] **Step 5:** `npm run typecheck && npm run lint` e commit:

```bash
git add app/app/webhooks/
git commit -m "feat(webhooks): aba Automações — builder quando/se/então"
```

---

### Task 4: Aba "Atividade" — timeline de execuções

**Files:**
- Create: `app/app/webhooks/_components/ActivityTab.tsx` (substitui o stub)
- Create: `app/api/v1/automation-rules/runs/route.ts` (lista runs da ORG inteira, cross-rule)

**Interfaces:**
- Produces: `GET /api/v1/automation-rules/runs?limit=50` → `{data: Array<{id, rule_id, rule_name, status, actions_result, error, created_at}>}` — select RLS-scoped em `automation_rule_runs` com join do nome da regra (`.select("*, automation_rules(name)")`), order desc, gate `requireRole("manager")`.

- [ ] **Step 1:** Implementar a rota acima (padrão das rotas da Parte 1 Task 12).

- [ ] **Step 2:** `ActivityTab.tsx` — timeline:

- Cada run é um card: hora relativa, nome da regra, e as ações como linhas "✓/✗/⏭ <label pt-br da ação>" a partir de `actions_result` (mapa de labels da Task 3 — extraia os labels para `app/app/webhooks/_components/labels.ts` e importe nos dois lugares).
- Run `failed`/`partial`: mostrar `error` da ação em linguagem simples + quando a ação falha for `call_webhook`, botão "Reenviar" → `POST /api/v1/automation-rules/runs/[runId]/resend` → toast + refresh.
- Empty-state: "Nenhuma automação rodou ainda. Assim que uma regra ligada disparar, o histórico aparece aqui."
- Botão refresh manual (sem polling no v1).

- [ ] **Step 3:** Verificação manual: com o run da Task 3 no banco, a timeline mostra o run verde; force uma falha (regra com `call_webhook` para `https://example.invalid/x`) → run com ✗ e botão Reenviar aparece.

- [ ] **Step 4:** `npm run typecheck && npm run lint` e commit:

```bash
git add app/app/webhooks/ app/api/v1/automation-rules/
git commit -m "feat(webhooks): aba Atividade — timeline de runs + reenviar"
```

---

### Task 5: Kit HostGator — crontab do drain + docs

**Files:**
- Modify: `hostgator-setup-kit/install.sh`
- Modify: `hostgator-setup-kit/update.sh`
- Modify: `hostgator-setup-kit/README.md`

**Interfaces:**
- Consumes: rota `/api/v1/cron/event-log-drain` (Parte 1 Task 2), env `INTERNAL_CRON_SECRET`/`INTERNAL_SECRET` já usadas pelo kit.

- [ ] **Step 1:** Leia `hostgator-setup-kit/install.sh` e `_common.sh` inteiros para achar onde o kit configura env/crontab hoje (se já existe bloco de crontab p/ outros crons, siga o padrão; se NÃO existe, crie uma função `setup_cron` em `_common.sh` chamada pelos dois scripts). O objetivo idempotente (não duplicar linha a cada update):

```bash
setup_event_log_drain_cron() {
  local cron_line="* * * * * curl -fsS -H \"Authorization: Bearer ${INTERNAL_SECRET}\" ${APP_URL}/api/v1/cron/event-log-drain >/dev/null 2>&1"
  ( crontab -l 2>/dev/null | grep -v "event-log-drain" ; echo "$cron_line" ) | crontab -
}
```

(Ajuste os nomes de variáveis às que o kit realmente usa — confira em `_common.sh`/`install.sh` como APP_URL e secrets são carregados.)

- [ ] **Step 2:** README do kit: seção nova "Automações e webhooks" explicando em 3 linhas que o cron acima é obrigatório para as automações rodarem, e como testar (`curl` manual com o secret → esperar `{"data":{"scanned":...}}`).

- [ ] **Step 3:** Teste do shell: `bash -n hostgator-setup-kit/install.sh hostgator-setup-kit/update.sh` (sintaxe) + rodar `setup_event_log_drain_cron` num shell local com `crontab -l` fake se possível; no mínimo, rodar duas vezes e provar que `crontab -l | grep -c event-log-drain` == 1 (idempotência).

- [ ] **Step 4: Commit:**

```bash
git add hostgator-setup-kit/
git commit -m "feat(webhooks): crontab do event-log-drain no kit HostGator"
```

---

### Task 6: E2E Playwright + verificação final

**Files:**
- Create: `tests/e2e/webhooks.spec.ts`

- [ ] **Step 1:** Leia `tests/e2e/utils/` e `tests/e2e/kanban-owner-filter.spec.ts` (login/seed pattern) antes de escrever. O spec:

```ts
// Cenário completo (manager do seed E2E):
// 1. Sidebar mostra "Webhooks"; navegar até /app/webhooks.
// 2. Aba Receber dados: criar fonte "E2E Landing" (pipeline/estágio do seed).
// 3. Na tela da fonte: URL visível contém /api/v1/webhooks/in/;
//    clicar "Enviar lead de teste" → toast de sucesso.
// 4. Aba Automações: criar regra gatilho "contato novo (webhook)" com ação
//    "Adicionar tag" = e2e-tag; ligar o switch (badge vira Ativa).
// 5. Disparar POST direto na URL da fonte via request context do Playwright
//    (nome "Ana E2E", telefone válido) → 200.
// 6. Disparar o drain: request POST /api/v1/cron/event-log-drain com
//    Authorization Bearer INTERNAL_SECRET (ler do env do teste).
// 7. Aba Atividade: run da regra aparece com status de sucesso.
// 8. /app/kanban: card "Ana E2E" existe (e, abrindo, tem a tag e2e-tag).
// 9. Como AGENT (segundo login do seed): sidebar NÃO mostra "Webhooks";
//    goto /app/webhooks redireciona para /app/inbox.
```

- [ ] **Step 2:** Run: `npm run test:e2e -- webhooks.spec.ts` (confira no `package.json` a forma de filtrar spec). Expected: PASS.

- [ ] **Step 3: Definition of Done da feature inteira (checklist do CLAUDE.md):**

Run: `npm run typecheck && npm run lint && npm run test:unit` + suíte de invariantes completa + E2E acima.
Conferir: RLS testada (Parte 1 T1), audit em toda mutação (T6/T12 Parte 1), rate limit na rota pública (T6 Parte 1), Zod em todo input (T6/T12 Parte 1), sem `console.log` novo (`git diff main --stat` + grep), env novas — nenhuma criada (usamos as existentes; se algo mudou, `.env.example` + `lib/env.ts`), migration + MANIFEST + baseline ok (T1 Parte 1), doc: adicionar a seção "Webhooks & Automações" no `README.md` principal (3 parágrafos: o que é, onde fica, como o cron funciona no self-host).

- [ ] **Step 4: Commit final + push:**

```bash
git add tests/e2e/webhooks.spec.ts README.md
git commit -m "feat(webhooks): E2E do fluxo completo + docs"
git push -u origin feat/webhooks-automation
```

---

## Cobertura da spec (self-check do plano — Parte 2)

| Spec § | Task |
|---|---|
| §9 sidebar + permissão | 1 |
| §9 aba Receber dados (empty-state, snippets, lead de teste, feed) | 2 |
| §9 aba Automações (builder, nasce pausada) | 3 |
| §9 aba Atividade (timeline, reenviar) | 4 |
| §6 crontab kit HostGator | 5 |
| §11 E2E + Definition of Done | 6 |

