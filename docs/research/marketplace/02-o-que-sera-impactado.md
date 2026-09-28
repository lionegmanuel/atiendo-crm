# Investigação B — O que será impactado (guardião do que já funciona)

> Épico **Marketplace e Extensões** · DeskcommCRM
> Pergunta: **o que, hoje funcionando, muda de comportamento ou corre risco de regressão quando o marketplace entrar?**

## 0. Cabeçalho — régua da medição

| Campo | Valor |
|---|---|
| Data | 2026-09-17 |
| Worktree | `/Users/rafaelmelgaco/wt/marketplace-ext` |
| Branch | `feat/marketplace-de-extensoes` |
| SHA base | `8ad4e257257f1f30a2d26de59229b93fa8915b6b` (topo de `origin/main`) |
| `git status --porcelain` | uma única linha: `?? docs/research/marketplace/` (este documento) |
| Modo | **somente leitura**. Nenhum `add`/`commit`/`checkout`/`stash`; nenhum arquivo existente alterado |

Comandos de reprodução do cabeçalho:

```bash
cd /Users/rafaelmelgaco/wt/marketplace-ext
git rev-parse HEAD            # 8ad4e257257f1f30a2d26de59229b93fa8915b6b
git rev-parse --abbrev-ref HEAD  # feat/marketplace-de-extensoes
git status --porcelain | wc -l   # 1
```

**Régua de classificação.** Todo achado deste documento é marcado:

- **CONFIRMADO** — li o artefato e cito `arquivo:linha`, ou rodei o comando e colo a saída.
- **INFERIDO** — deduzi de dois ou mais fatos confirmados, sem executar o caminho.
- **PROPOSTO** — recomendação minha; não descreve o estado do mundo.

Números sem comando ao lado não existem neste documento. Para negar existência eu conto com
`wc -l`, nunca corto com `head`.

_(seções seguintes gravadas incrementalmente)_

---

## 1. O contrato que existe hoje, em uma tela

**CONFIRMADO.** O contrato do pacote é literal em Zod — não é "extensível por configuração",
é fechado por tipo. `lib/extensions/manifest.ts`:

| Campo | Forma hoje | Linha |
|---|---|---|
| `format_version` | `z.literal(1)` | `manifest.ts:138` |
| `profile` | `z.literal("declarative")` | `manifest.ts:139` |
| `license` | `z.literal("MIT")` | `manifest.ts:143` |
| `permissions` | `z.tuple([z.literal("navigation.tasks")])` — **tupla de um elemento** | `manifest.ts:133` |
| `dependencies` | `z.tuple([])` — **tupla vazia** | `manifest.ts:134` |
| `data.mode` | `z.literal("none")` | `manifest.ts:147` |
| `action.capability` | `z.literal("tasks.open")` | `manifest.ts:175` |
| `display.icon` | `z.enum(["ListChecks","BookOpen","Lightbulb"])` | `manifest.ts:98` |
| `crm_cards` | `.max(EXTENSION_LIMITS.cards)` = **4** | `manifest.ts:15,181` |
| blocos por card | `.max(EXTENSION_LIMITS.blocksPerCard)` = **8** | `manifest.ts:16,171` |
| pacote | `packageBytes` = **64 KiB** | `manifest.ts:7` |
| catálogo | `catalogBytes` = **512 KiB**, `catalogEntries` = **128** | `manifest.ts:8,12` |
| todo objeto | `.strict()` — **chave desconhecida REPROVA** | `manifest.ts:124,131,191,222,…` |

E a checagem de compatibilidade repete a regra fora do Zod, em
`lib/extensions/manifest.ts:368-393` (`checkCompatibility`), com estas recusas nomeadas:
`format_version_unsupported`, `profile_unsupported`, `host_api_unsupported`,
`permission_unsupported`, `dependency_unsupported`, `capability_unsupported`
(`manifest.ts:71-77`). As três linhas que fecham o contrato: `manifest.ts:378`
(`permissions.length !== 1`), `:381` (`dependencies.length !== 0`), `:384`
(`capability !== "tasks.open"`).

> **A consequência estrutural, e é o achado nº 1 deste documento.** `permissions` é uma
> TUPLA, não um array. `z.tuple([z.literal("navigation.tasks")])` aceita exatamente
> `["navigation.tasks"]` e nada mais — nem `["navigation.tasks","x"]`, nem `[]`. O item 4 do
> épico ("novas capacidades no contrato") **não é acrescentar um valor a um enum**: é trocar
> a forma do campo, e com ela o tipo `ExtensionManifest["permissions"]`, que atravessa
> `CatalogEntry` (`manifest.ts:59-66`), `InstalledExtensionView.permissions`
> (`lib/extensions/view.ts:46`) e a comparação byte-a-byte manifesto↔catálogo
> `mirrorsCatalog` (`manifest.ts:415-416`, que compara `length` e cada índice).

Comando que reproduz a tabela:

```bash
grep -nE "z\.literal|z\.tuple|z\.enum|\.max\(EXTENSION_LIMITS" lib/extensions/manifest.ts
```

---

## 2. Inventário da rede de segurança — o que os testes garantem HOJE

Esta é a lista contra a qual toda mudança de contrato do épico tem de ser medida. Uma
mudança que apague qualquer linha daqui **é regressão**, a menos que o PR escreva por que a
garantia deixou de valer.

### 2.1 Tamanho da rede (CONFIRMADO)

```bash
grep -cE "^\s+it\(" tests/invariants/extensoes-declarativas.test.ts   # 38
grep -cE 'step\("' tests/e2e/extensoes-declarativas.spec.ts           # 12
grep -cE 'step\("' tests/e2e/extensoes-recuperacao.spec.ts            #  3
grep -cE 'step\("' tests/e2e/extensoes-versao.spec.ts                 #  7
for f in lib/extensions/*.test.ts components/extensions/*.test.*; do \
  echo "$f: $(grep -cE '^\s+(it|test)\(' $f)"; done
```

| Camada | Arquivos | Casos |
|---|---|---|
| Invariantes (Postgres real, `pnpm test:db`) | `tests/invariants/extensoes-declarativas.test.ts` (830 linhas) | **38** `it` |
| E2E (Playwright, frontend) | 3 specs (1069 + 342 + 427 linhas) | **3** `test`, **22** `test.step` |
| Unitários co-localizados | 16 arquivos em `lib/extensions/` e `components/extensions/` | **136** casos |

Os 136 unitários, por arquivo: `manifest.test.ts` 16 · `service.test.ts` 12 ·
`http.test.ts` 11 · `instalada.test.ts` 8 · `strict-json.test.ts` 7 ·
`context-routes.test.ts` 5 · `download.test.ts` 5 · `errors.test.ts` 4 ·
`erros-do-banco.test.ts` 3 · `download-rebinding.test.ts` 3 · `versao.test.ts` 2 ·
`ExtensionsManager.test.tsx` **43** · `ExtensionGuide.test.tsx` 5 ·
`operation-receipt.test.ts` 5 · `receipt-storage.test.ts` 4 · `api-client.test.ts` 3.

