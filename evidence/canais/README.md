# evidence/canais/ — as provas do seam de canais (WhatsApp API Oficial)

Índice dos artefatos da branch `feat/canais-oficial`. Plano:
`docs/superpowers/plans/2026-07-27-canais-seam-fases-0-2.md` · Registro:
`HANDOFF-canais-oficial.md`.

**Esta pasta é versionada de propósito.** A Task 0 gravou tudo em
`.superpowers/evidence/`, que o `.gitignore` ignora (linhas 84 e 92) — a prova existia
no disco de uma máquina só, e nenhum clone a recebia. `evidence/` na raiz é a convenção
versionada do repo (é onde as waves do CRM Vivo gravam), e o guarda
`tests/unit/evidencia-citada.test.ts` só sabe cobrar citação de arquivo que o `git`
entrega. Prova fora do `git` é afirmação, não lastro.

---

## `baseline/` — a foto do "antes" (Task 0, SHA `4536ab1`)

A referência contra a qual **toda** task posterior se compara. Nada aqui é regenerável
com fidelidade: os screenshots dependem de dados, build e servidor vivos naquele
momento. Tratar como **evidência histórica** (ver `evidence/README.md`) — sobrescrever
destrói a única cópia.

### Screenshots — a jornada WAHA vivida pela tela

| Arquivo | O que prova |
|---|---|
| `evidence/canais/baseline/01-login.png` | login com conta real (`.e2e-creds.json`), MFA TOTP incluso |
| `evidence/canais/baseline/02-qr.png` | tela de conectar WhatsApp com o QR do WAHA renderizado |
| `evidence/canais/baseline/03-inbox.png` | inbox carregado com conversa real |
| `evidence/canais/baseline/04-texto-enviado.png` | mensagem de texto enviada **pelo inbox** (não por API) |
| `evidence/canais/baseline/05-audio-enviado.png` | áudio enviado pelo inbox — o caminho multimodal antes do seam |
| `evidence/canais/baseline/06-followup.png` | follow-up agendado pela tela |
| `evidence/canais/baseline/07-radar.png` | Radar de Risco carregado com a demanda esfriada |

Re-gerar (aponta para OUTRA pasta — nunca para `baseline/`):

```bash
CANAIS_EVIDENCE_DIR=evidence/canais/task4 \
  pnpm exec playwright test --config tests/journeys/playwright.config.ts
```

Pré-requisitos: Supabase local com `supabase/baseline.sql` aplicado, WAHA na 3030,
`next build` + `next start` no ar, `.e2e-creds.json` semeado. Receita completa na seção
"Receita do ambiente" do `HANDOFF-canais-oficial.md`.

### `gates.csv` — a cadeia `before_send` de um turno REAL de IA

8 gates + header, todos `pass`, na ordem `stop → lgpd → pacing → spinning → promise →
semantic_promise → case_promise → disclosure`. **Esta sequência não pode mudar** nas
Fases 0–2 — é a prova mais dura do plano.

Sai de `before_send_traces.trace` (array `jsonb`), que só é escrito em turno de agente
(exige `job_id` de `job_queue`) — envio manual pelo inbox não grava nada. Provocar um
turno: `npx tsx scripts/provoke-agent-turn.ts`. Re-gerar o CSV:

```bash
psql "$DATABASE_URL" -c "\copy (select e->>'gate' as gate, e->>'verdict' as verdict, coalesce(e->>'code','') as code from before_send_traces t, jsonb_array_elements(t.trace) e order by t.created_at, (e->>'gate')) to 'evidence/canais/<task>/gates.csv' csv header"
```

### `unit.txt` — a suíte unitária

`pnpm run test:unit` → **1038 passaram / 136 arquivos · exit 0**. É verde, e essa é a
régua: qualquer vermelho a partir daqui é regressão das Tasks 1–7, sem constante conhecida
para descontar.

A gravação da Task 0 tinha 1035✓/1✗ — o vermelho era o próprio plano citando prova por
nome puro (Ressalva 1 do handoff). Consertada a citação, este arquivo foi regravado: uma
régua que embute um defeito já corrigido mede errado.

### `e2e.txt` / `e2e-paralelo.txt` — a suíte e2e, duas réguas diferentes

- `e2e.txt` — execução **em série** (`--workers=1`). É a régua de regressão: sem
  concorrência sobre fixtures compartilhadas, uma falha aqui é candidata a defeito real.
