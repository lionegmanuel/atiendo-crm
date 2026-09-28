# Investigação A — O que impacta: inventário das bases que condicionam um marketplace de extensões

| Campo | Valor |
|---|---|
| Worktree | `/Users/rafaelmelgaco/wt/marketplace-ext` |
| Branch | `feat/marketplace-de-extensoes` |
| SHA base | `8ad4e257257f1f30a2d26de59229b93fa8915b6b` (topo de `origin/main`) |
| `git status --porcelain` no início | **vazio** (0 linhas — `git status --porcelain \| wc -l` → `0`) |
| Data | 2026-09-17 |
| Autor | Investigação A do épico *Marketplace e Extensões* |

**Régua de confiança.** Cada achado abaixo é marcado:

- **CONFIRMADO** — li o código citado (`arquivo:linha`) ou rodei o comando citado e transcrevi a saída.
- **INFERIDO** — deriva de leitura de outro artefato, sem execução direta que o prove.
- **PROPOSTO** — desenho meu, não existe no repositório.

Onde a afirmação pôde virar comando, está o comando — número envelhece, `rode isto` não.

> **Status:** completo. Oito seções, terminando pelo que não foi medido.

---

## 2. O ciclo de vida que já existe, peça por peça

**CONFIRMADO.** A tabela abaixo foi montada lendo os arquivos citados. Reproduza o esqueleto com:

```bash
cd /Users/rafaelmelgaco/wt/marketplace-ext
find app/api/v1/extensions -name route.ts | sort            # as portas HTTP
grep -n '^create or replace function' supabase/migrations/20260917120000_0271_extensoes_declarativas.sql
grep -n 'export async function\|rpc(\|action:' lib/extensions/service.ts
```

| Etapa | Porta HTTP | RPC do banco | Serviço | Tela / componente | Quem tem autoridade |
|---|---|---|---|---|---|
| **Admissão de catálogo** | `POST /api/v1/extensions/catalogs` (`app/api/v1/extensions/catalogs/route.ts:13`) — corpo `application/json` até 512 KiB, `Idempotency-Key` UUID | `fn_extensions_admit_catalog(p_actor,p_operation,p_snapshot,p_digest)` (migration :148) | `admitExtensionCatalog` (`lib/extensions/service.ts:641`) | `components/extensions/ExtensionCatalog.tsx` | **Administrador da instalação**: `requireSupportWrite()` + `requireExtensionPlatform()` (`lib/extensions/http.ts:29`) — exige `is_platform_admin`, `support` falso, `platform_admins.scope = 'full'` e 2FA quando `mfa_required` ou já há fator (`http.ts:43`, `:70`, `:80`) |
| **Preparação (install / update / troca / reinstalação)** | `POST /api/v1/extensions/install` (`install/route.ts:10`) | `fn_extensions_prepare_install(...,p_expected_installation_revision)` (migration :242) | `installExtension` (`service.ts:683`, RPC em `:689`) | `ExtensionCatalog.tsx` + `ExtensionOperations.tsx` | Mesma guarda de instalação (`install/route.ts:12-15`) |
| **Download** | — (não há porta; é saída do servidor) | — | `downloadArtifact` (`lib/extensions/download.ts`), chamada dentro de `installExtension` | — | Servidor. A UI **não** pode passar URL de pacote: o corpo aceita só `catalog_id`/`publisher`/`name`/`version` (`lib/extensions/requests.ts:9-22`) |
| **Conclusão** | mesma porta `install` (mesmo request) | `fn_extensions_finish_install(p_actor,p_operation,p_manifest,p_sha256,p_byte_length,p_document)` (migration :324) | `service.ts:781` | `ExtensionOperations.tsx` | idem |
| **Falha de preparação** | — | `fn_extensions_fail_install(p_actor,p_operation,p_error_code)` (migration :430) | `service.ts:751` | recibo na gestão | idem |
| **Cancelar preparação** | `POST /api/v1/extensions/operations/:id/cancel` | `fn_extensions_cancel_install(p_actor,p_operation)` (migration :456) | `cancelExtensionInstall` (`service.ts:821`) | `ExtensionOperations.tsx` | Qualquer administrador da instalação; **retomar** é só de quem pediu (o banco confere o ator) — spec §"Operação recuperável" |
| **Ativação + configuração por organização** | `PUT /api/v1/extensions/:id/configuration` (`[id]/configuration/route.ts:16`) | `fn_extensions_configure(p_actor,p_organization,p_installation,p_operation,p_expected_revision,p_enabled,p_configuration)` (migration :474) | `configureExtension` (`service.ts:965`, RPC `:1002`) | `components/extensions/InstalledExtensionCard.tsx` | **Administrador da organização**: `requireRole("admin", { resource: "organization_extensions" })` (`configuration/route.ts:23`) |
| **Atualizar / trocar versão** | reusa `POST /api/v1/extensions/install` (spec :69) | `prepare_install` + `finish_install` | `service.ts:683` | `ExtensionCatalog.tsx` | Administrador da instalação |
| **Desfazer a última troca** | `POST /api/v1/extensions/:id/revert` (`[id]/revert/route.ts:15`) | `fn_extensions_revert_install(p_actor,p_operation,p_installation,p_expected_installation_revision)` (migration :537) | `revertExtension` (`service.ts:850`, RPC `:890`) | `InstalledExtensionCard.tsx` | Administrador da instalação (`revert/route.ts:20-23`). **Não baixa nada** — funciona com o catálogo fora do ar |
| **Remover da instalação** | `POST /api/v1/extensions/:id/remove` | `fn_extensions_remove_installation(...)` (migration :597) | `removeExtension` (`service.ts:921`, RPC `:927`) | `InstalledExtensionCard.tsx` | Administrador da instalação |
| **Leitura da gestão** | `GET /api/v1/extensions` (`extensions/route.ts:8`) | `fn_extensions_installation_counts(p_actor)` (migration :657) quando o ator administra | `listExtensions` (`service.ts:292`, RPC `:334`) | `components/extensions/ExtensionsManager.tsx` | `requireRole("viewer", { resource: "extension_installations" })` — **todo membro vê**; as ações administrativas é que somem |
| **Uso (guia + ação)** | `GET /api/v1/extensions/:id` (`[id]/route.ts:8`) e `POST /api/v1/extensions/:id/open` (`[id]/open/route.ts:15`) | — (leitura sob RLS) | `loadExtensionGuide` (`service.ts:520`), `loadCrmExtensions` (`service.ts:570`) | `components/extensions/ExtensionGuide.tsx`; cards no hub CRM | `requireRole("viewer", …)` nas duas |
| **Recibos** | `GET /api/v1/extensions/operations/:id` (`operations/[id]/route.ts:12`) | — | `readExtensionOperation` (`service.ts:604`) | `ExtensionOperations.tsx` + `components/extensions/receipt-storage.ts` (UUID de reconciliação no navegador) | `requireRole("viewer", { resource: "extension_operations" })` |