⚠️ **Todos os 16 estão FORA de `tests/unit/`** — são exatamente o recorte que `vitest run
tests/unit` perderia. Quem medir a suíte por caminho não vê nada desta seção. O comando que
vale é `pnpm test:unit`, sem caminho (doutrina no `CLAUDE.md`).

### 2.2 Os 38 invariantes, um a um (CONFIRMADO — `tests/invariants/extensoes-declarativas.test.ts`)

**Bloco "autoridade e isolamento reais"** (linha 115):

| # | Linha | Garante |
|---|---|---|
| 1 | 116 | membros leem só seu vínculo; **nenhuma escrita direta passa, inclusive `service_role`** |
| 2 | 135 | suporte ativo lê o vínculo só da organização atendida; convite não aceito não lê |
| 3 | 169 | tabelas de instância fechadas; RPCs **não alcançáveis por `anon`/`authenticated`** |
| 4 | 193 | ator revogado, viewer, manager, convite não aceito e organização vizinha recusados na RPC |
| 5 | 204 | desfazer/remover são de quem administra a **instalação**, nunca de quem administra uma organização |

**Bloco "publicação transacional e recibos"** (linha 219):

| # | Linha | Garante |
|---|---|---|
| 6 | 220 | `prepare`/`finish` repetidos devolvem o mesmo recibo e um único artefato/ponteiro |
| 7 | 235 | cancelamento impede conclusão tardia; falha terminal não libera a execução antiga |
| 8 | 251 | admissão monotônica invalida preparação, preserva instalação, rejeita mesmo número divergente |
| 9 | 267 | admissão repetida com a mesma chave e corpo diferente é **conflito**, não segundo recibo |
| 10 | 282 | mesma versão/digest diferente conflita; atualizar exige a revisão vista; origens diferentes coexistem |
| 11 | 294 | **bytes, hash, metadata e manifesto trocados não publicam nada** |
| 12 | 306 | guarda os bytes UTF-8 exatos, rejeita reconstrução, saneia JSON inválido |
| 13 | 322 | tetos de catálogo e identidades incluem preparações ainda publicáveis |
| 14 | 342 | replay também revalida o ator vigente |

**Bloco "configuração com CAS e limite agregado"** (linha 349):

| # | Linha | Garante |
|---|---|---|
| 15 | 350 | desativar/reativar preservam configuração; replay conserva resultado original |
| 16 | 366 | mesma revisão concorrente grava uma vez; mesma chave concorrente devolve recibo idêntico |
| 17 | 376 | duas ativações concorrentes disputam **a oitava vaga** sem afetar outra organização |

**Bloco "coordenação com atualização do core"** (linha 399) — **este bloco é o que liga
extensões ao `update.sh`**:

| # | Linha | Garante |
|---|---|---|
| 18 | 400 | preparação bloqueia INSERT e transição `dispatched`, até cancelamento explícito |
| 19 | 411 | atualização em voo ganha trava **antes** de `prepare`; não surge preparação concorrente |
| 20 | 422 | preparação não confirmada segura a atualização do core **na trava, não por sorte de tempo** |
| 21 | 450 | cancelamento sob trava encerra autoridade antes de `finish` tardio e permite atualizar |
| 22 | 463 | mesma chave `prepare` concorrente não duplica; outra chave mesma identidade é recusada |

**Bloco "atualizar, desfazer a última troca e remover"** (linha 471):

| # | Linha | Garante |
|---|---|---|
| 23 | 472 | atualizar troca o ponteiro, guarda o anterior, **não toca nos vínculos das organizações** |
| 24 | 502 | toda preparação de atualização tem saída, e cada saída libera a atualização do sistema |
| 25 | 523 | a revisão vista é precondição: aba antiga não troca, não desfaz, não remove o que mudou depois |
| 26 | 542 | desfazer é a própria inversa, não baixa nada, funciona com a versão fora do catálogo |
| 27 | 562 | desfazer recusa sem anterior, removida, preparação em curso e atualização recente do sistema |
| 28 | 583 | remover desliga só vínculos ativos, em todas as organizações, guarda a configuração, não espera o sistema |
| 29 | 624 | remover recusa preparação em curso da mesma identidade e instalação inexistente |
| 30 | 634 | configurar recusa instalação removida; ativar apaga a marca da remoção e desativar a preserva |
| 31 | 647 | reinstalar limpa remoção e anterior, sobe a revisão, deixa as organizações **por ativar** |
| 32 | 666 | a mesma versão com outro digest é conflito também contra a versão **anterior** |
| 33 | 674 | repetir conclusão antiga depois de outra troca devolve o recibo, **sem acusar pacote adulterado** |
| 34 | 686 | desfazer/remover com a mesma chave e outro pedido são conflito, não segundo efeito |
| 35 | 703 | **o teto de 128** conta só as não removidas, vale na reinstalação, não é consumido por atualização |
| 36 | 730 | a contagem entre organizações só devolve números, e eles batem com a contagem direta |

**Bloco "corrida entre ativar numa organização e remover da instalação"** (linha 767):

| # | Linha | Garante |
|---|---|---|
| 37 | 795 | ativação que esperou uma remoção recebe `extension_removed` quando a remoção confirma |
| 38 | 814 | remoção que esperou uma ativação desliga o vínculo que ela acabou de gravar |

### 2.3 Os 22 passos de E2E, um a um (CONFIRMADO)

`tests/e2e/extensoes-declarativas.spec.ts` (12 passos, `test.setTimeout(300_000)` na linha 296):

| Linha | Passo |
|---|---|
| 312 | admite pela UI o arquivo exportado pelo CLI |
| 348 | recusa **pelo HTTP real** um pacote cujo corpo mudou |
| 384 | armazenamento indisponível bloqueia o pedido **antes do POST** |
| 452 | perde a resposta do app depois do commit e **reconcilia o mesmo recibo** |
| 577 | papéis sem gestão não recebem controles **nem criam operação por POST** |
| 596 | configura compacta, sem descrição, ativa em A e **mede desktop/mobile** |
| 638 | uma aba antiga de A **não grava em B** depois da troca de organização |
| 720 | **B não recebe card nem acesso direto** |
| 797 | catálogo fora do ar **não impede** guia local e tarefa em A |
| 873 | desativação fecha URL e aba antigas; reativação preserva configuração |
| 950 | tenant switcher alterna A/B e o uso local continua com catálogo desligado |
| 979 | auditoria identifica ator, organização e ações **no banco e no visualizador** |

`tests/e2e/extensoes-recuperacao.spec.ts` (3 passos):

| Linha | Passo |
|---|---|
| 126 | admite o catálogo real e registra **tema escuro e fallback em espanhol** |
| 182 | cancela em outra aba enquanto o download continua aberto |
| 252 | socket interrompido **falha visivelmente** e oferece nova tentativa |

`tests/e2e/extensoes-versao.spec.ts` (7 passos, `timeout: 480_000`):

