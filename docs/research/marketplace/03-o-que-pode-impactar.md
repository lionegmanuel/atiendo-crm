# Investigação C — O que pode impactar

> Papel: **adversário do desenho**. Assumo que o épico *Marketplace e Extensões* vale a pena
> e procuro o que o quebra.

| campo | valor |
|---|---|
| worktree | `/Users/rafaelmelgaco/wt/marketplace-ext` |
| branch | `feat/marketplace-de-extensoes` |
| SHA base | `8ad4e257257f1f30a2d26de59229b93fa8915b6b` (topo de `origin/main`) |
| `git status --porcelain` | 1 linha: `?? docs/research/marketplace/` (este documento) |
| data | 2026-09-17 |

## A régua

- **MEDIDO** — li o código/rodei o comando. Vem com `arquivo:linha` ou com a saída do comando.
  A afirmação é sobre o que está no SHA acima e não sobre o que estará amanhã.
- **HIPOTÉTICO** — deriva de desenho que **ainda não existe**. Não tem evidência porque não há
  o que medir; é raciocínio sobre o que o épico propõe construir.

Nunca apresento hipótese como medição. Onde nego existência, conto com `wc -l` e digo o comando.

*(documento em construção — seções abaixo)*

---

## 1. A porta de instalação

### 1.1 O que as guardas de hoje cobrem — MEDIDO

Li `lib/extensions/download.ts` (276 linhas), `lib/extensions/http.ts` (222),
`lib/extensions/download-rebinding.test.ts` (126) e a migration
`supabase/migrations/20260917120000_0271_extensoes_declarativas.sql` (706).

**Guarda de origem (`download.ts`).**

| Cobre | Onde |
|---|---|
| Origem tem de ser **exata**: sem usuário/senha, sem path, sem query, sem fragmento, e `url.origin === origin` | `download.ts:34-43` |
| Fora do laboratório, **só `https:`** | `download.ts:71` |
| `localhost` e qualquer subdomínio `*.localhost` recusados | `download.ts:72` |
| Literal IP não-público (privado, loopback, link-local, reservado) recusado — `ipaddr.process().range() !== "unicast"` | `download.ts:73-79, 88-94` |
| **DNS resolvido uma vez; TODOS os endereços têm de ser públicos, ou o conjunto inteiro cai** | `download.ts:114-124` |
| O socket recebe **os endereços já classificados** (`pinnedLookup`), e recusa se o hostname pedido mudar — não há segunda janela de resolução (anti-rebinding) | `download.ts:127-148`, provado em `download-rebinding.test.ts:44-95` |
| `::ffff:127.0.0.1` (IPv4 mapeado) derruba o conjunto inteiro | `download-rebinding.test.ts:97-111` |
| SNI/Host preservados no hostname original quando não é IP literal | `download.ts:227-229` |
| **Sem redirect**: só `statusCode === 200` passa | `download.ts:151-156` |
| **Sem compressão**: pede `identity` e recusa `content-encoding` diferente — não há bomba de descompressão | `download.ts:158-164, 223` |
| Teto de bytes aplicado **no stream**, não no cabeçalho: 64 KiB e também `entry.byte_length` | `download.ts:166-200`, `manifest.ts:7` |
| Prazo total de 15 s **incluindo o DNS** | `download.ts:17, 246-249`, provado em `download-rebinding.test.ts:113-125` |
| A URL é construída pelo servidor: `/packages/<sha256>.json` na origem admitida. **O navegador nunca escolhe URL de pacote** | `download.ts:268` |
| Exceção de laboratório só abre para `http://127.0.0.1` **quando** casa exatamente com `EXTENSIONS_LOCAL_CATALOG_ORIGIN` **e** `NEXT_PUBLIC_APP_URL` é loopback | `download.ts:59-66`, `service.ts:732-734` |

**Guarda de autoridade (`http.ts`).** `requireExtensionPlatformFor` exige, nesta ordem:
sessão (`loadAuthUser`), `is_platform_admin && !support` (`http.ts:43`), linha viva em
`platform_admins` com `scope='full'` (`http.ts:53-79`), e `aal2` quando
`platform_admins.mfa_required` **ou** quando a pessoa já tem fator (`mfaEmDivida()`, `http.ts:80`).
Falha de leitura vira **503, não 403** (`http.ts:60-69`) — falha aberta na informação, fechada na ação.
`operationKey` exige `Idempotency-Key` UUID (`http.ts:95-105`); `readExtensionBody` aplica o teto
**nos bytes lidos**, não no cabeçalho (`http.ts:136-192`).

**Guarda de integridade (`manifest.ts`).** `validateArtifact` (`manifest.ts:426-443`) confere, em
ordem: `byteLength` exato contra a entrada → SHA-256 → parser estrito → `mirrorsCatalog` (o manifesto
espelha publicador, nome, versão, licença, `host_api`, permissões e **todo o `display`**, incluindo
`es`) → `checkCompatibility`.

**Guarda de banco (a migration).** `fn_extensions_assert_actor` confirma, **no banco**, que o ator
existe em `auth.users` e tem `platform_admins.scope='full'` com `revoked_at is null`
(migration:127-141). `fn_extensions_finish_install` **reconfere o digest em SQL**
(`encode(sha256(convert_to(p_document,'UTF8')),'hex')`, migration:342-346), exige
`document::jsonb = p_manifest`, e exige que o manifesto menos os campos estruturais seja
**idêntico** à entrada do catálogo menos `sha256`/`byte_length` (migration:355-367).

### 1.2 O que elas NÃO cobrem — MEDIDO

1. **A âncora de confiança é o arquivo que o operador colou.** `entry.sha256` é o que
   `validateArtifact` compara (`manifest.ts:433`), e `entry.sha256` veio do próprio catálogo
   admitido. Todo o aparato prova **"o pacote é o que o catálogo disse"**, nunca *"o catálogo é o que
   o publicador disse"*. Catálogo adulterado a montante → pacote adulterado com **todas as guardas
   verdes**. A spec diz isso por escrito: "Copiar o hash do próprio servidor não prova autoria"
   (`docs/specs/extensoes-declarativas-v1.md:90`).
