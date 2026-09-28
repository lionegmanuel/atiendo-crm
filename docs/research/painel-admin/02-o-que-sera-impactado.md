# Investigação B — O que será impactado pelo épico "painel de administração + modo admin"

- **Worktree:** `/Users/rafaelmelgaco/wt/painel-admin`
- **Branch:** `feat/painel-de-administracao` · **SHA:** `b264bd2d65539cb415f09f1e64742cdea6eb719a`
- **`git status --porcelain`:** vazio (árvore limpa) — medido no início e no fim.
- **Régua importante:** `git log --oneline origin/main..HEAD | wc -l` → **0**.
  Esta branch **não tem nenhum commit próprio**: ela é o topo da `main`. Tudo que
  está descrito abaixo é o estado de **produção**, não trabalho em curso.

---

## 0. Correções ao ponto de partida recebido

### 0.1 O painel admin tem 14 telas, não ~10

```console
$ ls app/admin/(protected)/
audit  cadastro  dashboard  google  inbox  incidents  layout.tsx  lgpd
marca  meta  page.tsx  platform-admins  tenants  usage  users
```

Além das 10 citadas, existem **`inbox`**, **`meta`** (App da Meta: chave secreta e
token de verificação do webhook) e **`cadastro`** (quem pode criar conta nesta
instalação). As três últimas são exatamente do tipo "configuração da instalação
que hoje se muda pelo `.env`" — ou seja, **o painel que o épico quer criar já
começou a existir**, sem nome e sem doutrina declarada.

### 0.2 "Ninguém chega no admin" — CONFIRMADO, com uma exceção que o ponto de partida não tinha

```console
$ grep -rn 'href="/admin' app components lib --include='*.tsx' --include='*.ts'
app/admin/(protected)/tenants/_client.tsx:35
app/admin/(protected)/lgpd/requests/[id]/_client.tsx:265
app/admin/(protected)/audit/[entryId]/_client.tsx:105
app/admin/(protected)/incidents/[id]/_client.tsx:73
app/admin/(protected)/incidents/[id]/_client.tsx:91
app/admin/(protected)/tenants/[id]/layout.tsx:79
app/admin/(protected)/users/[id]/_client.tsx:102
app/admin/(protected)/users/[id]/_client.tsx:119
components/shell/TenantSwitcher.tsx:94          ← ÚNICA porta vinda do app do tenant
components/admin/lgpd/LgpdRiskBanner.tsx:46
```

```console
$ grep -n 'admin' lib/navigation/registry.ts ; echo exit=$?
exit=1
```

A porta existe, mas é **uma só e está escondida**: `components/shell/TenantSwitcher.tsx:94`,
item `"Gerenciar organizações"` dentro do dropdown do seletor de organização,
condicionado a `user.is_platform_admin` (`TenantSwitcher.tsx:93`). E o seletor
inteiro só renderiza sob `if (user.organizations.length <= 1 && !user.is_platform_admin) return null;`
(`TenantSwitcher.tsx:40`).

Consequências para o desenho:
1. O rótulo mente sobre o destino — "Gerenciar organizações" leva a `/admin/tenants`,
   uma tela de 14, não ao painel.
2. Numa instalação self-host com **uma** organização, o dono é platform admin (o
   `install.sh` o promove), então o switcher aparece **só** por causa dele — um
   componente de troca de tenant exibido a quem não tem tenant para trocar.
3. O ponto de partida ("o único `href="/admin"` parte de dentro do próprio admin")
   estava errado por um; a correção **não** enfraquece a tese do épico, reforça:
   a única porta que existe é acidental.

### 0.3 As extensões NÃO são zero — estão em produção na `main`

Esta é a correção de maior impacto no recorte do épico. Ver §7.

---

## 1. O admin de hoje, por dentro

### 1.1 As duas camadas de layout

`app/admin/layout.tsx:1-12` é **deliberadamente vazio** (`return <>{children}</>`),
e o comentário diz o porquê: `app/admin/forbidden` é irmão do grupo `(protected)`
e precisa renderizar **sem** chamar `requirePlatformAdmin`, senão o redirect de
negação cai em loop.

`app/admin/(protected)/layout.tsx:6-20` é onde mora o gate e a casca:

```tsx
const { user } = await requirePlatformAdmin();
const locale = (user.user_metadata?.locale as string | undefined) ?? null;
return (<IdiomaProvider locale={locale}><AdminShell userEmail={user.email ?? ""}>{children}</AdminShell></IdiomaProvider>);
```

O comentário das linhas 8-14 registra um fato que o épico vai herdar:
**"um admin de plataforma é a MESMA conta que o dono do tenant (o install.sh
promove o dono a platform admin)"**. Não há dois usuários, há dois *modos* da
mesma pessoa — que é exatamente a premissa de um "modo admin", e não de um
"login de admin".

### 1.2 O gate exato — `lib/auth/requirePlatformAdmin.ts`

| Passo | Linha | O quê |
|---|---|---|
| 1 | `:37-42` | `supabase.auth.getUser()` (JWT validado no servidor). Sem user → `redirect("/login?next=/admin")` |
| 2 | `:45-54` | `select` em `platform_admins` filtrando `.is("revoked_at", null)`. Sem linha → `redirect("/admin/forbidden")` |
| 3 | `:56-61` | Se `paRow.mfa_required`, exige `mfa.getAuthenticatorAssuranceLevel().currentLevel === "aal2"`; senão → `redirect("/login/mfa?next=/admin")` |

Devolve `{ user, platformAdmin: { user_id, scope, mfa_required } }`.
O campo **`scope`** existe na tabela e é lido (`:47`, `:67`) mas **nada no gate o
consulta** — nenhum `if` sobre `scope` em todo o arquivo. É um eixo de
autorização já modelado no banco e não exercido; se o painel novo precisar de
"pode mexer em credencial" vs "só lê", `scope` é o lugar que já existe.

O cabeçalho (`:14-17`) afirma que **o middleware já faz um check antecipado via
RPC `fn_is_platform_admin`** e que este helper é a validação autoritativa. Duas
camadas, então: qualquer porta nova para `/admin` passa pelas duas.

Detalhe do cabeçalho que **diverge da doutrina em vigor**: `:7` diz
*"Enforce MFA AAL2 if `mfa_required` (default true for platform admins)"*. O
`CLAUDE.md` do projeto diz que o padrão de `platform_admins.mfa_required` é
**não exigir**, e que o `bootstrap-owner.ts` grava `false` explícito. É prosa de
estado vencida dentro do próprio guard — ver §6.

### 1.3 Quem não é platform admin — `app/admin/forbidden/page.tsx`

Tela terminal, sem o guard (`:11-14` explica que ela é o próprio destino do
redirect). Resolve idioma direto do `user_metadata.locale` porque está fora do
`IdiomaProvider`. Oferece dois botões: `/` e `/app` (`:34-39`).

O texto (`:28-31`) afirma *"Esta área é restrita a administradores da plataforma
**com MFA ativo**"* — a segunda metade é falsa hoje: quem chega aqui chegou por
não ter linha em `platform_admins` (`requirePlatformAdmin.ts:52-54`); quem tem
linha mas não tem `aal2` é mandado para `/login/mfa`, nunca para cá. Mensagem que
descreve a causa errada.

### 1.4 A navegação DENTRO do admin — `components/admin/AdminSidebar.tsx`

É uma **lista própria, hard-coded**: `const NAV_ITEMS: NavItem[]` em
`AdminSidebar.tsx:33-59`, 14 entradas, cada uma `{ href, label, icon }`. Sem
`minRole`, sem grupo, sem descrição, sem seção — a estrutura é um terço da do
registro do tenant.