| Linha | Passo |
|---|---|
| 166 | admite o catálogo com as duas versões e instala a 1.0.0 |
| 188 | ativa em A; **B não ativa** |
| 204 | atualiza para 1.1.0: A continua ativa e vê o card novo |
| 243 | desfaz com o catálogo desligado; aba antiga recebe o aviso e **não troca de novo** |
| 287 | remove: o guia aberto em A diz que foi removido, e a auditoria de A registra |
| 343 | religa o catálogo e reinstala: **A precisa ativar de novo** |
| 380 | atualização que falha no download deixa recibo `failed` e **não trava o sistema** |

### 2.4 Onde o CI roda isso (CONFIRMADO)

As três specs estão em `SPECS_PARTE_3` de `.github/workflows/e2e.yml` — medido, não lido:

```bash
python3 - <<'PY'
import re
y=open(".github/workflows/e2e.yml",encoding="utf-8").read()
for n,c in re.findall(r'(SPECS_PARTE_\d+):\s*>-\n((?:[ ]{8,}.*\n)+)',y):
    e=[x for x in re.findall(r'[a-z0-9-]+\.spec\.ts',c) if "exten" in x]
    if e: print(n,"->",e)
PY
# SPECS_PARTE_3 -> ['extensoes-declarativas.spec.ts','extensoes-recuperacao.spec.ts','extensoes-versao.spec.ts']
```

Contagem de cobertura do CI no mesmo SHA: **121** specs no disco
(`ls tests/e2e/*.spec.ts | wc -l`), **118** invocadas pelas três `SPECS_PARTE_*`, e
`FORA_DO_CI` = `vps-fresh-onboarding.spec.ts`, `inbox-tempo-real.spec.ts`,
`cadastro-sem-confirmacao-de-email.spec.ts`.

### 2.5 O limite que as próprias jornadas declaram (CONFIRMADO)

`docs/testing/user-journey-map.md:2151` — **J25 `[P0]`** e `:2195` — **J26 `[P0]`**. As duas
estão com estado verde declarado (16/09/2026, build `mpuyz81eEv5s9QLf96iqr`, commit
`2bce4b7ec`): J25 em 39,1 s + 16,6 s, J26 em 28,3 s.

E o J25 escreve, em `docs/testing/user-journey-map.md:2189-2191`, a fronteira exata onde este
épico entra:

> "Limite declarado: esta jornada prova o perfil declarativo e o catálogo local de ensaio.
> **Não prova marketplace público, autoria criptográfica nem execução de código de pacote.**"

**INFERIDO (de duas leituras confirmadas):** o épico consome precisamente os três itens que a
jornada P0 declara NÃO provar. Logo, J25/J26 permanecem verdes e continuam sem cobrir o que o
épico entrega — verde nelas **não é evidência** sobre o marketplace. Uma jornada nova
(J27?) é obrigatória, não opcional.

---

## 3. Superfícies que uma capacidade nova tocaria — leitura adversarial

### 3.1 "Abrir qualquer tela" — o que hoje impede redirecionamento arbitrário

**CONFIRMADO — há DOIS cadeados, e os dois são no código do núcleo, nenhum no pacote.**

**Cadeado 1, servidor.** `app/api/v1/extensions/[id]/open/route.ts:44`:

```ts
// O card tem de existir na versão VIGENTE. […]
const card = guide.manifest.contributions.crm_cards.find((item) => item.id === input.card_id);
if (card?.action.capability !== input.capability) { … }
// Esta capacidade só resolve um destino do núcleo. Nenhum dado de tarefa
// vai ao pacote; a rota de Tarefas continua exigindo sua autorização própria.
return ok({ href: "/app/tasks" });
```

O `href` é uma **constante literal escrita no servidor**. O manifesto nunca fornece uma URL: ele
fornece um *nome de capacidade* (`"tasks.open"`), e o servidor decide o destino. O pacote não
tem canal para expressar um endereço.

**Cadeado 2, cliente.** `components/extensions/ExtensionGuide.tsx:149-153`:

```ts
if (result.data.href !== "/app/tasks") {
  setActionError(t("O servidor devolveu um destino que esta extensão não pode abrir."));
  return;
}
router.push(result.data.href);
```

O cliente **reconfere o literal** antes do `router.push`. Um servidor comprometido (ou uma
regressão que fizesse o `href` vir do manifesto) ainda assim não navega.

**O que precisa ser verdade para uma capacidade "abrir tela X" não virar redirecionamento
arbitrário — PROPOSTO, derivado do mecanismo acima:**

1. **O pacote nomeia uma capacidade, nunca uma URL.** A tabela capacidade→destino vive no
   servidor, como hoje. Trocar `"tasks.open"` por `{ href: "…" }` no manifesto seria a
   regressão — e seria uma regressão **que passaria em todos os 176 testes de extensão**, porque
   nenhum deles afirma "o href não vem do pacote"; o que existe é o literal no código e a
   conferência no cliente.
2. **O cadeado 2 tem de continuar existindo, e ele não escala como `!==`.** Com N destinos, a
   linha `href !== "/app/tasks"` vira `!DESTINOS.has(href)`. Isso é aceitável **apenas se
   `DESTINOS` for um conjunto fechado de literais compilado no bundle** — se virar "qualquer
   coisa que comece com `/app/`", o cadeado morre: `/app/settings/api-tokens` e
   `/app/settings/seguranca` são `/app/`.
3. **Redirecionamento aberto é a falha clássica, e ela tem um vetor concreto aqui:** um `href`
   vindo do pacote como `//evil.example/x` ou `/app/../../evil` passaria por um teste ingênuo de
   prefixo. O `router.push` do Next aceita URL absoluta.
4. **Autorização não pode se mudar para a capacidade.** Hoje a rota `open` exige
   `requireRole("viewer", { resource: "organization_extensions" })`
   (`open/route.ts:22` — confirmado na linha) e o comentário afirma que "a rota de Tarefas continua exigindo sua
   autorização própria". Uma capacidade `pipeline.open` ou `settings.open` teria de manter isso:
   a extensão abre a **porta**, quem confere o **crachá** é a tela de destino. Se alguma
   capacidade futura devolver *dados* em vez de um destino, essa frase deixa de valer e a
   autorização precisa ser resolvida na própria rota `open`.

**Superfície adicional, hoje intacta (CONFIRMADO):**

```bash
grep -rn "dangerouslySetInnerHTML" components/extensions/ components/shell/NavHub.tsx app/app/extensions/ | wc -l   # 0
```

Todo texto de pacote é renderizado como filho React — `ExtensionGuide.tsx:319-322` põe
`{heading.text}` e `{body.text}` dentro de `<h3>`/`<p>`, escapados pelo React. **Uma vitrine que
renderize README/Markdown do publicador abre uma superfície de XSS que hoje não existe** — e
nenhum dos 176 testes cobriria, porque hoje não há HTML de pacote em lugar nenhum.

### 3.2 "Contribuir instrução ao agente de IA" — a superfície mais perigosa do épico

**CONFIRMADO (estado atual):** não existe. `data: { mode: "none" }` é `z.literal("none")`
(`manifest.ts:138`); o manifesto não tem campo que alcance a IA; e

```bash
grep -rn "extensions" lib/ai/ lib/agent-engine/ | grep -v "\.test\." | wc -l   # 0
grep -rn "agent-engine\|lib/ai" lib/extensions/ | grep -v test | wc -l         # 0
```