**Ações de auditoria que o ciclo emite** (CONFIRMADO — `grep -n 'action:' lib/extensions/service.ts`): `extension.catalog_admitted` (:662), `extension.install_failed` / `extension.update_failed` (:760), `extension.updated` (:795), `extension.installed` (:809), `extension.preparation_cancelled` (:833), `extension.reverted` (:900), `extension.removed` (:939), `extension.deactivated_by_removal` (:952), `extension.configured` / `extension.deactivated` (:1015).

**O que isto obriga o marketplace a respeitar:**

- **CONFIRMADO** — não existe "instalar com um clique a partir de uma URL". A única entrada de pacote é `catalog_id` + identidade (`requests.ts:9-22`); a URL do pacote é construída no servidor. Uma vitrine com botão "Instalar" precisa **primeiro** fazer o operador admitir um catálogo por arquivo.
- **CONFIRMADO** — o header `Idempotency-Key` é UUID **obrigatório** em toda mutação (`http.ts:95-105`, 422 quando falta). Qualquer cliente novo (CLI, script do kit) tem de gerá-lo.
- **CONFIRMADO** — `X-Expected-Organization-Id` é obrigatório nas rotas de organização (`http.ts:112-127`): ausência é 400, divergência é `extension_context_changed`. Um cliente fora do browser precisa saber a organização antes de chamar.

---

## 3. O contrato do pacote hoje, exaustivo

**CONFIRMADO** — tudo abaixo sai de `lib/extensions/manifest.ts` no SHA base. Para reler sem confiar nesta seção:

```bash
sed -n '6,20p'   lib/extensions/manifest.ts   # EXTENSION_LIMITS
sed -n '89,134p' lib/extensions/manifest.ts   # slug, semver, ícones, permissões, dependências
sed -n '368,392p' lib/extensions/manifest.ts  # checkCompatibility
```

### 3.1 Vocabulário fechado (todos os valores admitidos, sem exceção)

| Campo | Valores admitidos | Onde |
|---|---|---|
| `format_version` | `1` e só | `manifest.ts:138` (`z.literal(1)`) |
| `profile` | `"declarative"` e só | `manifest.ts:139` |
| `license` | `"MIT"` e só | `manifest.ts:143` (e `:216` no catálogo) |
| `permissions` | **exatamente uma**: `["navigation.tasks"]` — é `z.tuple([z.literal(...)])`, não array | `manifest.ts:133` |
| `dependencies` | **tupla vazia** `[]`; qualquer elemento é erro de schema | `manifest.ts:134` |
| `data.mode` | `"none"` e só | `manifest.ts:147` |
| `display.category` | `"productivity"` \| `"sales"` \| `"service"` | `manifest.ts:121` |
| `display.icon` e `crm_cards[].icon` | `"ListChecks"` \| `"BookOpen"` \| `"Lightbulb"` — **três ícones, fim** | `manifest.ts:98` |
| `configuration.density` | `"comfortable"` \| `"compact"` | `manifest.ts:128` |
| `configuration.show_description` | booleano | `manifest.ts:129` |
| `contributions.crm_cards[].action.capability` | `"tasks.open"` e só | `manifest.ts:175` |
| `contributions` | **só** a chave `crm_cards`; objeto `.strict()` | `manifest.ts:150-189` |
| Idiomas de `LocalizedText` | `"pt-BR"` obrigatório, `es` opcional; `.strict()` recusa qualquer outro | `manifest.ts:106` |
| `host_api` | `{min,max}` inteiros positivos, `min <= max`; host atual = **1** | `manifest.ts:109-115`, `HOST_API_VERSION` em `:87` |
| `publisher`, `name`, `crm_cards[].id` | slug ASCII `^[a-z0-9]+(?:-[a-z0-9]+)*$`, 2–64 | `manifest.ts:89-93` |
| `version` | SemVer estrito `x.y.z`, sem pré-release, sem build, sem zeros à esquerda | `manifest.ts:94-97` |
| `sha256` (catálogo) | `^[a-f0-9]{64}$` | `manifest.ts:219` |
| `origin` (catálogo) | origem exata: http/https, sem credencial, path `/`, sem query/fragmento, `url.origin === value` | `manifest.ts:193-208`, usada em `:227` |

### 3.2 Limites numéricos (`EXTENSION_LIMITS`, `manifest.ts:6-20`)