E o arquivo **declara a decisão de arquitetura** que o épico precisa enfrentar,
em três comentários quase idênticos (`:43-46`, `:48-49`, `:52-54`, `:55-57`):

> `AdminSidebar.tsx:43-46` — "A porta da tela de marca. Ela NÃO entra em
> `lib/navigation/registry.ts`: aquele registro descreve a navegação do tenant
> (`app/app/**`) e o teste de completude que o vigia varre só aquela raiz. O
> admin de plataforma tem navegação própria, e é esta lista."

Ou seja: **a separação entre os dois registros é intencional e está escrita**, e
foi reafirmada três vezes conforme telas de configuração de instalação foram
sendo adicionadas (marca, google, meta, cadastro). O épico não está descobrindo
um esquecimento; está propondo revogar uma decisão registrada.

Rodapé da sidebar (`:121-132`): link `"Voltar pra app"` → `/app`, mais o e-mail do
usuário. **A volta existe; a ida, não.** Assimetria exata do problema do épico.

`components/admin/AdminShell.tsx` é a casca: `PlatformModeBanner` (topo fixo),
`AdminSidebar`, drawer mobile via `Sheet` abaixo de `lg` (`:76-81`), header com
hambúrguer (`:86-98`), `TooltipProvider` na raiz (`:71`, com um comentário longo
`:26-57` explicando quais 4 telas quebravam sem ele). O cabeçalho `:97` escreve
`"Admin Plataforma"` — o nome que o produto já usa para o modo.

### 1.5 `NEXT_PUBLIC_ADMIN_URL` — **não** é subdomínio, é o mesmo host

```console
$ grep -rn 'ADMIN_URL' . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next
proxy.ts:26   # points `NEXT_PUBLIC_ADMIN_URL` at the same host as the app and maps no `admin.`
.env.example:259   NEXT_PUBLIC_ADMIN_URL=http://localhost:3000
.env.hostgator.example:133   NEXT_PUBLIC_ADMIN_URL=https://crm.seudominio.com.br
docs/runbooks/cloudpanel.md:77   NEXT_PUBLIC_ADMIN_URL=https://cloud.seudominio.com.br
Dockerfile:28   ARG NEXT_PUBLIC_ADMIN_URL=https://placeholder.invalid
```

Em toda instalação real a variável aponta para **o mesmo host do app** — o
`.env.hostgator.example` e o `cloudpanel.md` usam o domínio do CRM, não um
`admin.`. O comentário em `proxy.ts:26` confirma que nenhum `admin.` é mapeado.
Então **o admin não é um app separado**: é uma rota do mesmo Next, no mesmo
contêiner, atrás do mesmo proxy. Um "modo admin" não precisa cruzar origem,
cookie ou domínio.

