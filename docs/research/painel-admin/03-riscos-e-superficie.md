---
tipo: investigacao-de-risco
epico: painel de administração da instalação
medido_em: worktree /Users/rafaelmelgaco/wt/painel-admin
branch: feat/painel-de-administracao
sha: b264bd2d65539cb415f09f1e64742cdea6eb719a
data: 2026-09-17
papel: adversário do desenho — o que o transforma em problema
---

# Painel de administração — risco, segurança e modos de falha

**O que este documento é.** Uma leitura adversarial do épico "guardar e editar as
credenciais e knobs da instalação pela tela". Não avalia se o épico vale a pena;
assume que sim e procura o que o quebra.

**Régua de honestidade.** Cada risco é marcado **MEDIDO** (li o código/rodei o
comando, e a evidência está citada em `arquivo:linha`) ou **HIPOTÉTICO** (deriva de
um desenho que ainda não existe). A seção final diz o que eu **não** medi.

**Nada foi explorado.** Nenhum ataque foi executado contra instância viva. Vale a
mesma ressalva de `docs/threat-model.md`.

---

## Sumário — o que quebra o épico se for ignorado

| # | Risco | Sev | Estado |
|---|---|---|---|
| R1 | A cifra que o precedente usa guarda a chave **no mesmo banco** que o cifrado | 🔴 | MEDIDO |
| R2 | Perder a chave torna todo segredo irrecuperável, e **não há rotação** | 🔴 | MEDIDO |
| R3 | O wrapper de auditoria grava `metadata` livre — corpo de requisição vira linha imutável | 🟠 | MEDIDO (ver R6) |
| R4 | Concentração: o painel vira o alvo único, e o gate de identidade hoje é só senha | 🟠 | MEDIDO |
| R5 | Config vinda do banco pode derrubar o app inteiro se o resolvedor lançar | 🟠 | MEDIDO (precedente) |
| R6 | Vazamento por Sentry / logger / mensagem de erro | 🟠 | MEDIDO |
| R7 | Tabela nova em `public` nasce **concedida a `anon`** | 🟠 | MEDIDO |
| R8 | Confundir configuração de INSTALAÇÃO com a de ORGANIZAÇÃO = escalada de privilégio | 🟠 | HIPOTÉTICO (desenho) |
| R9 | Superfície de extensões: SSRF, bomba, prototype pollution, XSS de manifesto | 🟡 | MEDIDO (guarda existe) |

---

## R1 — A cifra do precedente guarda a chave DENTRO do banco 🔴 MEDIDO

### O que é

O repo tem **duas** cifras de segredo, e elas têm propriedades de segurança
**opostas**. O épico precisa escolher conscientemente, e o precedente mais próximo
escolheu a pior das duas.

**Cifra A — AES-256-GCM na aplicação.** `lib/crypto/aes_gcm.ts`. Chave em
`process.env.AI_CRED_AES_KEY`, 32 bytes base64 (`aes_gcm.ts:22-43`). IV de 12 bytes
aleatório por segredo (`:58`), tag de 16 (`:61-64`). Grava `ciphertext`, `iv`, `tag`
como `bytea` e um `last4` para a UI (`:65`). **A chave nunca toca o banco.**

**Cifra B — `pgp_sym_encrypt` dentro do Postgres.** `fn_encrypt_oauth` /
`fn_decrypt_oauth`, migration `supabase/migrations/20260718150000_0041_webhook_secret_encryption.sql:47-70`.
`cipher-algo=aes256`. A chave vem de `private.fn_oauth_key()` (`0041:33-43`), que lê,
nesta ordem: a GUC `app.nuvemshop_oauth_key`, e — quando ela não existe — **a coluna
`value` da tabela `private.app_secrets`, em texto claro** (`0041:24-28`).

### A evidência de que a chave mora no banco na instalação real

`hostgator-setup-kit/_common.sh:1019-1036` — `ensure_encryption_key()` gera a chave
com `openssl rand -hex 32`, escreve no `.env` **e a semeia no banco**:

```bash
psql_run -c "insert into private.app_secrets (name, value) values ('nuvemshop_oauth_key', '${key}') ..."
```

O comentário no próprio script diz o porquê (`_common.sh:1031-1032`): *"Semeia no
banco — é de lá que as funções de cifra leem (Supabase não permite configurar a
chave via parâmetro de banco)."* É decisão consciente, forçada pelo Supabase cloud
(`0041:19-22` registra o `42501`).

### Por que isso importa para ESTE épico

A pergunta central do briefing — *"se a chave que cifra vive no `.env` e o cifrado
vive no banco, o que um atacante com só um dos dois consegue?"* — tem **duas
respostas diferentes** neste repo:

| Atacante tem | Cifra A (`AI_CRED_AES_KEY`) | Cifra B (`fn_encrypt_oauth`) |
|---|---|---|
| Só o banco (dump, `service_role`, SQL injection, réplica) | **nada** — só ciphertext, IV e tag | **tudo** — a chave está em `private.app_secrets` |
| Só o `.env` (leitura de arquivo no host) | chave sem ciphertext | chave sem ciphertext |
| Backup do kit (`hostgator-setup-kit/backup.sh:19`) | só ciphertext | **tudo** |

O `backup.sh` roda `pg_dump` pela **conexão de schema** (`url_do_schema()`,
`_common.sh:433-435`) **sem** `--schema=public` — de propósito, para o backup não sair
parcial (`backup.sh:15-18`). Consequência não declarada em lugar nenhum: **o arquivo
`backups/db-*.sql.gz` contém a chave mestra em texto claro, na mesma linha de dump que
o material cifrado com ela.** Um backup vazado é a perda total dos segredos de cifra B.