| Limite | Valor | Onde aplica |
|---|---|---|
| `packageBytes` | 64 KiB (`64 * 1_024`) | `parseManifest` (`:349`); também teto de `byte_length` no catálogo (`:220`) e conferido em `validateArtifact` (`:430`) |
| `catalogBytes` | 512 KiB | `parseCatalog` (`:353`); e o teto do corpo HTTP em `catalogs/route.ts:20` |
| `jsonDepth` | 12 | parser estrito e `validateSnapshotStructure` (`:303`) |
| `jsonNodes` | 20 000 | idem (`:288`, `:307`, `:334`) |
| `objectProperties` | 32 por objeto | idem (`:324`) |
| `catalogEntries` | 128 | `catalogSchema` (`:229`) |
| `catalogRevision` | 999 999 999 | `:228` |
| `versionCharacters` | 64 | `semverSchema` (`:96`) |
| `cards` | 4 por pacote | `:181` |
| `blocksPerCard` | 8 | `:171` |
| `titleCharacters` | 100 (título, heading de bloco, label da ação) | `:119`, `:159`, `:166`, `:174` |
| `descriptionCharacters` | 400 (summary e description de card) | `:120`, `:160` |
| `bodyCharacters` | 2 000 (corpo de bloco) | `:167` |

Limites **fora** de `EXTENSION_LIMITS`, que também condicionam: corpo de requisição de mutação = 4 096 bytes, profundidade 6, 64 nós, 12 propriedades (`lib/extensions/requests.ts:43-49`); leitura do corpo com prazo de 15 s (`lib/extensions/http.ts:170`); `maxDuration = 30` na rota de instalação (`install/route.ts:8`). Limites declarados na spec mas **não** em `manifest.ts`: 8 extensões ativas por organização, 8 catálogos admitidos, 128 identidades por instância, download com prazo total de 15 s (spec :59) — **INFERIDO** que moram na migration/`download.ts`, não medido por mim.

### 3.3 O que um pacote NÃO consegue fazer

**CONFIRMADO** por ausência no schema `.strict()` de `manifest.ts:136-191` (propriedade desconhecida é erro) e por `checkCompatibility` (`:368-388`):

1. **Não executa código.** Não há campo para JS, WASM, URL de script ou expressão. O único conteúdo é texto localizado.
2. **Não traz SQL nem cria tabela.** `data.mode` só aceita `"none"` (`:147`).
3. **Não lê nem escreve dado do CRM.** Nenhuma capacidade de leitura existe; a única é `tasks.open`, que **abre uma tela** e não devolve dados (doutrina nº 2; spec :106).
4. **Não pede permissão nenhuma além de `navigation.tasks`.** `permissionsSchema` é tupla de um literal (`:133`); `checkCompatibility` recusa com `permission_unsupported` qualquer outra (`:378-380`).
5. **Não depende de outra extensão.** `dependencies` é tupla vazia; `dependency_unsupported` (`:381-383`).
6. **Não traz asset.** Sem URL de imagem, sem CSS, sem fonte. Ícone é um de três nomes.
7. **Não escolhe onde aparece.** O único ponto de contribuição é `crm_cards` — cards no hub CRM. Não há `menu`, `route`, `webhook`, `hook`, `settings_page`, `ai_tool`.
8. **Não configura nada próprio.** `configuration` é um esquema **do host** com dois campos (`configurationSchema`, `:126-131`); não há campo livre, nem texto de configuração do publicador.
9. **Não fala mais que dois idiomas.** `pt-BR` + `es` opcional (`:106`).
10. **Não usa `__proto__`/`prototype`/`constructor`** nem string com NUL ou surrogate solto (`:88`, `:256-270`, `:325`).
11. **Não tem preço, autor, homepage, repositório, screenshot, tags, changelog nem README.** Nenhum desses campos existe no manifesto nem em `CatalogEntry` (`:59-62`, `:210-222`). **Isto é o achado mais pesado para uma vitrine**: hoje não há onde guardar nada que uma vitrine precisa mostrar além de título, resumo, categoria, ícone, versão, licença, publicador, digest e tamanho.

---
## 4. Os pontos de extensão que o núcleo NÃO tem

### 4.1 A navegação é estática em tempo de compilação — **CONFIRMADO**

`NAV_CATALOG` é um literal congelado: `lib/navigation/catalogo.ts:105` abre o array e `:705` fecha com
`] as const satisfies readonly NavMetadata[]`. Não é função, não recebe argumento, não consulta nada.

```bash
grep -rnE "await |async |supabase|createClient|fetch\(" lib/navigation/ | wc -l   # → 0
```

Zero. **Nenhum arquivo de `lib/navigation/` é assíncrono, toca banco ou faz rede.** Uma extensão não
pode acrescentar uma porta: o único jeito de uma tela nascer no menu é um commit no núcleo, e
`tests/unit/navegacao-completude.test.ts` reprova o CI se uma rota nascer fora daqui (comentário em
`catalogo.ts:13-14`). A entrada de Extensões é ela própria uma linha estática — `catalogo.ts:697`
(`href: "/app/extensions"`).

**Consequência para o épico:** a vitrine, se for uma tela do produto, é mais uma linha em
`NAV_CATALOG` (DoD 14). E uma extensão instalada **continua sem porta própria** — ela só aparece
como card no hub CRM.

### 4.2 Nenhuma rota do app é condicional a módulo ativo — **CONFIRMADO**

Só **dois** arquivos fora da feature importam código de extensões:

```bash
grep -rn --include='*.ts' --include='*.tsx' "@/lib/extensions" app components lib workers hooks \
  | grep -vE "^(lib|components)/extensions/|^app/(api/v1|app)/extensions/"
```

Saída (2 arquivos, 4 linhas):

- `app/app/crm/page.tsx:4` → `loadCrmExtensions`; `:6` → `type ExtensionGuideView`
- `components/shell/NavHub.tsx:6` → `localize`, `type ExtensionManifest`; `:7` → `type ExtensionGuideView`

Os dois **consomem** contribuições para desenhar cards; nenhum **condiciona a própria existência** a
uma extensão. Isto é exatamente o não-negociável nº 1 em código.

Os arquivos que citam a tabela `organization_extensions` são 6, e todos pertencem à feature ou são
gerados/teste:

```bash
grep -rln --include='*.ts' --include='*.tsx' "organization_extensions" app components lib workers hooks
# app/api/v1/extensions/[id]/{configuration,route,open} · lib/database.types.ts
# lib/extensions/service.ts · lib/extensions/service.test.ts
```

