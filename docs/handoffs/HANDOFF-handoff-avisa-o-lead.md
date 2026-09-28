# HANDOFF — o handoff avisa o lead antes de silenciar

> ⚠️ **INSTRUÇÃO PERMANENTE:** ler no INÍCIO de toda sessão que trabalhe nesta
> feature e ATUALIZAR + COMMITAR a cada avanço. Progresso só conta com PROVA
> VISÍVEL (output de teste real, log de produção, screenshot). Commitar este
> arquivo junto — mudança só no working tree se perde.

## O defeito (relatado pelo dono do produto, com 2 screenshots)

O agente faz o handoff CORRETAMENTE, mas não manda mensagem nenhuma avisando o
lead. A pessoa fala e ninguém responde.

## Causa raiz — MEDIDA no banco de produção, e são DUAS

```
$ psql "$SUPABASE_DB_URL" -c "select c.status, c.bot_silenced_until, c.last_handoff_reason, ct.force_human
                                from conversations c join contacts ct on ct.id=c.contact_id
                               where c.contact_id in ('d9e198c1…','4435a78d…')"
status  | bot_silenced_until | last_handoff_reason | force_human
open    | infinity           | requested_human     | t            <- screenshot 2 (Lucas)
pending | infinity           | low_sentiment       | f            <- screenshot 1 (Dennis)
```

| Screenshot | Motor | Gatilho | Arquivo |
|---|---|---|---|
| 2 — "preciso de falar com atendente" | `performHumanHandoff` (`pg`) | regex determinístico | `lib/agent-engine/agent/inbound-turn.ts` — `return` com "bot silencia: sem modelo, sem envio" |
| 1 — não conseguia acessar o curso | `triggerHandoff` (`supabase-js`) | worker de SENTIMENTO | `workers/ai-handoff-from-sentiment.handler.ts` → `lib/ai/handoff/orchestrator.ts` |

Log da VPS (`evidence/handoff-avisa-antes/producao-2026-08-26.txt`) — o pior caso
é o Dennis: às 14:50:32 o agente PERGUNTOU o e-mail dele; às 14:51:01 o
sentimento disparou o handoff; às 14:51:27 o e-mail chegou e o turno foi pulado.
Ele respondeu uma pergunta da própria IA para o vazio.

**São dois motores, em dois mundos de banco.** Um conserto só no `inbound-turn`
conserta o screenshot 2 e deixa o 1 exatamente como está.

## A ordem é obrigatória, não estética

`performHumanHandoff` grava `contacts.force_human = true`, e o gate 1 da cadeia
de envio (`stopGate`, `before-send.ts`) relê `(is_blocked or force_human)` direto
da fonte a cada tentativa. **Avisar depois é avisar ninguém.** Medido: invertendo
a ordem, o turno registra `gate: stop → veto → contato_bloqueado`
(`evidence/handoff-avisa-antes/sabotagem-ordem-invertida.txt`).

## O que foi feito

| Arquivo | O quê |
|---|---|
| `lib/escalacao/aviso-ao-lead.ts` (novo) | O TEXTO — puro, um só para os dois mundos. Varia por motivo e por disponibilidade real da equipe; 3 variantes por lead (hash) |
| `lib/agent-engine/agent/aviso-de-escalacao.ts` (novo) | Envio do lado do MOTOR, atrás de `runBeforeSend` (cadeia completa), `seq: 0` |
| `lib/ai/handoff/aviso-ao-lead.ts` (novo) | Envio do lado do CRM, por `sendMessageHandler` (não há `pg.Pool` nem job ali) |
| `lib/agent-engine/agent/inbound-turn.ts` | Avisa nos 3 desvios: pedido explícito, opt-out ambíguo, teto de gasto. Canal hoistado para antes deles |
| `lib/ai/handoff/orchestrator.ts` | `Step 0` avisa antes do UPDATE; `Step 6` abre item na Central (não abria) |
| `lib/agent-engine/agent/human-handoff.ts` | `avisoAoLead` vira LINHA no item da Central; retorno da tool deixa de mandar calar |
| `lib/agent-engine/guardrails/before-send.ts` | `spinningEnforced` — desarme explícito do gate de spinning só para o aviso |
| `app/api/v1/ai/cases/[id]/reply/route.ts` | Escalação de caso avisa antes |

### Por que o gate de spinning é desarmado (a conta que reprovou a v1)

`decideSpinning` veta candidata idêntica/quase (Jaccard ≥ 0,8) a 2+ das últimas
20 mensagens DAQUELE NÚMERO — janela que cruza leads. Medido com a função real:
com 3 variantes, **14 de 20** avisos seguidos eram vetados. Variante não é
garantia; o desarme é. Congelado em `tests/unit/aviso-ao-lead.test.ts`.

## Provas observadas