⚠️ Note que `SUPABASE_DB_ADMIN_URL` é coisa **completamente diferente** (conexão
DDL do kit, issue #192) e é vigiada por `tests/unit/env-ddl-fora-do-app.test.ts`
para **nunca** ser nomeada em código do app — não confunda as duas ao grepar.

---

## 2. A porta que falta — o registro de navegação

### 2.1 A forma de uma entrada

O registro é `lib/navigation/catalogo.ts` (707 linhas, **49 destinos** — `grep -c 'href: "/app' lib/navigation/catalogo.ts` → 49).
`lib/navigation/registry.ts` **não declara nada**: importa `NAV_CATALOG`, troca o
nome do ícone pelo componente (`registry.ts:96-99`) e expõe três projeções.

`NavMetadata` (`catalogo.ts:32-46`):

| Campo | Obrigatório | Significado |
|---|---|---|
| `href` | sim | a rota |
| `label` | sim | o nome no menu |
| `description` | sim | card do hub + texto buscável no ⌘K; "Nunca vazio" |
| `icon` | sim | chave do mapa `ICONS` de `registry.ts:54-92` |
| `group` | sim | um de 6 `NavGroupId` |
| `section` | só em grupo com hub | agrupamento dentro do hub |
| `minRole` | não (ausente = `viewer`) | escala do tenant |
| `sidebar` | não (ausente = só no hub) | sobe pro sidebar |
| `healthDot` | não | ponto de saúde |

Grupos (`catalogo.ts:68-79`): `atendimento`, `crm` (hub `/app/crm`), `ia` (hub
`/app/ai`), `canais`, `analise` (hub `/app/analise`), `organizacao`
(hub `/app/settings`, e é o **único grupo que fica no rodapé fixo** —
`GRUPO_NO_RODAPE`, `catalogo.ts:90`, com a medição de 1019px×663px que motivou).

### 2.2 `minRole` é a escala do tenant — e platform admin é BYPASS, não gate

```ts
// lib/navigation/interface.ts:42-48
export function canSee(d, platform: boolean, role: Role | null): boolean {
  return platform || (!!role && ROLE_RANK[role] >= ROLE_RANK[d.minRole ?? "viewer"]);
}
```

`ROLE_RANK` (`lib/auth/types.ts:24-30`): `viewer:1, agent:2, ai_operator:3, manager:4, admin:5`.

**O `platform` é um curto-circuito de abertura**: platform admin vê TUDO,
independentemente de `minRole`. Não existe, em lugar nenhum do registro, uma forma
de dizer **"só platform admin"** — o predicado é `platform || …`, nunca
`platform && …`, e não há campo `platformOnly` ou equivalente:

```console
$ grep -n 'platform\|Platform' lib/navigation/catalogo.ts ; echo exit=$?
exit=1
```

Zero ocorrências no catálogo inteiro. Confirmado nas 4 funções de projeção
(`permitidos`, `destinosDaInterface`, `sidebarGroups`, `hubSections`, `searchable`):
todas derivam de `canSee`.

**Consequência direta para o "modo admin":** uma entrada `{ href: "/admin", … }`
no `NAV_CATALOG` apareceria para **todo viewer** da instalação. O link não daria
403 (o gate do layout redireciona para `/admin/forbidden`), mas a navegação
passaria a anunciar uma porta que quase ninguém pode abrir — exatamente o que
`catalogo.ts:95-96` diz que o `minRole` existe para evitar: *"Assim a navegação
nunca mostra um link que morre em /403"*.

### 2.3 O repositório JÁ ESCREVEU que isso é um buraco

`tests/unit/navegacao-completude.test.ts:43-44`, na `NAV_ALLOWLIST`:

```ts
"/app/settings/atualizacao":
  "porta é o rodapé de versão (VersionFooter), que aparece justamente quando há
   versão nova — melhor que um card fixo. Além disso é só do dono do servidor
   (is_platform_admin), papel que o registro não modela",
```

**"papel que o registro não modela"** — a frase está no gate do CI, escrita como
justificativa de uma exceção. E existe um **precedente funcional completo** ali:

- `app/app/settings/atualizacao/page.tsx:16` → `if (!user?.is_platform_admin) notFound();`
- a porta dela é `components/shell/VersionFooter.tsx`, um componente próprio no
  rodapé do sidebar, **fora** do registro.

Ou seja: quando o produto precisou de uma tela platform-admin-only dentro do app
do tenant, a solução foi **tela fora do registro + porta bespoke + entrada na
allowlist justificada**. O "modo admin" é a segunda ocorrência da mesma classe —
e a hora de decidir se o registro passa a modelar o papel, ou se o padrão é
repetir a exceção.

### 2.4 Uma entrada `/admin` no registro REPROVARIA o CI hoje

Não é opinião, é o caso de teste `navegacao-completude.test.ts:92-95`:

```ts
it("todo destino do registro aponta para uma tela que existe", () => {
  const mortos = NAV_DESTINATIONS.map((d) => d.href).filter((h) => !ROTAS.includes(h));
  expect(mortos, `Link morto no registro:\n  ${mortos.join("\n  ")}`).toEqual([]);
});
```

E `ROTAS` vem de `rotasNoDisco(BASE)` com `BASE = path.join(RAIZ, "app", "app")`
(`:23-24`, `:61`). `/admin` **não está** sob `app/app/`, logo não está em `ROTAS`,
logo seria reportado como **"Link morto no registro"**. O escopo está declarado no
cabeçalho do arquivo (`:19-21`): *"ESCOPO: só `app/app/**` — a navegação do tenant.
O admin de plataforma (`app/admin/`), o onboarding e as páginas públicas têm
navegação própria."*

**Portanto, o épico tem de escolher entre três caminhos, e nenhum é "só adicionar
uma linha":**

1. **Ampliar o registro** — novo campo (`platformOnly`) + `canSee` passa a ter um
   ramo de exclusão + `rotasNoDisco` passa a varrer `app/admin/` também. Mexe no
   gate que protege 49 destinos e no predicado que decide o que **todo** usuário vê.
2. **Porta bespoke**, no padrão `VersionFooter` — componente próprio, gate
   `is_platform_admin`, registro intocado. É o precedente existente, e é o que os
   4 comentários do `AdminSidebar.tsx` pedem.
3. **Consertar a porta que já existe** — `TenantSwitcher.tsx:93-95`, hoje rotulada
   "Gerenciar organizações" e apontando para uma tela de 14.

O caminho 1 é o único que faz `/admin` aparecer no **⌘K** (`searchable`,
`registry.ts:158-167`), que é onde um leigo procura o que não sabe onde fica.
Isso é argumento real a favor dele — e é um custo de gate que precisa ser dito.

---

## 3. O precedente de configuração pela tela — o padrão canônico

Duas telas, **mesmo padrão**, descrito por elas mesmas como irmãs
(`app/admin/(protected)/google/page.tsx:25-31`: *"É o mesmo argumento de
/admin/marca, e esta tela é irmã dela"*).

### 3.1 As sete peças do padrão

| # | Peça | `marca` | `google` |
|---|---|---|---|
| 1 | Tela `page.tsx`, `export const dynamic = "force-dynamic"` | `marca/page.tsx:15` | `google/page.tsx:11` |
| 2 | **Gate local redundante** `if (!usuario?.is_platform_admin) notFound()` | `marca/page.tsx:59` | `google/page.tsx:47` |
| 3 | Leitura pelo **admin client** (tabela é server-side only) | `instalacao.ts:397` | `google/page.tsx:52-56` |
| 4 | Mutação por **server action**, não rota de API | `app/actions/settings/updateBranding.ts` | `app/actions/settings/updateGoogleOAuth.ts` |
| 5 | Gate da mutação: `requirePlatformAdmin()` (não `loadAuthUser()+flag`) | `updateBranding.ts:80` | `updateGoogleOAuth.ts:68` |
| 6 | Invalidação de cache do processo | `updateBranding.ts:121` | `updateGoogleOAuth.ts:105` |
| 7 | `audit()` com `actingAsPlatformAdmin: true` e `resourceId: null` | `updateBranding.ts:123-152` | `updateGoogleOAuth.ts:108+` |

### 3.2 As sete decisões que o épico herda (cada uma com a linha que a escreve)

**(a) `/admin` e não `/app/settings`, e o argumento é o REVENDEDOR.**
`updateBranding.ts:20-30`: *"Num revendedor que hospeda várias empresas, deixar o
admin de um tenant repintar o login de todos seria dar a um cliente o controle da
fachada dos outros."* Regra derivável: **objeto = instalação → `/admin`; objeto =
organização → `/app/settings`.** (Existem as duas: `/admin/marca` e
`/app/settings/marca`, catálogo linha 655.)

**(b) `notFound()` e não `redirect('/403')`.** `marca/page.tsx:46-50`: *"para quem
não administra a instalação, esta tela simplesmente não faz parte do produto — a
existência dela não é assunto dele."* Interage com o "modo admin": se a porta
ficar visível no app do tenant, esse argumento cai.

**(c) O gate local é redundante DE PROPÓSITO.** `marca/page.tsx:52-55`: *"Ele fica
porque a garantia precisa ser local: um layout pode ser movido, e a única regra
que não depende de vizinho é a que a própria página aplica."*

**(d) Server Action NÃO é rota, e por isso o gate é `requirePlatformAdmin()`.**
É o parágrafo mais importante do padrão inteiro — `updateBranding.ts:45-62`:

> *"Server Action NÃO é rota: não passa por `requireRole` (cujo `mfaEmDivida` tem
> um call site só, `lib/auth/require-role.ts`, que serve apenas `/api/v1`) e não
> passa pelo layout de `/admin` — e não existe `middleware.ts` neste repo para
> cobrir a diferença. Um POST direto na action, com uma sessão `aal1` de um
> platform admin, entrava: `is_platform_admin` responde 'esta pessoa TEM o papel',
> que é política de CADASTRO, não de SESSÃO. E, ao contrário da marca por
> organização, aqui o banco NÃO tem como fechar o buraco — a escrita vai pelo
> `service_role`, e o Postgres não enxerga o AAL de uma sessão do GoTrue."*

**Toda server action nova do painel tem esse buraco por construção.** Quem usar
`loadAuthUser()` + `is_platform_admin` reabre o furo já fechado duas vezes.

**(e) `upsert`, nunca `update`.** `updateBranding.ts:111-116`: *"um `update`
casaria zero linhas devolvendo sucesso — a tela diria 'salvo' e nada seria
gravado. É o mesmo modo de falha que a issue #144 mediu em `organizations`."*

**(f) `audit()` sem `organizationId` e com `resourceId: null`.**
`updateBranding.ts:126-139`: sem org porque *"a marca da instalação não pertence a
tenant nenhum"*; `resourceId: null` porque `api_audit_log.resource_id` é **uuid** e
a chave natural `"1"` do singleton estouraria `22P02` — silenciosamente, já que
audit é fire-and-forget. Há teste: `tests/unit/audit-resource-id-e-uuid.test.ts`,
cujo docstring *"registra que esta classe já reincidiu três vezes"*.
O `metadata` leva **quais campos mudaram, nunca os valores** (`:144-151`).

**(g) Segredo não volta para a tela.** `google/page.tsx:39-44`: a leitura pede
`client_id` e um **booleano** (`temSegredoSalvo`), nunca o
`client_secret_encrypted`. *"Devolvê-lo para preencher o campo o vazaria a cada
render, para qualquer XSS, para o payload do RSC e para o cache do navegador."*
A cifra é `encryptWebhookSecret` (AES-GCM via `fn_encrypt_oauth`,
`updateGoogleOAuth.ts:82-90`), e **falha fechada**: sem a chave mestra (GUC
`app.nuvemshop_oauth_key`) a action recusa com *"o segredo não foi gravado"* em
vez de gravar em claro.

### 3.3 O bloco de ESTADO — invariante 6 do Sistema Vivo

`app/admin/(protected)/marca/_estado.tsx:3-25` define o que uma tela de
configuração deve mostrar além dos campos:

- **de onde veio cada campo** (`.env` ou a tela — via `seeded_from_env`);
- a medida objetiva do efeito (aqui: contraste AA, com veredito);
- **o que o sistema ajustou sozinho**, e por quê;
- **se a configuração PAROU de ser aplicada** (`fallback_at` + `fallback_reason`,
  alarme que acende no caminho de render e **apaga sozinho** — `instalacao.ts:467-481`).

E separa explicitamente **o que está NO CAMPO** (ao vivo) do **que está GRAVADO**
(`_estado.tsx:18-24`): *"um bloco que mistura as duas leituras é como se ensina
alguém a não confiar na tela"*.

`/admin/google` faz o mesmo em miniatura: `atualizadoEm` + a origem do que está em
vigor, porque *"quem tem o par no `.env` e abre esta tela vazia conclui que não há
nada configurado — e a precedência (banco primeiro) fica invisível"*
(`google/page.tsx:62-65`).

### 3.4 A precedência: banco > `.env`, e o `.env` NÃO é apagado

`lib/branding/instalacao.ts:13-21` — o parágrafo que o épico inteiro precisa
respeitar:

> *"O `agent.sh` do kit, em falha de update, reverte só a IMAGEM (`APP_IMAGE`) —
> não o schema, não o `git checkout`. E o `update.sh` aplica o baseline ANTES de
> puxar a imagem. Ou seja: o rollback põe CÓDIGO ANTIGO sobre BANCO NOVO por
> construção. Código antigo não conhece esta tabela; se a marca só existisse aqui,
> ela SUMIRIA no meio de um rollback — o pior momento possível para o cliente
> descobrir mais um problema. Com o `.env` intacto, a marca degrada para o valor
> da instalação e a tela continua sendo a do cliente."*

O mecanismo que faz os dois conviverem é a coluna **`seeded_from_env`**
(`instalacao.ts:169-196`): a semeadura do `.env` só corre quando a linha ainda é
cópia dele; a escrita humana grava `seeded_from_env: false` e **trava a promoção
para sempre** — *"inclusive quando a pessoa apagou os três campos de propósito
para voltar ao padrão do produto"*.

⚠️ **E o `.env` NÃO é reescrito pelo app.** O contrato é: `.env` é **semente e piso
de rollback**; o app **só lê** dele. Nenhuma das duas actions escreve no arquivo.

### 3.5 Coluna nova é TUDO OU NADA — `42703` derruba a linha inteira

`instalacao.ts:87-101`:

> *"Código novo sobre schema velho … faz o PostgREST devolver `42703` para a linha
> inteira — não uma linha com a coluna faltando. `lerLinha` trata isso como 'o
> banco não falou' e o resolvedor cai no `.env`… Ou seja: quem não aplicou a 0158
> perde a marca DO BANCO, não só o logo, até aplicar."*

Se o painel novo puser N configurações numa mesma tabela-singleton, **uma coluna
nova não aplicada derruba as N**. É argumento forte a favor de uma tabela
chave→valor, ou de uma tabela por domínio, em vez de um singleton gordo.

### 3.6 O resolvedor NUNCA lança

`instalacao.ts:321-331` e `saida.ts:31-43`. `marcaDaInstalacao()` é chamada de
`app/layout.tsx`, *"que embrulha o produto inteiro — uma exceção aqui é 500 em
todas as telas, inclusive na tela onde alguém corrigiria o que quebrou"*.
Qualquer leitor de configuração que o painel novo puser no caminho de render
herda essa obrigação.

### 3.7 O cache: `globalThis`, não `let` de módulo — e o porquê medido

`instalacao.ts:233-277`. O memo mora em `globalThis.__memoDaMarcaDaInstalacao`
porque **o mesmo módulo é instanciado DUAS vezes no mesmo processo**: medido no
`next build` (Next 16.3, Turbopack), `206/206` `route.js` carregam
`chunks/[turbopack]_runtime.js` e `98/98` `page.js` carregam
`chunks/ssr/[turbopack]_runtime.js`, cada um com seu `moduleCache` e **zero
registro em `globalThis`**.

Efeito real, com controle: `invalidarMarcaDaInstalacao()` chamada de
`app/api/v1/marca/logo/route.ts` **zerava um memo que nenhuma tela lia** — a troca
de logo só aparecia quando o TTL de 30s expirasse, atrás de um toast verde. A
mesma função chamada da server action sempre funcionou, porque a action compila no
runtime das PÁGINAS. **A variável era o runtime.**

Há ainda um contador de geração (`__geracaoDaMarcaDaInstalacao`,
`instalacao.ts:280-307`, `:337-370`) contra *lost update*: uma leitura em voo antes
da escrita voltava com a linha pré-escrita e a reinstalava por um TTL inteiro —
**medido no trace do CI em 2026-08-20**, 19,6s depois do POST 200 a tela ainda
negava o logo. E `"erro"` fica **fora** do memo (`:354-369`), senão uma falha de
leitura vira fato por 30s.

**Regra que o painel novo herda:** toda configuração cacheada precisa de
(1) memo em `globalThis`, (2) contador de geração, (3) TTL curto para o que a
invalidação não alcança, (4) falha fora do memo. Quatro peças, não uma.

---

## 4. Os três processos — e como (ou se) uma mudança os alcança

### 4.1 Confirmado: `app`, `worker`, `scheduler`, todos com imagem publicada

| Serviço | Linha | `image:` | `pull_policy:` | `env_file` | `mem_limit` |
|---|---|---|---|---|---|
| `app` | `docker-compose.prod.yml:14` | `${APP_IMAGE:-ghcr.io/melgarafael/deskcommcrm:stable}` (`:35`) | `${APP_PULL_POLICY:-always}` (`:36`) | `.env` (`:38`) | 768m |
| `worker` | `:58` | `${WORKER_IMAGE:-ghcr.io/melgarafael/deskcomm-worker:stable}` (`:92`) | `always` (`:93`) | `.env` (`:98`) | 512m |
| `scheduler` | `:203` | `${SCHEDULER_IMAGE:-ghcr.io/melgarafael/deskcomm-scheduler:stable}` (`:213`) | `always` (`:214`) | — (`INTERNAL_SECRET` via `environment:`) | — |

O `worker` mantém `build:` **ao lado** da imagem (`:94-97`), e o comentário
`:58-68` explica: com os dois presentes o Compose usa a imagem quando ela existe e
constrói quando não — mudança aditiva, registry fora do ar cai no comportamento
antigo.

### 4.2 O `worker` NÃO vê a invalidação do `app` — a linha exata

`lib/branding/instalacao.ts:45-52`:

> *"── O `worker` é um SEGUNDO processo e nunca vê a invalidação ──
> `Dockerfile.worker` sobe um processo próprio. Ele não renderiza marca hoje —
> medido: nenhum dos 8 call sites de `lib/branding` está em `workers/`. Quando
> renderizar (e-mail, PDF), a regra é LER DO BANCO NO ENVIO, sem memo: um envio é
> raro comparado a um render, o custo de uma leitura é irrelevante ali, e um memo
> naquele processo entregaria a marca velha por até um TTL inteiro sem ninguém ter
> como perceber."*

⚠️ **A medição desse parágrafo VENCEU.** O worker já renderiza marca:

```console
$ grep -rn "lib/branding" workers/
workers/lgpd-export-worker.ts:57:import { marcaDaSaida } from "@/lib/branding/saida";
```

E `marcaDaSaida` chama `marcaDaInstalacao()` (`lib/branding/saida.ts:52`, `:184`) —
que é a função COM memo de `globalThis` e TTL de 30s. Ou seja: o caso que o
comentário previa como futuro chegou, e a regra que ele prescrevia ("ler do banco
no envio, sem memo") **não foi aplicada**. O PDF de LGPD do worker pode sair com a
marca de até 30s atrás. Impacto pequeno (30s), mas é o **mecanismo** que importa:
não há nada que alerte quando um segundo processo passa a ler config cacheada.

### 4.3 Os quatro mecanismos que existem — e qual vale para quê

**(1) `.env` — alcança os três, e é o ÚNICO que alcança os três.**
Medido e escrito em `lib/instalacao/ambiente.ts:10-16`:

> *"⚠️ Desfaz uma premissa escrita no código: `app/api/v1/ai/providers/route.ts`
> afirma que 'o servidor web não enxerga o env do worker' e por isso nunca mostra
> a origem `variavel_de_ambiente`. Medido: `docker-compose.prod.yml` dá
> `env_file: .env` ao serviço `app` (linha 34) E ao `worker` (linha 71) — o MESMO
> arquivo."*

Custo: mudança no `.env` só vale **depois de recriar o contêiner**. É exatamente o
SSH que o épico quer eliminar.

**(2) Leitura do banco A CADA USO — é o que o worker de IA já faz, e funciona.**
`lib/agent-engine/edge/llm/credentials.ts:15-16`:

> *"A config é lida do DB A CADA chamada (`resolveOrgLlmConfig`) — trocar
> modelo/provider/teto é UPDATE na config, sem restart nem deploy."*

A credencial BYOK vive em `ai_provider_credentials` (AES-256-GCM, colunas
`api_key_encrypted`/`api_key_iv`/`api_key_tag`), os knobs em
`organizations.settings->'llm'`, o teto em `ai_budgets` — tudo num round-trip com
`left join` (`:9-13`). **Sem chave BYOK, o fallback é a chave de plataforma do
`.env`** (`:5-6`) — e aí volta a valer (1).

**Esta é a resposta de desenho para a pergunta do épico:** o mecanismo pelo qual o
worker fica sabendo é **não cachear**. Não há push, não há invalidação
cross-process, não há sinal. Quem precisa ver mudança na hora lê do banco no
instante do uso.

**(3) `event_log` — existe, mas está FECHADO para configuração.**
`lib/branding/instalacao.ts:54-61` e `app/actions/settings/updateBranding.ts:64-71`
dizem a mesma coisa, com a mesma medição:

> *"`lib/event-log/register-handlers.ts` registra 12 handlers e nenhum cobriria um
> tipo `platform_branding.*`. O drain deixa evento sem handler INTOCADO, então a
> linha nasceria `pending` para sempre em todo clone — evento sem consumer é o
> anti-pattern nº 3 do CLAUDE.md."*

(`grep -c register lib/event-log/register-handlers.ts` → 19 ocorrências hoje; o
número "12" da prosa é afirmação de estado que pode ter vencido — o argumento não
depende dele.)

Usar `event_log` para propagar config ao worker **exigiria registrar um handler
novo**, o que é possível — mas é criar um caminho que hoje não existe, e o
CLAUDE.md proíbe o meio-termo (emitir sem consumer).

**(4) TTL — o piso, para o que a invalidação não alcança.**
`instalacao.ts:223-229`, 30s, justificado por *"edição direta no banco (`psql`), e
uma segunda réplica no dia em que existir"*.

### 4.4 O que isso significa para o painel

Resumo operacional, por tipo de configuração:

| Se o painel mudar… | O `app` vê | O `worker` vê | O `scheduler` vê |
|---|---|---|---|
| uma tabela lida a cada uso (padrão `resolveOrgLlmConfig`) | na hora | **na hora** | n/a (só bate no app por HTTP) |
| uma tabela com memo `globalThis` + TTL (padrão `marcaDaInstalacao`) | na hora (invalidação) | **até 30s depois** | n/a |
| o `.env` | só após recriar o contêiner | só após recriar o contêiner | só após recriar |

O `scheduler` é o caso fácil: ele **não roda código do produto** — dispara os crons
por HTTP contra o `app` com `INTERNAL_SECRET` (`docker-compose.prod.yml:203-262`).
Configuração alcança o cron porque alcança o `app`.

**Conclusão de desenho (a mais importante da seção):** não existe hoje nenhum
canal de notificação entre processos, e a doutrina do repo empurra contra criar um
(`event_log` sem consumer é anti-pattern). O caminho que o produto já validou é
**leitura no ponto de uso, sem cache**, e só cachear onde a invalidação alcança o
leitor. Um painel que ponha credencial de IA da instalação no banco deve seguir
`resolveOrgLlmConfig`, **não** `marcaDaInstalacao`.

---

## 5. O kit self-host — como a configuração nova chega a quem já instalou

### 5.1 A lei

`docs/doctrine/packaging.md:207-222` (invariante 6):

> *"Variável nova nasce **opcional, com default que preserva o comportamento
> anterior**; se ela precisa existir, quem a acrescenta é o `update.sh`, não o
> usuário."*

E `:350-368` (Retrocompatibilidade) lista o que um bump **não pode** exigir:
*"editar `.env`, compose ou qualquer arquivo à mão"*, *"que o operador saiba o que
é uma imagem, uma tag ou um registry"*. Fecha com: *"Mudança que não couber nessas
regras não entra: vira issue com plano de migração."*

### 5.2 Como o `update.sh` de fato acrescenta uma chave — dois exemplos vivos

O helper é `set_env_var` (`hostgator-setup-kit/_common.sh:792-802`): filtra a linha
antiga com `grep -vE "^${key}="`, faz append da nova, `chmod 600`, `mv`. O
comentário `:783-791` explica por que existe: *"`export APP_IMAGE=…` vale só
enquanto o script roda … um `docker compose up -d` rodado à mão pelo dono semanas
depois voltaria pro `APP_IMAGE` gravado no install e DESFARIA a atualização"*.

Dois padrões de "chave nova chega sozinha", ambos chamados pelo `update.sh`:

- **`completar_segredos_da_voz`** (`_common.sh:762-781`, chamado em `update.sh:283`)
  — para cada chave ausente, gera e grava. Note a disciplina: *"`^CHAVE=` casa
  inclusive a linha com valor vazio — que é presença, não lacuna. Só a AUSÊNCIA da
  linha é preenchida."* E sai cedo se o `.env` não for gravável (`:766`).
- **`ensure_encryption_key`** (`_common.sh:1019-1038`, chamado em `update.sh:392`)
  — gera `openssl rand -hex 32`, grava no `.env` **e semeia no banco**
  (`private.app_secrets`), porque *"Supabase não permite configurar a chave via
  parâmetro de banco"*. É a chave-mestra de cifra que o `/admin/google` usa.

**Portanto: o épico tem o caminho pronto.** Configuração nova que precise de
segredo no `.env` se acrescenta no `update.sh` com um helper como esses. O que ele
**não** pode fazer é pedir ao operador que edite.

### 5.3 O que o `update.sh` faz com o `.env` existente

Ele **preserva e completa**, nunca sobrescreve em massa. Escritas medidas:

- `gravar_imagens .env "$VERSAO_ALVO"` (`update.sh:275`) — pina as **três** imagens.
  O comentário `:263-268` registra o defeito que isso consertou: *"`update.sh`
  antigo grava só `APP_IMAGE`, e o worker fica seguindo um canal móvel."*
- `completar_segredos_da_voz .env` (`:283`) e `ensure_encryption_key .env` (`:392`).
- Re-aplica `supabase/baseline.sql` **antes** de puxar a imagem (`:189-213`),
  sem `ON_ERROR_STOP`, via `url_do_schema` (`SUPABASE_DB_ADMIN_URL` quando houver).

### 5.4 O rollback do `agent.sh` — o que reverte e o que NÃO reverte

`hostgator-setup-kit/agent.sh:286-328`. Quando o `update.sh` sai ≠ 0 (e ≠ o código
de recusa):

**Reverte:** as **imagens dos três serviços** (`app`, `worker`, `scheduler`), via
`dc up -d` com `*_IMAGE=<ID local anterior>` e `*_PULL_POLICY=missing`, e depois
**persiste no `.env`** com `set_env_var` (`:316-325`). O comentário `:312-315` diz
por que persistir: *"o `update.sh` já gravou as imagens NOVAS (quebradas) no `.env`
antes do pull. Sem reescrever aqui, o próximo `up -d` — o do cliente, semanas
depois — traria o app quebrado de volta e desfaria o rollback em silêncio."*

Worker e scheduler só voltam se o `.env` já tinha `WORKER_IMAGE`/`SCHEDULER_IMAGE`
(`:246-251`), com um motivo concreto: numa instalação legada o ID seria do
`alpine:3.20` do scheduler antigo, e pinar aquilo deixaria *"os 16 crons parando,
em silêncio, gravado no `.env`"*.

**NÃO reverte:** o **schema** (nenhum `down`, nenhum `psql` de volta), o
**`git checkout`** da árvore, e **nenhum dado**. Confirmado lendo o bloco inteiro
`:286-328`: as únicas escritas são `set_env_var` sobre as seis chaves de imagem.

### 5.5 A consequência para "o painel é a fonte da verdade"

O rollback põe **código antigo sobre banco novo, por construção** — é a frase de
`lib/branding/instalacao.ts:13-21`, e ela é a razão pela qual a marca continua
sendo escrita no `.env` como **piso**.

Traduzido para o épico, em três regras:

1. **Configuração que vive só no banco desaparece num rollback.** O código antigo
   não conhece a tabela nova; o PostgREST devolve `42703` ou `42P01`, e o leitor
   (se for bem escrito) cai na camada de baixo. Se não houver camada de baixo, o
   valor some.
2. **O `.env` é o piso, e o produto lê dele — mas não escreve nele.** Nenhuma das
   duas actions medidas escreve no arquivo; a coluna `seeded_from_env` é o que
   impede o `.env` de desfazer a escolha humana no render seguinte
   (`instalacao.ts:169-196`).
3. **Coluna nova numa tabela-singleton é tudo-ou-nada** (`instalacao.ts:87-101`):
   uma coluna não aplicada derruba a leitura da linha inteira. Argumento concreto
   contra empilhar N configurações no mesmo singleton.

⚠️ Há uma **assimetria** que o épico precisa decidir: `platform_branding` tem o
`.env` como piso; `platform_google_oauth` **também** (a tela mostra
`configuracaoDoAmbiente()` — `google/page.tsx:62-65`). Se o painel novo adotar
configurações **sem** correspondente no `.env`, ele quebra o piso de rollback pela
primeira vez, e isso precisa ser uma decisão escrita, não um esquecimento.

### 5.6 O fragmento em `.changes/`

DoD 17 do `CLAUDE.md`: PR que muda comportamento visível a quem opera uma VPS traz
seu fragmento em `.changes/`, declarando o **efeito no operador**
(`nada_mudou` / `capacidade_nova` / `exige_acao`). Um painel que substitui SSH é
`capacidade_nova` por definição. Confere com `pnpm release:conferir`.

---

## 6. Audit e segurança de tela

### 6.1 Como as mutações do admin são auditadas hoje

Via `audit()` de `lib/audit`, com três marcas específicas do contexto de plataforma
(medidas em `updateBranding.ts:123-152`, e idênticas em `updateGoogleOAuth.ts:108+`):

- `actingAsPlatformAdmin: true` — a coluna que separa ação de plataforma de ação de tenant;
- **sem `organizationId`** — *"a marca da instalação não pertence a tenant nenhum.
  Carimbar a organização ativa de quem chamou faria a auditoria sugerir que a
  mudança foi daquele cliente, quando ela afeta todos"*;
- `resourceId: null` — porque `api_audit_log.resource_id` é **uuid** e a chave `"1"`
  do singleton estoura `22P02` **em silêncio** (audit é fire-and-forget). Guardado
  por `tests/unit/audit-resource-id-e-uuid.test.ts`, cujo docstring registra
  **três reincidências**.

O `metadata` leva `fields_changed` (as CHAVES) e booleanos de "foi definido?" —
**nunca os valores** (`:144-151`): *"O hex da marca é identidade, e a auditoria é
lida por quem opera a plataforma."* Para um painel de credenciais isso deixa de ser
zelo estético e vira requisito: `metadata` com o valor de uma chave de API a
grava em claro numa tabela append-only de 5 anos.

O consumidor é real: `/admin/audit` (+ `app/api/v1/admin/audit`). O `CLAUDE.md`
lembra que a tabela é append-only **por schema** (nenhum papel tem GRANT de
UPDATE/DELETE, nem `service_role`) — com a ressalva do `TRUNCATE`.

### 6.2 MFA: as duas perguntas, e onde cada uma é feita

`lib/auth/politica-mfa.ts` responde **"preciso CADASTRAR?"** — `exigeCadastroDeMfa`
(`:67-71`): `isPlatformAdmin && plataformaExige === true`, **ou**
`role === "admin" && empresaExige`. As duas origens **somam, nunca se anulam**
(`:61-65`). O padrão de ambas é **não exigir** (`:76-80`).

`mfaEmDivida()` (`lib/auth/server.ts:378`) responde **"preciso PROVAR agora?"** — e
`politica-mfa.ts:26-31` insiste que ela **não** consulta a política: *"quem TEM
fator cadastrado precisa provar. Isso NÃO depende da política … com o cadastro
opcional isso teria virado um buraco: quem ativasse a verificação por vontade
própria teria o fator ignorado na sessão."*

⚠️ E há um controle decorativo consertado que vale de aviso ao épico
(`politica-mfa.ts:33-37`): *"`platform_admins.mfa_required` JÁ EXISTIA E NUNCA FOI
LIDO. A coluna está no schema, aparece na tela de admin da plataforma com um badge
de sim/não, e o gate ignorava … o operador podia desmarcá-lo e nada mudava."*

### 6.3 Os TRÊS gates diferentes em vigor no admin — medidos

| Caminho | Gate | `scope` | AAL |
|---|---|---|---|
| **Páginas** `/admin/**` | `requirePlatformAdmin()` (`lib/auth/requirePlatformAdmin.ts`) | lido, **nunca checado** | `aal2` **se** `mfa_required` |
| **Server actions** de instalação | `requirePlatformAdmin()` (`updateBranding.ts:80`, `updateGoogleOAuth.ts:68`) | idem | idem |
| **Rotas** `/api/v1/**` | `requireRole()` → `mfaEmDivida()` (`lib/auth/require-role.ts:115`) | n/a | prova quem TEM fator |
| **Rotas de extensões** | `requireExtensionPlatformFor()` (`lib/extensions/http.ts:41-93`) | **`scope !== "full"` → 403** | `(mfa_required && aal≠aal2) \|\| mfaEmDivida()` |

**`lib/extensions/http.ts:80` é o gate mais estrito do repo** e é o único que
combina as duas perguntas:

```ts
if ((platform.mfa_required && (await sessionAal()) !== "aal2") || (await mfaEmDivida())) {
```

É também o único que exerce `scope` (`:70`) e que recusa **sessão de suporte**
(`:43`, `!user.is_platform_admin || user.support`). Sendo o gate mais novo do
repo, é o candidato natural a **padrão do painel novo** — e o fato de ele existir
e os outros não o usarem é, por si, um achado: há quatro gates de plataforma com
rigores diferentes.

### 6.4 Trocar a chave de IA da instalação deveria exigir o quê?

Há um precedente **do mesmo dia**: commit `28a3e4c43` *"feat(EPIC-13): chave
editável e recusa do DELETE que ensina a repontar"* (merge `d73c32cc4`), que criou
`PATCH /api/v1/ai/credentials/:id` para rotacionar a chave **no lugar**, reusando a
cifragem AES-GCM de `guardarCredencial` — *"nada em claro, nada logado"*, resposta
saindo da **view segura**. Mas essa é a chave **BYOK da organização**
(`ai_provider_credentials`), não a da instalação.

A da instalação hoje é `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` /
`OPENROUTER_API_KEY` / `AI_GATEWAY_API_KEY` no `.env`
(`lib/instalacao/ambiente.ts:51-59`, `lib/env.ts:178-200`), lida como **fallback**
por `resolveOrgLlmConfig` (`credentials.ts:5-6`, `:94-96`) e **diretamente do
`process.env`** pelo worker de mídia (`workers/media-derive-worker.ts:118-125`).
**Não existe tabela `platform_ai_credentials`** — o painel teria de criá-la.

Juntando o que o repo já decidiu, o gate mínimo para trocar a chave de IA da
instalação é:

1. **`requirePlatformAdmin()`** — nunca `loadAuthUser()` + a flag
   (`updateBranding.ts:45-62`: sem isso, um POST direto na action com sessão `aal1`
   entra, e o banco não pode fechar o buraco porque a escrita vai por `service_role`).
2. **`scope === "full"`**, no padrão de `lib/extensions/http.ts:70` — o eixo existe
   no banco e só um call site o usa.
3. **`aal2` na sessão**, no padrão de `lib/extensions/http.ts:80` — as duas
   condições somadas, não uma. Trocar a chave de IA da instalação é reapontar o
   gasto de LLM de **todos os tenants**; é ação de raio maior que instalar uma
   extensão, que já exige isso.
4. **Cifra em repouso** no padrão do `client_secret` do Google
   (`encryptWebhookSecret` / AES-GCM), **falhando fechado** quando a chave-mestra
   não existe (`updateGoogleOAuth.ts:82-90`) — nunca gravar em claro.
5. **O valor NUNCA volta para a tela** — só um booleano `temChaveSalva` e o
   `updated_at` (`google/page.tsx:39-44`).
6. **`audit()` com `metadata` sem o valor** — só `fields_changed` e booleanos
   (`updateBranding.ts:144-151`).
7. **Leitura no ponto de uso, sem memo**, para o `worker` enxergar
   (`credentials.ts:15-16`) — e o `.env` mantido como piso de rollback (§5.5).

### 6.5 ⚠️ O "não existe `middleware.ts` neste repo" é falso — ele se chama `proxy.ts`

`app/actions/settings/updateBranding.ts:49-50` afirma: *"e não existe
`middleware.ts` neste repo para cobrir a diferença"*. Medido:

```console
$ ls middleware.ts proxy.ts
ls: middleware.ts: No such file or directory
proxy.ts
```

A frase está certa **pelo nome do arquivo** e errada **pelo mecanismo**. O Next 16
renomeou `middleware.ts` → `proxy.ts`, e o arquivo existe na raiz, exporta
`proxy(request)` e um `config.matcher` que cobre **todos os caminhos** menos
assets estáticos (`proxy.ts:124-129`). E ele **já gateia `/admin`**:

```ts
// proxy.ts:111-118
if (isAdminSurface && pathname.startsWith("/admin") && pathname !== "/admin/forbidden") {
  const { data: isAdmin, error } = await supabase.rpc("fn_is_platform_admin");
  if (error || !isAdmin) {
    return NextResponse.redirect(new URL("/admin/forbidden", request.url));
  }
}
```

O que isso muda, e o que NÃO muda, para o argumento de `updateBranding.ts`:

- **NÃO muda a conclusão.** O middleware confere `fn_is_platform_admin`
  (é CADASTRO), e **nada** sobre AAL. O buraco que `requirePlatformAdmin()` na
  action fecha — *"um POST direto na action, com uma sessão `aal1` de um platform
  admin, entrava"* — continua real, porque o `proxy.ts` não olha AAL.
- **Muda a premissa, e a premissa importa para o épico.** Uma server action
  renderizada em `/admin/**` **passa** pelo matcher (o POST vai para a própria URL
  da página) e já tem a checagem de papel. Uma server action renderizada em
  `/app/**` — que é o que um "modo admin" dentro do app do tenant produziria —
  **não** tem nenhuma. Quem desenhar o painel com o mesmo argumento escrito na
  action vai medir contra a régua errada.
- **E confirma §1.5 pelo código**, `proxy.ts:25-28`: *"the admin surface is reached
  by PATH (`/admin/*`) — the self-host kit points `NEXT_PUBLIC_ADMIN_URL` at the
  same host as the app and maps no `admin.` sub-domain. The host-based branch below
  stays a NOOP today and only exists as documentation of the intended deploy
  topology."* O ramo `host.startsWith("admin.")` (`:29-30`) existe e é **NOOP hoje**.

Este é um caso de **prosa de estado vencida dentro de um argumento de segurança** —
a classe que o `CLAUDE.md` manda trocar por comando. O comando é o `ls` acima.

---

## 7. Extensões — o recorte do épico MUDA

### 7.1 A medição que corrige o ponto de partida

O ponto de partida dizia "zero em lib/app/components". **Medido neste worktree, no
SHA `b264bd2d6`, que é o topo da `main`:**

```console
$ git ls-tree -r --name-only main | grep -i exten | head -20
app/api/v1/extensions/[id]/configuration/route.ts
app/api/v1/extensions/[id]/open/route.ts
app/api/v1/extensions/[id]/remove/route.ts
app/api/v1/extensions/[id]/revert/route.ts
app/api/v1/extensions/[id]/route.ts
app/api/v1/extensions/catalogs/route.ts
app/api/v1/extensions/install/route.ts
app/api/v1/extensions/operations/[id]/cancel/route.ts
app/api/v1/extensions/operations/[id]/route.ts
app/api/v1/extensions/route.ts
app/app/extensions/[id]/page.tsx
app/app/extensions/page.tsx
components/extensions/ExtensionCatalog.tsx
components/extensions/ExtensionGuide.tsx
components/extensions/ExtensionOperations.tsx
components/extensions/ExtensionsManager.tsx
components/extensions/InstalledExtensionCard.tsx
…
$ ls lib/extensions/
context-routes.test.ts  download.ts  errors.ts  erros-do-banco.ts  http.ts
instalada.ts  manifest.ts  requests.ts  service.ts  strict-json.ts
versao.ts  view.ts  vocabulario.ts   (+ 9 arquivos de teste)
```

**Extensões estão em produção na `main`.** Não é spec, não é protótipo: 10 rotas de
API, 2 telas, 5 componentes, 13 módulos de `lib`, migration aplicada.

### 7.2 O que está commitado, e quando

| Artefato | Caminho | Commit |
|---|---|---|
| Migration | `supabase/migrations/20260917120000_0271_extensoes_declarativas.sql` | `1e6d4f381`, **2026-09-17** |
| Spec | `docs/specs/extensoes-declarativas-v1.md` | na `main` |
| Arquitetura | `docs/architecture/extensoes-declarativas.architecture.json` | na `main` |
| Pesquisa (11 arquivos, ~174 KB) | `docs/research/extensoes/01-…` a `10-…` + `README.md` | `f65d04667`, `e24a2b94e`, `cb72a9f2c`, `213dee0d4`, `0e97e2d79` |

⚠️ **Já existe um `02-o-que-sera-impactado.md` em `docs/research/extensoes/`** — a
mesma numeração desta investigação. O épico de extensões usou exatamente este
método; vale ler antes de refazer trabalho.

### 7.3 Cinco tabelas novas (migration 0271)

`extension_catalogs`, `extension_artifacts`, `extension_installations`,
`organization_extensions`, `extension_operations` — todas com
`enable row level security` (`:100-104`). Desenho declarado no cabeçalho (`:1-6`):

> *"Documentos declarativos locais; nenhuma execução de pacote ou DDL dinâmico. A
> autoridade de publicação é um recibo `preparing`, sem TTL. … Atualizar, desfazer
> a última troca e remover: ponteiro de artefato com histórico de UM passo … e
> remoção lógica (nenhuma linha é apagada)."*

Note que é **um catálogo de documentos**, com limite de 64 KiB por artefato
(`byte_length between 1 and 65536`), não um marketplace de código executável.
`organization_extensions` é a tabela tenant-aware (`organization_id … on delete
cascade`, `:37`).

### 7.4 O que isso muda no recorte do épico — três coisas

**(a) As extensões NÃO estão no painel admin — estão no app do tenant.**
`app/app/extensions/page.tsx` usa `requireAuth()` + `resolveActiveOrg()` (`:11-13`),
**sem** gate de plataforma. E ela está no `NAV_CATALOG`:

```
catalogo.ts:697-702
  href: "/app/extensions", label: "Extensões",
  group: "organizacao", section: "Sua empresa"   ← SEM minRole (= viewer)
```

Quem **administra** o catálogo (admitir, instalar, remover) é platform admin,
atrás de `requireExtensionPlatformFor` nas ROTAS (`lib/extensions/http.ts:41-93`).
Ou seja: a tela é do tenant, o poder é da plataforma, e a separação é feita **na
API**, não na navegação.

**Esse é o desenho oposto ao de `/admin/marca`** — que pôs a tela em `/admin` com o
argumento do revendedor. Duas respostas diferentes para a mesma pergunta,
convivendo na mesma `main`. O épico **tem de reconciliar isso**, porque um painel
de administração da instalação que ignore `/app/extensions` deixa a
"administração da instalação" em dois lugares.

**(b) O gate mais estrito do repo já está escrito** — `lib/extensions/http.ts:70,80`
(`scope === "full"` + AAL duplo + recusa de sessão de suporte). Ver §6.3.

**(c) O épico herdou um vocabulário.** `lib/extensions/vocabulario.ts` e a spec
falam em "pacotes disponíveis" / "guias", não em "plugins" ou "marketplace". Um
painel que introduza "extensões" com outro sentido colide com o que existe.

### 7.5 A varredura completa pedida

```console
$ grep -ril "extens|plugin|marketplace|manifest" lib app components hooks workers
```
→ 40 arquivos, dos quais os relevantes a extensões são os 13 de `lib/extensions/`,
as 10 rotas de `app/api/v1/extensions/`, as 2 telas e os 5 componentes. Os demais
são homônimos legítimos: `app/manifest.ts` (PWA), `lib/branding/logo.ts`,
`lib/ai/skills/package.ts` (o marketplace **de skills de IA**, migrations
`0068_skills_marketplace` e `0069_seed_platform_skills`), `lib/agent-engine/agent/skills.ts`.

```console
$ grep -ril "extens|plugin|marketplace" supabase/migrations supabase/*.sql
supabase/migrations/20260917120000_0271_extensoes_declarativas.sql   ← o alvo
supabase/migrations/20260724120000_0068_skills_marketplace.sql        ← outro domínio
supabase/migrations/20260724130000_0069_seed_platform_skills.sql      ← outro domínio
supabase/baseline.sql                                                  ← apêndice
supabase/migrations/MANIFEST.md
(+ 5 falsos positivos por "manifest"/"extension" em texto)
```

⚠️ **Existe um SEGUNDO "marketplace" no produto** — o de *skills de IA*
(`0068_skills_marketplace`, `lib/ai/skills/`). Ele é anterior e não tem relação com
`lib/extensions/`. Qualquer conversa sobre "marketplace" no épico precisa dizer de
qual dos dois se trata.

---

## O que eu NÃO medi

1. **Não rodei nenhum teste.** Nada aqui é "o CI passa/reprova" observado — as
   afirmações sobre `tests/unit/navegacao-completude.test.ts` (§2.4) são leitura do
   código do teste, não execução. Uma entrada `/admin` no catálogo **não foi
   adicionada nem rodada** para ver o vermelho.
2. **Não abri nenhuma tela.** Zero evidência visual, zero Playwright. Tudo é leitura
   estática. A DoD 12 do `CLAUDE.md` não foi exercida.
3. **Não medi o banco.** Nenhum `psql`: não conferi grants de `platform_branding`,
   `platform_google_oauth` ou das 5 tabelas de extensão, nem as policies de RLS.
   O que digo sobre "RLS ligada, zero policies, grants revogados" é **citação dos
   comentários** de `updateBranding.ts:36-38` e `google/page.tsx:50-52`, não medição.
4. **Não li `lib/auth/server.ts` inteiro** — só os call sites de `mfaEmDivida` e
   `sessionAal`. A implementação de `mfaEmDivida()` (`:378`) não foi lida linha a
   linha; a descrição dela vem do docstring de `politica-mfa.ts`.
5. **Não li o `install.sh`** (2228 linhas) nem o `comecar.sh`. Só o `update.sh`
   (403), o `agent.sh` (337) e os trechos citados do `_common.sh` (1038). A
   afirmação "o `install.sh` promove o dono a platform admin" é **citação** de
   `app/admin/(protected)/layout.tsx:11-13` e de `politica-mfa.ts:7-9`, não medição
   no script.
6. **Não li a spec de extensões** (`docs/specs/extensoes-declarativas-v1.md`) nem
   os 11 arquivos de `docs/research/extensoes/` — só confirmei que existem, com
   caminho e commit. O que digo do desenho vem do cabeçalho da migration 0271 e do
   `lib/extensions/http.ts`.
7. **Não medi o número de `event_log` handlers com precisão.** `grep -c register`
   deu 19 ocorrências do token, que **não** é o número de handlers registrados; a
   prosa do repo diz 12. Não reconciliei — e o argumento de §4.3(3) não depende disso.
8. **Não investiguei `app/admin/(protected)/inbox`, `meta` e `cadastro` por dentro.**
   Só registrei que existem e que o `AdminSidebar` as lista com o mesmo comentário
   de "é configuração da INSTALAÇÃO".
9. **O middleware eu MEDI** (ver §6.5) — mas não testei o comportamento dele
   contra um POST de server action; a análise de §6.5 é leitura do `matcher` e do
   corpo de `proxy.ts`, não uma requisição observada.
10. **Não comparei com os outros ~90 worktrees.** Tudo aqui é o SHA `b264bd2d6`.
    Se outra sessão tem trabalho de painel admin em andamento, não o vi.