**Não existe middleware de rota no repositório** — `find . -name "middleware.ts" -not -path "*/node_modules/*" | wc -l` → `0`. Não há, portanto, camada onde um gate "módulo ativo?" pudesse ser aplicado hoje.

### 4.3 Nenhuma ferramenta de IA vem de extensão — **CONFIRMADO**

O catálogo MCP é montado por `import` estático em `lib/mcp/tools/index.ts:12-49+`, arquivo de 188
linhas sem registro dinâmico:

```bash
grep -rn "registerTool\|addTool\|push(" lib/mcp/tools/index.ts
# única linha: :94, e é COMENTÁRIO ("cada handler valida no Zod do registerTool")
grep -rn --include='*.ts' -i "extension" lib/ai lib/agent-engine
# 6 linhas, TODAS em lib/ai/skills/package.ts sobre extensão de ARQUIVO (png/jpg/pdf) — falso positivo
```

A spec confirma pelo outro lado (`docs/specs/extensoes-declarativas-v1.md:159`): *"Não cria
ferramentas de IA, handoff, envio ou autoridade nova; essas integrações pertencem aos marcos
seguintes."*

**A única capacidade que existe é `tasks.open`**, e ela abre uma tela — não devolve dado nem entra
no prompt de nenhum agente.

### 4.4 Resumo do que NÃO existe

| Ponto de extensão | Existe? | Prova |
|---|---|---|
| Item de menu vindo de extensão | **Não** | `lib/navigation/` é 100% estático (0 linhas async/db/fetch) |
| Rota/página vinda de extensão | **Não** | não há middleware; `app/app/extensions/[id]/page.tsx` é rota do núcleo que renderiza texto |
| Ferramenta de IA vinda de extensão | **Não** | `lib/mcp/tools/index.ts` é import estático; zero menção a extensões |
| Webhook/hook/evento de extensão | **Não** | `contributions` só aceita `crm_cards` (`manifest.ts:150-189`) |
| Tabela/schema de extensão | **Não** | `data.mode: "none"` obrigatório (`manifest.ts:147`); ADR-0002 aceita mas **não construída** |
| Asset (imagem, CSS, fonte) de extensão | **Não** | nenhum campo de URL no manifesto; 3 ícones nomeados |
| Execução de código de terceiro | **Não** | doutrina "O que existe hoje", coluna do meio |

---
## 5. O que já existe e pode ser REUSADO pela vitrine

### 5.1 As skills embutidas: fonte, espelho, gate e **um instalador que já distribui** — CONFIRMADO

| Peça | Onde | O que é |
|---|---|---|
| Fonte | `.agents/skills/<nome>/SKILL.md` — 7 skills, 42 arquivos (`find .agents/skills -type f \| wc -l` → 42) | padrão aberto Agent Skills; frontmatter `name` + `description` (+ `metadata` livre) |
| Espelho | `.claude/skills/<nome>/` — as mesmas 7 | gerado por `pnpm skills:sync` (`scripts/sincronizar-skills.ts`, `package.json:33`) |
| Forma portátil | `.agents/skills/<nome>/agents/openai.yaml` — 1 por skill | (`diff -rq` mostra que o espelho `.claude/` **não** leva a pasta `agents/`) |
| Gate | `tests/unit/skills-embutidas.test.ts` (229 linhas) | reprova espelho divergente, skill escondida por `.gitignore`, frontmatter fora do padrão, orçamento de 8 000 caracteres do Codex e skill dentro da imagem Docker |
| Registro | `.agents/rules/deskcomm-guias.md` (`trigger: always_on`) | a tabela "quando usar cada guia" |
| **Distribuição** | **`scripts/instalar-guias.sh`** (280 linhas) + `tests/shell/instalar-guias.test.sh` (21 casos) | `curl -fsSL …/scripts/instalar-guias.sh \| bash` mantém um **clone esparso da `main` em `~/.deskcomm/guias`** e liga cada `deskcomm-*` por link simbólico em `~/.claude/skills`, `~/.agents/skills` e `~/.gemini/config/skills` |

**Este é o achado mais reusável do inventário.** Já existe, provado por teste de shell, um canal de
distribuição de artefatos do projeto para a máquina de quem usa, com: não-sobrescrita de artefato
alheio, marca de procedência (`.deskcomm-fonte`), atualização por reexecução, `--remover` que só
apaga o que ele criou, e fallback de cópia onde não há link simbólico. Uma skill nova de
"criar extensão" **entra por esse caminho sem construir nada**.

**O que isto obriga:** skill nova exige (a) pasta em `.agents/skills/`, (b) `pnpm skills:sync` para
o espelho, (c) linha em `.agents/rules/deskcomm-guias.md`, (d) caber no orçamento de 8 000
caracteres de descrição somadas, (e) o `--help` de `instalar-guias.sh` cita os guias **pelo nome**
(`scripts/instalar-guias.sh:7-9`) — acrescentar um sem atualizar ali deixa o texto mentindo.

**INFERIDO:** a prosa de `.agents/rules/deskcomm-guias.md:6` diz *"guias para cinco situações"* e
lista 5 bullets + 2 no fim (7 skills no disco). Uma skill nova de extensões torna esse "cinco" uma
afirmação de estado vencida (DoD 16). Não medi se algum gate lê esse número.

### 5.2 Não existe geração de página estática neste repositório — CONFIRMADO

```bash
grep -rn --include='*.tsx' --include='*.ts' "generateStaticParams" app lib | wc -l   # → 0
grep -n "output" next.config.ts        # :17 → standalone (ou undefined na Vercel); nada de "export"
```

Nenhum `output: "export"`, nenhum `generateStaticParams`. **O repositório não sabe produzir um site
estático.** Uma vitrine pública não nasce daqui sem trabalho novo — ou nasce noutro lugar (5.3).

### 5.3 A "vitrine" pública já existe, com esse nome, **e mora em outro repositório** — CONFIRMADO