- `pnpm test:db tests/invariants/handoff-avisa-o-lead.test.ts` → **8/8**, turno
  REAL contra Postgres do `baseline.sql`. Log em
  `evidence/handoff-avisa-antes/ordem-no-turno-real.txt`: 10 gates → `spinning:
  skipped` → "lead avisado" → **só então** "handoff humano aplicado".
- Sabotagem (inverter a ordem) → **4 de 8 vermelhos**, incluindo
  `expected [] to have a length of 1` — o defeito original reproduzido.
- `tests/unit/aviso-ao-lead.test.ts` 14/14; sabotado (colapsar variantes) → vermelho.
- `tests/unit/handoff-avisa-o-lead.test.ts` 11/11 (varredura AST dos 2 motores);
  3 sabotagens distintas → 3 vermelhos.
- `tests/unit/handoff-por-orcamento.test.ts` 24/24 (3 casos novos).
- `pnpm typecheck` 0, `pnpm lint:channels` ok.

## O corte de release — o trabalho NÃO termina no merge

Instrução do Rafael (2026-08-26): *"toda nova atualização deve respeitar a
doutrina de packaging e releases, senão os usuários não conseguem atualizar na
VPS deles."* Merge na `main` não chega a instalação nenhuma — o self-hoster puxa
IMAGEM PUBLICADA por número de versão.

**Esta entrega é MINOR: v1.5.0 → v1.6.0** (muda comportamento visível ao cliente).

Checklist em `docs/doctrine/packaging.md` (12 itens). Já verificado ANTES do merge:

| Item | Estado |
|---|---|
| 1 — seção no CHANGELOG | ✅ três entradas na voz de quem opera |
| 2 — nenhuma variável nova obrigatória | ✅ `git diff ... -- .env.example` vazio |
| 3 — o número nunca foi publicado | ✅ tag local vazia; `ghcr_status deskcommcrm 1.6.0` → 404, com controle positivo (1.5.0 → 200) e negativo (9.9.9 → 404) |
| 4 — pins upstream revisitados | ✅ **decidido: ficam** (waha 2026.7.2, redis:7-alpine, caddy:2-alpine, srh por digest). Bump de infra não entra em release corretiva |
| 5 — tag `v1.6.0` empurrada | ✅ de `bf386c19` |
| 6 — run de publicação verde | ✅ |
| 7 — as três imagens existem e são PÚBLICAS | ✅ 200/200/200, com controle negativo (9.9.9 → 404) |
| 8 — a imagem reporta a versão | ✅ label `1.6.0` |
| 9 — release no GitHub | ✅ notas extraídas de `git show v1.6.0:CHANGELOG.md`, não do disco |
| 10 — `stable` == `1.6.0` no digest, nas três | ✅ BATE nas três (a sonda quebrou no zsh e o guarda "SONDA VAZIA" pegou) |
| 11 — tags de branch órfãs | ⬜ exige `gh auth refresh -s delete:packages` |
| 12 — `update.sh` numa instalação real | ✅ **feito na VPS do dono** — ver abaixo |

O item 12 (ensaio de `update.sh` numa instalação real) é o único que exige VPS e
**é ele que responde a pergunta do Rafael** — se o cliente consegue atualizar.

## A prova na VPS (v1.6.0, imagem `bf386c19`)

`update.sh` de 1.5.0 → 1.6.0 **sem o operador editar arquivo nenhum** (invariante 6).
Verificado pelo artefato: os três contêineres com label `1.6.0` + revision
`bf386c19`; `/api/v1/health` responde 1.6.0 com supabase/redis/waha ok; domínio
responde 307. O código chegou: `grep` do símbolo novo acha na imagem 1.6.0 e dá
**zero** na 1.5.0.

Turno real pelo caminho de produção, com número sintético — o caso exato do
screenshot 2:

```
21:46:15  cliente → Preciso de falar com atendente
21:46:34  IA      → Claro! Já estou chamando alguém da equipe para falar com você.
                    No momento ninguém está disponível, mas seu pedido ficou registrado.
```

A segunda frase é o estado REAL da equipe às 21h46. Log, na ordem:
`spinning=skipped/not_applicable` → `lead avisado` (21:46:36) → `handoff aplicado`
(21:46:38). Central: *"O cliente JÁ FOI avisado de que uma pessoa vai assumir."*

Evidência em `evidence/handoff-avisa-antes/vps-v1.6.0-turno-real.txt`. Contato de
teste removido da produção depois da prova.

## O que NÃO foi provado ainda

- **Entrega no aparelho.** O número da prova é sintético: a mensagem sai com
  `status='sent'` e não chega a um WhatsApp real. Confirmar mandando "preciso
  falar com atendente" de um celular para **55 11 4863-3324**.
- **E2E de tela:** não escrito.
- **Assimetria conhecida:** o aviso do lado do CRM nasce marcado
  (`metadata.aviso_de_escalacao`); o do MOTOR não — lá a identidade é o `seq 0` no
  `send_ledger`. Funciona, mas a mesma mensagem se declara num caminho e não no
  outro. Candidato à próxima versão.