As duas superfícies são **hoje disjuntas nos dois sentidos** — zero arestas. O épico proporia a
primeira.

O ponto de entrada seria `lib/ai/render-system-prompt.ts`. O cabeçalho dele
(`render-system-prompt.ts:1-11`) declara o mecanismo:

> "Templating uses `{{placeholder}}` style. **Unknown placeholders survive substitution
> unchanged** so the operator can see what's missing in DevTools."

**Leitura adversarial — quatro vetores concretos, todos PROPOSTO/INFERIDO:**

1. **Injeção de placeholder.** Texto de pacote inserido no template ANTES da substituição é
   expandido: um pacote cujo corpo contenha `{{retrieved_chunks}}` ou `{{contact_name}}` teria
   esses valores materializados dentro do seu próprio texto. Pior: `PLACEHOLDER_RX` é
   `/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g` (`render-system-prompt.ts:17`) e `lookup()` caminha um
   path com `.` sobre um objeto (`:26-34`) — **o pacote escolhe qual caminho do escopo ler.**
   Mitigação estrutural: o texto do pacote entra **depois** da substituição, ou com os `{{` }}`
   escapados. Nunca concatenado no template.
2. **Posição de confiança.** Instrução de pacote no *system prompt* é instrução com a mesma
   autoridade do operador — ela pode dizer "ignore as regras anteriores", "não escale para
   humano", "revele o prompt". Um pacote de terceiro, numa vitrine pública, teria autoridade de
   dono do CRM sobre a conversa com o cliente final. Mitigação estrutural: instrução de pacote
   vai para uma seção **rotulada como não-autoritativa** e delimitada, nunca solta.
3. **A doutrina de canal.** `pnpm lint:channels` roda como step próprio do `verify`
   (`.github/workflows/ci.yml:49-51`, "Invariante 1 de `docs/doctrine/restricao-de-canal.md`:
   nenhuma feature nomeia um provider"). Um pacote que contribua instrução mencionando WhatsApp
   ou um provider **não é alcançado por esse lint** — o lint varre o repo, não o conteúdo de um
   pacote de terceiro. A doutrina teria um furo de raio igual à vitrine.
4. **Onde o laço se fecharia.** Existe uma cadeia de guardas de saída —
   `lib/agent-engine/guardrails/before-send.ts`, com `internalVocabularyGate` e o gate de
   vazamento medido em `tests/unit/gate-vazamento-interno.test.ts`. **INFERIDO:** essa cadeia
   avalia o TEXTO DE SAÍDA, não a origem da instrução; ela pegaria vazamento de vocabulário
   interno causado por um pacote malicioso, mas não pegaria um pacote que só muda o *tom* ou
   *suprime a escalação*. Um pacote com instrução precisa do seu próprio laço de retorno
   (invariante 7 do Sistema Vivo).

**Veredito desta subseção (PROPOSTO): capacidade de contribuir instrução ao agente NÃO deve
entrar na mesma versão que a vitrine pública.** Hoje instalar exige o dono do servidor (§3.3);
uma vitrine que torne instalar fácil e uma capacidade que dê voz ao agente, juntas, transformam
"instalar uma extensão" em "dar a um estranho a caneta que fala com o seu cliente".

### 3.3 O achado que colide com o objetivo 3 do épico (CONFIRMADO)

`lib/extensions/http.ts:41-93` — `requireExtensionPlatformFor`:

- `if (!user.is_platform_admin || user.support)` → 403 "Só o administrador da instalação pode
  gerenciar os pacotes disponíveis." (`http.ts:43-52`)
- consulta `platform_admins`; `if (!platform || platform.scope !== "full")` → 403 (`http.ts:70-79`)
- `if ((platform.mfa_required && (await sessionAal()) !== "aal2") || (await mfaEmDivida()))` →
  403 `mfa_required` (`http.ts:80-91`)

E o invariante nº 5 (`tests/invariants/extensoes-declarativas.test.ts:204`) prova a mesma coisa
no banco: *"desfazer e remover são só de quem administra a instalação, nunca de quem administra
uma organização"*.

**A colisão.** O objetivo 3 do épico é "jornada de descobrir/instalar/ativar/usar excelente para
um usuário leigo". Mas **o usuário leigo de um tenant não pode instalar nada** — ele é `admin` da
organização, não `is_platform_admin scope=full` da instalação. O que ele pode é **ativar** o que
o dono do servidor já instalou.

Isso não é um bug a consertar; é uma decisão de segurança com prova em dois níveis. O que ela
exige do épico é **PROPOSTO**: a vitrine tem duas audiências distintas, e confundi-las produz a
pior tela possível — um catálogo bonito onde todo botão dá 403 para 9 de cada 10 usuários. Ou a
vitrine é a tela do **dono do servidor** (e a jornada "leiga" é a de *ativar*, não a de
instalar), ou o épico está propondo relaxar `requireExtensionPlatform` — e aí ele está mexendo
no invariante nº 5, no nº 3 e no nº 4, e tem de dizer isso em voz alta.

### 3.4 Teto de 8 extensões ativas por organização (CONFIRMADO)

`lib/extensions/service.ts:577` — `loadCrmExtensions` faz `.eq("enabled", true).limit(8)`. E o
invariante nº 17 (`tests/invariants/…:376`) prova a disputa: *"duas ativações concorrentes
disputam **a oitava vaga** sem afetar outra organização"*.

**INFERIDO:** 8 extensões × `EXTENSION_LIMITS.cards` = 4 → **até 32 cards** no hub do CRM. Hoje,
com catálogo local de ensaio, ninguém chega perto. Uma vitrine cuja proposta é "instalar é fácil"
empurra as instalações para o teto — e o hub do CRM não foi medido com 32 cards. A prova de
layout que existe (`extensoes-declarativas.spec.ts:596`, "mede desktop/mobile") roda com os dois
pacotes da fixture, não com 32 cards.

### 3.5 O que a rede anti-SSRF já cobre — e o que a vitrine adiciona (CONFIRMADO)

`lib/extensions/download.ts` é uma peça séria e a vitrine não pode contorná-la:

| Guarda | Linha |
|---|---|
| origem tem de ser origem EXATA (sem path, query, hash, user, senha) | `download.ts:27-45` |
| fora do laboratório local, **só `https:`** | `download.ts:71` |
| `localhost` e sufixos `.localhost` recusados | `download.ts:72` |
| IP literal não-público recusado (`ipaddr.process(...).range() !== "unicast"`) | `download.ts:73-79, 88-94` |
| DNS resolvido UMA vez e **fixado no socket** (`pinnedLookup`) — sem rebind | `download.ts:114-148, 262-266` |
| `content-encoding` diferente de `identity` recusado (sem zip bomb) | `download.ts:158-164` |
| `content-length` > 64 KiB ou > `byte_length` recusado ANTES do corpo | `download.ts:166-183` |
| corte por byte durante o streaming, nas duas réguas | `download.ts:187-200` |
| prazo total de 15 s | `download.ts:17, 245-249` |
| **o caminho é derivado do digest**, nunca do catálogo: `` `/packages/${entry.sha256}.json` `` | `download.ts:268` |

E o escape local só abre com **três condições simultâneas** (`download.ts:59-66`): `http:` **e**
host exatamente `127.0.0.1` **e** `EXTENSIONS_LOCAL_CATALOG_ORIGIN` idêntico à origem **e**
`NEXT_PUBLIC_APP_URL` em loopback. Numa VPS real a variável é `""`
(`lib/env.ts:80`, `.env.example:445`), o app não está em loopback, e o escape é inalcançável.

```bash
grep -rn "EXTENSIONS_" hostgator-setup-kit/ | wc -l   # 0 — o kit não escreve essa chave
```

**PROPOSTO — o que a vitrine adiciona e precisa herdar isto:** qualquer busca de metadado da
vitrine (ícone, captura de tela, README, contagem de instalações, busca) é **uma requisição HTTP
de saída nova**, e ela não passa por `downloadArtifact`. Se a vitrine baixar uma imagem por URL
que o publicador escolhe, ela reabre exatamente o SSRF que estas 10 guardas fecham — e o reabre
num caminho que nenhum dos 5 casos de `lib/extensions/download.test.ts` nem dos 3 de
`download-rebinding.test.ts` vigia. A régua: **todo egress da vitrine passa por
`validateCatalogOrigin` + `pinnedLookup`, ou não existe** (metadado viaja dentro do catálogo
já assinado por digest).

---

## 4. Marca própria × vitrine — veredito com evidência

### 4.1 O estado hoje: zero vazamento no caminho das extensões (CONFIRMADO)

```bash
grep -rniE "deskcomm" lib/extensions/ components/extensions/ app/api/v1/extensions/ app/app/extensions/ \
  | grep -v "\.test\." | wc -l
