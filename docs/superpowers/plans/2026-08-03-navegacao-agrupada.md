# Navegação Agrupada — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar três listas de navegação escritas à mão por um registro único, agrupar o sidebar por objetivo, e travar a organização com um teste que falha o CI quando nasce tela sem porta.

**Architecture:** `lib/navigation/registry.ts` vira a fonte única de destinos. Sidebar, hubs (`/app/ai`, `/app/settings`) e a paleta ⌘K passam a ser projeções puras dela. Um teste estático cruza `app/app/**/page.tsx` com o registro nos dois sentidos.

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript estrito · Tailwind · Phosphor (via `lib/ui/icons`) · Vitest.

**Spec:** `docs/superpowers/specs/2026-08-03-navegacao-agrupada-design.md`

## Global Constraints

- **Nenhuma URL muda.** Nenhum arquivo de rota sai do lugar, nenhum redirect é criado (spec §7).
- Ícones **sempre** de `@/lib/ui/icons`, nunca direto de `@phosphor-icons/react` (ADR-05).
- Sem dependência nova. `cmdk` está fora — a paleta usa `components/ui/dialog` + `input` que já existem.
- Copy em pt-BR, para dono de PME. "ANÁLISE", não "Observabilidade".
- `minRole` de cada destino espelha a guarda server-side real da página (spec §4.2).
- Zero `console.log` merged. `pnpm typecheck` e `pnpm lint` zerados ao fim de cada task.
- Commits atômicos por task.

---

## File Structure

**Criar:**

| Arquivo | Responsabilidade |
|---|---|
| `lib/navigation/registry.ts` | Tipos, `NAV_GROUPS`, `NAV_DESTINATIONS`, e as projeções puras (`canSee`, `sidebarGroups`, `hubSections`, `searchable`) |
| `components/shell/NavHub.tsx` | Renderiza um hub seccionado a partir do registro. Consumido por `/app/ai` e `/app/settings` |
| `components/shell/CommandPalette.tsx` | Paleta ⌘K sobre `dialog` + `input` |
| `app/app/ai/page.tsx` | Hub da IA (a rota não existe hoje) |
| `tests/unit/navegacao-registry.test.ts` | Projeções puras |
| `tests/unit/navegacao-completude.test.ts` | **O enforcement**: rota↔registro nos dois sentidos |

**Modificar:**

| Arquivo | Mudança |
|---|---|
| `lib/ui/icons.ts` | +5 ícones: `Funnel`, `BookOpen`, `Key`, `UserCircle`, `ClockCounterClockwise` |
| `components/shell/Sidebar.tsx` | Deriva do registro; 7 `usePermission` e o if-chain de 7 ramos saem |
| `app/app/settings/page.tsx` | Deriva do registro, seccionado por jornada |
| `components/shell/SearchTrigger.tsx` | `console.info` morto → abre a paleta |
| `app/app/ai/layout.tsx` | Remove `<AiSectionTabs />` |
| `app/app/templates/page.tsx` | Título → "Respostas rápidas" |
| `docs/doctrine/sistema-vivo.md` | Linha da porta no Living System Checklist |
| `CLAUDE.md` | Mesma linha no DoD |

**Deletar:** `app/app/ai/_components/AiSectionTabs.tsx` — o hub o substitui; era a causa das 6 telas invisíveis.

---

### Task 1: O registro

**Files:**
- Create: `lib/navigation/registry.ts`, `tests/unit/navegacao-registry.test.ts`
- Modify: `lib/ui/icons.ts`

**Interfaces produzidas** (o resto do plano depende destes nomes exatos):

```ts
export type NavGroupId = "atendimento" | "crm" | "ia" | "canais" | "analise" | "organizacao";

export interface NavGroup { id: NavGroupId; label: string; hub?: string }

export interface NavDestination {
  href: string;
  label: string;
  description: string;
  icon: PhosphorIcon;
  group: NavGroupId;
  section?: string;
  minRole?: Role;      // ausente = viewer
  sidebar?: boolean;   // ausente = false
  healthDot?: boolean;
}

export const NAV_GROUPS: NavGroup[];
export const NAV_DESTINATIONS: NavDestination[];

export function canSee(d: NavDestination, isPlatformAdmin: boolean, role: Role | null): boolean;
export function sidebarGroups(isPlatformAdmin: boolean, role: Role | null): Array<{ group: NavGroup; items: NavDestination[] }>;
export function hubSections(group: NavGroupId, isPlatformAdmin: boolean, role: Role | null): Array<{ section: string; items: NavDestination[] }>;
export function searchable(isPlatformAdmin: boolean, role: Role | null): NavDestination[];
```