- `e2e-paralelo.txt` — a execução original com **5 workers**, mantida só para a
  comparação série × paralelo. Teste que só falha aqui é candidato a flake de
  concorrência, não a defeito.

Comparar as duas listas é o que separa flake de defeito. Nenhuma das duas é verde — a
classificação está no `HANDOFF-canais-oficial.md`, Ressalva 3.

```bash
set -o pipefail
E2E_PORT=3007 pnpm exec playwright test --workers=1 2>&1 | tee evidence/canais/baseline/e2e.txt
echo "exit=$?" >> evidence/canais/baseline/e2e.txt
```

`$?` só vale com `pipefail` ligado (senão é o exit do `tee`). E **não** troque por
`${PIPESTATUS[0]}`: é variável do bash, e no zsh expande para vazio — o registro sai
`exit=` e ninguém percebe.

`E2E_PORT` é obrigatório se a 3001 estiver ocupada por outro worktree: o config usa
`reuseExistingServer: false` de propósito (reusar servidor alheio testa o build errado) e
aborta a suíte inteira em vez de rodar contra o processo de outra sessão.

---

## `task1/` — a jornada re-vivida depois do `banRisk` (Task 1)

Mesmas 7 paradas, mesmo instrumento, build novo servido na 3007. Existe para uma pergunta
só: **a cadeia mudou?** Resposta medida — `diff evidence/canais/baseline/gates.csv
evidence/canais/task1/gates.csv` sai **vazio** (exit 0).

| Arquivo | O que prova, agora com `banRisk` no motor |
|---|---|
| `evidence/canais/task1/01-login.png` | login + MFA continuam entrando na conta real |
| `evidence/canais/task1/02-qr.png` | conectar WhatsApp segue renderizando o QR do WAHA |
| `evidence/canais/task1/03-inbox.png` | inbox carrega as conversas do tenant |
| `evidence/canais/task1/04-texto-enviado.png` | texto enviado pelo inbox — o caminho de envio não regrediu |
| `evidence/canais/task1/05-audio-enviado.png` | áudio enviado pelo inbox — multimodal intacto |
| `evidence/canais/task1/06-followup.png` | follow-up agendado pela tela |
| `evidence/canais/task1/07-radar.png` | Radar de Risco carregado (**byte-a-byte igual** ao da baseline) |

Os screenshots **não** são byte-a-byte iguais aos da baseline e não deveriam ser: a jornada
roda sobre o mesmo banco e acrescenta dados (a conversa tem o texto e o áudio da execução
anterior, e o botão "Lembrar" virou "Lembrete ativo" porque o follow-up da baseline
continua vivo). Só `evidence/canais/task1/07-radar.png` saiu idêntico em bytes. O que se
compara aqui é layout e estado da interface, não hash.

**A query do `gates.csv` ganhou escopo** — `before_send_traces` é cumulativo, e a versão
sem filtro somaria os turnos de todas as tasks num diff só:

```bash
psql "$DATABASE_URL" -c "\copy (select e->>'gate' as gate, e->>'verdict' as verdict, coalesce(e->>'code','') as code from before_send_traces t, jsonb_array_elements(t.trace) e where t.created_at = (select max(created_at) from before_send_traces) order by t.created_at, (e->>'gate')) to 'evidence/canais/<task>/gates.csv' csv header"
```

Um turno contra um turno — que é o escopo em que a baseline foi gravada.

---

## `task4/` — a jornada com o handler falando com o `ChannelAdapter` (Task 4e)

As Tasks 4b/4c/4d trocaram as chamadas diretas ao WAHA em `app/api/v1/messages/_handler.ts`
por `adapter.*`. Até aqui nada disso tinha saído do `vitest`. Esta pasta é a prova pela
tela, servida por um build **feito depois** dos três commits do refactor (`BUILD_ID`
`4W3v83yHSysyCUIj3YQLD`, gerado 15:20; o último commit do refactor é de 15:12 — o
processo que estava na 3007 servia um build de 13:16, anterior a tudo, e foi derrubado).