(`scripts/backup-db.sh:26` usa `--schema=public` e por isso **não** leva a chave — ver R2.)

### O precedente que o épico vai clonar escolheu a cifra B

`supabase/migrations/20260827200000_0201_credencial_do_google_pela_tela.sql` é o
molde mais próximo do que este épico quer: um singleton de credencial **de
instalação**, editável pela tela. O desenho dele é **excelente em tudo menos nisto**:

- `0201:48-56` — tabela `platform_google_oauth`, singleton com `check (id = 1)`.
- `0201:64-67` — `enable row level security` + `revoke all ... from anon, authenticated`
  + `grant` só ao `service_role`. RLS ligada com **zero policies**, e o cabeçalho
  (`0201:21-32`) explica: *"uma tabela com RLS ligada, sem policy nenhuma e com os
  grants de `anon`/`authenticated` revogados não é servida de jeito nenhum"*. Isto é
  a mitigação certa para R7 e deve ser copiada literalmente.
- `0201:33-42` — **e aqui está o problema**: escolhe `fn_encrypt_oauth` e rejeita o
  AES-GCM explicitamente (*"é de escopo de ORGANIZAÇÃO e exposta por view"*). O
  argumento dado é de **superfície** (não criar função `security definer` nova), e ele
  é bom. Mas o argumento de **separação de chave** não foi feito, e é o que decide.

O resultado medido: o `client_secret` do app OAuth do Google desta instalação — que
o próprio comentário diz que *"permite a QUALQUER UM trocar códigos e refresh tokens
em nome desta instalação, isto é, ler a agenda de todos os atendentes"* (`0201:28-32`)
— está guardado com uma chave que mora na tabela ao lado.

### Gravidade

🔴. Não porque a cifra B seja fraca (AES-256 é AES-256), mas porque ela **não compra
a propriedade pela qual se cifra**. Cifrar at-rest existe para que alcançar o banco
não seja alcançar os segredos. Na cifra B, alcançar o banco **é** alcançar os segredos.
E o épico multiplica o que está atrás dessa porta: hoje é um `client_secret` do Google;
depois será a chave de IA, o `X-Api-Key` do WAHA, o token do Resend, o token do Upstash.

### Mitigação concreta

1. **O painel usa a cifra A (AES-GCM na aplicação), com uma chave própria** — não
   reaproveite `AI_CRED_AES_KEY`, que é de escopo de organização e tem outro ciclo de
   vida. Uma env nova, ex. `PLATFORM_SECRETS_AES_KEY`, gerada pelo `install.sh` e
   gravada **só no `.env`**.
2. **A chave da instalação não é semeada no banco.** Se o painel precisar de uma
   função SQL, ela recebe o material já cifrado — nunca a chave.
3. **Copie de `0201` a forma da tabela** (singleton, RLS ligada, zero policies, grants
   revogados de `anon`/`authenticated`, só `service_role`). Essa parte do precedente é
   a melhor do repo.
4. **Documente no `backup.sh`** que o dump contém segredos cifrados **e não contém**
   a chave — e que o operador precisa guardar o `.env` separado, senão cai em R2.

---

## R2 — Perder a chave é perder tudo, e rotação não existe 🔴 MEDIDO

### O que é

Nenhuma das duas cifras tem versionamento de chave nem caminho de re-cifragem.
Medido: `grep -rn "rotateKey\|key_version\|kid" lib/ app/` devolve **zero**. O
único uso da palavra "rotação" no repo é `tests/unit/credenciais-ia-rotacao.test.ts`,
e ele testa **rotação do SEGREDO** (trocar a chave de API do provedor de IA pela
tela, `PATCH /api/v1/ai/credentials/:id`) — **não** rotação da chave de cifra.

O kit é explícito sobre a consequência, num comentário e não num mecanismo
(`hostgator-setup-kit/_common.sh:1016-1018`):

> *"Idempotente: reusa a chave do `.env` se existir (**trocá-la invalidaria dados
> já cifrados**); gera se ausente e appenda ao `.env`."*

### Os três modos de perda, todos alcançáveis por operador leigo

1. **`.env` perdido / recriado.** `ensure_encryption_key()` não acha
   `NUVEMSHOP_OAUTH_ENCRYPTION_KEY` no `.env`, **gera uma nova** e a semeia no
   banco com `on conflict do update` (`_common.sh:1026-1036`) — **sobrescrevendo a
   chave antiga**. Todo segredo cifrado antes vira lixo indecifrável, e o único
   sinal é um `✓` verde dizendo que a chave foi gerada. Para `AI_CRED_AES_KEY` é
   pior: não há sequer a semeadura no banco, e o `decryptKey` só vai lançar
   `Unsupported state or unable to authenticate data` no primeiro uso.
2. **Restauração de backup parcial.** `scripts/backup-db.sh:26` usa
   `--schema=public` — `private.app_secrets` **não** entra. Restaurar esse dump num
   banco novo devolve ciphertext sem chave.
3. **Migração de VPS.** O operador leva o dump e esquece o `.env`.

### Por que isso muda de categoria com este épico

Hoje o que se perde é recuperável colando a credencial de novo: são poucos
segredos, e quem os tem é o dono. **O épico transforma o painel no lugar onde TODA
credencial da instalação mora.** Perder a chave passa a significar "a instalação
inteira precisa ser reconfigurada do zero, e o operador não sabe quais eram as
credenciais" — porque o painel é exatamente o produto que fez ele parar de
guardá-las em outro lugar.

