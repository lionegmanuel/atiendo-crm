# Fase 3a — Contrato de Templates da Meta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar os dois erros de parâmetro da Meta (`132000` contagem, `132012` formato) **inalcançáveis pelo caminho normal**, e dar aos templates a superfície de tela que o invariante 6 do sistema vivo exige.

**Architecture:** O template hospedado na Meta é o schema. O contrato de parâmetros é **derivado** dele por função pura (`deriveTemplateContract`, já escrita e testada na Fase 3a-spike) e alimenta **dois consumidores**: o formulário da tela e o montador do payload de envio. Ninguém digita quantidade de parâmetro em lugar nenhum. Configs apontam para o template por `contract_hash`; hash divergente = config obsoleta, que vira trabalho visível em vez de erro em produção.

**Tech Stack:** Next.js 16 App Router, TypeScript 6 estrito, Supabase/Postgres com RLS, Vitest, Playwright.

## Global Constraints

- **Nada de redigitar contrato.** Se aparecer em qualquer lugar (tela, jsonb, tipo) um campo "número de parâmetros", "quantidade de variáveis" ou equivalente, o desenho vazou. O contrato só existe derivado.
- **Uma derivação, dois consumidores.** Formulário e sender chamam a MESMA `deriveTemplateContract`. Um segundo caminho de derivação é o defeito original com outra roupa.
- Toda mudança de schema: migration versionada **+** apêndice idempotente em `supabase/baseline.sql` **+** linha no `MANIFEST.md`. **Próximo NNNN = `0088`** — medido em TODAS as branches locais (`0085` e `0086` estão em `feat/operacao-visivel`, `0087` é o desta branch). Antes de fixar o número, re-meça:
  `for b in $(git branch --format='%(refname:short)'); do git ls-tree -r --name-only "$b" -- supabase/migrations/; done | grep -oE '_0[0-9]{3}_' | sort -u | tail -1`
- `pnpm typecheck` e `pnpm lint` zerados por task. **`set -o pipefail` + `$?`; nunca `${PIPESTATUS[0]}`** (no zsh vira vazio).
- **`pnpm run test:unit -- <filtro>` é falso verde** — use `pnpm exec vitest run <filtro>`.
- **1 vermelho herdado da `main`** (`evidencia-citada` > `lp-prompts-imagens.md`), roteado ao autor. Régua: **1088 ✓ / 1 ✗**.
- Commits atômicos por task. Toda task alimenta `docs/handoffs/HANDOFF-canais-oficial.md`.
- Nenhum nome de provider fora de `lib/channels/` — `pnpm exec tsx scripts/lint-channels.ts` é catraca: a dívida (53 arquivos) só pode encolher.

## O que já existe (Fase 3a-spike, commits `93a3a91`/`6763f60`/`e8b43b5`)

| Artefato | Estado |
|---|---|
| `lib/channels/meta/template-contract.ts` | `deriveTemplateContract` + `describeAddress`, endereço recursivo, `parameterFormat` |
| `tests/unit/meta-template-contract.test.ts` | 8 casos contra payload real, sabotagens verificadas |
| `tests/fixtures/meta/message-templates.json` | os 5 templates reais da WABA de teste |
| `scripts/spike-template-contract.ts` | imprime o contrato derivado de cada um |
| `evidence/canais/fase3a/prova-erros-meta.md` | 132000 / 132012 / OK medidos contra a API |

**Este plano NÃO reescreve nada disso.** Ele constrói em cima.

## Os fatos medidos que o desenho assume