2. **Nenhuma política de TLS além do default do Node.** Não há `ca:`, `checkServerIdentity` nem
   pinning em `download.ts` (o arquivo inteiro está acima; conte: `grep -c "checkServerIdentity\|ca:" lib/extensions/download.ts`
   → 0). Qualquer CA da imagem vale para a origem.
3. **A guarda de SSRF é do lado do cliente.** Origem pública que *ela própria* é um proxy para a rede
   interna do cliente continua alcançável — nenhum verificador local resolve isso.
4. **A regex de origem do SQL é MUITO mais frouxa que a do TypeScript.**
   `p_snapshot->>'origin' !~ '^https?://[^/@?#[:space:]]+$'` (migration:172) **aceita**
   `http://192.168.1.1:8080` e `http://localhost`. A política estrita
   (`assertCatalogOrigin`) vive **só** em `lib/extensions/service.ts:647`. O banco não a conhece.
5. **A auditoria vive no TypeScript, não na RPC.** `grep -c api_audit_log` na migration → **0**.
   As sete ações (`extension.catalog_admitted`, `.installed`, `.updated`,
   `.preparation_cancelled`, `.reverted`, `.removed`, `.deactivated_by_removal`) são escritas em
   `service.ts:662, 795, 809, 833, 900, 939, 952`.

### 1.3 Se acrescentarmos um comando shell no kit, o que se perde

**MEDIDO, com uma consequência HIPOTÉTICA.** As RPCs têm
`grant execute … to service_role` (migration:698-706), e o `.env` do kit guarda
`SUPABASE_SERVICE_ROLE_KEY` e `SUPABASE_DB_URL` (`hostgator-setup-kit/install.sh:760-761, 1245-1246`).
Um comando shell que falasse com o banco — em vez de falar com o app — perderia, **cada item
medido acima**:

| Garantia | Vive em | Some no shell-direto? |
|---|---|---|
| Política de origem (https, sem localhost, sem IP privado, origem exata) | `service.ts:647` + `download.ts:68-81` | **Sim** — o SQL aceita `http://192.168.1.1` |
| Vínculo DNS / anti-rebinding / recusa de endereço especial | `download.ts:114-148` | **Sim** — o SQL não baixa nada; quem baixa é o chamador |
| Recusa de redirect e de compressão | `download.ts:151-164` | **Sim** |
| Prazo de 15 s e teto de stream | `download.ts:17, 187-198` | **Sim** |
| MFA (`aal2`) e bloqueio de sessão de suporte | `http.ts:43, 80` | **Sim** — o SQL só vê `platform_admins.scope` |
| `Idempotency-Key` como chave do recibo | `http.ts:95-105` | Parcial — a RPC exige `p_operation`, mas quem o escolhe é o chamador |
| Parser estrito (chaves duplicadas, BOM, surrogate solto, profundidade, nós) | `strict-json.ts` | **Sim** — `jsonb` do Postgres **aceita chave duplicada** e fica com a última; `strict-json.ts:137` a recusa |
| Validação de conteúdo de `display` (título ≤100, texto não-vazio, forma localizada) | `manifest.ts:117-124` | **Sim** — o SQL só checa `jsonb_typeof(display)='object'` (migration:186) |
| Linha em `api_audit_log` | `service.ts` (7 pontos) | **Sim — zero linhas de auditoria** |

O que o shell-direto **não** conseguiria burlar: `fn_extensions_assert_actor` exige um `p_actor` que
seja platform admin real no banco (migration:127-141) — mas numa VPS, quem tem a service key lê esse
uuid com uma linha de SQL. O resultado é uma instalação arbitrária **atribuída a um administrador que
não a fez**, com recibo em `extension_operations` e **nenhuma** linha de auditoria.

**O mecanismo que barra:** o comando shell tem de ser um **cliente HTTP fino** das rotas
`/api/v1/extensions/*`, autenticado como gente (token de sessão/bearer), nunca um cliente do banco.
Concretamente, três condições — e nenhuma é opcional:

1. **Zero uso de `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_DB_URL` no comando.** Um teste de cerca que
   varra `hostgator-setup-kit/*.sh` e reprove qualquer coisa que combine `fn_extensions_` com `psql`
   ou com a service key. Custo: ~40 linhas de teste, uma tarde.
2. **A política de origem passa a existir nos DOIS lados.** Portar `assertCatalogOrigin` para dentro
   de `fn_extensions_admit_catalog` como CHECK de forma (https obrigatório fora do laboratório,
   recusa de literal IP privado e de `*.localhost`) — o SQL **não** faz DNS nem HTTP (anti-pattern 9),
   então ele nunca substitui `downloadArtifact`; ele só fecha a fresta entre a regex frouxa da
   migration e a política real. Custo: uma migration + apêndice no baseline + MANIFEST, ~1 dia.
3. **O `grant execute … to service_role` das RPCs de escrita é a superfície.** Enquanto ele existir
   (e ele precisa existir, é como o app escreve), qualquer processo na VPS com a service key é
   administrador da instalação. Isso não é novo do marketplace — é o `threat-model.md` do self-host —
   mas **uma vitrine pública que convida a instalar por shell transforma uma superfície interna numa
   porta anunciada**. O mecanismo é não anunciar a porta: o comando do kit é um cliente HTTP, e a
   doutrina de packaging ganha a linha "kit não fala com o banco de extensões".

---

## 2. Publicação aberta

O não-negociável 13 (`docs/doctrine/extensoes.md:120-123`) e o DEC-004 §1 dizem: **catálogo oficial é
revisado**, qualquer criador envia, "validação automática e revisão proporcional ao perfil antecedem a
publicação", "teste verde não é selo". A pergunta é o que sobra para a revisão humana.

### O que o contrato JÁ barra — MEDIDO

