# Histórico de leads captados + abordagem escrita pela IA + a automação para de mentir

Entrega de 2026-08-24. Três coisas, e a terceira nasceu de um relato de uso
real: uma automação ligada, um lead entrando pelo formulário, e nenhuma
mensagem chegando ao cliente.

## O relato, reproduzido antes de qualquer conserto

Cenário montado exatamente como a tela o monta (gatilho "contato novo pelo
webhook" → ação "Enviar mensagem no WhatsApp"), disparado por um POST real na
URL da fonte e drenado pela mesma rota de cron que o scheduler bate:

```
run.status          = success      ← ✓ verde na aba Atividade
mensagem.status     = failed
mensagem.error_code = waha_error
```

A causa: `sendMessageHandler` **não lança** quando o envio falha — ele marca a
linha da mensagem (`failed`, ou deixa em `queued`) e a devolve normalmente,
porque quem o chama pela tela é o Inbox, que renderiza a bolha com o estado
dela. A ação da automação só verificava se houve exceção.

Depois do conserto, no mesmo instrumento:

```
run.status          = failed
texto na tela       = "Não conseguimos falar com o serviço de WhatsApp.
                       Confira se ele está no ar."
Central de avisos   = 1 item crítico, nomeando a automação
```

Dois silêncios vizinhos vieram junto:

1. **A janela paralela.** A automação avaliava 7h–22h com
   `new Date().getHours()` — a hora do RELÓGIO DO SERVIDOR. Num contêiner em
   UTC isso é 4h–19h de Brasília, e uma automação disparada às 19h30 do horário
   comercial ficava represada até as 4h da manhã. Pior: quem abriu Conexões e
   mudou a janela do número viu a mudança valer para o agente e não valer para
   a automação. Agora a janela vem de `channel_knobs`, pela MESMA regra pura
   (`janelaDeEnvioAberta`) que o agente usa.
2. **O adiamento invisível.** Quando uma ação pedia adiamento, o motor devolvia
   `retry` e saía sem gravar linha nenhuma — a aba Atividade ficava vazia. Para
   quem montou a regra, "não apareceu nada" e "não rodou" eram a mesma tela.
   Migration 0175 acrescenta o estado `adiado`.

## Evidência pela tela

Produzida por `scripts/evidencia-webhooks.ts` contra o rig fresco (Supabase
local aplicado do `baseline.sql` + `bootstrap`/seed, `next build` + `next
start`), com o app dirigido por Playwright:

| Imagem | O que prova |
|---|---|
| `evidence/webhooks-historico-e-ia/01-leads-recebidos.png` | A aba nova com a tabela: quem, contato, fonte, quando, origem, resultado — e uma linha **"Não entrou"** ao lado das que viraram lead |
| `evidence/webhooks-historico-e-ia/02-detalhe-da-captacao.png` | O painel: campos do formulário, data e hora por extenso, página de origem, **endereço IP** e navegador, com o link para o lead |
| `evidence/webhooks-historico-e-ia/03-atividade-diz-falhou.png` | O conserto do relato: badge **Falhou** e a frase "Não conseguimos falar com o serviço de WhatsApp. Confira se ele está no ar." — onde antes havia ✓ Sucesso |
| `evidence/webhooks-historico-e-ia/04-acao-mensagem-pela-ia.png` | A ação nova no ENTÃO: agente publicado, número, e o campo "O que a IA deve fazer com os dados" preenchido |
| `evidence/webhooks-historico-e-ia/05-mobile-390.png` | 390px: filtros empilhados e a tabela rolando DENTRO do próprio container — o corpo da página não rola na horizontal (medido: `scrollWidth` 390 = `clientWidth` 390) |

Medidas por ferramenta, não a olho (`getBoundingClientRect` via Playwright): a
`TabsList` com quatro abas mede **431,94px** em 1440px de viewport — o skeleton
do primeiro paint foi corrigido de 306px (a medida de três abas) para 432px.

## Living System Checklist — histórico de leads captados

- **Quem me alimenta?** `POST /api/v1/webhooks/in/[token]` — em TODOS os
  desfechos, inclusive nos que recusam (`registrarCaptacao`, chamada em 5
  pontos da rota).
- **Quem eu alimento?** Duas peças reais: a aba "Leads recebidos"
  (`GET /api/v1/lead-captures`) e a ação `send_ai_message`, que lê os campos do
  formulário por `dadosDoFormularioDoContexto` para dar entrada ao agente.
- **Que log eu emito?** A própria linha em `webhook_lead_captures` é o registro
  durável; o `api_audit_log` continua recebendo `webhook.lead_received` e
  `webhook.inbound_invalid_signature`; falha ao gravar vai para o logger
  estruturado com a causa nomeada (nunca em silêncio).
- **Onde apareço na tela?** Aba "Leads recebidos" em `/app/webhooks`, com
  tabela e painel de detalhe.
- **Por qual porta se chega?** `/app/webhooks` já está em
  `lib/navigation/registry.ts` (grupo Canais). A aba é interna à tela.
- **Mecanismo anti-morte?** A captação recusada é o próprio anti-morte: antes,
  um formulário mal mapeado devolvia 400 ao site e sumia. Agora ela aparece com
  o motivo em português e os campos crus.
- **Onde se configura?** A fonte, na aba "Receber dados" (nome, funil, etapa,
  segredo, field_map). O que aparece se faltar: o estado vazio explica.
- **Continuidade IA↔humano?** O histórico é a ENTRADA da IA na abordagem
  pós-formulário. Na volta, o texto gerado fica no `detail.texto_gerado` do run
  — é o que permite ajustar a instrução vendo o que ela produziu.
- **Laço de retorno?** Envio que falha vira `failed` no run **e** aviso crítico
  na Central (`agent_inbox_items`, kind `message_send_stuck`, o mesmo do cron
  `recover-stuck-messages` — é o mesmo fato de negócio).
- **Mapa vivo?** `docs/architecture/ia-360-organizar.architecture.json`: 5
  peças novas, 7 arestas.

## Decisões que valem a pena reler antes de mexer

**Por que uma tabela nova, e não `webhook_events_log`.** Aquele é arquivo
FORENSE e é descartável por desenho: o cron `webhook-log-retention` zera
`raw_body`/`payload_parsed`/`headers` em D+7 e apaga a linha em D+90 (migration
0163). Foi a decisão certa — numa instalação real ele era 468 MB de um banco de
545 MB —, mas um histórico de negócio construído sobre ele MENTE a partir do
sétimo dia: os campos viram `null` e nada na UI distingue "o formulário veio
vazio" de "o corpo foi descartado ontem". Arquivo de depuração e memória de
negócio têm ciclos de vida opostos.

**Por que a RLS exige `manager`.** `fields` é o formulário como a pessoa
preencheu. A policy de `webhook_events_log` é org-flat sem gate de papel, então
hoje qualquer `viewer` lê aquela PII direto pelo PostgREST com a anon key —
mesmo com a rota HTTP exigindo `manager`. A rota não é a única porta.

**Por que a LGPD entra por trigger.** `fn_lgpd_cascade_redact_contact` tem 180
linhas; um 9º passo exigiria reescrevê-la inteira no apêndice do baseline,
criando duas cópias que divergem no primeiro conserto. O gancho é a transição
`is_anonymized false → true` em `contacts`, que roda na mesma transação e
alcança qualquer caminho que anonimize um contato.

**Por que o agente não recebe só um JSON.** Um modelo que recebe
`{"segmento":"clínica"}` sem mais nada escreve SOBRE o JSON, não com ele.
Faltam duas coisas, e o prompt declara as duas: a SITUAÇÃO (abordagem fria,
primeira mensagem, ninguém disse nada — o oposto do turno normal do agente, que
sempre responde a alguém) e a INTENÇÃO do dono do negócio, que é o campo "O que
a IA deve fazer com esses dados". É o mesmo desenho do `prompt_hint` de um
passo de follow-up, que já provou funcionar.

**Por que a ação de IA não tem `send_message` no toolset.** Quem envia é a
automação, com janela, opt-out e throttle. Dar a ferramenta ao modelo faria
dele o remetente, e as guardas ficariam dependendo de ele obedecer.

## A poda, que era dívida e foi paga

O cabeçalho da migration 0174 já DESCREVIA a poda quando ela ainda não existia
— uma afirmação de estado falsa dentro do próprio artefato, que é o defeito que
o DoD 16 combate. Ela agora existe:
`lib/webhooks/retencao-da-captacao.ts`, chamada no MESMO tique do cron
`webhook-log-retention`.

Três decisões que valem reler:

  * **Um horizonte só, sem "esvaziar mantendo a linha".** No arquivo forense o
    corpo é 97% do peso e ninguém o lê depois de uma semana, então esvaziar e
    manter a linha faz sentido. Aqui a linha É o produto: ou o registro serve
    inteiro, ou não serve.
  * **A política vem do módulo canônico**, `lib/retencao/politica.ts` — o mesmo
    que a poda da fila e o expurgo da auditoria usam. A primeira versão desta
    poda tinha um `Math.max(dias, 30)` próprio, o que é duplicação sem fonte
    declarada: duas cópias do piso divergem no primeiro ajuste. E o módulo
    canônico devolve algo que a versão caseira jogava fora — o AVISO. Sem ele, o
    operador que escreveu `LEAD_CAPTURE_RETENTION_DAYS=1` veria o número ser
    elevado em silêncio e descobriria pela ausência de efeito: falha fechada na
    ação e fechada também na informação, que é o pior dos dois mundos.
  * **O módulo estava mais certo que eu, e o teste registra isso.** Escrevi o
    caso do `0` esperando que caísse no piso de 30; `interpretarRetencao` trata
    `<= 0` como LIXO e resolve para o PADRÃO (365). Está certo: cair no piso
    encurtaria a retenção de um ano para um mês por causa de um zero digitado.
    O caso do valor NEGATIVO entrou junto — sem a guarda, `-30` daria um limite
    30 dias no FUTURO e o `lt(received_at, …)` apagaria o histórico inteiro,
    inclusive o de hoje.
  * **Mesmo cron, e não um novo.** Uma rota a mais seria mais uma linha no
    `entrypoint.sh` do scheduler para alguém esquecer de agendar — o defeito que
    já custou meses ao `risk-watcher` e ao `routing-worker`.

Guardado por `tests/unit/retencao-do-historico-de-captacao.test.ts` (10 casos).
Sabotado: removendo o `Math.max` do piso, 2 casos reprovam.

## O que a revisão adversarial achou (e o que eu tinha errado)

Antes de abrir o PR, seis lentes independentes leram o diff e cada achado passou
por um cético que tentou derrubá-lo. Saíram **11 achados únicos, 2 refutados, 9
consertados** — todos meus. Os três que valem ser lidos por quem herdar isto:

**1. O defeito consertado ressuscitou um andar acima.** `desfechoDoEnvio` passou
a devolver `postponed` honestamente, e o AGREGADOR do motor continuava fazendo
`failed === 0 ? "success"` — então uma ação adiada virava "Sucesso" verde na
tela, para uma mensagem em `queued` que não chegou ao cliente. É exatamente o
defeito que esta entrega veio matar, e eu o deixei vivo porque consertei por
instância em vez de por classe. Guardado agora por `tests/unit/automacao-nao-diz-
sucesso-para-envio-morto.test.ts` (20 casos, o último comparando a regra do teste
com o fonte do motor); sabotado devolvendo o ternário antigo, reprova.

**2. A instrução do operador e o formulário público moravam na mesma mensagem.**
Separados só por cabeçalho markdown (`## O que fazer com esses dados`) — que
qualquer campo forja, e mais perto do fim, que é a posição de mais peso. A
instrução subiu para o `system` (onde conteúdo público nunca chega) e os dados
desceram para o `user` dentro de `<dados id="{nonce}">`, com um id aleatório por
chamada. Não é imunidade — nenhuma mitigação de injeção é —, é a diferença entre
"duas linhas no campo" e "adivinhar um uuid".

**3. A linha inteira de `contacts` ia para o provedor de LLM.** `buildContext`
hidrata com `select("*")`, e eu iterava o objeto: `cpf_hash`, `cpf_encrypted`,
`organization_id`, `created_at` e as flags internas saíam da instalação sob o
rótulo "o que a pessoa preencheu" — com o modelo instruído a "personalizar de
verdade" a partir disso. Virou allowlist que itera os campos PERMITIDOS, não os
presentes: coluna nova em `contacts` amanhã não vaza sozinha.

Mais: IP malformado derrubava o INSERT inteiro (`:::::` passava na minha regex e
o Postgres recusa); a captação `duplicado` gravava PII sem `contact_id`, fora do
alcance do gatilho de anonimização; a tela mostrava o código cru da falha da IA
porque `explicacao` era anulada justamente em `failed`; e erro de consulta se
apresentava como "Ninguém preencheu seus formulários ainda".

**Duas coisas que só apareceram porque medi, em vez de raciocinar:**

- `net.isIP`, que peguei como "a ferramenta exata", aceita `fe80::1%eth0` — e o
  Postgres recusa. Meu comentário afirmava o contrário. As duas saídas estão
  agora lado a lado em `lib/http/ip-do-cliente.ts`, e o guarda recusa `%` e `/`.
- O **disclosure foi refutado**, e eu estava prestes a implementá-lo:
  `insertDisclosureTemplateVersion` e `setDisclosureTemplatePointer` têm ZERO
  chamadores no repo, então `loadDisclosureTemplate` devolve `null` em toda
  organização e o gate é no-op em todo envio existente. Mesmo armado, esta ação
  não escreve em `send_ledger`, então o disclosure continuaria chegando na
  primeira mensagem do agente. Era código para uma proteção que ninguém tem.

## Um controle que não controla, achado no caminho (NÃO consertado)

`checkDailyLimit` (`lib/automation/throttle.ts`) — o cap diário anti-ban da
automação — lê `channel_session_warmup`. Essa tabela **não tem escritor nenhum
no produto**:

```bash
grep -rn "channel_session_warmup" --include='*.ts' app/ lib/ workers/ scripts/
#  → só o LEITOR (lib/automation/throttle.ts) e a declaração em database.types
grep -rn "pacing_ledger" --include='*.ts' lib/ workers/ | grep insert
#  → lib/agent-engine/pacing/store.ts:132  (o contador que o pacing REAL usa)
```

Logo `sent` é sempre `0` e o cap diário da automação **nunca dispara**. O único
`insert` na tabela em todo o repositório está dentro de
`tests/invariants/automation-send-whatsapp.test.ts` — ou seja, o caso que
"prova" o cap semeia à mão a tabela que ninguém escreve.

Há um segundo defeito no mesmo lugar: `checkDailyLimit` calcula "hoje" com
`new Date().toISOString().slice(0,10)` — o dia em **UTC** — e devolve a próxima
tentativa com `setHours` no fuso do **processo**. É exatamente o defeito de fuso
que a janela de envio acabou de deixar de ter, sobrevivendo no irmão ao lado.

**Por que não consertei:** ligar a automação ao `pacing_ledger` muda o
comportamento anti-ban real (o cap passaria a valer de fato, onde hoje não
vale), e isso é frente própria — não algo para entrar junto de uma entrega de
histórico e abordagem por IA, às vésperas do merge. O que fiz foi não deixar o
achado invisível: está escrito aqui e no comentário do caso 4 do invariante, com
os comandos que o reproduzem.

## O que NÃO foi feito (dívida declarada)

- **O agente da abordagem não lê a base de conhecimento (RAG).** `draft-reply`
  também não lê; a via limpa usa `runModelCall` sem tools. Se a mensagem
  precisar citar material do negócio, isso é frente própria.
- **A LGPD alcança a captação pelo `contact_id`, e só por ele.** A revisão
  sugeriu uma rede a mais — o gatilho alcançar também pela volta do lead
  (`lead_id in (select id from crm_leads where contact_id = …)`), para não
  depender de todo call site lembrar do vínculo. Não implementei, e a razão é
  que procurei um cenário ALCANÇÁVEL hoje sem o vínculo e não achei: depois do
  conserto da rota, os caminhos com PII passam `contactId`; o formulário que
  coleta só nome e e-mail cria lead sem contato, mas aí não há contato para
  anonimizar — a LGPD é indexada por contato, e a pessoa não tem registro. O que
  a rede cobriria é um call site FUTURO esquecendo. Fica declarado em vez de
  codificado; quem discordar tem o raciocínio inteiro aqui para decidir
  diferente.
- **Nenhuma spec exercita a IA gerando texto de verdade.** O rig não tem chave
  de modelo (`.env.e2e` sem `ANTHROPIC_API_KEY`), então a spec prova a
  CONFIGURAÇÃO pela tela e o caminho de erro; o texto gerado por um modelo real
  não foi medido em CI.