# 0
```

Nenhum arquivo de extensão aparece na `MARCA_CONGELADA` (`tests/unit/branding.test.ts:210-332`).

### 4.2 O que a allowlist permite, exatamente (CONFIRMADO)

`tests/unit/branding.test.ts` é **1094 linhas** e tem **três varreduras**:

1. **Marca** (`:168`): `/deskcomm/i` sobre `.ts`/`.tsx` de `app|components|hooks|lib|workers`,
   **fora de comentário** (`:553-556` prova que comentário não conta e código conta).
2. **Templates do GoTrue** (`:635-641`): os `.html`/`.toml` que a primeira varredura nunca viu —
   nasceu porque o revendedor recebia "Confirme seu e-mail — DeskcommCRM".
3. **Host de terceiro** (`:760-790`): **21 hosts** declarados na `main`, por HOST e não por
   arquivo, com categorias `FORNECEDOR` (pode crescer) e `CONSOLE`/`AMOSTRA`/`PLATAFORMA`/
   `PROTOCOLO` (**conjunto FECHADO fixado por nome**, "porque é nessas que a pressa tentaria
   declarar um vazamento para seguir em frente").

A `MARCA_CONGELADA` tem **5 categorias** (`:186-198`): `PROTOCOLO` (contrato de fio),
`INFRA` (cookie/storage), `DIVIDA` (**exige campo `fase`** que a apaga), `DEV` (fixture) e
`PADRAO` (a definição de `DEFAULT_APP_NAME`, em `lib/branding.ts`). Cada entrada carrega
`motivo` escrito e o conjunto EXATO de marcas do arquivo.

### 4.3 Veredito

**Pergunta:** *um revendedor com marca própria pode ver o nome do produto vazando na vitrine?*

**Resposta: sim, por três portas — e duas delas o `branding.test.ts` NÃO fecha.**

| Porta | O que aconteceria | O gate pega? |
|---|---|---|
| **(a) Texto de UI da vitrine** — "Extensões para o DeskcommCRM", "Certificado pelo DeskcommCRM" num `.tsx` de `components/` ou `app/` | marca em código, fora de comentário, numa das 5 raízes | **SIM — CONFIRMADO.** `branding.test.ts:168` reprova. É o caminho seguro |
| **(b) Origem padrão do catálogo** — algo como `https://extensions.deskcomm.com.br` embutido como default | é host de terceiro **e** contém a marca | **SIM para a marca**, e a 3ª varredura exigiria categoria. Mas `FORNECEDOR` "pode crescer" — alguém declara ali e segue. **PROPOSTO: uma origem NOSSA não é `FORNECEDOR`; é vazamento de marca com outro nome** |
| **(c) Conteúdo que vem do catálogo remoto** — `display.title`, `display.summary`, os textos dos cards, o nome do publicador | renderizado em runtime, a partir de bytes baixados | **NÃO — CONFIRMADO.** As três varreduras leem **arquivos do repositório** (`fs.readFileSync` / `readdirSync`, `:505`). Texto que chega por HTTP não existe para elas |

**A porta (c) é o achado central desta seção.** Hoje ela é inofensiva porque o catálogo é local
de ensaio e os pacotes são da fixture. Com uma vitrine pública, **o conteúdo da loja é texto que
nós publicamos e que aparece dentro da instalação de um revendedor com marca própria** — e
`branding.test.ts` é estruturalmente cego para ele: ele varre o disco, e isso vem da rede.

Concretamente: um pacote oficial chamado *"Assistente DeskcommCRM de Vendas"* apareceria na
vitrine de um revendedor chamado "Vendas Turbo", com o gate de marca **verde**, porque o texto
nunca esteve num `.ts`.

**PROPOSTO — o que o épico precisa decidir e escrever:**

1. A vitrine é do **produto** (marca fixa) ou da **instalação** (marca do revendedor)? A
   doutrina existente responde por analogia: `docs/white-label.md` + a regra do `CLAUDE.md` de
   que *o banco está ACIMA do `.env`* e o resolvedor nunca lança. Mas há um precedente que
   aponta para o outro lado, e é forte: **"O PDF de LGPD NUNCA leva marca"**, porque ele nomeia
   o **controlador**, e nomear o revendedor ali "inverteria papéis". A vitrine tem o mesmo
   formato de problema: o publicador do pacote é um terceiro, não o revendedor.
2. **Nenhum texto de pacote pode afirmar a marca do produto.** Se a decisão for "a vitrine usa a
   marca da instalação", então o catálogo precisa de uma regra de conteúdo — e ela precisa de um
   **mecanismo**, não de uma linha de prosa: o `branding.test.ts` não alcança bytes de rede, e
   `docs/doctrine/…` não é um gate. O lugar natural é uma varredura sobre o catálogo publicado,
   no repositório que o produz.
3. O `favicon`/logo da vitrine sai de `marcaResolvida()`, como as outras 4 superfícies
   (`branding.test.ts` (caso "o layout raiz resolve a marca UMA vez para os quatro consumidores") exige **exatamente 4** `await marcaResolvida()` no layout raiz e
   manda "consumidor a mais é legítimo — atualize o número"). Uma vitrine que resolva marca por
   fora quebra essa asserção, **e é ela que vai reprovar o PR** — o que é o comportamento
   desejado, mas quem for consertar precisa saber que a mensagem de erro pede para atualizar o
   número, não para contornar.

---