| Ataque | Barrado por | Evidência |
|---|---|---|
| **Código arbitrário no pacote** | Não existe campo para ele. `profile: z.literal("declarative")`, e **todo** objeto do schema é `.strict()` — uma chave a mais reprova | `manifest.ts:136-191` |
| **Escalada de permissão** | `permissions` é `z.tuple([z.literal("navigation.tasks")])`; `capability` é `z.literal("tasks.open")`. Não há vocabulário para pedir mais | `manifest.ts:133, 175`; espelhado em SQL (migration:195) |
| **Dependência maliciosa** | `dependencies` é `z.tuple([])` — array vazio obrigatório | `manifest.ts:134`; SQL: `p_manifest->'dependencies' <> '[]'` (migration:362) |
| **Acesso a dados** | `data: {mode:"none"}` literal | `manifest.ts:147`; SQL (migration:362) |
| **Prototype pollution** | `__proto__`/`prototype`/`constructor` recusados no parser **e** na revalidação do snapshot | `strict-json.ts:13,137`; `manifest.ts:88,325` |
| **Chave JSON duplicada** (assinar um documento e servir outro) | `validateKeysAndWidth` recusa repetição | `strict-json.ts:137` |
| **DoS de parser** (profundidade, largura, nós) | varredura de custo limitado **antes** do parser recursivo | `strict-json.ts:78-123` |
| **Surrogate solto / NUL** (quebrar o `jsonb` a jusante) | `isJsonbSafeString` nas duas camadas | `strict-json.ts:58-72`, `manifest.ts:256-270` |
| **BOM, comentário, vírgula final** | recusados | `strict-json.ts:88-94,148,157` |
| **XSS no texto do card** | zero `dangerouslySetInnerHTML` em `components/extensions/` (`grep -rn dangerouslySetInnerHTML components/extensions/` → vazio); o corpo é renderizado como texto JSX | `ExtensionGuide.tsx:319-321` |
| **Identidade duplicada no mesmo catálogo** | `superRefine` no TS e `group by … having count(*) > 1` no SQL | `manifest.ts:232-242`; migration:200-203 |
| **Licença não-MIT** | `z.literal("MIT")` e `v_entry->>'license' <> 'MIT'` | `manifest.ts:215`; migration:195 |

### O que o contrato NÃO barra — MEDIDO por ausência

1. **Typosquatting de publicador. Nada impede.** `publisher` é
   `z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(2).max(64)` (`manifest.ts:89-93`) — só forma.
   Não existe registro de publicador, prova de posse de nome, nem lista de nomes reservados:
   `grep -rn -i "reserv\|oficial\|deskcomm" lib/extensions/*.ts` (fora de teste) devolve **1 linha**,
   e ela é um comentário sobre outra coisa (`instalada.ts:81`). `deskcomm`, `deskcomm-oficial` e
   `deskcornm` estão livres.
2. **"Parecer oficial" pelo texto. Nada impede.** `display.title` é texto livre de até 100
   caracteres e `summary` de até 400 (`manifest.ts:16-18, 117-124`). O conjunto de ícones é fechado
   em três (`manifest.ts:98`), o que tira o logotipo — mas não tira a palavra.
3. **Conteúdo de texto abusivo renderizado na tela de alguém.** O teto por pacote é
   **4 cards × 8 blocos × 2.000 caracteres = 64.000 caracteres** de texto livre
   (`manifest.ts:15-19`), mais títulos e descrições. Não há moderação, filtro, nem varredura de URL.
   **Atenuante medido:** o texto não é linkificado — `{body.text}` em JSX
   (`ExtensionGuide.tsx:321`) — então não há link clicável, e phishing exige que a pessoa copie e
   cole. Ainda assim é texto arbitrário do terceiro dentro do CRM de alguém.
4. **Colisão de identidade ENTRE catálogos.** A instalação é chaveada por
   `catalog_id + publisher + name` (migration:387-388). Dois catálogos admitidos podem trazer
   `acme/tarefas` cada um, e viram **duas instalações independentes**. A tela precisa distinguir
   origem; o modelo não impede a coexistência.
5. **Pacote "malicioso" no sentido de dano ao CRM: efetivamente barrado.** Sem código, sem dados,
   sem permissão além de abrir Tarefas, o pior que um pacote declarativo v1 faz é **enganar pelo
   texto**. Digo isto como medição, não como conforto: é a razão pela qual o perfil declarativo pode
   abrir a publicação antes de o resto existir.

**Mecanismos que barram (1) e (2), em ordem de custo:**

- **Namespace reservado, verificado por teste.** Uma lista de prefixos (`deskcomm*`, `oficial*`,
  `official*`) recusada em `slugSchema` e na regex do SQL, e uma varredura de similaridade
  (distância de Damerau-Levenshtein ≤ 1 contra a lista) no lado da vitrine. Custo: ~meio dia no
  contrato + migration + apêndice no baseline. **Barra typosquatting de nome exato e de 1 caractere;
  não barra homoglifos** — e não precisa barrar, porque o slug já é `[a-z0-9-]` (sem Unicode).
- **Selo visível de procedência na tela, não no pacote.** O manifesto **não pode** carregar
  "oficial" (ele é do terceiro); a origem do catálogo pode. A tela já guarda `catalog.origin`
  (`service.ts:494-499`) — falta exibi-la ao lado do nome, sempre, e dizer qual origem é a oficial.
  Custo: uma tarde de UI + um caso em `ExtensionsManager.test.tsx`.
- **Posse de publicador na vitrine** (conta, e-mail verificado, um publicador por conta). Isso é
  infraestrutura da vitrine, não do CRM. Custo: o serviço inteiro — ver §6.

---

## 3. Confiança sem TUF

A spec é explícita (`docs/specs/extensoes-declarativas-v1.md:92`): a admissão manual "é uma
implementação restrita do ponto de admissão, **não TUF**. Não oferece descoberta autenticada
automática, expiração, rotação delegada de chaves ou conhecimento de revogação offline."

Enumerando, com o cenário em que a falta dói e o que o **público** faz com o risco:

| O que não temos | MEDIDO onde a falta aparece | O cenário concreto em que dói | O que a vitrine pública faz com ele |
|---|---|---|---|
| **Descoberta autenticada** | A âncora é o arquivo que o operador colou; `admitExtensionCatalog` recebe bytes de `readExtensionBody` (`catalogs/route.ts:20`) e nada assina esses bytes | Alguém publica no fórum "cole este catálogo" com um digest de pacote trocado. Todas as guardas ficam verdes | **Multiplica.** Hoje o dano é um operador enganado por vez; com vitrine, o vetor vira "copie daqui" em escala, e o CRM não distingue a origem certa da falsificada |
| **Expiração de metadados** | `extension_catalogs` não tem coluna de validade. `grep -c -i "expires\|valid_until\|ttl" supabase/migrations/20260917120000_0271_extensoes_declarativas.sql` → **1**, e o único acerto é o comentário da linha 2 ("recibo `preparing`, **sem TTL**") — nenhuma coluna | Um catálogo admitido em 2026 segue "atual" em 2029; a tela mostra `admitted_at` mas nada diz que ele está velho | **Piora.** Numa vitrine viva, "o que eu tenho" e "o que existe" divergem continuamente, e nada mede a distância |
| **Rotação de chaves** | Não há chave. Nenhuma assinatura em `lib/extensions/` — `grep -rn "verify\|signature\|pubkey" lib/extensions/*.ts` (fora de teste) não devolve verificação criptográfica de procedência | Publicador perde a conta; não há como dizer "a partir da revisão N, a chave é outra" | **Vira obrigação.** Sem vitrine, não ter chave é coerente ("você trouxe o arquivo"). Com vitrine, não ter chave é uma promessa quebrada de proveniência |
| **Revogação offline** | Nada reconsulta o catálogo depois da instalação: `loadExtensionGuide` lê **só** estado local (`service.ts:519-566`), e `downloadArtifact` só é chamado em `installExtension` (`service.ts:732` — único call site não-teste) | Versão 1.2.0 é retirada por ser abusiva. Quem já instalou nunca fica sabendo. **Não há caminho no código para ficar sabendo** | **Transforma em incidente.** É exatamente o cenário do DEC-004 §2, e a política aprovada (A) exige um **aviso acionável** que hoje não existe como peça |
| **Rollback de catálogo** | *Temos parcialmente.* `v_revision < v_catalog.revision` é recusado, e revisão igual com conteúdo diferente também (migration:206-209) | — | Cobre o "voltar para um estado antigo" **dentro de uma origem**; não cobre trocar a origem inteira |

**O mecanismo que barra o pior deles (revogação):** um **aviso de versão**, não um interruptor.
Concretamente — e cabendo na política A do DEC-004:

1. Uma coluna de aviso por identidade+versão no catálogo admitido (`entries[].advisory`), preenchida
   quando o operador admite uma revisão nova. Custo: migration + apêndice + MANIFEST + UI, ~2 dias.
   **Limite honesto:** só alcança quem admite catálogo novo. Não é revogação; é "da próxima vez que
   você olhar, você vê".
2. Uma verificação **puxada pelo host**, opt-in, que compara as instalações locais com a revisão
   corrente da origem e abre um item na Central. Custo: um cron + uma tela, ~3 dias. **Isto muda a
   afirmação "o instalado não depende do catálogo"** (não-negociável 8) de invariante para
   "invariante com uma exceção que o administrador ligou" — e o texto da doutrina precisa mudar
   junto, senão ela vence o prazo.
3. **O que NÃO se pode fazer:** desligar remoto por padrão. O DEC-004 §2 recusou B por escrito.

---

## 4. Anunciar o que não existe — **a lista de promessas que a vitrine faria e o produto não cumpre**

Este é o entregável principal. Confronto o desejo do épico com a tabela "o que existe hoje e o que
ainda não existe" (`docs/doctrine/extensoes.md:141-149`) e com o código medido acima. O
não-negociável 11 diz: "Tela, README ou changelog não prometem SDK, execução isolada de código,
**marketplace público** ou avaliações antes da prova deles" (`extensoes.md:111-114`).

| # | A promessa que a vitrine faria | O que existe de fato | Estado |
|---|---|---|---|
| 1 | "Instale na sua VPS com a mesma facilidade que instalar o CRM" | Instalar exige **ser administrador da instalação, com MFA quando aplicável** (`http.ts:41-91`), **colar um arquivo de catálogo** obtido fora da resposta a verificar (spec:90) e conhecer publicador/nome/versão. Não há "um clique da vitrine para a minha VPS", e a spec **recusa por escrito** aceitar URL de pacote vinda do navegador (spec:94) | **NÃO CUMPRE — e a recusa é deliberada** |
| 2 | "Qualquer pessoa cria e publica" | Não há serviço de publicação. O que existe é `experiments/extensoes/catalog/catalog.py` — CLI com SQLite, **em `experiments/`**, rodando em `127.0.0.1` | **NÃO CUMPRE** |
| 3 | "Extensões que fazem X" (qualquer X que não seja texto) | Uma extensão v1 renderiza até 4 cards de texto e um botão que abre Tarefas. `capability: z.literal("tasks.open")` (`manifest.ts:175`) é o vocabulário **inteiro** | **NÃO CUMPRE** |
| 4 | "Extensões guardam seus dados" | `data: {mode:"none"}` literal (`manifest.ts:147`). A ADR-0002 foi **aceita em 17/09/2026 e "ainda não construída"** (`extensoes.md:147`) | **NÃO CUMPRE** |
| 5 | "Avaliações e notas da comunidade" | Zero código. `grep -rn -i "avalia\|rating\|review" lib/extensions/ app/api/v1/extensions/` → vazio | **NÃO CUMPRE** |
| 6 | "N downloads" / "X instalações" | Zero código: `grep -rn -i telemetr lib/extensions/ components/extensions/ app/api/v1/extensions/` → **0**; nenhum contador de download existe | **NÃO CUMPRE** (e ver §7) |
| 7 | "Publique na licença que quiser" | `z.literal("MIT")` no TS (`manifest.ts:215`) **e** `v_entry->>'license' <> 'MIT'` no SQL (migration:195). Apache-2.0 e GPL **não entram** | **NÃO CUMPRE** |
| 8 | "Catálogo com centenas de extensões" | Teto de **128 entradas por catálogo** (`manifest.ts:12`, migration:189) e **8 catálogos por instalação** (migration:213-214) | **NÃO CUMPRE acima de 128** |
| 9 | "Em qualquer idioma" | O manifesto aceita **`pt-BR` (obrigatório) e `es` (opcional)**, e só (`manifest.ts:22, 104-107`) | **NÃO CUMPRE** |
| 10 | "Execução isolada, sandbox, SDK" | `experiments/extensoes/runtime/` tem sondas WASM e de contêiner — é **bancada**, não produto. Nenhum import de `experiments/` em `lib/`, `app/` ou `components/` | **NÃO CUMPRE — e o não-negociável 11 proíbe prometer** |
| 11 | "Versão por organização" / "histórico de versões" | Uma versão por instalação; **desfazer alcança UMA troca** — `previous_artifact_id` é uma coluna só (migration:387-390). Histórico de mais de um passo está **recusado por escrito** | **NÃO CUMPRE** |
| 12 | "Se sair uma versão perigosa, a gente avisa" | Nenhum caminho no código reconsulta catálogo depois de instalar (§3) | **NÃO CUMPRE** |
| 13 | "Funciona nas próximas versões do CRM" | `HOST_API_VERSION = 1` fixo (`manifest.ts:87`); ver §8 para o que acontece quando ele sobe | **NÃO CUMPRE — e o modo de falha é silencioso** |