| Arquivo | O que prova, agora com o handler atrás do seam |
|---|---|
| `evidence/canais/task4/01-login.png` | login + MFA entram na conta real |
| `evidence/canais/task4/02-qr.png` | Conexões segue mostrando o estado real da sessão WAHA |
| `evidence/canais/task4/03-inbox.png` | inbox carrega as conversas do tenant |
| `evidence/canais/task4/04-texto-enviado.png` | texto enviado pelo inbox — mesmo desfecho da baseline (`Falhou`, contato do seed sem telefone) |
| `evidence/canais/task4/05-audio-enviado.png` | áudio enviado pelo inbox — o ramo de mídia do `adapter.send` |
| `evidence/canais/task4/06-followup.png` | follow-up agendado pela tela |
| `evidence/canais/task4/07-radar.png` | Radar de Risco carregado |
| `evidence/canais/task4/08-envio-real.png` | **o que faltava:** envio manual pelo inbox que atravessa `adapter.send` inteiro e chega ao WAHA — bolha com ✓, não `Falhou` |
| `evidence/canais/task4/gates.csv` | a cadeia `before_send` de um turno REAL de IA, **idêntica** à da baseline (`diff` vazio, exit 0) |

### Por que o `08` existe — o `gates.csv` não cobre o que a 4d refatorou

O `gates.csv` prova a cadeia do turno de IA. O caminho **manual** do inbox (o que a Task 4d
mexeu) nunca chegou a `adapter.send` neste banco: o contato do seed do radar não tem
telefone, então `resolveRecipient` devolve `null` e a mensagem morre em
`missing_phone_number` — foi assim na baseline, na task1 e na task4. Nenhuma mensagem
jamais saiu com `status='sent'` aqui.

Para exercitar o ramo de verdade, a Task 4e apontou **temporariamente** a sessão do seed
para a sessão WAHA que está `WORKING` e deu ao contato o número da própria conta do WAHA
(envio para si mesmo — real, sem terceiro no meio), enviou **pela tela**, mediu, e
**reverteu os dois campos** aos valores originais. Medido em `messages`:

```
status = sent · external_id = 3EB0644366757BD8B9CA71 · error_code = null
```

`external_id` não-nulo é o ID que o WhatsApp devolveu: a mensagem saiu de verdade, pelo
`adapter.send`, com o `parseWahaMessageId` do outro lado do seam.

### O Postgres local segfaultou no meio (e isso não é regressão do refactor) — task4

A primeira e a segunda execuções da jornada saíram sujas — toast `No active organization` e
`/app/radar` redirecionando para `/app`. Ambos os sintomas são o mesmo defeito:
`loadAuthUser` (`lib/auth/server.ts`) **descarta o erro** do `select` em
`user_organizations`, então uma falha de query vira "usuário sem organização".

A falha de query foi medida na fonte: `docker logs supabase_db_deskcomm-crm` mostra
`server process ... was terminated by signal 11: Segmentation fault` às 18:22:51 e
18:28:41 UTC — exatamente as duas janelas —, o PostgREST respondendo `503 PGRST002` e o
GoTrue `FATAL: the database system is in recovery mode`. O mesmo container já tinha
segfaultado 2× às 15:28/15:29, **antes** da execução da baseline. É defeito do stack local
(pgvector/pg17 + walsender do Realtime), pré-existente, e o diff de produção das Tasks
4b/4c/4d toca 3 arquivos — `app/api/v1/messages/_handler.ts`, `lib/channels/types.ts` e
`lib/channels/adapters/waha.ts` — nenhum deles no caminho de auth ou do radar. A terceira
execução, com o banco de pé, passou 3/3 e é a que está gravada aqui.

---

## `task5/` — a jornada com o pacing consultando a capability do canal (Task 5)

A Task 5 ligou a capability (Task 2) no motor de pacing (Task 1): o gate pergunta
`capabilitiesOf(ctx.provider).banRisk` e, quando o canal não tem risco de ban, o veredito
carrega `skipped: 'not_applicable'` até o `before_send_traces`. **Em produção nada disso
acontece ainda** — o ctx fixa `provider: 'waha'` (a coluna nasce na Task 6), `banRisk`
continua `true` e o gate avalia como sempre. Esta pasta é a prova disso: o CSV tem que
sair idêntico à baseline, e sai.