`canSee` é a única lógica de permissão: `isPlatformAdmin || (role && ROLE_RANK[role] >= ROLE_RANK[d.minRole ?? "viewer"])`. É ela que dispensa os sete hooks do Sidebar.

**Conteúdo do registro** — grupos na ordem da spec §5; `sidebar: true` só no uso diário:

| group | label | hub |
|---|---|---|
| atendimento | ATENDIMENTO | — |
| crm | CRM | — |
| ia | AGENTE DE IA | `/app/ai` |
| canais | CANAIS | — |
| analise | ANÁLISE | — |
| organizacao | ORGANIZAÇÃO | `/app/settings` |

Destinos (`minRole` medido em spec §4.2; `S` = `sidebar: true`):

```
atendimento  S /app/inbox              Inbox              viewer   Tray
atendimento  S /app/radar              Radar              viewer   ClockCountdown
atendimento  S /app/templates          Respostas rápidas  viewer   FileText
crm          S /app/kanban             Kanban             viewer   Kanban
crm          S /app/contacts           Contatos           viewer   Users
crm          S /app/settings/tenant/pipelines  Funis      manager  Funnel
ia           S /app/ai/agents          Agentes            manager  Robot      §Montar
ia           S /app/ai/followups       Follow-ups         manager  FlowArrow  §Montar
ia           S /app/ai/routers         Roteadores         manager  Signpost   §Montar
ia             /app/ai/credentials     Credenciais        manager  Key        §Montar
ia             /app/ai/knowledge/sources Conhecimento     manager  BookOpen   §Ensinar
ia             /app/ai/memory          Memória            manager  Brain      §Ensinar
ia             /app/ai/skills          Skills             manager  PuzzlePiece §Ensinar
ia             /app/ai/cases           Casos              agent    ClipboardText §Acompanhar
ia             /app/ai/inbox           Alertas            agent    Flag       §Acompanhar
ia             /app/ai/usage           Uso e orçamento    manager  Gauge      §Acompanhar
canais       S /app/connections        Conexões           admin    PlugsConnected  healthDot
canais       S /app/integrations/nuvemshop  Nuvemshop     admin    Storefront
canais       S /app/webhooks           Webhooks           manager  WebhooksLogo
analise      S /app/metrics            Desempenho         viewer   ChartBar
analise      S /app/ai/evolution       Evolução da IA     manager  ChartLineUp
analise      S /app/audit              Audit Log          manager  ClockCounterClockwise
organizacao  S /app/team               Equipe             viewer   UsersThree   §Sua empresa
organizacao    /app/settings/tenant    Organização        admin    Buildings    §Sua empresa
organizacao    /app/settings/billing   Billing            viewer   Receipt      §Sua empresa
organizacao    /app/settings/profile   Perfil             viewer   UserCircle   §Sua conta
organizacao    /app/settings/security  Segurança          viewer   ShieldCheck  §Sua conta
organizacao    /app/settings/notifications Notificações   viewer   Bell         §Sua conta
organizacao    /app/lgpd/requests      LGPD               admin    ScalesSimple §Dados e acesso
organizacao    /app/settings/api-tokens API Tokens        admin    Lock         §Dados e acesso
```

Seções: IA usa `Montar o agente` / `Ensinar o agente` / `Acompanhar o agente`. Organização usa `Sua conta` / `Sua empresa` / `Dados e acesso`. O link do hub de Organização (`Configurações`) é injetado pelo sidebar a partir de `NavGroup.hub`, não é um destino duplicado.

- [ ] **Passo 1** — adicionar os 5 ícones em `lib/ui/icons.ts`, mantendo os comentários de seção do arquivo.
- [ ] **Passo 2** — escrever `tests/unit/navegacao-registry.test.ts` cobrindo: (a) `canSee` nega manager em destino admin e aceita platform admin sempre; (b) `sidebarGroups` devolve só `sidebar:true`, na ordem de `NAV_GROUPS`, e **omite grupo que ficou vazio** pela permissão; (c) `hubSections("ia", …)` devolve as 3 seções na ordem declarada; (d) href duplicado no registro é erro.
- [ ] **Passo 3** — rodar: `pnpm vitest run tests/unit/navegacao-registry.test.ts`. Esperado: **FAIL** (módulo não existe).
- [ ] **Passo 4** — escrever `lib/navigation/registry.ts`.
- [ ] **Passo 5** — rodar o mesmo comando. Esperado: **PASS**.
- [ ] **Passo 6** — `pnpm typecheck && pnpm lint`; commit `feat(nav): registro único de navegação`.

---

### Task 2: O teste que impede a bagunça de voltar