**A leitura dura:** das treze, **onze** são promessas que a vitrine faria por reflexo
(é o que toda loja de extensão diz) e que o produto de hoje não sustenta. Duas delas — #1 e #10 —
não são "ainda não", são **recusas registradas**: prometê-las seria contradizer a spec e o
não-negociável 11 no mesmo texto.

---

## 5. Vitrine vazia

**MEDIDO. Existe exatamente UM pacote de exemplo no repositório, e ele é gerado por código, não versionado como arquivo.**

```bash
cd /Users/rafaelmelgaco/wt/marketplace-ext
grep -rl --include='*.json' '"declarative"' . | grep -v node_modules | wc -l   # → 0
```

Zero manifestos `.json` no disco. O único pacote é `command_make_example`
(`experiments/extensoes/catalog/catalog.py:248-295`): `laboratorio-local/tarefas-praticas` 1.0.0,
**um** card (`organizar-proximo-passo`), **um** bloco, ação "Abrir tarefas". As fixtures E2E
(`tests/e2e/fixtures/catalogo-extensoes.ts:356-373, 601-636`) chamam `make-example` e **reescrevem
publisher/name/version** para montar variantes — inclusive o "pacote alterado" que existe só para
provar a recusa por digest. Não são extensões; são casos de teste.

**O que um visitante veria no dia 1, honestamente:** uma vitrine com **um** item chamado
"Tarefas práticas", cujo conteúdo é uma frase de orientação e um botão que leva a uma tela que o CRM
já tem no menu. A pergunta que ele faria — *"e o que mais ela faz?"* — não tem resposta, porque
`tasks.open` é o vocabulário inteiro.

**Uma loja com um folheto é pior que nenhuma loja**: ela transforma "ainda não temos" (neutro) em
"temos, e é isto" (veredito). E o veredito é sobre a plataforma, não sobre o pacote.

**O mecanismo que barra:** não lançar a vitrine pela vitrine. Duas condições, nesta ordem:
1. **Um número mínimo de capacidades, não de pacotes.** Enquanto `tasks.open` for a única, todo
   pacote é o mesmo pacote com outro texto. A régua é: **≥3 capacidades distintas com consumidor
   real**, cada uma pela porta do não-negociável 2. Custo: por capacidade, contrato + revalidação no
   servidor + teste de autoridade + tela — estimo 2 a 3 dias cada, e **nenhuma delas está desenhada**.
2. **≥5 pacotes oficiais que um leigo instalaria por vontade própria**, escritos por nós, cobrindo
   nichos diferentes do `VISION.md` (e-commerce, clínica, imobiliária). Sem isso, a vitrine é uma
   página de status disfarçada. Custo: baixo por pacote (é JSON), alto em produto (é decidir o que
   as extensões *são*).

---

## 6. Custo operacional

### Quem hospeda — HIPOTÉTICO, porque não existe

Não há infraestrutura de vitrine no repositório. O catálogo é um processo local com SQLite
(`experiments/extensoes/catalog/catalog.py`, spec:98: "processo separado, com banco SQLite próprio";
"Publicação local e exportação do arquivo de admissão acontecem por CLI"). Não há `app/` público de
vitrine, não há workflow de deploy dela, não há domínio.

O que a hospedagem precisa servir, **derivado do que `downloadArtifact` exige** (MEDIDO):
origem HTTPS **exata** (raiz do domínio: `pathname === "/"`, `download.ts:38`), servindo
`/packages/<sha256>.json` (`download.ts:268`), **sem redirect** (`download.ts:151`) e **sem
compressão** (`download.ts:158-164`). Isso elimina de saída: um path sob o site do produto
(`site.com/marketplace/` não passa), um CDN que redirecione, e a compressão automática que
praticamente todo CDN liga por padrão. **É um requisito de infraestrutura mais apertado do que
parece, e ele está no código hoje.**

### Quando ela cai — MEDIDO, e a doutrina confere

O não-negociável 8 diz "catálogo fora do ar impede só novos downloads". **Confirmado no código:**

- `loadExtensionGuide` (`service.ts:519-566`) — o caminho que renderiza um guia instalado — lê
  `extension_installations`, `organization_extensions` e `extension_artifacts`. **Nenhuma rede.** O
  comentário na linha 519 afirma isso, e o corpo o cumpre.
- `downloadArtifact` tem **um único call site** não-teste: `service.ts:732`, dentro de
  `installExtension`.
- A gestão lista catálogos a partir da tabela `extension_catalogs` (`service.ts:309-312`), do
  snapshot gravado — não da origem.

**Portanto: vitrine fora do ar → nenhuma tela do CRM quebra, nenhuma extensão instalada para.**
Custo de indisponibilidade: quem quer instalar algo novo não consegue. Isso é o desenho, e ele
aguenta a vitrine cair.

### O gargalo humano — HIPOTÉTICO, e é o risco de programa

O DEC-004 §1 escolheu revisão antes da publicação e registrou a consequência: "Exige capacidade de
revisão dos mantenedores", e "Não proponho prazo de revisão, suporte ou quantidade de extensões
aceitas sem medir capacidade". **A memória do projeto já mediu esse gargalo noutro contexto:** a
triagem de PRs precisou de duas faixas, uma rodada de cético e portões por lote para caber
(`feedback_triagem_peso_do_processo`). Revisão de extensão é o mesmo trabalho com menos
ferramenta: não há CI do contribuidor, não há diff, e o que se revisa é **texto de produto** — para o
qual não existe teste.