E a falha é **silenciosa por construção**: a decifragem só falha no momento de
USAR o segredo (mandar a mensagem, chamar a IA), não no momento de abrir o painel.
O painel mostra "Chave do WhatsApp: ✓ configurada" lendo a existência da linha, e o
envio falha em outro lugar, horas depois.

### Mitigação concreta

1. **Versione a chave na linha.** Uma coluna `key_version smallint not null` ao
   lado do ciphertext. Sem ela, rotação é impossível para sempre; com ela, é uma
   migration de backfill depois.
2. **Guarde uma prova de chave, não o segredo.** Uma linha-canário cifrada com a
   chave corrente. O `/api/v1/health` (ou o painel, no carregamento) tenta decifrá-la:
   falhou ⇒ a tela diz *"a chave que protege suas credenciais mudou — os segredos
   guardados não podem mais ser lidos"*, ANTES de o WhatsApp parar de enviar.
3. **`ensure_encryption_key()` não pode gerar chave nova em silêncio quando já
   existe material cifrado no banco.** Hoje ele faz: é a diferença entre
   "instalação nova" e "operador apagou o `.env`", e ele não pergunta. A guarda é
   uma contagem — se há linha cifrada e não há chave, **pare e avise**, não gere.
4. **O `backup.sh` do kit precisa dizer que o `.env` faz parte do backup.** Ele
   hoje salva banco + sessões do WhatsApp e não menciona o arquivo sem o qual o
   banco é indecifrável.

---

## R3 — O audit log grava `metadata` livre, e é append-only por 5 anos 🟠 MEDIDO

### A resposta direta à pergunta do briefing

> *"O audit log de hoje gravaria o valor de um campo de credencial se o painel
> usasse o wrapper padrão?"*

**Sim, se o handler passar o campo — e o wrapper não faz nada para impedir.**

`lib/audit/index.ts:43` declara `metadata?: Record<string, unknown>`; `:91` insere
`metadata: { ...entry.metadata, ...supportMetadata }` **verbatim**. Não há
allowlist, denylist, truncagem nem redação em lugar nenhum do caminho. O único
higienizador do módulo é `hashEmail()` (`:174`), e ele precisa ser **chamado pelo
handler** — o wrapper não o aplica.

### E o padrão perigoso já está no repo

`app/api/v1/agenda/configuracao/route.ts:52`:

```ts
void audit({
  action: "agenda.settings_updated",
  ...
  metadata: parsed.data,          // ← o corpo validado INTEIRO
});
```

Ali é inofensivo (`parsed.data` são prazos em minutos). Mas é **o molde que um
implementador do painel vai copiar**, porque é o único exemplo de "auditar a
mudança de configuração" no repo. Aplicado a um `PATCH /api/v1/platform/secrets`
com `{ waha_api_key: "..." }`, ele escreve a credencial em claro no banco.

### Por que é pior que um log qualquer

`api_audit_log` é **append-only por schema** — a doutrina do CLAUDE.md descreve, e
os grants do baseline confirmam (`supabase/baseline.sql:4550-4552`):

```
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."api_audit_log" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE ... TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE ... TO "service_role";
```

**Nenhum `UPDATE`, nenhum `DELETE`.** Um segredo que entra ali não sai: as únicas
saídas são (a) o expurgo de retenção, cujo default é **5 anos**, e (b) `TRUNCATE`,
que destrói a trilha inteira. Rotacionar a credencial vazada é o único conserto
real — e o operador leigo não vai saber que precisa.

Agravante de alcance: a policy `audit_log_select`
(`supabase/baseline.sql:4031`) libera a leitura para `fn_is_platform_admin()` **ou**
para quem é `admin` da organização da linha. Se o painel carimbar um
`organization_id` nas linhas de configuração de INSTALAÇÃO (o reflexo natural,
porque quase toda chamada a `audit()` no repo carimba), **todo admin de tenant
daquela organização passa a ler o `metadata`** — que é o vetor do R8.

### Mitigação concreta

1. **Auditar o FATO, nunca o VALOR.** `metadata: { campos_alterados: ["waha_api_key"],
   last4: "…9f2a" }`. O que a auditoria precisa responder é *quem mudou o quê e
   quando*, não *para qual valor*.
2. **Um gate, não uma regra.** Um teste que varre o AST das rotas do painel e
   reprova `metadata: parsed.data` / `metadata: body` — o repo já tem exatamente
   essa forma de guarda em `tests/unit/cron-audita-so-quando-ha-efeito.test.ts`,
   que varre toda rota de `app/api/v1/cron/`. Copie a forma.
3. **`organization_id` NULL nas linhas de configuração de instalação**, para que
   `audit_log_select` as entregue só ao platform admin. Medido: com
   `organization_id IS NULL`, o segundo ramo da policy não casa (`NULL IN (...)`
   não é verdadeiro), então sobra `fn_is_platform_admin()`. Isto é uma propriedade
   que o desenho precisa **escolher**, não herdar.

---

## R4 — Concentração de valor com identidade provada só por senha 🟠 MEDIDO

### O que é

O briefing está certo: o painel vira o alvo mais valioso da instalação. O que a
medição acrescenta é **quão barato está o gate hoje**.

`lib/auth/requirePlatformAdmin.ts:56-61` — o `aal2` é **condicional**:

```ts
if (paRow.mfa_required) {
  const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalData?.currentLevel !== "aal2") redirect("/login/mfa?next=/admin");
}
```

E o CLAUDE.md declara que `bootstrap-owner.ts` grava `mfa_required = false`
**explícito**. Logo, na instalação self-host recém-criada — o cenário do produto —
**`/admin/*` inteiro é protegido por senha e nada mais**.

O mesmo formato aparece na porta das extensões, `lib/extensions/http.ts:80`:

```ts
if ((platform.mfa_required && (await sessionAal()) !== "aal2") || (await mfaEmDivida())) {
```

Instalar uma extensão — que é executar código novo na instalação — está sob a
mesma condicional.

**Isto NÃO é crítica da decisão de produto.** Tornar o MFA opcional foi a decisão
certa: o comentário de `lib/auth/politica-mfa.ts:6-18` documenta o dano medido
(bloqueador de tela cheia como sétimo passo não anunciado do wizard). O problema
não é o cadastro ser opcional; é **a prova de identidade na hora da ação** ter sido
amarrada à mesma chave.

### O precedente que resolve, e ele já está no repo

`app/actions/auth/politicaDeMfa.ts:136` — `desativarMfaDaConta()` exige `aal2`
**incondicionalmente**, e o comentário (`:82-85`) dá o argumento inteiro:

> *"EXIGE TER PROVADO O FATOR NESTA SESSÃO (`aal2`). Sem isso, uma sessão roubada —
> que é exatamente o cenário que a verificação em duas etapas existe para conter —
> desligaria a proteção com um clique. É a mesma razão pela qual trocar senha pede
> a senha atual."*

A régua ali não é "o MFA é obrigatório?". É: **quando a ação destrói ou exporta a
própria proteção, quem TEM fator prova, sempre.** É a mesma assimetria que o
CLAUDE.md marca entre CADASTRAR e PROVAR (`mfaEmDivida()` não consulta a política).

### A régua que eu proponho para o painel

Três faixas, e o critério de cada uma é **o que a ação faz com o segredo**, não o
papel de quem a executa:

| Faixa | Ações | Exigência |
|---|---|---|
| **Leitura de estado** | "a chave do WAHA está configurada? `…9f2a`, atualizada em 12/03" | platform admin. Nada mais. |
| **Escrita de segredo** | gravar/trocar uma credencial, instalar extensão, mudar a origem do catálogo | `aal2` **se a pessoa tem fator cadastrado** — a régua do `mfaEmDivida()`, não a da política |
| **Exportação / revelação** | mostrar um segredo em claro, exportar o `.env`, desligar a cifra | `aal2` **sempre**, e se não há fator cadastrado a ação **não existe** na tela |

O argumento para a terceira linha ser diferente: uma ação que revela o segredo
guardado é o equivalente exato de `desativarMfaDaConta()` — ela desfaz a proteção
que o painel inteiro existe para dar. Se o precedente aceita bloquear ali, aceita
aqui.

E o argumento para a **faixa de exportação simplesmente não existir sem fator**:
o painel não precisa devolver segredo em claro para ser útil. `platform_google_oauth`
já provou isso — `0201:57-59`: *"O segredo nunca volta ao browser; a tela devolve
apenas se existe."* **Copie essa propriedade e a terceira faixa some sozinha**, o
que é melhor que protegê-la.

### Mitigação concreta

1. Segredo **nunca** volta ao browser. A tela devolve presença + `last4` + quando
   mudou. (Precedente: `0201:57-59`; `ai_provider_credentials_safe`, baseline:1215.)
2. Escrita de segredo exige `aal2` para quem tem fator, pela régua do `mfaEmDivida()`.
3. Um aviso **na própria tela**, não num doc: *"esta tela guarda as chaves da sua
   instalação. Ligar a verificação em duas etapas protege todas elas."* É o lugar
   onde pedir MFA finalmente faz sentido para o usuário — porque ele está vendo o
   que tem a perder. É o oposto de pedi-lo no passo 7 de um wizard.

---

## R5 — Configuração vinda do banco pode derrubar o app inteiro 🟠 MEDIDO (precedente)

### A doutrina que já existe

`lib/env.ts:37-48`, sobre `diasDeRetencao`:

> *"`z.coerce.number().int().positive()` lança para `=0`, que é justamente o que o
> operador da VPS escreve quando quer desligar a poda — e `lib/env.ts` roda no
> import do Next, então o throw vira 500 em TODAS as telas, com o contêiner
> `healthy` e nada dizendo o porquê. **Falha fechada na AÇÃO** (o valor inválido
> não vale) **e aberta na INFORMAÇÃO** (o app sobe e diz alto o que ignorou)."*

`lib/branding/instalacao.ts` é o mesmo princípio aplicado a config que vem do
BANCO, que é o caso deste épico. O CLAUDE.md sela: *"Resolvedor NUNCA lança —
`branding()` roda em `app/layout.tsx`, e um throw ali é 500 em todas as telas."*

### Os quatro modos de falha que o painel PRECISA ter resposta para

| Modo | O que o painel faz hoje se copiar mal | O que precisa fazer |
|---|---|---|
| **Banco fora** | leitura de config lança no layout ⇒ 500 em toda tela, contêiner `healthy` | cair para o valor do `.env`, renderizar, e dizer na tela que está no piso |
| **Valor lixo** (jsonb editado à mão, coluna com texto inválido) | Zod lança no resolvedor | recusar o VALOR (não a leitura), usar o default, registrar o motivo |
| **Decifragem falha** (R2) | `decryptKey` lança `unable to authenticate data` dentro do render | tratar como "credencial ausente", com a causa dita: *chave mudou*, não *não configurado* — **as duas precisam ser distinguíveis na tela**, senão o operador recadastra e o problema volta |
| **Rollback do `agent.sh`** | ver abaixo — é o pior e o menos óbvio | manter o `.env` escrito |

### O modo de falha que só este repo tem, e que quase ninguém previria

`lib/branding/instalacao.ts:15-22`, textual:

> *"O `agent.sh` do kit, em falha de update, reverte só a IMAGEM (`APP_IMAGE`) — não
> o schema, não o `git checkout`. E o `update.sh` aplica o baseline ANTES de puxar a
> imagem. Ou seja: **o rollback põe CÓDIGO ANTIGO sobre BANCO NOVO por construção**.
> Código antigo não conhece esta tabela; se a marca só existisse aqui, ela SUMIRIA
> no meio de um rollback — o pior momento possível para o cliente descobrir mais um
> problema."*

Traduzido para este épico: **um update que falha e reverte devolve uma imagem que
não conhece a tabela de credenciais.** Se o painel for a única fonte, a instalação
volta sem chave de IA, sem token do WAHA, sem Resend — no exato momento em que o
operador já está lidando com um update quebrado. O WhatsApp para.

É por isso que a doutrina de marca própria diz *"o banco está ACIMA do `.env`"* e
**ao mesmo tempo** *"`APP_NAME`/`APP_LOGO_URL` são semente e piso de rollback"*. As
duas metades são uma coisa só, e quem copiar só a primeira produz esta falha.

### Mitigação concreta

1. **O `.env` continua sendo escrito.** Toda gravação no painel escreve o banco
   (fonte) **e** reflete no `.env` (piso de rollback) — como o kit já faz para marca.
   Segredo cifrado no banco, segredo em claro no `.env` **que já era o lugar dele**:
   isto não piora nada, e é o que sobrevive ao rollback.
2. **Resolvedor não lança, nunca.** Mesma forma de `lib/branding/instalacao.ts`.
3. **A degradação é VISÍVEL.** `platform_branding` tem colunas `fallback_at` e
   `fallback_reason` (`lib/branding/instalacao.ts:75-76, 199-214`) em vez de um
   `logger.warn` — porque um warn num contêiner ninguém lê. Copie a forma: o painel
   precisa de um campo que diga *quando* degradou e *por quê*, lido pela tela.

---

## R6 — Vazamento: Sentry, logger, erro devolvido 🟠 MEDIDO

### O que está BEM feito e deve ser preservado

`lib/sentry/scrub.ts` é bom, e o cabeçalho conta por que existe (`:1-12`): a lógica
vivia triplicada e ninguém percebeu que transação, span e breadcrumb têm hooks
próprios — *"o canal sem sanitização era justamente o de 100% de amostragem"*.

Cobertura medida: `beforeSend`, `beforeSendTransaction`, `beforeSendSpan`,
`beforeBreadcrumb` (`scrub.ts:152-187`). Headers sensíveis são apagados **por padrão
e não por lista** (`:46-50`, regex `authorization|cookie|api[-_]?key|token|secret|password|credential`)
— exatamente o desenho certo para um painel de credenciais, porque um header novo
nasce protegido. `sendDefaultPii: false` (`sentry.server.config.ts:18`).

### Os três buracos que este épico abre

**(a) O corpo da requisição não é tocado por hook nenhum.** `scrubEventUrls`
(`scrub.ts:130-145`) limpa `request.url`, `request.query_string`, `request.headers`
e `transaction`. **`request.data` — o corpo — não aparece no arquivo.** Confirmável:
`grep -n "request.data\|\.data\b" lib/sentry/scrub.ts`. Hoje isso é seguro por
acidente feliz: com `sendDefaultPii: false`, o SDK não anexa corpo. Mas é uma
propriedade de **configuração do terceiro**, não uma defesa deste repo, e este épico
é o primeiro em que o corpo de um POST é a credencial inteira. Se alguém ligar
`sendDefaultPii` (ou o SDK mudar o default), a chave do WAHA vai para o Sentry **da
comunidade** — porque o DSN default é o do projeto (`lib/sentry/dsn.ts:16-22`).

**(b) `enableLogs: true` em quatro lugares, sem `beforeSendLog`.** Medido:
`sentry.server.config.ts:17`, `sentry.edge.config.ts:15`,
`instrumentation-client.ts:31`, `workers/agent-worker/main.ts:50`. `sentryScrubHooks`
não tem `beforeSendLog`. **Isto é HIPOTÉTICO hoje** e eu meço o porquê: `grep -rn
"Sentry.logger" --include="*.ts" --include="*.tsx"` devolve **1 linha, e ela é um
comentário** (`next.config.ts:139`, sobre tree-shaking) — **nenhum call site**:
nada escreve nesse canal. Mas é literalmente a
mesma classe de buraco que o cabeçalho do `scrub.ts` descreve ter custado a issue
#100: um canal ligado, sem hook, esperando o primeiro emissor. Se o painel logar
qualquer coisa por ali, sai cru.

**(c) O logger não redige — a proibição é um comentário.** `lib/logger.ts:8`:
*"Never log secrets, raw tokens, message bodies, CPF, or phone numbers."* E
`:13-20`: `JSON.stringify({level, msg, ts, ...ctx})`, com
`LogContext = Record<string, unknown>` (`:11`). **Nenhuma redação.** Um
`logger.error("falha ao validar chave", { chave })` escreve a chave em claro no
stdout do contêiner, onde ela fica em `docker logs` até a rotação do daemon. O
anti-pattern nº 14 do CLAUDE.md proíbe `console.log`, mas `logger.error` é o
caminho **recomendado** — e ele não protege.

**(d) `fail()` devolve `details` verbatim ao browser.** `lib/api/wrappers.ts:65-80`:
`details?: unknown`, serializado direto na resposta. O padrão dominante no repo é
`details: parsed.error.flatten().fieldErrors` (medido em 8 rotas, ex.
`app/api/v1/tasks/route.ts:77`), que carrega **mensagens** e não valores — seguro.
Mas `details` é `unknown` e nada impede `details: parsed.error.issues`, onde alguns
tipos de issue do Zod carregam o campo `received`. Num painel de credenciais, um
`received` é a credencial.