- **132000** = contagem (`body: localizable_params (2) ... expected (3)`).
- **132012** = formato (`header: Format mismatch, expected IMAGE, received UNKNOWN`).
- **Contar `{{n}}` previne só o 132000.** Nos 5 templates reais: contagem ingênua acha 3 parâmetros, derivação acha 6.
- `example` vem **null** nos templates reais → o rótulo do campo na tela só pode vir do `contextBefore`/`contextAfter`.
- `parameter_format` é declarado pela Meta (`POSITIONAL`/`NAMED`) e **muda o payload**: `NAMED` exige `parameter_name` em cada parâmetro.
- A WABA de teste responde em `v22.0`; o dashboard gera `v25.0`. Alinhar é item da Task 5.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/<ts>_0088_meta_templates.sql` | **Criar.** Tabela `meta_templates` + RLS. |
| `lib/channels/meta/template-sync.ts` | **Criar.** Busca na Graph API → linhas locais + `contract_hash`. Puro na parte de transformação. |
| `lib/channels/meta/contract-hash.ts` | **Criar.** `hashContract(components)` canônico e estável. |
| `lib/channels/meta/build-components.ts` | **Criar.** Contrato + valores → `components[]` do payload. O 2º consumidor da derivação. |
| `app/api/v1/webhooks/meta/[token]/route.ts` | **Criar.** Verificação `hub.challenge` (GET) + HMAC SHA256 (POST). |
| `app/api/v1/channels/templates/route.ts` | **Criar.** Lista para a tela; dispara sync. |
| `app/app/settings/templates/page.tsx` + `_client.tsx` | **Criar.** A superfície (invariante 6). |
| `lib/channels/meta/template-binding.ts` | **Criar.** `bindingIsStale(saved, current)` — a trava por hash. |

---

## Task 1: `hashContract` — a âncora da trava

**Files:**
- Create: `lib/channels/meta/contract-hash.ts`
- Test: `tests/unit/meta-contract-hash.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `hashContract(components: unknown): string` — SHA-256 hex de uma serialização canônica.

> Por que primeiro: tudo depois depende dele. E um hash instável (que muda por reordenação de chaves do JSON) transformaria toda config em obsoleta a cada sync — a trava viraria alarme falso permanente, e alguém a desligaria.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// tests/unit/meta-contract-hash.test.ts
import { describe, expect, it } from "vitest";
import { hashContract } from "@/lib/channels/meta/contract-hash";