O mecanismo que barra: **fila com teto declarado e recusa automática acima dele.** Não um SLA (o
DEC-004 proíbe prometer prazo), mas um número de vagas abertas por semana, visível na vitrine,
que fecha sozinho. Custo: baixo em código, alto em disciplina. Sem isso, o modo de falha é o
conhecido — a fila cresce, a revisão vira carimbo, e "revisado" deixa de significar alguma coisa,
que é exatamente o que o DEC-004 recusou ao descartar a opção B.

---

## 7. LGPD e dados

**Releitura do DEC-004 §3 e do não-negociável 13, terceiro travessão.** A política aprovada (A) é:
"Começar com downloads e avaliações; depois decidir o relato de uso". E o não-negociável:
"Qualquer telemetria de uso, venha da VPS ou de outro ponto, **com ou sem identificador**, pede
decisão própria antes" (`extensoes.md:129-131`).

**O que a vitrine pode medir sem pedir decisão nova — MEDIDO contra o texto aprovado:**

| Pode | Por quê |
|---|---|
| **Entregas de pacote registradas pelo próprio serviço** que serve `/packages/<sha>.json` — incluindo repetições e atualizações | É o "downloads" do DEC-004 §3 opção A, e o PROG-017 §12 define exatamente assim: "Downloads contam entregas de pacote registradas, incluindo repetições e atualizações conforme metodologia publicada" |
| **Avaliações**, com identidade de comunidade própria, uma por conta e extensão, com contexto de versão e moderação | PROG-017 §12. **Condição dura:** "Essa identidade **não é criada a partir da lista de usuários da VPS**" |

**O que NÃO pode, sem decisão própria antes:**

1. **Qualquer coisa que a VPS conte de volta.** Instalações ativas, uso, "extensão X está rodando em
   N lugares". DEC-004 §3: "Saber se uma instalação continua ativa exige que a VPS conte algo de
   volta". Hoje o código não conta nada: `grep -rn -i telemetr` em `lib/extensions/`,
   `components/extensions/` e `app/api/v1/extensions/` → **0 linhas**.
2. **Identificador persistente**, mesmo aleatório ou hash. "Identificador persistente é pseudônimo,
   não anonimato, e não entra por padrão" (`extensoes.md:133`).
3. **Reaproveitar o consentimento do Sentry.** DEC-004 §3 diz explicitamente que o consentimento
   atual é para **erros**, e "Nenhum dos dois autoriza automaticamente criar uma identidade
   persistente de adoção".

**A armadilha concreta que eu vejo — HIPOTÉTICO, mas o mecanismo é barato.** Um contador de download
no servidor da vitrine **grava IP e User-Agent** por padrão, em qualquer stack (Nginx, Vercel,
Cloudflare). IP de uma VPS de cliente **é dado pessoal do cliente dele** sob LGPD, e o log dessa
requisição correlaciona *instalação × extensão × tempo* — que é exatamente o "relato de adoção" que o
DEC-004 §3 recusou como opção B. **A política aprovada seria violada por um default de
infraestrutura, sem ninguém decidir nada.**