### Mitigação concreta

1. **Uma função de redação no caminho, não uma regra no comentário.** Um
   `redigirSegredos(ctx)` aplicado dentro do `logger` (não por quem chama), casando
   pelo mesmo critério de `isSensitiveHeader` — que já existe e já é "por padrão,
   não por lista" (`scrub.ts:46`). Reuse-o.
2. **`beforeSendLog` somado a `sentryScrubHooks`**, antes de o primeiro emissor
   existir. O arquivo já é o ponto único e diz isso (`scrub.ts:11`).
3. **O painel nunca põe valor de campo em `details`.** A mensagem de erro diz o
   campo, nunca o conteúdo: *"a chave do WAHA foi recusada pelo servidor"*, não
   *"`sk-…` inválida"*.
4. **Um teste de fumaça que vale mais que os três acima:** mande uma credencial
   sintética reconhecível (ex. `CANARIO-NAO-DEVE-VAZAR-a1b2`) pelo painel, force um
   erro, e varra `docker logs`, o payload do Sentry e a resposta HTTP pela string.
   É o único jeito de provar ausência de vazamento em vez de argumentá-la.

---

## R7 — Tabela nova em `public` nasce CONCEDIDA a `anon` 🟠 MEDIDO

### Os caminhos que chegam ao banco hoje

Enumerados, como o briefing pede:

| Caminho | Quem alcança | O que o desenho do painel precisa fazer |
|---|---|---|
| **PostgREST + anon key** | qualquer pessoa com o browser aberto — a anon key **vai para o cliente** | a tabela do painel **não pode ser servida**: RLS ligada, ZERO policies, grants revogados |
| **PostgREST + JWT `authenticated`** | qualquer usuário logado de qualquer tenant | idem — nenhuma policy, nenhum grant |
| **`service_role`** | o servidor. Bypassa RLS por construção | filtro manual + `requirePlatformAdmin()` na rota, sempre |
| **Função `security definer` em `public`** | exposta como RPC ao PostgREST se os grants não forem revogados | de preferência **não criar nenhuma** (foi o que `0201` fez) |
| **`psql` / dump / réplica** | quem tem a connection string | ver R1 — é aqui que a cifra tinha de pagar, e não paga |

### O que faz este risco ser real e não teórico

Duas armadilhas medidas, e **as duas já morderam este repo**:

**(a) Função.** `tests/invariants/hardening-definer-varredura.test.ts:14-32`: o
`ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO anon` do baseline
(`supabase/baseline.sql:4716`) vale para **todo apêndice novo**, e concede grant
**direto**, que `revoke all ... from public` não remove. No dia em que a varredura
foi escrita, **8 das 25** `security definer` de `public` tinham EXECUTE para `anon`
**com os seis gates obrigatórios verdes** — entre elas `fn_publish_ai_agent_version`,
que escreve e recebe o org por argumento sem checar membership.

**(b) Tabela.** O mesmo vale para tabelas, e o repo registra o erro literal
(`supabase/baseline.sql:11605-11609`):