**Files:** Create `tests/unit/navegacao-completude.test.ts`

**Consumes:** `NAV_DESTINATIONS` (Task 1).

O teste é o núcleo do pedido "não quero reorganizar toda vez". Dois sentidos:

1. **Toda rota tem porta** — varre `app/app/**/page.tsx`, deriva a rota, ignora segmentos dinâmicos (`[id]`) e o que está em `NAV_ALLOWLIST`. Falha se sobrar rota fora do registro.
2. **Todo destino existe** — falha se um `href` do registro não tiver `page.tsx` correspondente (link morto).

**Escopo: `app/app/**` apenas.** O admin de plataforma (`app/admin/`), o onboarding (`app/onboarding/`) e as páginas públicas têm navegação própria e ficam fora — verificado: nenhum deles vive sob `app/app/`.

`NAV_ALLOWLIST` mora no próprio teste, com **um comentário por entrada** explicando por que aquela rota não é destino de navegação. Entradas iniciais, todas verificadas no HEAD:

- `/app` — `app/app/page.tsx` é `redirect("/app/inbox")`
- `/app/settings/tenant/whatsapp` — redirect legado para `/app/connections`
- `/app/team/invite` — sub-fluxo alcançado de dentro de Equipe

Rotas com `[` no path são ignoradas por regra, não por allowlist.

- [ ] **Passo 1** — escrever o teste.
- [ ] **Passo 2** — rodar: `pnpm vitest run tests/unit/navegacao-completude.test.ts`. Esperado: **PASS**.
- [ ] **Passo 3 — provar que morde.** Comentar uma entrada do registro (ex.: `/app/ai/usage`), rodar de novo. Esperado: **FAIL** nomeando a rota órfã. Restaurar. *Um teste que nunca ficou vermelho não provou nada* — este passo não é opcional.
- [ ] **Passo 4** — commit `test(nav): CI falha quando nasce tela sem porta`.

---

### Task 3: Sidebar agrupado

**Files:** Modify `components/shell/Sidebar.tsx`; Create `tests/unit/sidebar-grupos.test.tsx`

**Consumes:** `sidebarGroups` (Task 1).

Some do arquivo: `NAV_ITEMS`, os 7 `usePermission`, o if-chain de 7 ramos (linhas 44-50 e 86-94 do original). Entra: um `useAuth()` e `sidebarGroups(user.is_platform_admin, activeOrg?.role ?? null)`.

Preservar sem regressão: logo/branding (`branding()`, incluindo o comentário do `<img>` sobre o self-hoster), estado colapsado, `ConnectionHealthDot` em Conexões, `aria-current`, `title` no modo colapsado.

**Colapsado:** os títulos de grupo somem (viram `<hr>` separador), os ícones ficam — 6 títulos em 64px de largura seria ilegível.

- [ ] **Passo 1** — teste: renderiza títulos na ordem certa; um `agent` não vê o grupo CANAIS inteiro (todos os destinos são manager+); colapsado não renderiza título nenhum.
- [ ] **Passo 2** — rodar. Esperado: **FAIL**.
- [ ] **Passo 3** — reescrever o Sidebar.
- [ ] **Passo 4** — rodar. Esperado: **PASS**. `pnpm typecheck && pnpm lint`.
- [ ] **Passo 5** — commit `feat(nav): sidebar agrupado por objetivo`.

---

### Task 4: Hubs por jornada

**Files:** Create `components/shell/NavHub.tsx`, `app/app/ai/page.tsx`; Modify `app/app/settings/page.tsx`, `app/app/ai/layout.tsx`; Delete `app/app/ai/_components/AiSectionTabs.tsx`

**Consumes:** `hubSections` (Task 1).

`NavHub` recebe `{ group, title, subtitle }`, resolve papel via `requireAuth`/`resolveActiveOrg` no server, e renderiza seções com `<h2>` + grade de cards (label + description), seguindo o card que o `settings/page.tsx` já usa — não inventar visual novo.

`app/app/settings/page.tsx` vira uma chamada de `NavHub group="organizacao"`; o `LINKS` hardcoded e os cards duplicados (Conexões, Audit Log) somem.

`app/app/ai/layout.tsx` perde `<AiSectionTabs />`. Confirmar que `/app/ai` não colide com rota existente antes de criar a page.