`docs/doctrine/versionamento.md:198` abre a seção **"A vitrine"**: a LP em
`www.deskcomm.com.br`, repositório **`deskcomm-site`**, com `/changelog`, `/en/changelog`,
`/es/changelog` (página por versão em `/changelog/X.Y.Z`) e **`/guias`**. Ela lê o `CHANGELOG.md`
da `main` deste repo e revalida a cada 10 minutos; ninguém escreve release no site.

O acoplamento é auditado dos dois lados: `tests/unit/release-chega-na-lp.test.ts` guarda a FORMA do
cabeçalho `## [X.Y.Z] — AAAA-MM-DD` que `deskcomm-site/lib/changelog.ts` lê, e o job `cortar-tag`
**reprova a release** se a versão não aparecer nas três páginas em ~35 tentativas.

Para saber se as páginas estão no ar (comando, não frase — `versionamento.md:213-217`):

```bash
for p in /changelog /en/changelog /es/changelog /guias; do
  echo "$p: $(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://www.deskcomm.com.br$p")"
done
```

**Evidência de como aquela página foi provada** (reusável como molde de QA da vitrine nova):
`evidence/lp-guias-changelog/2026-09-15/` — `prova.mjs` dirige Chromium em **3 idiomas × 10
larguras** (360…1440 px), verifica vazamento de `undefined`/`NaN`/`[object Object]`, rolagem
horizontal, `lang`/canonical, filtro por público, abas por teclado, botão de copiar contra a área de
transferência, e tira a régua do próprio `CHANGELOG.md` em vez de um número escrito à mão. 533
verificações verdes (`run.txt`).

**Consequência dura para o épico:** *"vitrine"* já é um termo ocupado, e o lugar natural de uma
vitrine pública de extensões é o `deskcomm-site` — **fora deste repositório e fora do alcance dos
gates deste CI**. Qualquer item do épico que diga "página pública" atravessa uma fronteira de
repositório.

### 5.4 Artefato público de descoberta: `public/llms.txt` — CONFIRMADO

`public/llms.txt`, 27 linhas, **escrito à mão** (nenhum gerador: `grep -rn "llms.txt"` acha só
`HANDOFF-marca-propria.md` e `app/icon.tsx`). Traz categoria, fatos-chave e uma seção `## Docs` com
links absolutos para o GitHub. Um marketplace descobrível por IA acrescenta linhas aqui — é o único
arquivo do repo cujo propósito declarado é ser lido por um modelo.

### 5.5 Fragmentos de release: `.changes/` — CONFIRMADO

Existe `CHANGELOG.md` e um diretório `.changes/` com fragmentos por PR (`ls .changes | wc -l`
mostra o estoque atual), consumidos por `pnpm release:conferir` / `release:cortar`
(`scripts/cortar-release.ts`, `package.json:34-35`). É o canal por onde "capacidade nova" chega a
quem opera uma VPS — **e por onde a vitrine chega ao público**, via LP.

### 5.6 O kit de instalação **não sabe que extensões existem** — CONFIRMADO

```bash
grep -rn -i "extens" hostgator-setup-kit/
```

13 linhas, **todas** sobre `create extension` do Postgres (vector/citext/pg_trgm), "sim por
extenso" ou "extensão do gawk". **Nenhum script do kit** (`install.sh`, `update.sh`, `agent.sh`,
`comecar.sh`, `diagnostico.sh`, `healthcheck.sh`, `backup.sh`, `restore.sh`, …) menciona a feature.

Onde um comando de extensão **caberia** (PROPOSTO, não existe):
- `comecar.sh` — o menu de primeira execução, onde caberia "quer instalar um pacote?";
- `diagnostico.sh` — não reporta catálogos admitidos, instalações nem preparações penduradas;
- `update.sh` — não avisa que uma preparação em curso recusa a atualização do core (não-negociável 10).

A única pegada da feature na instalação é `EXTENSIONS_LOCAL_CATALOG_ORIGIN=` em `.env.example:445`
e `lib/env.ts:80` — vazia por padrão, e **de laboratório**.

---

## 6. As leis que o épico não pode violar

Cada linha cita o não-negociável de `docs/doctrine/extensoes.md` e diz o que ele **proíbe na
prática** para um marketplace. Todos **CONFIRMADO** (li o arquivo).

| Nº | O que a lei diz | O que proíbe para o marketplace |
|---|---|---|
| **1** | Zero extensões é estado de primeira classe (:50) | Proíbe a vitrine virar dependência: nenhuma tela do núcleo pode exigir catálogo no ar, e a página de extensões tem de funcionar com catálogo vazio e com a rede caída |
| **2** | Extensão pede capacidade nomeada; não lê o banco (:56) | Proíbe a vitrine prometer "plugin que integra com X" — a única capacidade é `tasks.open`; qualquer card de vitrine que sugira acesso a dados mente |
| **3** | Instalar não é autorizar (:61) | Proíbe "instalar em um clique concede permissões"; e proíbe a vitrine ler, entre organizações, qualquer coisa além de contagem (`fn_extensions_installation_counts`) |
| **4** | A instância decide o pacote; a organização decide o uso (:68) | Proíbe a vitrine oferecer "instalar" a quem não é admin da instalação com `scope='full'`, e proíbe reativar por conta própria depois de reinstalar |
| **5** | Toda operação é recibo durável com saída pela tela (:75) | Proíbe botão de instalar sem `Idempotency-Key`, sem recibo e sem tela de retomada/cancelamento |
| **6** | Toda troca de ponteiro exige a precondição do que a tela viu (:81) | Proíbe "atualizar tudo" em lote a partir da vitrine sem carregar `expected_installation_revision` de cada instalação |
| **7** | Tirar é lógico e preserva dados (:86) | Proíbe "desinstalar" na vitrine que apague linha; remover é lógico e preserva recibos/configuração |
| **8** | O instalado não depende do catálogo (:90) | Proíbe a vitrine virar fonte de verdade do instalado; e proíbe anunciar TUF — a admissão manual **não é TUF** |
| **9** | Schema de extensão segue a doutrina de migrations (:95) | Proíbe pacote de terceiro com SQL. Tabela de módulo **oficial** só pela função provisionadora da ADR-0002 — **aceita em 17/09/2026 e não construída** |
| **10** | Publicar espera o sistema; tirar não espera (:107) | Proíbe a vitrine disparar instalação sem checar atualização do core `dispatched` < 15 min (`RUN_STALE_AFTER_MS`) |
| **11** | **Não anunciar o que não existe** (:111) | **O mais restritivo do épico.** Proíbe *"Tela, README ou changelog não prometem SDK, execução isolada de código, marketplace público ou avaliações antes da prova deles."* A palavra **"marketplace público"** está escrita na lei como coisa que não se anuncia antes de existir. Uma vitrine que liste extensões que ninguém pode instalar, ou que mostre estrelas/downloads que não são medidos, viola esta linha diretamente |
| **12** | Recurso já distribuído não é extraído do núcleo sem equivalência e migração (:116) | Proíbe a vitrine "modularizar" o que já está entregue; nada sai do núcleo para virar item de catálogo |
| **13** | As três políticas do DEC-004 (:120) | Ver abaixo — é a lei que mais amarra a vitrine |