> *"TABELA NOVA NASCE CONCEDIDA, e não só função: o `ALTER DEFAULT PRIVILEGES ...
> GRANT ALL ON TABLES TO anon/authenticated` deste mesmo baseline vale para toda
> tabela criada depois dele. **A primeira versão deste bloco dizia 'nenhuma função
> nova, então não há grant a revogar' — leitura errada da doutrina**, que fala de
> FUNÇÃO."*

Ou seja: alguém que conhecia a doutrina do CLAUDE.md a aplicou e **ainda assim**
criou uma tabela concedida, porque a doutrina fala de função e o default alcança
tabela. O painel cria pelo menos uma tabela nova em `public`.

### Mitigação concreta

1. **Copie `0201:64-67` literalmente** — `enable row level security` + `revoke all
   from anon, authenticated` + `grant` só a `service_role`. Zero policies. O
   raciocínio está em `0201:21-32` e é o melhor do repo: *"uma tabela 'protegida por
   policy' depende de a policy estar certa; uma tabela com RLS ligada, sem policy
   nenhuma e com os grants revogados **não é servida de jeito nenhum**."*
2. **Copie também o TESTE.** `tests/invariants/credencial-do-google-e-server-side.test.ts`
   já é o molde exato, e as asserções dele são as certas: `anon` sem privilégio
   nenhum (`:109`), `authenticated` idem (`:113`), **`service_role` com privilégio
   como controle positivo da sonda** (`:118`), `anon` barrado com *permission denied*
   e não com zero linhas (`:130`), RLS ligada como segundo degrau *"para o dia em
   que o grant voltar"* (`:145`), nenhuma policy (`:153`), e a coluna cifrada que não
   se lê em claro (`:167`). Um teste novo do painel que não tenha o controle positivo
   (`:118`) é uma sonda que pode estar cega.
3. **Se o painel criar qualquer função em `public`**, os DOIS revokes (`from public`
   e `from anon`), e a varredura de `hardening-definer-varredura` já a pega — ela
   varre todas, não uma lista.

---

## R8 — Confundir INSTALAÇÃO com ORGANIZAÇÃO 🟠 HIPOTÉTICO (o desenho ainda não existe)

### Por que isto é a falha mais fácil de cometer

O CLAUDE.md já separa os dois escopos na marca própria (`platform_branding` vs
`organizations.settings.branding`), e `0201:11-19` repete o critério para a
credencial do Google:

> *"O `redirect_uri` sai de `NEXT_PUBLIC_APP_URL`, o `install.sh` grava o par no
> `.env` da VPS, e o app OAuth é registrado no console do Google pelo dono da
> instalação. **É uma VPS por cliente: a credencial pareia 1:1 com a instalação.**"*

O teste do escopo, portanto: **quem paga a conta e quem responde pelo cadastro no
terceiro?** Chave de IA, token do WAHA, Resend, Redis, catálogo de extensões — todos
são da INSTALAÇÃO. A tentação de pendurar em `organizations.settings` é grande
porque `settings` é `jsonb` livre e não exige migration.

`ai_provider_credentials` é o contra-exemplo **legítimo**: ela é de organização
porque a chave é comprada pelo tenant. Ter as duas formas no repo é exatamente o
que torna a confusão provável.

### O caminho de escalada, se a confusão acontecer

Um `admin` de tenant (nível 4 dentro da organização dele) alcançando configuração
da instalação escala para controle da VPS inteira: trocar a origem do catálogo de
extensões, trocar o endereço do WAHA, ler a chave de IA paga pelo dono. Num
self-host de VPS única isso costuma ser inofensivo (uma org só), **mas o produto é
multi-tenant desde o dia 1** e a doutrina diz isso na primeira linha de convenções.

Três formas concretas de a confusão acontecer, todas baratas de cometer:

1. **A rota usa `requireRole("admin")` em vez de `requirePlatformAdmin()`.**
   `requireRole` é o guard dominante do repo — é o que um implementador digita por
   reflexo. Ele verifica papel **dentro do tenant**.
2. **A Server Action não reencontra o gate.** Medido, e já aconteceu:
   `app/actions/settings/updateBranding.ts:45-57` documenta que *"Server Action NÃO
   é rota: não passa por `requireRole` (cujo `mfaEmDivida` tem um call site só, que
   serve apenas `/api/v1`) e não passa pelo layout de `/admin` — e não existe
   `middleware.ts` neste repo para cobrir a diferença. **Um POST direto na action,
   com uma sessão `aal1` de um platform admin, entrava.**"* E a linha seguinte é a
   que mais importa para este épico: *"ao contrário da marca por organização, aqui o
   banco NÃO tem como fechar o buraco — a escrita vai pelo `service_role`, e o
   Postgres não enxerga o AAL de uma sessão do GoTrue."*
3. **O audit carimba `organization_id`** e, pela policy `audit_log_select`
   (baseline:4031), entrega o `metadata` a todo admin daquele tenant — ver R3.

### Mitigação concreta

1. **Tabela separada, nome que declara o escopo** — `platform_*`, como
   `platform_branding` e `platform_google_oauth`. Sem `organization_id`. A ausência
   da coluna é a defesa: não há como filtrar errado uma coluna que não existe.
2. **`requirePlatformAdmin()` dentro de CADA Server Action e CADA rota do painel**,
   não só no layout. O guard no layout protege a tela; o POST direto não passa por
   ela. Este é um erro já pago uma vez neste repo.
3. **`organization_id: null` nas linhas de auditoria de configuração de instalação.**
4. **Um invariante que reprove a coluna** — se alguém acrescentar `organization_id`
   à tabela do painel, o teste falha. Barato e determinístico.

### LGPD

Chave de API não é dado pessoal, então o painel em si não amplia superfície de
titular. **Uma exceção que o desenho precisa tratar:** `updated_by uuid` (que
`0201:52` tem) é dado de usuário, e o cascade de anonimização do CLAUDE.md não
conhece essa tabela. Se o dono da instalação exercer direito de exclusão, um
`updated_by` órfão sobra apontando para um usuário que não existe mais. Resolva como
a doutrina já resolve: **preservar o timestamp, anonimizar o ator**, ou `on delete
set null`. É pequeno, mas é o tipo de coisa que só aparece em auditoria.

---

## R9 — A superfície das extensões 🟡 MEDIDO (a guarda existe e é boa)

**A spec EXISTE neste worktree**: `docs/specs/extensoes-declarativas-v1.md`,
datada de 16/set/2026, com instalação/configuração/recuperação declaradas como
implementadas e provadas em tela.

### O que já está fechado — e é preciso dizer, senão o relatório infla o risco

| Vetor do briefing | Estado | Evidência |
|---|---|---|
| **ZIP bomb** | não se aplica | o formato é **JSON, sem ZIP**, por contrato (spec, "Contrato do documento"). Transporte comprimido é **recusado** |
| **JSON bomb** | fechado | `lib/extensions/strict-json.ts` — teto de bytes (`:156`), profundidade 12, 20.000 nós, 32 props/objeto; pacote 64 KiB, catálogo 512 KiB |
| **Prototype pollution** | fechado, em dois lugares | `strict-json.ts:13` e `manifest.ts:88`, ambos `new Set(["__proto__","prototype","constructor"])`; `manifest.ts:317` ainda recusa objeto com protótipo trocado |
| **XSS por texto de manifesto** | fechado por contrato | *"sem HTML, script, SQL, CSS, expressões ou URLs de assets. **Texto é renderizado como texto**"*; ícone é enum fechado de 3 valores, não URL |
| **SSRF** | guarda dedicada | `lib/extensions/download.ts`: só HTTPS (`:71`), origem exata sem credencial/query (`:27`), endereços especiais recusados (`:88`), **DNS resolvido uma vez e amarrado à conexão** (`pinnedLookup`, `:127`) — fecha rebinding —, sem redirect, teto de bytes no corpo lido (`:150`), prazo total 15 s (`:17`) |
| **Chave duplicada / NUL / Unicode malformado** | recusados antes do banco | contrato da spec; `strict-json.ts` |

Isto é melhor que a média e não deve ser reaberto.

### O helper anti-SSRF de webhook é reaproveitável? Não — e não deveria ser

`lib/automation/outbound-url.ts` é **textual**, e o cabeçalho declara os dois tetos
(`:1-14`): (1) literais IPv6 são bloqueados **por inteiro**, porque uma regex
parcial não pega `[::ffff:127.0.0.1]` nem `[fc00::1]`; (2) **não resolve nome** — quem
julga o IP é `assertDestinoResolvidoSeguro` (`lib/automation/outbound-ip.ts`),
chamado logo depois em `call-webhook.ts`.

Essa dupla tem uma **janela de rebinding** entre a resolução que julga e a resolução
que conecta. `lib/extensions/download.ts` não tem, porque amarra o endereço à
conexão (`pinnedLookup`). **A guarda das extensões é a mais forte das duas** — então
o painel deve usar a das extensões, não a de webhook. Reaproveitar a de webhook aqui
seria regressão.

### O que o épico ACRESCENTA, e é onde mora o risco restante

1. **Admitir origem de catálogo vira ação de tela.** Hoje o gate é
   `lib/extensions/http.ts:80`, com o mesmo `aal2` condicional do R4. Digitar uma
   origem é escolher de quem esta instalação aceita conteúdo — pertence à faixa
   "escrita de segredo" da régua do R4, no mínimo.
2. **Nenhum gate exercita o caminho HTTPS real.** O `docs/threat-model.md` diz
   textualmente, no adendo de T6: *"o caminho HTTPS real (SNI, certificado, lookup
   amarrado) não é exercitado por nenhum gate — os testes usam HTTP local e um dublê
   do lookup."* E o E2E de SSRF de webhook (`tests/e2e/vps-webhook-outbound-ssrf.spec.ts`)
   **não roda no CI**. A lógica está provada; a integração não.
3. **`EXTENSIONS_LOCAL_CATALOG_ORIGIN` é uma exceção HTTP-em-loopback**
   (`lib/env.ts:78-80`), condicionada a a URL do app também ser loopback
   (`download.ts:47-57`). O desenho está certo. O risco é o painel oferecer esse
   campo na tela: um knob que **desliga HTTPS** não pode ser editável pela tela — ele
   é de laboratório e tem de continuar só no `.env`.

### Mitigação concreta

1. Admitir origem de catálogo entra na faixa de escrita da régua do R4.
2. Knobs que **enfraquecem uma guarda** (`EXTENSIONS_LOCAL_CATALOG_ORIGIN` é o caso
   conhecido) ficam **fora do painel**, por lista explícita e testada. Um painel que
   edita "todo knob do `.env`" acaba editando este.
3. Antes de o painel expor a admissão de catálogo, ponha o E2E de SSRF no CI — é o
   único momento em que alguém vai priorizar isso, e o custo é baixo.

---

## O que eu NÃO medi

Declarado para que ninguém leia ausência de achado como ausência de risco:

1. **Nada foi explorado.** Nenhum ataque executado, nenhuma instância viva tocada,
   nenhum teste rodado. Tudo aqui é leitura de código no SHA `b264bd2d6`. Não rodei
   `pnpm test:db`, `test:unit` nem qualquer gate.
2. **Não confirmei se `service_role` alcança `private.app_secrets`.** Medi que o
   baseline faz `revoke all on schema private from public` (`:6006-6007`) e que
   `ALTER DEFAULT PRIVILEGES` só cobre `public` — mas não rodei
   `information_schema.role_table_grants` num banco real para provar. **O R1 não
   depende disso**: o `pg_dump` do `backup.sh` roda pela conexão de schema, e o
   `psql_run` do kit já escreve na tabela — as duas coisas medidas.
3. **Não medi o comportamento real do SDK do Sentry** quanto a anexar `request.data`
   com `sendDefaultPii: false`. Li a config e o scrub; a garantia vem da
   documentação do terceiro, não de medição minha. O item (a) do R6 está marcado
   como propriedade de configuração justamente por isso.
4. **Não medi se o canal de Logs do Sentry (`enableLogs: true`) envia algo hoje.**
   Medi que `Sentry.logger` tem **zero** call sites (a única ocorrência da string é
   um comentário em `next.config.ts:139`) e que não há `beforeSendLog`.
   Isso torna o item (b) do R6 hipotético — e eu o marquei assim.
5. **Não li as 89 rotas que usam `createAdminClient`** (contagem do
   `docs/threat-model.md` T3, não minha). Não sei se alguma já vaza segredo.
6. **Não auditei `lib/extensions/service.ts` inteiro** — 350+ linhas. Medi o
   contrato, o parser, o download e o gate de HTTP. A lógica de instalação/ativação
   não foi lida.
7. **Não avaliei a superfície de tela**: CSP, headers de segurança, autocomplete de
   formulário de senha, se o valor digitado fica no estado do React após o submit, e
   se o campo de credencial é `type="password"`. **É lacuna relevante** — o
   `docs/threat-model.md` T8 registra que *"se `next.config.ts` define CSP"* nunca
   foi verificado, e o item de SVG do mesmo T8 afirma que **este repo não define
   CSP**. Um painel de credenciais sem CSP merece medição própria.
8. **Não medi o tamanho real do audit log** com `metadata` grande, nem o custo do
   expurgo de retenção sobre ele.
9. **Não verifiquei o `install.sh` inteiro** — só `ensure_encryption_key()` e o
   `url_do_schema()`/`psql_run` que ela usa.
10. **Não medi rotação de `AI_CRED_AES_KEY`** além de constatar a ausência de
    `key_version`/`kid` por `grep`. Pode existir um caminho manual documentado em
    algum runbook que eu não li.