| Arquivo | O que prova |
|---|---|
| `evidence/canais/task5/01-login.png` | login + MFA na conta real, com o build de HEAD |
| `evidence/canais/task5/02-qr.png` | Conexões mostrando o estado real da sessão WAHA |
| `evidence/canais/task5/03-inbox.png` | inbox carrega as 3 conversas do tenant |
| `evidence/canais/task5/04-texto-enviado.png` | texto enviado pelo inbox |
| `evidence/canais/task5/05-audio-enviado.png` | áudio enviado pelo inbox |
| `evidence/canais/task5/06-followup.png` | follow-up agendado pela tela |
| `evidence/canais/task5/07-radar.png` | Radar de Risco carregado |
| `evidence/canais/task5/gates.csv` | a cadeia de um turno REAL de IA, **idêntica** à baseline (`diff` vazio, exit 0) — `pacing,pass`, sem `skipped`, porque o canal é WAHA |

Build servido: `BUILD_ID etodPjlZdqc6OfLt3T50q` (feito **depois** do merge da `main`, que o
build anterior — `4W3v83yHSysyCUIj3YQLD` — não continha). Worker reiniciado antes do turno:
o gate alterado roda no worker (`inbound-turn`/`followup-turn`), não no Next, e o processo
que estava de pé carregava `before-send.ts` do disco anterior à mudança.

**O que este CSV NÃO prova (declarado):** o ramo `banRisk: false`. Nenhuma sessão é
`meta_cloud` — não há como ser, o provider é literal. Quem prova esse ramo, incluindo a
chegada do `skipped` na linha do banco, é `tests/unit/gate-pacing-capability.test.ts`.

---

## `task6/` — a jornada com o `provider` vindo do BANCO (Task 6)

A Task 6 tirou os dois últimos literais `'waha'` do caminho de produção: o handler de
envio resolve o adapter por `channel_sessions.provider` (`app/api/v1/messages/_handler.ts`)
e o ctx do `before_send` lê a mesma coluna (`lib/agent-engine/guardrails/before-send.ts`).
Como toda sessão existente nasce `provider='waha'` pelo `default` da migration 0087, **nada
pode mudar** — e é isso que esta pasta mede.

| Arquivo | O que prova |
|---|---|
| `evidence/canais/task6/01-login.png` | login + MFA na conta real, com o build de HEAD |
| `evidence/canais/task6/02-qr.png` | Conexões mostrando o estado real da sessão WAHA |
| `evidence/canais/task6/03-inbox.png` | inbox carrega as conversas do tenant |
| `evidence/canais/task6/04-texto-enviado.png` | texto enviado pelo inbox — agora com o adapter resolvido pela coluna |
| `evidence/canais/task6/05-audio-enviado.png` | áudio enviado pelo inbox — ramo de mídia do `adapter.send` |
| `evidence/canais/task6/06-followup.png` | follow-up agendado pela tela |
| `evidence/canais/task6/07-radar.png` | Radar de Risco carregado |
| `evidence/canais/task6/gates.csv` | a cadeia de um turno REAL de IA, **idêntica** à baseline (`diff` vazio, exit 0) |

Build servido: `BUILD_ID 2M1TD9Dp7TONA5qDJ-_Ps`, feito depois da migration e das duas
trocas de literal. Worker reiniciado no `HEALTH_PORT=8797` antes do turno — `before-send.ts`
roda no worker, e o processo de pé carregava o arquivo anterior à mudança.

### Três medições intermediárias descartadas, e por quê (declarado, não escondido)