### 6.1 O nº 11 em detalhe — o que a vitrine pode e não pode dizer

O texto (`docs/doctrine/extensoes.md:111-114`) proíbe nominalmente prometer, antes da prova:
**SDK**, **execução isolada de código**, **marketplace público** e **avaliações**. E define o que
um candidato a extensão precisa ter para ser chamado de extensão: *"instalação, permissões,
compatibilidade, atualização, desativação e preservação de dados"* — o perfil declarativo v1 tem
os seis; um "plugin" novo que não os tenha não pode ser listado.

Teste prático para o épico: **toda palavra da vitrine tem de ter artefato.** "Instalar" tem
(`POST /install`). "Avaliar" **não tem** — não existe tabela, rota nem coluna de avaliação
(`grep -rn "rating\|avaliac" lib/extensions/` — ver seção 8, não medi isso). "Baixar" não tem
contador.

### 6.2 O nº 13 — as três políticas do DEC-004, e o que cada uma amarra

1. **Catálogo oficial é revisado** (`:121-123`). Qualquer criador pode enviar; validação automática
   + revisão proporcional ao perfil **antecedem** a publicação. **Teste verde não é selo**, e
   **catálogo alternativo não recebe o selo oficial.**
   → Proíbe publicação automática por merge de PR. Obriga um passo humano de revisão e uma
   distinção visual entre "oficial" e "de terceiro" em qualquer lista.
2. **Aviso sobre versão já instalada deixa a decisão local** (`:124-128`). *"Nenhuma origem
   desliga, pausa ou altera em silêncio uma extensão numa VPS."* Suspensão automática só como
   política local previamente autorizada, reagindo a comunicado autenticado. *"Um comunicado do
   catálogo nunca é comando no host."*
   → Proíbe kill-switch, proíbe "despublicar" que desligue instalações, proíbe atualização
   automática empurrada pela vitrine. Catálogo fora do ar, sozinho, não desliga nada (coerente com
   o nº 8).
3. **Métricas começam por downloads e avaliações** (`:129-135`). Qualquer telemetria de uso — *"venha
   da VPS ou de outro ponto, com ou sem identificador"* — **pede decisão própria antes**.
   Identificador persistente é pseudônimo, **não entra por padrão**. *"O painel diz que downloads
   não são usuários ativos, e toda métrica publica método e limitações."*
   → Proíbe contar instalações a partir da VPS. Downloads só podem ser contados **no servidor de
   catálogo**, e o painel tem de dizer, na tela, que download ≠ usuário ativo. Uma barra de
   "10 mil instalações ativas" é violação dupla (telemetria sem decisão + métrica sem método).

### 6.3 As leis de fora da doutrina de extensões que também alcançam o épico

- **DoD 18** (`CLAUDE.md:616`) — todo PR do épico declara destino (núcleo / extensão / ambos /
  infraestrutura) com a razão medida pela pergunta-raiz. A própria vitrine é **núcleo ou
  infraestrutura**, nunca extensão.
- **DoD 14** (`CLAUDE.md:18` da seção) — tela nova entra em `NAV_CATALOG` (`lib/navigation/catalogo.ts`) ou na allowlist com justificativa escrita.
- **DoD 13 / sistema-vivo** — peça nova precisa de entrada, saída, registro visível, porta, anti-morte, laço de retorno e ≥2 arestas em `docs/architecture/`.
- **DoD 12 / QA Visual** — jornada de instalar/ativar/usar tem de ser provada **pela tela**, em banco fresco do `baseline.sql` + `bootstrap-owner.ts`, com envs opcionais ausentes. `curl` não conta.
- **DoD 17 / versionamento** — fragmento em `.changes/` declarando o efeito no operador.
- **Doutrina de packaging** — a vitrine não pode pedir edição manual de `.env`/compose na VPS; nenhum serviço novo pode ser `build:`-only.
- **Doutrina de migrations** — qualquer tabela nova (ex.: contador de downloads) sai como migration + apêndice idempotente no `baseline.sql` + MANIFEST, com `revoke execute … from public, anon`.
- **TRIAGEM 2-bis** (`triagem/TRIAGEM.md:137`) — já classifica PR por destino hoje; a mesma tabela da doutrina, replicada. **Mudar a régua obriga a mudar os dois arquivos.**

---
## 7. Para entregar X, o épico obrigatoriamente toca Y

Régua: **CONFIRMADO** onde a coluna "O que existe" cita arquivo/linha medido; **PROPOSTO** onde a
coluna diz "não existe".