## 5. Quem já instalou — o que o épico exige do `install.sh` / `update.sh`

### 5.1 Hoje o kit não sabe que extensões existem (CONFIRMADO)

```bash
grep -rn "EXTENSIONS_" hostgator-setup-kit/ | wc -l          # 0
grep -n -i "exten" hostgator-setup-kit/update.sh hostgator-setup-kit/install.sh | wc -l   # 8
```

As 8 ocorrências são **`create extension` do Postgres** (`vector`, `citext`, `pg_trgm`) —
`update.sh:190-192`, `install.sh:1778-1792`. **Nenhuma delas é a feature de extensões.** Uma
sonda que procurasse só `grep -i exten` no kit leria 8 e concluiria "já está coberto"; está
medido aqui que não está.

### 5.2 Como uma variável nova entra sem quebrar `.env` antigo (CONFIRMADO)

O padrão que a própria feature já usa é o certo e é o mais barato:

```ts
// lib/env.ts:80
EXTENSIONS_LOCAL_CATALOG_ORIGIN: z.string().optional().default(""),
```

`.optional().default("")` + linha vazia em `.env.example:445`. Um `.env` de 2026-01 que não tem
a chave **não quebra**: o Zod preenche. `lib/env.ts` lança no startup só para chave crítica
ausente, e esta não é.

O outro padrão — para chave que **precisa** de valor — é uma função dedicada no `update.sh`, que
grava a chave faltante no `.env` existente. Os dois exemplos vivos:

```bash
grep -n "completar_segredos_da_voz\|ensure_encryption_key" hostgator-setup-kit/update.sh
# 283:  VOZ_CRIADA="$(completar_segredos_da_voz .env)" || VOZ_CRIADA=""
# 392:  ensure_encryption_key .env
```

**A régua do `CLAUDE.md`, literal:** *"Bump de versão **não pode** exigir que o operador da VPS
edite `.env`, compose ou qualquer arquivo à mão. Se exigir, não entra."*

### 5.3 O que acontece se esquecermos — por caminho (INFERIDO, cada um de um fato confirmado)

| Se o épico acrescentar… | E esquecermos de… | O que acontece na VPS de quem já instalou |
|---|---|---|
| variável com valor obrigatório (chave de assinatura, origem da vitrine) | função no `update.sh` | `lib/env.ts` lança no boot → **o app não sobe**. O healthcheck é probe TCP e pode nem acusar; o sintoma para o cliente é o domínio caindo |
| variável opcional | nada (basta `.optional().default()`) | funciona. **É o caminho a preferir sempre** |
| comando novo no kit (`extensoes.sh`, `vitrine.sh`) | entregá-lo no `update.sh` | o script simplesmente não existe no disco de quem instalou antes. `pnpm test:shell` é o **único** gate que exercita o kit (`ci.yml`, step "Kit self-host (bash)", ~15 s, com os 163 casos de `test-validators.sh`) |
| mudança de schema (tabela de vitrine, coluna de assinatura) | apêndice idempotente no `supabase/baseline.sql` | a migration **não chega ao self-hoster**. O `update.sh` reaplica o baseline **sem `ON_ERROR_STOP`**: falha em silêncio e o app roda contra um schema velho |
| serviço novo no compose (proxy de vitrine, cache) | `image:` publicada | serviço `build:`-only → invisível a `docker compose pull`, imune a `up -d` sem `--build`, **nunca atualizado**. É o defeito do `worker` (`project_packaging_worker_build_only`), e há teste reprovando o retorno do padrão |

### 5.4 A coordenação que JÁ existe entre extensões e a atualização do core (CONFIRMADO)

Este é o detalhe mais fácil de quebrar sem perceber. Cinco invariantes (nº 18 a 22,
`tests/invariants/extensoes-declarativas.test.ts:400-463`) provam que **uma instalação de
extensão em voo segura a atualização do sistema**, e vice-versa:

- nº 18 (`:400`): preparação bloqueia INSERT e a transição `dispatched` até cancelamento explícito;
- nº 19 (`:411`): atualização em voo ganha a trava **antes** de `prepare`;
- nº 20 (`:422`): preparação não confirmada segura a atualização **na trava, não por sorte de tempo**;
- nº 21 (`:450`): cancelamento sob trava encerra a autoridade antes de um `finish` tardio;
- nº 22 (`:463`): mesma chave `prepare` concorrente não duplica.

O estado `dispatched` é o do atualizador do core (`lib/system/update-run.ts`). **INFERIDO:** um
épico que acrescente um caminho novo de instalação (um comando de kit, um cron de sincronização
de vitrine) que **não passe pelo mesmo `prepare`** contorna esses cinco invariantes sem
vermelhecer nenhum — porque eles testam o caminho existente, não a ausência de um segundo
caminho. Essa é a regressão silenciosa mais cara desta lista: o sintoma é uma VPS atualizando o
core no meio de uma instalação de pacote.

---

## 6. Custo de CI — o que um PR deste tamanho dispara

### 6.1 Os cinco obrigatórios, medidos na fonte (CONFIRMADO)

```console
$ gh api repos/melgarafael/DeskcommCRM/branches/main/protection \
    --jq '.required_status_checks.contexts|join(", ")'
verify, build-and-size, invariants, e2e, imagens-ok
```

### 6.2 Tempo real por job (CONFIRMADO — último run verde na `main` de cada workflow)

```bash
for wf in ci.yml perf.yml e2e.yml publish-image.yml; do
  id=$(gh run list --workflow=$wf --branch main --status success --limit 1 --json databaseId --jq '.[0].databaseId')
  gh api repos/melgarafael/DeskcommCRM/actions/runs/$id/jobs \
    --jq '.jobs[] | "\(.name)\t\(.conclusion)\t\(((.completed_at|fromdateiso8601)-(.started_at|fromdateiso8601))/60|floor) min"'
done
```

| Check | Job(s) | Medido | Teto |
|---|---|---|---|
| `verify` | `verify` | **11 min** | 15 |
| `invariants` | `invariants-majors (15)` **7 min** + `(17)` **9 min** → agregador `invariants` 0 min | **9 min** (paralelo) | 30 |
| `build-and-size` | `build-and-size` | **2 min** | 15 |
| `e2e` | `e2e-parte (1)` 15 · **`(2)` 27** · **`(3)` 25** → agregador 0 | **27 min** (paralelo) | **30** |
| `imagens-ok` | app 5 + worker 2 + scheduler 0 + `imagem-do-app-sobe` 4 + `imagens-de-fundo-sobem` 2 | **~5 min** (paralelo) | — |

O `verify` tem **sete** gates em sequência (`ci.yml:38-95`): `typecheck`, `lint`,
`lint:channels`, `lint:role-rank`, `checar:colisao-de-migration`, `test:unit`, `test:shell`.

### 6.3 Onde este PR ficaria vermelho — em ordem de probabilidade

**1. `e2e` — e é quase certo. CONFIRMADO no dado, INFERIDO na conclusão.**