O primeiro turno saiu `stop,veto,contato_bloqueado`; o segundo foi **pulado** ("lead em
handoff humano"); o terceiro saiu `pacing,veto,outside_window`. Nenhum dos três é
comparável com a baseline, e nenhum tem a ver com o diff desta task:

1. **`force_human`** — o `provoke-agent-turn.ts` manda **o mesmo texto** toda vez, e este
   era o 7º envio idêntico: o agente concluiu, com razão, que o padrão inviabiliza
   atendimento por bot e aplicou handoff humano *dentro do próprio turno* (worker log
   01:08:03), três segundos antes de a cadeia rodar. Deriva de dado causada por medir
   repetidas vezes com o mesmo estímulo — não por código.
2. **`bot_silenced_until`** — resquício do handoff acima, que faz `isLeadInHandoff`
   abortar o turno **antes** do `before_send` (nem trace nasce).
3. **`outside_window`** — eram 22h10 BRT, e a janela de cortesia padrão termina às 22h. É
   diferença de RELÓGIO, não de código: a baseline foi gravada de dia.

Comparar a baseline com qualquer um deles seria teste confundido — duas variáveis mudando
(o diff **e** o estado/hora) com uma resposta só. As três variáveis foram controladas antes
da medição válida: `force_human` e `bot_silenced_until` voltaram a `false`/`null` (o valor
que tinham quando a baseline foi gravada), e uma linha **temporária** em `channel_knobs`
(`window_end_hour = 23`, `number_activated_at = now() - 60 dias`, para não cair no cap de
warm-up) reproduziu a condição "dentro da janela". **A linha foi apagada em seguida** —
`channel_knobs` voltou a zero linhas, que é como estava. O que ficou no banco é o estado
anterior às medições.

---

## `fase2/` — a prova de FECHAMENTO das Fases 0–2 (Task 7)

Mesma jornada, mesmo instrumento, contra o `BUILD_ID TQnQ6CYeKMo7ioGwH2uBC` (28/07 08:46),
feito **depois** das trocas desta task. Worker reiniciado no `HEALTH_PORT=8797` antes do
turno: `before-send.ts` e `lib/ai/runtime/agent.ts` rodam lá.

| Arquivo | O que prova |
|---|---|
| `evidence/canais/fase2/01-login.png` | login + MFA na conta real, com o build de HEAD |
| `evidence/canais/fase2/02-qr.png` | Conexões mostrando o estado real da sessão |
| `evidence/canais/fase2/03-inbox.png` | inbox carrega as conversas do tenant |
| `evidence/canais/fase2/04-texto-enviado.png` | texto enviado pelo inbox |
| `evidence/canais/fase2/05-audio-enviado.png` | áudio enviado pelo inbox — ramo de mídia |
| `evidence/canais/fase2/06-followup.png` | follow-up agendado pela tela |
| `evidence/canais/fase2/07-radar.png` | Radar de Risco carregado |
| `evidence/canais/fase2/08-envio-real.png` | envio manual que **chegou ao canal** (`status='sent'`, `external_id='3EB0C84FF2954F12B3D118'`) — a prova de que `resolveSessionRef` entrega o identificador certo ao fio, e não só compila |
| `evidence/canais/fase2/gates.csv` | a cadeia de um turno REAL de IA, **idêntica** à baseline (`diff` vazio, exit 0) |
| `evidence/canais/fase2/unit.txt` | suíte unitária: 1080✓/1✗ (o ✗ é herdado da `main`) |
| `evidence/canais/fase2/typecheck.txt` | `tsc --noEmit` exit 0 |
| `evidence/canais/fase2/lint.txt` | eslint exit 0 — 156 warnings, 0 erros (igual à baseline) |
| `evidence/canais/fase2/lint-channels.txt` | o lint novo verde: 53 arquivos de dívida conhecida, nenhum novo |
| `evidence/canais/fase2/test-db.txt` | `pnpm test:db` exit 0 — install ✓, update ✓, 373✓/1 skipped |

### Estado temporário do envio real — aplicado e revertido (declarado)

O ramo de envio não é alcançável com o seed: os contatos do seed não têm telefone, e a
sessão está `STOPPED`. Para exercitá-lo, a sessão do radar foi apontada **temporariamente**
para a sessão real que está `WORKING` no container, e o contato recebeu o número da própria
conta do canal (envio para si mesmo). Medido, e os dois campos **revertidos** aos valores
originais (`e2e-radar-session` / `STOPPED` / telefone nulo), conferidos depois da reversão.

### O que essa medição NÃO provou

O **áudio** do envio real falhou com `waha_error` / `waha_500: ECONNREFUSED 127.0.0.1:54321`:
o container não alcança a URL assinada do Storage do host. É limitação do ambiente local (o
mesmo ramo de mídia já estava provado em unidade e na jornada), não regressão — e o erro
prova que o ramo de mídia chegou até o canal com a sessão certa, senão teria falhado antes.

## `fase3a/` — contrato de templates da Meta

| Artefato | O que prova |
|---|---|
| `evidence/canais/fase3a/prova-erros-meta.md` | os 3 experimentos que separam 132000 (contagem) de 132012 (formato), medidos contra a Graph API real |
| `evidence/canais/fase3a/envio-real-buildcomponents.txt` | o `components[]` que `buildComponents` monta é **aceito** pela Meta (`wamid`, `accepted`), e o mesmo payload com 1 parâmetro removido à mão volta **132000** |

Re-gerar o segundo: `pnpm exec tsx --env-file=.env.local scripts/spike-send-template.ts`.
São **dois** envios reais no celular de uma pessoa — não rode em laço.