| O épico quer… | Existe hoje | O que ele obrigatoriamente toca | Lei que o amarra |
|---|---|---|---|
| **1. Vitrine onde qualquer um descobre extensões** | `components/extensions/ExtensionCatalog.tsx` lista **só catálogos já admitidos na instalação** — não há descoberta pública | **Fora deste repo:** `deskcomm-site` (o `/guias` e `/changelog` são o molde). **Dentro:** `public/llms.txt` para descoberta por IA; nenhuma geração estática existe aqui (`generateStaticParams` → 0) | Não-neg. **11** (não anunciar marketplace público antes da prova); DEC-004 §1 (selo oficial ≠ catálogo alternativo) |
| **1a. Botão "instalar na minha VPS" a partir da vitrine** | Impossível hoje: `install` só aceita `catalog_id` de catálogo **admitido por arquivo** (`lib/extensions/requests.ts:11`) | `POST /api/v1/extensions/catalogs` + `ExtensionCatalog.tsx` (fluxo de admissão); ou um caminho novo de admissão, que muda o modelo de confiança | Não-neg. **8** (admissão manual não é TUF; distribuição pública espera o verificador); spec :88-94 |
| **1b. Contagem de downloads na vitrine** | **Não existe** — `grep -rnwiE "rating\|avaliacao\|review\|download_count\|downloads\|install_count"` sobre toda a feature devolve **1 linha, e é um comentário** (`components/extensions/ExtensionsManager.test.tsx:1334`) | Servidor de catálogo (processo separado, SQLite — spec :98), **nunca** a VPS | DEC-004 §3: métrica com método publicado; "downloads não são usuários ativos" impresso no painel |
| **1c. Avaliações / estrelas** | **Não existe** (mesmo comando acima) | Servidor de catálogo + moderação | Não-neg. **11** (não prometer avaliações antes da prova) + DEC-004 §1 |
| **1d. Página/descrição rica de cada extensão** | **Impossível com o contrato atual**: `ExtensionManifest` não tem homepage, repositório, autor, screenshot, tags, changelog nem README (`lib/extensions/manifest.ts:29-57`) | `lib/extensions/manifest.ts` (schema `.strict()`), `CatalogEntry`, a migration (manifesto persistido é revalidado) e **toda instalação existente** | Não-neg. **6** (troca de ponteiro com precondição) + doutrina de migrations (tripla) |
| **2. Doutrina + skill embutida que ensine a criar extensão** | 7 skills em `.agents/skills/`; `deskcomm-contribuir` é o molde (`references/` + `scripts/` + `agents/openai.yaml`); doutrina já escrita em `docs/doctrine/extensoes.md` | `.agents/skills/<nova>/SKILL.md`; `pnpm skills:sync`; `.agents/rules/deskcomm-guias.md`; `tests/unit/skills-embutidas.test.ts` (orçamento de 8 000 caracteres); `scripts/instalar-guias.sh` (o `--help` nomeia os guias) | DoD 16 (o "cinco situações" do rules vira afirmação vencida) |
| **2a. Redirecionar contribuidor de PR-no-núcleo para extensão** | `triagem/TRIAGEM.md:137` (2-bis) já classifica; `deskcomm-contribuir` é "o espelho da triagem" | `triagem/TRIAGEM.md` §2-bis **e** `docs/doctrine/extensoes.md` (a tabela está duplicada — mudar uma sem a outra as faz divergir) | DoD 18 |
| **2b. Um SDK / kit de criação de pacote** | **Não existe.** O único artefato de autoria é o JSON do manifesto | — | Não-neg. **11** proíbe **anunciar** SDK antes da prova |
| **3. Jornada de instalar/ativar/usar excelente para leigo** | Implementada e provada: `ExtensionsManager.tsx`, `InstalledExtensionCard.tsx`, `ExtensionOperations.tsx`, `ExtensionGuide.tsx`; E2E `tests/e2e/extensoes-declarativas.spec.ts`, `extensoes-recuperacao.spec.ts`, `extensoes-versao.spec.ts` (J25/J26) | Esses componentes + `docs/testing/user-journey-map.md` (jornada nova) + evidência visual | DoD 12 (banco fresco do `baseline.sql`, envs opcionais ausentes) |
| **3a. Porta na navegação para a vitrine** | `lib/navigation/catalogo.ts:697` já tem `/app/extensions` (grupo Organização) | `NAV_CATALOG` (`catalogo.ts`) + `lib/navigation/registry.ts` (ícone) + `tests/unit/navegacao-completude.test.ts` | DoD 14 |
| **3b. Extensão que aparece fora do hub CRM** | **Não existe**: `contributions` só aceita `crm_cards` (`manifest.ts:150-189`); navegação é 100% estática | `manifest.ts` (`contributions` novo), `lib/navigation/` (deixaria de ser estático) e `checkCompatibility` | Não-neg. **1** (desligar não pode tirar jornada do ar) + **2** |
| **3c. Comando de extensão no kit da VPS** | **Nenhum** (`grep -rn -i "extens" hostgator-setup-kit/` → 13 linhas, todas `create extension` do Postgres) | `hostgator-setup-kit/comecar.sh` e/ou `diagnostico.sh`; `pnpm test:shell` é o único gate que exercita o kit | Doutrina de packaging + DoD 15 |
| **4. Extensão com dados próprios** | **Aceita e não construída**: ADR-0002 (17/09/2026). `data.mode` só aceita `"none"` | Função provisionadora `security definer` sem parâmetro + molde de teste com módulos instalados + invariante das provisionadoras (nada disso existe) | Não-neg. **9**; ADR-0002 D9 ("pacote de terceiro continua sem trazer SQL") |
| **5. Extensão executando código** | **Não existe** no produto. Há bancada experimental (Wasmtime / contêiner) em `docs/research/extensoes/04` e `07`, e runbook em `experiments/extensoes/README.md` | escolha de executor por evidência (PROG-017 §7 e §14) | Não-neg. **11** proíbe prometer execução isolada antes da prova |
| **6. Ferramenta de IA vinda de extensão** | **Não existe**: catálogo MCP por import estático (`lib/mcp/tools/index.ts`) | `lib/mcp/tools/` inteiro (deixaria de ser estático), `TETO_TOOLS_POR_AGENTE`, pacotes de capacidade (`lib/mcp/tools/pacotes.ts`) | Não-neg. **2** e **3** (instalar não autoriza) |
| **7. Skills de IA distribuídas como extensão** | **Sistema paralelo já existe**: `lib/ai/skills/package.ts` instala pacote `.zip` de skill de agente (limites: 64 arquivos, 5 MiB total, 1 MiB por arquivo, assets em lista fechada) | Reconciliar dois modelos de "pacote de terceiro" que hoje não se falam — a spec já declara que *"Instalações e artefatos não são cópias de skills"* (`extensoes-declarativas-v1.md:102`) | Não-neg. **11** (não chamar de extensão o que não tem os seis atributos) |