As três specs de extensão estão em **`SPECS_PARTE_3`**, e a parte 3 mediu **25 min contra um
teto de 30**. Sobram **5 minutos**. As três specs existentes custam ~84 s somadas (39,1 + 16,6 +
28,3, `user-journey-map.md`) — mas cada uma delas **inicia um servidor HTTP próprio, publica
pacotes pelo CLI e precisa de `.next/BUILD_ID`**. Uma spec de vitrine no mesmo molde não é
barata. E o cabeçalho do `e2e.yml:270-284` já registra que a partição foi refeita em 16/09
porque a parte 1 estourou 30 min cravados, com a nota explícita: *"Subir `timeout-minutes` não
entra: o teto é o que denuncia o crescimento."*

> **PROPOSTO:** o PR de marketplace tem de vir com a repartição das specs já feita, ou nasce
> vermelho por relógio — que é o vermelho mais caro de diagnosticar, porque parece flakiness.

**2. `verify` → `test:unit`.** Duas armadilhas concretas:

- **`navegacao-completude.test.ts`** (`tests/unit/navegacao-completude.test.ts:71-74`): toda tela
  nova em `app/app/**` reprova se não estiver em `lib/navigation/catalogo.ts` ou na
  `NAV_ALLOWLIST` **com justificativa ≥ 20 caracteres** (`:108-114`, `motivo.trim().length < 20`). Uma tela
  `/app/marketplace` ou `/app/extensions/vitrine` **reprova**. Exceção automática: diretórios
  `[…]` são pulados (`:55-56`), então `/app/extensions/[id]` já é isento.
  Hoje `/app/extensions` está declarado em `catalogo.ts:697-703` (grupo `organizacao`, seção
  "Sua empresa", ícone `PuzzlePiece`, **sem `minRole`** — logo visível a todos os papéis).
- **`branding.test.ts`**: §4 acima.

**3. `verify` → `checar:colisao-de-migration`.** Se o épico trouxer migration (tabela de vitrine,
assinatura de publicador) e outra sessão estiver com o mesmo `NNNN`. O cabeçalho do step
(`ci.yml:65-73`) registra que o `0161` foi disputado por **cinco** PRs.

**4. `invariants` (`pnpm test:db`).** Roda nas **duas majors** (pg15 piso + pg17). Migration que
use recurso de pg17 reprova só na perna 15 — e o padrão de quem roda `pnpm test:db` local é o
**piso** (`scripts/test-db.sh`), então o local pega.

**5. `imagens-ok`.** Só se o PR tocar Dockerfile/compose. Se o épico acrescentar um serviço, ele
tem de subir `build-and-push` para uma 4ª imagem publicada — e o job hoje exige exatamente três.

**O que NÃO reprova, e por isso é o buraco:** `pnpm gov:verify` não é invocado por workflow
nenhum, e `vps-fresh-onboarding.spec.ts` — a jornada de instalação fresca, **a P0 da doutrina de
QA Visual** — está em `FORA_DO_CI`. **Os cinco checks verdes não provam a jornada que o épico
vende.**

### 6.4 O fragmento em `.changes/` (CONFIRMADO)

```bash
ls .changes/*.md | wc -l   # 22 fragmentos no SHA base
```

Formato (`docs/doctrine/versionamento.md:126`): frontmatter com
`impacto: nada_mudou | capacidade_nova | exige_acao`, `secao`, `titulo`, e — quando
`exige_acao` — um bloco `## Requer atenção` (`:142`).

**O CI valida a FORMA de todo fragmento, mas NÃO cobra a presença de um.** A presença é cobrada
pelo `CLAUDE.md` (DoD 17) e por quem revisa. **PROPOSTO:** o épico é `capacidade_nova` se a
vitrine só acrescentar; vira `exige_acao` no instante em que exigir uma chave nova no `.env` ou
um passo no `update.sh` — e é exatamente aí que a régua do §5.2 morde: *se exigir edição à mão,
não entra.*

---

## 7. Tabela de regressões plausíveis

Cada linha: o que quebra · como o **usuário** sentiria · qual teste existente pega, ou o nome do
teste que **falta**.

| # | Regressão | Sintoma para o usuário | Pega hoje? |
|---|---|---|---|
| R1 | `permissions` deixa de ser `z.tuple` e vira `z.array` sem revisar `checkCompatibility` | pacote com permissão desconhecida instala e o card não faz nada | **PARCIAL.** `manifest.test.ts` (16 casos) e `checkCompatibility` (`manifest.ts:345`) checam `length !== 1`; afrouxar os dois juntos fica verde. **FALTA:** `um pacote com permissão fora do conjunto declarado é recusado com permission_unsupported` |
| R2 | `href` da capacidade passa a vir do manifesto | clique num card leva a site externo / página de credenciais | **PARCIAL.** `ExtensionGuide.test.tsx` (5 casos) cobre o guia; o cadeado é o literal em `ExtensionGuide.tsx:149`. **FALTA:** `o destino de uma capacidade nunca é lido do pacote` (teste de origem, não de valor) |
| R3 | Lista de destinos vira prefixo (`startsWith("/app/")`) | extensão abre `/app/settings/api-tokens` — tela de chaves | **NÃO.** Nenhum teste afirma que a lista é fechada. **FALTA:** `a tabela capacidade→destino é um conjunto fechado de literais` |
| R4 | Vitrine renderiza README/Markdown do publicador | script de terceiro roda na sessão do dono do CRM | **NÃO.** Hoje `dangerouslySetInnerHTML` = 0 nos 4 diretórios. **FALTA:** `nenhum texto de pacote chega ao DOM como HTML` |
| R5 | Egress novo da vitrine (ícone/captura por URL) sem `validateCatalogOrigin` | nada visível — é o servidor do cliente varrendo a rede interna dele | **NÃO.** `download.test.ts` (5) e `download-rebinding.test.ts` (3) cobrem `downloadArtifact`, não um caminho novo. **FALTA:** `toda saída HTTP de extensões passa pela política de origem` (varredura de AST, no molde de `cron-audita-so-quando-ha-efeito.test.ts`) |
| R6 | Caminho de instalação novo (comando de kit / cron de vitrine) que não passa por `prepare` | `update.sh` roda no meio de uma instalação; instalação corrompida | **NÃO.** Os invariantes 18–22 provam o caminho existente. **FALTA:** `nenhuma escrita em extension_installations fora da RPC de prepare/finish` |
| R7 | Tela nova da vitrine sem porta no `catalogo.ts` | a loja existe e só se chega digitando a URL | **SIM.** `navegacao-completude.test.ts:74` reprova o `verify` |
| R8 | Nome do produto no `.tsx` da vitrine | revendedor "Vendas Turbo" vê "DeskcommCRM" na loja | **SIM.** `branding.test.ts:168` |
| R9 | Nome do produto **dentro do catálogo remoto** (título/descrição de pacote) | idem R8, com **todos os gates verdes** | **NÃO — e é estrutural.** As 3 varreduras leem o disco (`branding.test.ts:505`). **FALTA:** varredura de marca sobre o catálogo publicado |
| R10 | Origem padrão da vitrine embutida como host nosso | domínio nosso viaja na imagem do revendedor | **PARCIAL.** 3ª varredura (`:760`) exige categoria, mas `FORNECEDOR` "pode crescer" — declarar ali passa. **FALTA:** categoria `NOSSO_HOST` que reprove por definição |
| R11 | Chave nova obrigatória em `lib/env.ts` sem função no `update.sh` | **o app não sobe** depois de atualizar; domínio fora do ar | **PARCIAL.** `test:shell` (163 casos de `test-validators.sh`) exercita o `install.sh`. **FALTA:** `toda chave sem default tem escrita no update.sh` |
| R12 | Schema novo só em `migrations/`, sem apêndice no `baseline.sql` | quem atualiza fica com schema velho; a vitrine não abre, sem erro | **PARCIAL.** `invariants` aplica o baseline em install+update, mas não vê o que falta nele. **FALTA:** derivar o apêndice da migration (`feedback_artefato_espelho_se_deriva`) |
| R13 | Serviço novo no compose sem `image:` publicada | o serviço nunca atualiza na VPS do cliente | **SIM.** Há teste reprovando o retorno do padrão `build:`-only, e `imagens-ok` é obrigatório |
| R14 | Vitrine facilita instalar → org bate nas 8 vagas e 32 cards no hub | hub do CRM vira parede de cards; layout móvel estoura | **NÃO.** O invariante 17 prova a disputa da 8ª vaga; o passo de layout (`spec:596`) roda com 2 pacotes. **FALTA:** medir o hub no teto (`scrollHeight`/`getBoundingClientRect`, ver `feedback_agrupar_cria_overflow`) |
| R15 | Instrução de pacote concatenada no template do system prompt | agente muda de comportamento; pior caso, para de escalar para humano | **NÃO.** `lib/ai` ↔ `lib/extensions` têm **0 arestas** hoje. **FALTA:** tudo — inclusive `texto de pacote não é expandido por PLACEHOLDER_RX` |
| R16 | Vitrine pública exposta a quem não é `platform_admin scope=full` | tenant admin vê catálogo onde todo botão dá 403 | **PARCIAL.** Invariantes 3, 4 e 5 e `context-routes.test.ts` (5 casos) provam o 403. **FALTA:** teste de UI — `quem não administra a instalação não vê botão de instalar` (hoje há o análogo no passo `spec:577`) |
| R17 | `EXTENSION_LIMITS` afrouxado (pacote > 64 KiB, catálogo > 128) para caber a vitrine | primeira instalação de um pacote grande derruba o worker por memória | **PARCIAL.** `strict-json.test.ts` (7) e `manifest.test.ts` (16) checam os tetos; mudar a constante muda os dois lados junto e fica verde. **FALTA:** o teto declarado com o motivo do número |