describe("hashContract", () => {
  it("é estável a reordenação de chaves — senão toda config vira obsoleta a cada sync", () => {
    const a = [{ type: "BODY", text: "Oi {{1}}" }];
    const b = [{ text: "Oi {{1}}", type: "BODY" }];
    expect(hashContract(a)).toBe(hashContract(b));
  });

  it("muda quando um placeholder é ACRESCENTADO", () => {
    const antes = [{ type: "BODY", text: "Oi {{1}}" }];
    const depois = [{ type: "BODY", text: "Oi {{1}}, pedido {{2}}" }];
    expect(hashContract(antes)).not.toBe(hashContract(depois));
  });

  it("muda quando o FORMATO do header muda (o caso do 132012)", () => {
    const texto = [{ type: "HEADER", format: "TEXT", text: "Oi" }];
    const imagem = [{ type: "HEADER", format: "IMAGE" }];
    expect(hashContract(texto)).not.toBe(hashContract(imagem));
  });

  it("é estável a mudança de texto que NÃO afeta parâmetro", () => {
    // Corrigir uma vírgula no corpo não deve invalidar a config de ninguém.
    const a = [{ type: "BODY", text: "Olá {{1}}, tudo bem?" }];
    const b = [{ type: "BODY", text: "Olá {{1}} tudo bem?" }];
    expect(hashContract(a)).toBe(hashContract(b));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm exec vitest run meta-contract-hash
```

Expected: `Failed to resolve import "@/lib/channels/meta/contract-hash"`.

- [ ] **Step 3: Implementar**

O 4º caso decide o desenho: **o hash não é do JSON cru — é do CONTRATO DERIVADO.** Serialize os `slots` de `deriveTemplateContract` (endereço + key + expects, em ordem) mais o `parameterFormat`, e tire SHA-256 disso. Texto que não muda parâmetro não muda hash; formato de header muda.

```ts
import { createHash } from "node:crypto";
import { deriveTemplateContract } from "./template-contract";

export function hashContract(components: unknown): string {
  const { slots, parameterFormat } = deriveTemplateContract({
    name: "", language: "", components: components as never,
  });
  const canonical = JSON.stringify({
    parameterFormat,
    slots: slots.map((s) => [s.address, s.key, s.expects]),
  });
  return createHash("sha256").update(canonical).digest("hex");
}
```

- [ ] **Step 4: Verde + sabotar**

```bash
pnpm exec vitest run meta-contract-hash     # 4 passed
```

Sabote: faça o hash usar `JSON.stringify(components)` cru → o 1º e o 4º caso vermelham. Restaure.

- [ ] **Step 5: Commit**

```bash
git add lib/channels/meta/contract-hash.ts tests/unit/meta-contract-hash.test.ts docs/handoffs/HANDOFF-canais-oficial.md
git commit -m "feat(canais): hash do contrato derivado, estável a texto e sensível a parâmetro"
```

---

## Task 2: `buildComponents` — o segundo consumidor

**Files:**
- Create: `lib/channels/meta/build-components.ts`
- Test: `tests/unit/meta-build-components.test.ts`

**Interfaces:**
- Consumes: `TemplateContract`, `ParamSlot` (Fase 3a-spike).
- Produces: `buildComponents(contract, values: Record<string, string>): MetaComponent[]` e `missingSlots(contract, values): ParamSlot[]`.

> Este é o consumidor que fecha o buraco. O formulário e este montador leem **os mesmos slots** — divergir vira impossível por construção. Se você se pegar reinterpretando `components` aqui, parou de usar a derivação.

- [ ] **Step 1: Escrever o teste que falha**

Use os templates reais da fixture. Os três casos que espelham os erros medidos:

```ts
// tests/unit/meta-build-components.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deriveTemplateContract } from "@/lib/channels/meta/template-contract";
import { buildComponents, missingSlots } from "@/lib/channels/meta/build-components";

const FIXTURE = JSON.parse(readFileSync("tests/fixtures/meta/message-templates.json", "utf8"));
const tpl = (n: string) => FIXTURE.data.find((t: { name: string }) => t.name === n);

describe("buildComponents", () => {
  it("3 valores no corpo viram UM componente body com 3 parameters (evita 132000)", () => {
    const c = deriveTemplateContract(tpl("jaspers_market_order_confirmation_v1"));
    const out = buildComponents(c, { "1": "Rafael", "2": "DESK-001", "3": "30/07" });
    expect(out).toEqual([
      { type: "body", parameters: [
        { type: "text", text: "Rafael" },
        { type: "text", text: "DESK-001" },
        { type: "text", text: "30/07" },
      ]},
    ]);
  });

  it("header de mídia vira componente header (evita 132012)", () => {
    const c = deriveTemplateContract(tpl("jaspers_market_image_cta_v1"));
    const out = buildComponents(c, { "header:1": "https://x.com/a.jpg" });
    expect(out).toEqual([
      { type: "header", parameters: [{ type: "image", image: { link: "https://x.com/a.jpg" } }] },
    ]);
  });

  it("carrossel monta cards com card_index próprio", () => {
    const c = deriveTemplateContract(tpl("jaspers_market_media_carousel_v1"));
    const out = buildComponents(c, { "card0:header:1": "https://x/1.jpg", "card1:header:1": "https://x/2.jpg" });
    expect(out).toEqual([
      { type: "carousel", cards: [
        { card_index: 0, components: [{ type: "header", parameters: [{ type: "image", image: { link: "https://x/1.jpg" } }] }] },
        { card_index: 1, components: [{ type: "header", parameters: [{ type: "image", image: { link: "https://x/2.jpg" } }] }] },
      ]},
    ]);
  });

  it("valor faltando é reportado como slot, nunca enviado incompleto", () => {
    const c = deriveTemplateContract(tpl("jaspers_market_order_confirmation_v1"));
    expect(missingSlots(c, { "1": "Rafael" }).map((s) => s.key)).toEqual(["2", "3"]);
  });

  it("NAMED põe parameter_name; POSITIONAL não", () => {
    const named = deriveTemplateContract({
      name: "x", language: "pt_BR", parameter_format: "NAMED",
      components: [{ type: "BODY", text: "Oi {{nome}}" }],
    });
    expect(buildComponents(named, { nome: "Rafael" })).toEqual([
      { type: "body", parameters: [{ type: "text", parameter_name: "nome", text: "Rafael" }] },
    ]);
  });
});
```

> **A chave de `values` precisa endereçar o slot, não só a `key`.** Um carrossel de 2 cards tem dois slots com `key: '1'`. Defina e documente a convenção (`card0:header:1`) numa função `slotKey(address, key)` exportada, e **use a mesma função no formulário** — chave montada de dois jeitos diferentes é o mismatch voltando pela porta dos fundos.

- [ ] **Step 2: Rodar e ver falhar** — `pnpm exec vitest run meta-build-components`

- [ ] **Step 3: Implementar** `slotKey`, `buildComponents`, `missingSlots`.

- [ ] **Step 4: Verde + sabotar**

Sabote: ignore o ramo de card (monte tudo plano) → o caso do carrossel vermelha. Ignore `parameterFormat` → o caso NAMED vermelha. Restaure.

- [ ] **Step 5: Prova contra a API real (é barata e vale mais que o unit)**

Com o destinatário `5531998966398` já registrado, monte o payload com `buildComponents` e envie de verdade:

```bash
pnpm exec tsx scripts/spike-send-template.ts   # criar neste step
```

Envie os 3 params corretos → espere `wamid.…`. Depois omita um → espere **132000**. Grave a saída em `evidence/canais/fase3a/envio-real-buildcomponents.txt`.

Isto fecha o ciclo: o payload que a nossa derivação monta é aceito pela Meta.

- [ ] **Step 6: Commit**

---

## Task 3: Tabela `meta_templates` + sync

**Files:**
- Create: `supabase/migrations/<ts>_0088_meta_templates.sql`
- Modify: `supabase/baseline.sql` (apêndice `-- ---- meta templates (migration 0088) ----`), `supabase/migrations/MANIFEST.md`
- Create: `lib/channels/meta/template-sync.ts`
- Test: `tests/unit/meta-template-sync.test.ts`, `tests/invariants/meta-templates-rls.test.ts`

**Interfaces:**
- Consumes: `hashContract` (Task 1).
- Produces: `syncTemplates(orgId, waba, token): Promise<{ inserted; updated; unchanged }>`; linhas em `meta_templates`.

- [ ] **Step 1: Migration**

```sql
create table if not exists public.meta_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  waba_id text not null,
  name text not null,
  language text not null,
  status text not null,                 -- APPROVED | PENDING | REJECTED | PAUSED | DISABLED
  category text,
  rejected_reason text,
  quality_score text,
  components jsonb not null,
  contract_hash text not null,
  parameter_format text not null default 'POSITIONAL',
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- (name, language) é a CHAVE — nunca só name. pt_BR e pt são templates distintos.
create unique index if not exists meta_templates_org_name_lang_uniq
  on public.meta_templates (organization_id, waba_id, name, language);
alter table public.meta_templates enable row level security;
```

RLS `tenant_isolation_meta_templates_all` via `fn_user_org_ids()`, como as demais tabelas tenant-aware.

`status` fica **sem CHECK** — é vocabulário ABERTO da Meta (ela pode criar estado novo), e a doutrina do repo diz que CHECK em vocabulário aberto quebra o `update.sh` do clone. Vocabulário vive no TypeScript; a coluna fica **fora** do invariante `vocabulario-banco-x-typescript.test.ts` (leia o cabeçalho dele antes de "completar" o schema).

- [ ] **Step 2: Aplicar, provar antes/depois, espelhar no baseline nos 2 modos**

```bash
psql "$DATABASE_URL" -c "select count(*) from meta_templates"   # deve existir, 0 linhas
docker run -d --name pgtest -e POSTGRES_PASSWORD=x -p 55432:5432 pgvector/pgvector:pg17
psql "postgres://postgres:x@localhost:55432/postgres" -v ON_ERROR_STOP=1 -f supabase/baseline.sql  # install
psql "postgres://postgres:x@localhost:55432/postgres" -f supabase/baseline.sql                     # update
pnpm test:db
```

- [ ] **Step 3: `syncTemplates`, com a transformação PURA e testável**

Separe: `templatesToRows(apiPayload, orgId, wabaId)` puro (testável com a fixture real) + a casca que faz fetch e upsert. Upsert por `(org, waba, name, language)`.

**Não apague template que sumiu da Meta** — marque `status='DISABLED'`. Apagar quebraria a config que aponta pra ele sem deixar rastro; marcar transforma em item visível (invariante 6).

- [ ] **Step 4: Verde + sabotar + commit**

---

## Task 4: Webhook da Meta

**Files:**
- Create: `app/api/v1/webhooks/meta/[token]/route.ts`
- Create: `lib/channels/meta/webhook.ts`
- Test: `tests/unit/meta-webhook.test.ts`

**Interfaces:**
- Consumes: `syncTemplates` (Task 3).
- Produces: `verifyMetaSignature(rawBody, header, appSecret): boolean`; handler `GET` (challenge) e `POST` (eventos).

> Siga o padrão de `app/api/v1/webhooks/waha/[token]/route.ts` — token no path, segredo por org, `crypto.timingSafeEqual`. A diferença: a Meta usa **HMAC SHA256** com o **App Secret** no header `X-Hub-Signature-256` (formato `sha256=<hex>`), enquanto o WAHA usa SHA512.

- [ ] **Step 1: Testes que falham**

Casos: (a) `GET` com `hub.mode=subscribe` e `hub.verify_token` correto devolve `hub.challenge` cru; (b) token errado devolve 403; (c) `POST` com assinatura inválida devolve 401 **e não processa**; (d) `message_template_status_update` com `APPROVED` atualiza a linha; (e) evento desconhecido é ignorado com 200 (a Meta re-tenta o que não recebe 200, e re-tentativa infinita de evento que não nos interessa é auto-DDoS).

- [ ] **Step 2–4:** implementar, verde, sabotar (assinatura sempre válida → o caso (c) vermelha).

- [ ] **Step 5: Anti-morte — o sync não pode depender só do webhook**

Rede falha e webhook se perde. Registre um job de reconciliação no `event_log`/cron que re-sincroniza periodicamente. **Sem isso, um webhook perdido deixa a config obsoleta sem ninguém saber** — viola o invariante 4 do sistema vivo.

- [ ] **Step 6: Commit**

---

## Task 5: A tela de templates (invariante 6)

**Files:**
- Create: `app/app/settings/templates/page.tsx`, `_client.tsx`
- Create: `app/api/v1/channels/templates/route.ts`
- Modify: `.env.example` + `lib/env.ts` (nomes das envs `META_*`, sem valor)
- Test: `tests/e2e/templates-screen.spec.ts`

**Interfaces:**
- Consumes: `deriveTemplateContract`, `slotKey` (Task 2), `syncTemplates` (Task 3).
- Produces: a superfície. Sem ela, disparo de template é mecanismo invisível — o que o invariante 6 proíbe.

- [ ] **Step 1: A rota de API** — lista `meta_templates` da org (RLS), com o contrato derivado de cada um. Botão de sync manual chama `syncTemplates`.

- [ ] **Step 2: A tela**

Siga o padrão de `app/app/settings/*` (existem `api-tokens`, `billing`, `notifications`, `profile`, `security`, `tenant` — copie a estrutura de layout de um deles). Requisitos de conteúdo:

- lista com **nome, idioma, status, categoria**; status não-`APPROVED` visualmente distinto e com o motivo quando houver;
- **preview do corpo com os slots destacados**, usando `contextBefore`/`contextAfter` — é o que torna óbvio o que preencher. `example` vem null da Meta, então este é o único rótulo possível;
- para cada template, **quantos slots e onde** (corpo / cabeçalho / botão / card N), usando `describeAddress`;
- estado vazio que ensina: sem WABA configurada, diga o que fazer, não mostre tabela vazia.

**Não** invente campo "número de parâmetros" editável. O número é derivado e só isso.

- [ ] **Step 3: Provar pela tela** (doutrina de QA Visual — `curl` não conta)

Playwright dirigindo o frontend com conta real, contra build fresco (`next build` + `next start`; **rebuild se mexeu em produção**, senão a prova é falso verde). Screenshots em `evidence/canais/fase3a/tela/`. Cada botão criado tem que ser clicado e a ação esperada verificada.

- [ ] **Step 4: Alinhar a versão da Graph API**

O dashboard gera `v25.0`; `.env.local` está em `v22.0` (os experimentos do spike rodaram em v22 e funcionaram). Decida e registre: fixar `META_GRAPH_VERSION` numa versão suportada e documentar a política de bump. Env nova entra em `.env.example` **e** `lib/env.ts`.

- [ ] **Step 5: Commit**

---

## Task 6: A trava por hash

**Files:**
- Create: `lib/channels/meta/template-binding.ts`
- Test: `tests/unit/meta-template-binding.test.ts`

**Interfaces:**
- Consumes: `hashContract` (Task 1).
- Produces: `type TemplateBinding = { name; language; contractHash; values: Record<string,string> }`; `bindingState(binding, current): 'ok' | 'stale' | 'missing' | 'not_approved'`.

> É a peça que impede o erro de voltar depois de tudo pronto. Alguém edita o template na Meta, o body ganha `{{3}}`, e a config salva ontem passa a mandar 2 de 3. Sem esta trava, isso só aparece como erro no envio — que é exatamente o estado atual do TomikCRM.

- [ ] **Step 1: Testes que falham**

```ts
// tests/unit/meta-template-binding.test.ts
import { describe, expect, it } from "vitest";
import { bindingState, type TemplateBinding } from "@/lib/channels/meta/template-binding";

const SALVO: TemplateBinding = {
  name: "pedido_confirmado",
  language: "pt_BR",
  contractHash: "abc123",
  values: { "1": "{{lead.nome}}" },
};
const ATUAL = { name: "pedido_confirmado", language: "pt_BR", contractHash: "abc123", status: "APPROVED" };

describe("bindingState", () => {
  it("hash igual e APPROVED = ok", () => {
    expect(bindingState(SALVO, ATUAL)).toBe("ok");
  });

  it("hash divergente = stale — alguém editou o template na Meta", () => {
    expect(bindingState(SALVO, { ...ATUAL, contractHash: "def456" })).toBe("stale");
  });

  it("template sumiu da Meta = missing", () => {
    expect(bindingState(SALVO, null)).toBe("missing");
  });

  it("template pausado/rejeitado = not_approved, mesmo com hash igual", () => {
    expect(bindingState(SALVO, { ...ATUAL, status: "PAUSED" })).toBe("not_approved");
    expect(bindingState(SALVO, { ...ATUAL, status: "REJECTED" })).toBe("not_approved");
  });

  it("idioma diferente NÃO casa — a chave é (name, language)", () => {
    expect(bindingState(SALVO, { ...ATUAL, language: "pt" })).toBe("missing");
  });
});
```

**Ordem de precedência importa:** `missing` > `not_approved` > `stale` > `ok`. Um template rejeitado E com hash diferente reporta `not_approved` — reconfigurar parâmetros de um template que a Meta recusou é trabalho jogado fora.

- [ ] **Step 2–4:** implementar, verde, sabotar.

- [ ] **Step 5: O estado obsoleto vira trabalho VISÍVEL**

`stale` / `missing` / `not_approved` **não podem falhar em silêncio**. Cada um gera item em `agent_inbox_items` com o diff do que mudou, e aparece na tela da Task 5 marcado. Isto é o invariante 4 + 6 juntos: nenhuma demanda sem próximo passo, nenhuma configuração sem superfície.

- [ ] **Step 6: Commit**

---

## Living System Checklist — Contrato de Templates

```
[ ] Quem me alimenta?  Graph API (sync por webhook + cron de reconciliação)
[ ] Quem eu alimento?  buildComponents (envio), tela de templates, seletor de fallback
                       do follow-up (Fase 4)
[ ] Que atividade/log eu emito?  sync → event_log; binding stale → agent_inbox_items
[ ] Onde eu apareço na tela?  /app/settings/templates — lista, status, preview com slots
[ ] Qual meu mecanismo anti-morte?  cron de reconciliação (webhook perdido não deixa
                                    config obsoleta invisível) + inbox item por stale
[ ] Qual a continuidade IA↔humano?  rejeição da Meta volta ao agente como contexto
                                    (Fase 4, quando o agente propuser template)
[ ] Onde se CONFIGURA o que eu uso?  a própria tela da Task 5 (é a razão dela existir)
[ ] Atualizei o mapa vivo?  docs/architecture/*.json ganha o nó "meta templates" com
                            arestas → envio e → follow-up
```

---

## O que esta fase NÃO faz

- **Não envia por Meta em produção.** O adapter `meta_cloud` é a Fase 3b; aqui só o contrato, o sync e a tela.
- **Não propõe template pelo agente** — Fase 4.
- **Não implementa o gate `messaging-window`** — Fase 4.
- **Não faz onboarding de canal pela tela** — **Fase 5 — credencial por sessão, com tela** (NÃO Embedded Signup; ver `docs/doctrine/restricao-de-canal.md`, seção "Embedded Signup não cabe em self-host"). Credenciais seguem em `.env.local`.