- [ ] **Passo 1** — teste `tests/unit/nav-hub.test.tsx`: hub de IA renderiza as 3 seções na ordem e não mostra destino acima do papel.
- [ ] **Passo 2** — rodar. Esperado: **FAIL**.
- [ ] **Passo 3** — implementar `NavHub`, criar `/app/ai/page.tsx` (verificado: não existe hoje, sem colisão), reescrever `settings/page.tsx`, limpar o layout, deletar `AiSectionTabs.tsx`.
- [ ] **Passo 4** — rodar suite + `pnpm typecheck && pnpm lint`. O teste da Task 2 deve continuar verde (o hub novo `/app/ai` precisa estar no registro como `hub`, não como destino — ajustar allowlist se necessário, **com comentário**).
- [ ] **Passo 5** — commit `feat(nav): hubs de IA e Organização por jornada`.

---

### Task 5: ⌘K vivo

**Files:** Create `components/shell/CommandPalette.tsx`; Modify `components/shell/SearchTrigger.tsx`; Create `tests/unit/command-palette.test.tsx`

**Consumes:** `searchable` (Task 1).

Sobre `components/ui/dialog` + `input`. Sem `cmdk`. Busca case/acento-insensível em `label + description`; ↑↓ move, Enter navega (`router.push`), Esc fecha. Vazio mostra os destinos do grupo Atendimento como ponto de partida.

Escopo v1: **só navegação** — não busca contato, conversa nem lead.

Acessibilidade não é opcional: `role="dialog"`, foco no input ao abrir, foco devolvido ao gatilho ao fechar, `aria-activedescendant` no item destacado.

- [ ] **Passo 1** — teste: digitar "conhec" encontra "Conhecimento"; digitar "orcamento" (sem acento) encontra "Uso e orçamento"; um `agent` não vê resultado que exige admin.
- [ ] **Passo 2** — rodar. Esperado: **FAIL**.
- [ ] **Passo 3** — implementar a paleta; `SearchTrigger` passa a abri-la (o `console.info` e o `eslint-disable` saem juntos).
- [ ] **Passo 4** — rodar. Esperado: **PASS**. `pnpm typecheck && pnpm lint`.
- [ ] **Passo 5** — commit `feat(nav): ⌘K deixa de ser promessa vazia`.

---

### Task 6: Respostas rápidas + doutrina

**Files:** Modify `app/app/templates/page.tsx`, `docs/doctrine/sistema-vivo.md`, `CLAUDE.md`

Título e subtítulo de `/app/templates` → "Respostas rápidas" (spec §5.1: libera o nome "Templates" para o da Meta, que o PR #105 traz). A URL **não** muda.

No Living System Checklist e no DoD, a linha que faltava:

```
[ ] Por qual porta se chega até mim?  (entrada no registro de navegação, ou allowlist justificada)
```

Registrar em `sistema-vivo.md` que o enforcement mecânico previsto na linha 111 **foi acionado** — com o motivo (7 telas alcançáveis só por dentro, 1 órfã) e o artefato (`navegacao-completude.test.ts`), atualizando a tabela de Enforcement.

- [ ] **Passo 1** — aplicar as três edições.
- [ ] **Passo 2** — `pnpm typecheck && pnpm lint`; commit `docs(nav): a doutrina passa a exigir a porta, não só a tela`.

---

### Task 7: Prova pela tela (DoD item 12)

**Files:** Create `tests/e2e/navegacao.spec.ts`

`curl` não conta — a doutrina de QA Visual exige prova pela tela, como um leigo faria.

- [ ] **Passo 1** — subir ambiente: `next build` + `next start` (não `next dev`), banco do `baseline.sql`, seed via `scripts/seed-e2e-credentials.ts`.
- [ ] **Passo 2** — spec E2E que loga e prova, **pela tela**: (a) os 6 títulos de grupo aparecem na ordem; (b) "Funis" é alcançável **sem passar por Configurações**; (c) "Conhecimento" é alcançável a partir do hub de IA; (d) ⌘K abre, filtra e navega.
- [ ] **Passo 3** — rodar; screenshot do sidebar novo e do hub de IA em `.superpowers/evidence/`.
- [ ] **Passo 4** — rodar a suíte unit inteira + `pnpm typecheck` + `pnpm lint`.
- [ ] **Passo 5** — commit `test(nav): prova pela tela do sidebar agrupado e dos hubs`.

---

## Ordem e dependências

Task 1 destrava tudo. 2→3→4→5 dependem só dela e podem ser feitas na ordem escrita. 6 é independente. 7 fecha, depois de 3, 4 e 5.

## Definition of Done

Os 9 critérios da spec §12, mais: `pnpm test:unit` verde, `pnpm typecheck` e `pnpm lint` zerados, evidência visual em `.superpowers/evidence/`.

**Não fazer push.** O repo tem hook de governança (`DESKCOMM_GOV_PHASE_MERGE`) e push é decisão do Rafael.