**Leitura da tabela (INFERIDO):** das 17, **7 não têm nenhum teste** e **7 têm cobertura
parcial que o próprio afrouxamento tornaria verde**. O padrão que se repete em R1, R2, R12 e R17
é o mesmo, e tem nome na memória do projeto: **`feedback_catraca_satisfeita_pelo_motivo_errado`
— sabote o CONSERTO, não só o defeito.** Um teste que afirma "o valor é X" não protege nada
quando o PR muda X nos dois lados; o que protege é afirmar a **propriedade** (o destino não vem
do pacote; o teto tem um motivo).

---

## 8. O QUE EU NÃO MEDI

Explícito, para ninguém medir contra a régua errada:

1. **Não executei nenhuma suíte.** Zero `pnpm test:unit`, `test:db`, `test:e2e`, `typecheck`,
   `lint`. Todos os números de caso deste documento vêm de **contagem de `it`/`test`/`step` por
   `grep -c`**, não de uma rodada. Um `it` pode estar `skip`ado — **eu não conferi `.skip`**.
2. **Não li os corpos dos 38 invariantes nem dos 22 passos de E2E.** Li os **títulos**. Um título
   pode mentir sobre o que o corpo afirma (`feedback_teste_confundido`). Para decidir se uma
   mudança de contrato mantém um invariante, leia o corpo — não esta tabela.
3. **Não li os 136 unitários de extensão**, só contei por arquivo.
4. **Não li `lib/extensions/service.ts` inteiro** (o arquivo tem ~750 linhas; li os trechos
   dos limites e de `loadCrmExtensions`). Não li `instalada.ts`, `versao.ts`, `erros-do-banco.ts`,
   `strict-json.ts`, `requests.ts`, `vocabulario.ts` nem os componentes
   `ExtensionsManager.tsx` / `ExtensionCatalog.tsx` / `ExtensionOperations.tsx` /
   `InstalledExtensionCard.tsx`.
5. **Não li o SQL.** Não abri as migrations de extensões, nem o `baseline.sql`, nem as RPCs. Toda
   afirmação sobre banco aqui é **o que o teste de invariante diz que garante**, não o que o
   schema faz. As RLS e os `grant`/`revoke` não foram inspecionados.
6. **Não li `docs/doctrine/packaging.md` nem `docs/adr/0001` na íntegra** — usei a síntese de
   quatro linhas do `CLAUDE.md` e medi o kit por `grep`.
7. **Não li `docs/white-label.md`.** A seção 4 se apoia em `tests/unit/branding.test.ts` (que é
   o mecanismo) e no `CLAUDE.md` (que é a doutrina).
8. **Não li `docs/doctrine/sistema-vivo.md` além dos títulos dos 7 invariantes** (`grep` de
   heading). Não respondi o Living System Checklist pela feature — isso é trabalho do PR.
9. **Não li `docs/architecture/extensoes-declarativas.architecture.json`** — só confirmei que
   existe. O mapa vivo precisa da peça nova com ≥2 arestas (DoD 13) e eu não medi as arestas
   atuais.
10. **Os tempos de CI são de UM run verde por workflow**, o mais recente na `main` no momento da
    medição — não são média nem p95. `e2e-parte (2)` = 27 min e `(3)` = 25 min são uma amostra de
    tamanho 1. O run de CI deste SHA não foi consultado.
11. **Não conferi `.skip`/`.only` em nenhum arquivo de teste**, nem se as 3 specs de extensão
    passam no CI hoje — usei o estado declarado no `user-journey-map.md`, que é **prosa de
    estado e tem prazo** (data declarada: 16/09/2026, commit `2bce4b7ec`; o SHA base deste
    documento é `8ad4e2572`, e **eu não diffei os dois**).
12. **Não medi o repositório da vitrine** (se existe), nem o CLI que exporta pacotes
    (`tests/e2e/fixtures/catalogo-extensoes.ts` foi lido só por referência no journey map).
13. **Não avaliei desempenho**: nenhuma medição de tempo de render do hub do CRM com N cards,
    nem de `loadCrmExtensions` com 8 instalações.
14. **Nada aqui é veredito sobre se o épico deve ou não entrar.** Este documento mede o que
    corre risco; a decisão é de quem lê.

---

_Documento gravado em `docs/research/marketplace/02-o-que-sera-impactado.md`, worktree
`/Users/rafaelmelgaco/wt/marketplace-ext`, branch `feat/marketplace-de-extensoes`, SHA base
`8ad4e257257f1f30a2d26de59229b93fa8915b6b`, 2026-09-17. Nenhum arquivo existente foi alterado._