### 7.1 As três coisas que o épico não consegue fazer sem mudar o contrato

**CONFIRMADO** por leitura de `lib/extensions/manifest.ts`:

1. **Mostrar qualquer informação de vitrine que não seja título, resumo, categoria, ícone,
   publicador, nome, versão, licença, `host_api`, digest e tamanho.** O schema é `.strict()`; campo
   novo é erro de validação, e o manifesto persistido é **revalidado** a cada uso.
2. **Distinguir extensões entre si visualmente.** Três ícones (`ListChecks`, `BookOpen`,
   `Lightbulb`) e três categorias. Uma vitrine com 50 pacotes teria 3 ícones repetidos.
3. **Instalar de qualquer origem que não seja um catálogo admitido por arquivo.** O servidor
   constrói `/packages/<sha256>.json` na origem admitida e recusa URL vinda do navegador.

E há um **quarto**, que é de política e não de schema: mudar o conjunto de permissões entre versões
*"hoje é impossível, porque a admissão força `["navigation.tasks"]`"* — e a spec já reserva o
código `extension_permissions_changed` para quando deixar de ser
(`docs/specs/extensoes-declarativas-v1.md:86`).

---

## 8. O QUE EU NÃO MEDI

Explícito, para que ninguém leia ausência como negativa:

1. **Não rodei nenhum teste.** Nada de `pnpm test:unit`, `test:db`, `test:e2e`, `test:shell`,
   `typecheck` ou `lint`. Todas as asserções deste documento são **leitura de código e `grep`**,
   nunca execução de suíte. Onde digo "provado", estou repetindo o que a spec ou a doutrina
   afirma — não medi a prova.
2. **Não li o corpo das 13 funções da migration.** Extraí assinaturas, `grant`/`revoke`, tabelas e
   políticas por `grep`. **Não verifiquei** o que cada RPC faz por dentro, nem os `raise`
   (os códigos de erro do banco), nem a lógica de `applied_now`, nem o lock com o atualizador do
   core. Quem precisar disso leia `supabase/migrations/20260917120000_0271_extensoes_declarativas.sql`
   (706 linhas) inteiro.
3. **Não conferi o apêndice do `baseline.sql`.** A doutrina exige migration + apêndice idempotente
   + MANIFEST; **não** verifiquei se as 5 tabelas e as 13 funções estão no `supabase/baseline.sql`
   nem se há linha no `MANIFEST.md`. Comando para conferir:
   `grep -n "extension_installations\|fn_extensions_" supabase/baseline.sql | wc -l` e
   `grep -n "0271" supabase/migrations/MANIFEST.md`.
4. **Não medi os limites que a spec declara e `manifest.ts` não tem**: 8 extensões ativas por
   organização, 8 catálogos admitidos, 128 identidades por instância, prazo de 15 s do download.
   Presumi (INFERIDO) que moram na migration e em `lib/extensions/download.ts`.
5. **Não li `lib/extensions/download.ts`, `strict-json.ts`, `errors.ts`, `erros-do-banco.ts`,
   `instalada.ts`, `versao.ts`, `view.ts`, `vocabulario.ts`, `service.ts` (1 000+ linhas) por
   inteiro** — só grepei símbolos. A guarda de SSRF, o rebinding de DNS e a lista de códigos de
   erro do banco **não foram auditados por mim**.
6. **Não li os 10 relatórios de `docs/research/extensoes/`** além do `README.md`. Em particular, o
   `01-o-que-impacta.md` daquela pasta responde a uma pergunta parecida com a minha, num SHA
   anterior (`25edc35b0`), e **não reconciliei** meus achados com os dele.
7. **Não abri `deskcomm-site`.** Tudo que digo sobre a LP vem de `docs/doctrine/versionamento.md`,
   de `tests/unit/release-chega-na-lp.test.ts` e da evidência em `evidence/lp-guias-changelog/`.
   Não rodei o `curl` das quatro páginas; **não sei se elas respondem 200 hoje**.
8. **Não li os documentos internos de decisão** (PROG-016 a PROG-021, DEC-004). Eles estão **fora
   deste repositório** e a doutrina diz que o que vale para PR é a lei em `docs/doctrine/extensoes.md`.
   Onde cito "PROG-017 §11" estou repetindo o ponteiro da doutrina, não o conteúdo.
9. **Não verifiquei a branch protection.** Repito a lista do `CLAUDE.md`; o comando que a mede é
   `gh api repos/melgarafael/DeskcommCRM/branches/main/protection --jq '.required_status_checks.contexts|join(", ")'`.
10. **Não li `scripts/sincronizar-skills.ts` nem `scripts/skills-embutidas/espelho.ts`.** Descrevi o
    espelho pelo cabeçalho do teste e por `diff -rq` de uma única skill.
11. **Não medi o estoque de `.changes/`** (só vi que o diretório existe e tem fragmentos), nem rodei
    `pnpm release:conferir`.
12. **Não avaliei desempenho de nada** — nem o custo de listar catálogos grandes, nem o efeito dos
    128 itens por catálogo na tela.
13. **Não li `docs/architecture/extensoes-declarativas.architecture.json`**, que é o mapa vivo que o
    DoD 13 cobra.