**O mecanismo que barra:** o contador é **incremento sem retenção** — a vitrine soma numa linha
agregada e o log de acesso da origem de pacotes tem retenção zero (ou IP truncado) **por
configuração declarada antes do primeiro byte servido**, com a metodologia publicada na própria
página (o não-negociável 13 já exige: "O painel diz que downloads não são usuários ativos, e toda
métrica publica método e limitações"). Custo: uma decisão de infra na hora de subir, e um parágrafo.
Depois de subir, é uma migração de dados sob LGPD.

---

## 8. Compatibilidade no tempo

**A pergunta:** o que acontece com um pacote instalado quando o CRM é atualizado e o `host_api` sobe?

**O comportamento real, MEDIDO** — `checkCompatibility` (`manifest.ts:368-388`) com
`HOST_API_VERSION = 1` (`manifest.ts:87`):

```
if (subject.host_api.min > HOST_API_VERSION || subject.host_api.max < HOST_API_VERSION)
  return incompatible("host_api_unsupported");
```

É uma **janela fechada**, não um piso. O pacote de exemplo declara `{min:1, max:1}`
(`catalog.py:256`). Quando `HOST_API_VERSION` virar **2**, esse pacote passa a ter
`host_api.max (1) < 2` → **incompatível**. Não é um caso de borda: é o comportamento de **todo
pacote existente** no dia em que a constante sobe, a menos que o publicador tenha adivinhado o futuro
e escrito `max: 999`.

E o que acontece então, nos dois lugares:

**(a) No hub do CRM — sai de cena em silêncio.** `loadExtensionGuide` lança
`extension_incompatible` (`service.ts:558-559`), e `loadCrmExtensions` usa `allSettled`: cada rejeição
vira **um `logger.warn`** e o guia é **filtrado da lista** (`service.ts:581-597`). A instalação
continua `enabled=true` no banco. Só quando **todos** falham é que o hub distingue falha de lista
vazia (`service.ts:594-597` + `app/app/crm/page.tsx:37-47`). Portanto: com duas extensões ativas,
uma delas incompatível, **a organização perde um card e ninguém é avisado**. O `logger.warn`
(`service.ts:585-589`) é o único registro, e ele não tem porta na tela.

**(b) Na gestão da instalação — aparece, com o motivo e com saída.** `montarInstalada`
(`instalada.ts:78-110`) transforma o pacote ilegível/incompatível em **linha incompatível com o
vínculo preservado**, e `InstalledExtensionCard.tsx:221-233` oferece desativar
(`extension-disable-incompatible-<id>`). `montarAnterior` marca o "desfazer" como bloqueado com
motivo (`instalada.ts:45-74`). Isso está coberto por teste
(`ExtensionsManager.test.tsx:443, 613, 1562, 1597`). **Esta metade está bem feita.**

**O buraco é a assimetria entre (a) e (b):** quem administra a instalação vê; quem **usa** a
organização não vê nada, só a ausência. Numa VPS self-host, quem administra a instalação e quem usa
o CRM **frequentemente não são a mesma pessoa** (é o cenário do revendedor de marca própria).
E o sintoma do lado de quem usa — "o card sumiu depois da atualização" — é indistinguível de bug.

**O mecanismo que barra**, em ordem de custo:

1. **O hub distingue "nenhuma" de "algumas não puderam ser lidas".** `loadCrmExtensions` já tem a
   informação (as rejeições em `guias`); falta devolvê-la e a tela dizer *"uma orientação não está
   disponível nesta versão — fale com quem administra a instalação"*. Custo: ~1 dia, e é o menor
   conserto com o maior retorno. É literalmente o não-negociável 5 ("toda preparação tem saída pela
   tela") aplicado ao caso que hoje escapa.
2. **`host_api` passa a ser piso, não janela** (`min <= HOST_API_VERSION`, sem teto), e a
   incompatibilidade passa a ser declarada por capacidade removida em vez de por número. Custo:
   mudança de contrato — exige `format_version 2` ou uma regra de transição, e **não** pode ser feita
   depois de haver pacotes de terceiros no mundo. **É agora ou é caro.**
3. **HIPOTÉTICO, e é o risco de programa:** um marketplace público transforma um número interno
   (`HOST_API_VERSION`) numa **promessa contratual com estranhos**. Subir de 1 para 2 deixa de ser
   uma linha de código e passa a ser um evento de ecossistema. Enquanto há um pacote de exemplo,
   isso é grátis. Depois da vitrine, nunca mais é.

---

## Tabela-síntese de riscos

| # | Risco | Régua | Severidade | O que o barraria | Custo de barrar |
|---|---|---|---|---|---|
| R1 | Comando shell no kit falando com o banco contorna origem, DNS-pinning, MFA, parser estrito **e a auditoria inteira** (`grep -c api_audit_log` na migration → 0) | MEDIDO (guardas e grants); HIPOTÉTICO (o comando não existe) | **Alta** | Comando = cliente HTTP fino das rotas `/api/v1/extensions/*`; teste de cerca que reprova `fn_extensions_` + service key em `hostgator-setup-kit/*.sh` | ~1 dia (cerca) |
| R2 | Regex de origem do SQL (`^https?://…`) aceita `http://192.168.1.1`; a política estrita vive só em `service.ts:647` | MEDIDO (migration:172 × `download.ts:68-81`) | **Média** | Portar a forma da política para CHECK na RPC (sem DNS, sem HTTP) | migration + baseline + MANIFEST, ~1 dia |
| R3 | Typosquatting de publicador: `slug` só valida forma; zero registro, zero nome reservado | MEDIDO por ausência | **Alta** (com vitrine) | Lista de prefixos reservados no contrato **e** no SQL + similaridade ≤1 na vitrine + origem sempre visível na tela | ~1 dia + UI |
| R4 | Até 64.000 caracteres de texto livre de terceiro renderizados no CRM de alguém, sem moderação | MEDIDO (`manifest.ts:15-19`) | **Média** (atenuada: texto não-linkificado, `ExtensionGuide.tsx:321`) | Revisão humana antes de publicar (já é a política) + canal de denúncia + poder de despublicar | processo, não código |
| R5 | Sem revogação: nada reconsulta o catálogo depois de instalar (`downloadArtifact` tem 1 call site) | MEDIDO (`service.ts:519, 732`) | **Alta** | Aviso por versão no catálogo admitido; verificação puxada pelo host, opt-in, abrindo item na Central | ~2-3 dias + mudar o texto do não-negociável 8 |
| R6 | Âncora de confiança = arquivo colado. Catálogo adulterado a montante passa com todas as guardas verdes | MEDIDO (`manifest.ts:433`, spec:90) | **Alta** | O verificador mantido do PROG-017 §11 (TUF). **Nada menor resolve** | fora do escopo deste épico |
| R7 | Extensão incompatível some do hub da organização **em silêncio** (só `logger.warn`) | MEDIDO (`service.ts:581-597`) | **Alta** — é regressão de primeira impressão | Hub distingue "nenhuma" de "algumas ilegíveis" e diz o quê fazer | ~1 dia |
| R8 | `host_api` é janela fechada: `{min:1,max:1}` morre quando `HOST_API_VERSION` vira 2 | MEDIDO (`manifest.ts:87, 375`) | **Alta** no tempo | Virar piso sem teto — **antes** de haver pacote de terceiro no mundo | mudança de contrato; barata hoje, cara depois |
| R9 | Teto de 128 entradas/catálogo e 8 catálogos/instalação | MEDIDO (`manifest.ts:12`, migration:189, 213) | **Média** | Paginação de catálogo ou catálogo por categoria — **mudança de contrato** | migration + contrato |
| R10 | Só MIT; só `pt-BR`/`es` | MEDIDO (`manifest.ts:215, 22`; migration:195) | **Média** | Ampliar o vocabulário de licença e de idioma no contrato | migration + contrato |
| R11 | Origem tem de ser raiz de domínio HTTPS, sem redirect e sem compressão — elimina path sob o site e o default de quase todo CDN | MEDIDO (`download.ts:38, 151, 158-164, 268`) | **Média** | Decidir a hospedagem **contra estes requisitos** antes de comprar domínio | grátis agora, retrabalho depois |
| R12 | Contador de download grava IP/UA por default e reconstrói adoção — o que o DEC-004 §3 recusou | HIPOTÉTICO (infra não existe); MEDIDO que hoje há **0** telemetria | **Alta** (LGPD) | Incremento agregado sem retenção, IP truncado, metodologia publicada, decidido **antes** de servir o primeiro byte | um parágrafo agora; migração de dados depois |
| R13 | Vitrine com 1 pacote de exemplo e 1 capacidade | MEDIDO (`wc -l`/`grep` acima) | **Alta** (produto) | ≥3 capacidades com consumidor real + ≥5 pacotes oficiais antes de abrir | semanas |
| R14 | Fila de revisão sem teto vira carimbo; "revisado" perde significado | HIPOTÉTICO (o DEC-004 §1 já registrou a consequência) | **Média** | Vagas por semana, visíveis, que fecham sozinhas. **Nunca um SLA** (o DEC-004 proíbe) | processo |
| R15 | Vitrine dentro do CRM vaza a marca do produto na instalação de um revendedor | HIPOTÉTICO (a vitrine não existe); MEDIDO que a guarda existe (`tests/unit/branding.test.ts`, 1.094 linhas) | **Média** | Vitrine **fora** do app, ou dentro com nome resolvido por `branding()` e o teste de marca estendido | ~1 dia se decidido cedo |

---

## A lista curta de "não prometa isto ainda"

A fala que a vitrine **não pode** ter — cada linha contradiz o código medido ou uma recusa escrita:

1. ❌ **"Instale com um clique."** A spec recusa URL de pacote vinda do navegador (spec:94). Instalar
   exige administrador da instalação, MFA quando aplicável, e um catálogo colado à mão.
2. ❌ **"Tão fácil quanto instalar o CRM."** Instalar o CRM é um `install.sh`. Instalar uma extensão
   é admitir catálogo + preparar + concluir, com precondição de revisão a cada troca.
3. ❌ **"Crie sua extensão e publique."** Não há serviço de publicação. O que existe é um CLI em
   `experiments/`.
4. ❌ **"Extensões com código próprio" / "SDK" / "sandbox".** Não-negociável 11, textualmente.
5. ❌ **"Sua extensão guarda seus dados."** `data: {mode:"none"}` é literal no contrato e no SQL.
6. ❌ **"Avaliações da comunidade" / "N downloads".** Zero código dos dois lados.
7. ❌ **"Publique na sua licença."** Só MIT, no TS **e** no SQL.
8. ❌ **"Em qualquer idioma."** `pt-BR` obrigatório, `es` opcional, e só.
9. ❌ **"Centenas de extensões."** 128 por catálogo, 8 catálogos.
10. ❌ **"Instalou uma vez, funciona sempre."** `host_api` é janela fechada, e o hub hoje **cala**
    quando ela fecha.
11. ❌ **"Se uma versão for perigosa, avisamos você."** Nenhum caminho no código reconsulta o
    catálogo depois de instalar.
12. ❌ **"Extensões verificadas" / qualquer selo de segurança.** A âncora de confiança é o arquivo
    que o operador colou. "Copiar o hash do próprio servidor não prova autoria" (spec:90).
13. ⚠️ **"Marketplace oficial"** — a palavra *oficial* só é honesta se houver namespace reservado e
    a origem do catálogo aparecer na tela ao lado de cada nome. Hoje não há nem uma coisa nem outra.

**O que a vitrine PODE dizer hoje, sem mentir:** que o DeskcommCRM tem um **contrato de extensão
declarativa v1**, aberto e documentado; que o núcleo funciona inteiro com zero extensões; que
instalar é uma decisão de quem administra a instalação, e ativar é de quem administra a organização;
e que a distribuição pública **está em construção**. Isso é menos empolgante e é verdade — e o
não-negociável 11 existe exatamente para preferir a segunda coisa.

---

## O QUE EU NÃO MEDI

Declarado explicitamente, para ninguém medir contra a régua errada:

1. **Não rodei nenhuma suíte.** Nem `pnpm test:unit`, nem `test:db`, nem `test:e2e`. Nenhuma
   afirmação minha depende de suíte verde; todas dependem de leitura de código com `arquivo:linha`.
   Toda contagem que dou veio de `grep`/`wc -l` citados no próprio texto.
2. **Não li `lib/extensions/service.ts` inteiro** (1.028 linhas). Li os trechos citados: 244-264,
   302-346, 416-520, 515-600, 641-673, 705-800, 880-1000. Não li os caminhos de
   `configure`, `revert` e `remove` linha a linha.
3. **Não li a migration inteira** (706 linhas). Li `fn_extensions_assert_actor`,
   `fn_extensions_admit_catalog`, `fn_extensions_finish_install`, os grants e as declarações de
   tabela. **Não li** `fn_extensions_configure`, `fn_extensions_revert_install`,
   `fn_extensions_remove_installation` nem as policies RLS — então **não afirmo nada sobre
   isolamento entre organizações**; isso é `tests/invariants/extensoes-declarativas.test.ts`, que
   não rodei.
4. **Não verifiquei se os testes que cito realmente passam** no SHA `8ad4e2572`. Cito o que eles
   *afirmam* pelos nomes e corpos que li — `download-rebinding.test.ts` eu li inteiro; de
   `ExtensionsManager.test.tsx` (**1.817** linhas, `wc -l`) li só as linhas de título que o `grep`
   devolveu.
5. **Não medi desempenho nem custo em dinheiro.** Nenhum número sobre latência de instalação, carga
   da vitrine, banda ou preço de hospedagem. Onde dou "custo de barrar", é **estimativa de esforço
   minha**, não medição.
6. **Não explorei nada.** Nenhuma tentativa de SSRF, nenhuma chamada a RPC, nenhum pacote
   construído. As classes de problema acima vêm de leitura; a ausência de uma barreira no código
   **não é prova de que o ataque funciona ponta a ponta**, e eu não a tenho.
7. **Não li os documentos de decisão inteiros.** Do PROG-017 li §11-§14; do DEC-004 li o arquivo
   inteiro (69 linhas). **Não li** PROG-016, PROG-018, PROG-019, PROG-020, PROG-021 nem PROG-023 —
   e o PROG-018 é justamente "provas e sequência de entrega", que pode já responder parte do que
   levanto em §5 e §6.
8. **Não li os documentos irmãos desta investigação.** Vi que
   `01-o-que-impacta.md` e `02-o-que-sera-impactado.md` existem e li só o cabeçalho do primeiro, para
   não duplicar régua. **Se algum deles contradisser um número meu, remeça — não presuma qual está
   certo.**
9. **`experiments/extensoes/runtime/` e `events/` eu só listei o conteúdo.** Que nenhum código de
    produto os importa **eu medi**: `grep -rn "experiments/" lib/ app/ components/ | wc -l` → **0**.
    O que **não** medi é o que essas sondas concluíram — não li `runtime/probe.mjs`,
    `container/engine.mjs` nem `events/worker.mjs`, e o PROG-020 ("resultados da bancada") ficou
    fora da minha leitura.
10. **Não medi o estado da branch protection nem do CI** para nada que eu proponha. Toda estimativa
    de "custo de barrar" ignora o tempo de fazer o gate passar.
