# Inbox: quem manda nesta conversa

Base `origin/main` @ 927dfa51 · worktree `/Users/rafaelmelgaco/wt/inbox-comando` · branch `feat/inbox-quem-manda`.

Este arquivo é a **segunda** versão. A primeira foi submetida a cinco críticos que mediram em Postgres
real; a lente de regressão devolveu **PARA** e duas decisões morreram. O que segue já incorpora os
consertos — as decisões mortas estão no fim, com a medição que as matou, para ninguém as ressuscitar.

## As 4 reclamações e a causa medida

| # | Reclamação | Causa-raiz MEDIDA |
|---|---|---|
| 1 | Não se sabe quem está no controle | Ninguém está. `fn_conversation_assign` nunca toca `bot_silenced_until`, e o motor moderno nunca lê `assignee_kind` (`grep -rn "assignee_kind\|assigned_to_user_id" lib/agent-engine/` → rc=1). Um humano dá "Assumir" e a IA continua respondendo; ela só cala 5 min deslizantes quando o atendente **envia** (`extendBotSilence`, `app/api/v1/messages/_handler.ts:248`). |
| 2 | Não se sabe se a IA está ativa, nem liga/desliga | Só existe o botão de LIGAR (`reactivate-bot`). Não há rota nem botão de DESLIGAR. |
| 3 | Não há badge do atendente | O payload devolve `assigned_to_user_id` cru. A tool MCP resolve `assigned_to_user_name` pelo MESMO handler (`lib/mcp/tools/conversations.ts:74`): **a IA sabe o nome de quem atende; a tela não.** `components/kanban/OwnerBadge.tsx` (humano vs. IA por geometria, com teste) nunca saiu de `components/kanban/`. |
| 4 | As atividades não mostram transferências | `claim`/`transfer`/`release` não emitem atividade nenhuma (grep nas três rotas: zero). A ida e a volta IA↔humano **já** emitem (`handoff_triggered`/`handoff_resolved`) e **já** aparecem no painel — só a troca entre humanos é muda. |

## O conceito único: `comandoDaConversa()`

`lib/inbox/comando-da-conversa.ts` — função pura, sem I/O, três consumidores reais (linha da lista,
cabeçalho, painel). Responde as duas perguntas com UMA verdade, lendo só colunas que a linha já carrega:

```
Comando = { quem: "humano", userId, nome } | { quem: "automatico" } | { quem: "aguardando" } | { quem: "encerrada" }
MotivoDoSilencio = "atendente_no_comando" | "contato_travado" | "pausado" | "resposta_humana_recente"
```

Quatro motivos, não seis: `janela_fechada` saiu porque o canal primário (WAHA) **não tem** janela de 24h
(`lib/channels/capabilities.ts:15` `freeformOutsideWindow: true`) e quem já responde por isso na tela é
o `JanelaSelo`, provider-aware; `encerrada` saiu porque `STATUS_LABEL` já a mostra. Motivo que não muda
a ação de ninguém é telemetria, não informação (invariante 5).

## Decisões

**R1 — "Assumir"/"Transferir" calam o automático; "Liberar"/"Fechar" o devolvem.**
`fn_conversation_assign` (`create or replace`, **mesma assinatura de 6 args** — assinatura nova criaria
overload e as 5 chamadas por nome passariam a falhar com *is not unique*, medido) passa a gravar
`bot_silenced_until`. Três braços:
- `p_reason = 'routing'` → **não mexe**. O rodízio distribui, não toma o comando. Sem esta ressalva, uma
  org em `round_robin` (worker de 1 em 1 min sobre um trigger que dispara em TODA conversa nova) teria a
  IA calada na primeira mensagem da vida de cada cliente — medido — e a tela que liga o rodízio não diz
  uma palavra sobre IA.
- destino humano (`claim`/`transfer`) → `'infinity'`.
- destino nulo (`release`) → `null`.
E `close` limpa junto: sem isso o silêncio vaza para o PRÓXIMO episódio, porque a ingestão reusa a MESMA
linha de conversa (`on conflict do update`) e `Fechar` não solta o dono, de propósito.

Usa o gate que o motor **já lê** — nenhuma linha do motor muda. É por isso que não mexemos em
`assignee_kind`: ele nunca é limpo por close/release, então viraria mudez permanente por pessoa.

**R2 — o liga/desliga na tela.** `POST /api/v1/conversations/[id]/pause-ai`: silencia e, se ninguém for
dono, assume para quem clicou — pausar sem dono deixaria a conversa sem ator nenhum, que é morte por
definição (invariante 4). Par simétrico do `reactivate-bot` que já existe. **Um** botão no mesmo slot com
dois rótulos ("Pausar o automático" ⇄ "Devolver ao automático"): dois botões custam 85px numa barra que
já estourou a caixa de 392px em 1280px uma vez. E o "Devolver ao automático" passa a aparecer também em
`closed`/`archived` — hoje uma conversa fechada com o automático parado não tem NENHUMA porta de volta
para quem não é o dono.

**R3 — o nome de quem atende chega à tela.** `assigned_to_user_name` no payload (list + get). O lookup usa
`createAdminClient()` **só para o nome** — o client dos DADOS não muda, senão o service role bypassa
`conversations_select` e desliga o `visibility_mode` inteiro, em silêncio. Sem service role, o campo vem
`null` **declarado** (como `team/assignable` faz), nunca por acidente: `resolveUserNames` com o client da
rota devolve `null` para todos calada (GoTrue responde 403 `not_admin` e o supabase-js não lança).
Decisão registrada: quem enxerga a conversa passa a saber quem a atende — inclusive `viewer`. Alarga de
propósito a matriz spec 13 §4, pela mesma razão da exceção que `team/assignable` já abriu: não dá para
mostrar a conversa a alguém e esconder de quem ela é.
`OwnerBadge` é reusado (geometria, nunca cor) no cabeçalho sempre, e na lista só quando discrimina —
`mostrarAtendente` só nas abas onde pode haver mais de um dono, na mesma regra do badge de canal.
E a **Fila passa a incluir `pending`**: hoje a conversa que o automático escalou não aparece em aba
nenhuma que o `agent` enxerga.

**R4 — a troca de comando entra na linha do tempo que JÁ existe.** Quatro tipos novos em
`ACTIVITY_LABELS` (`Record<ActivityType,string>` exaustivo, o compilador cobra) emitidos por
claim/transfer/release/pause. **Sem tabela nova, sem rota nova, sem segunda linha do tempo**: a ida e a
volta IA↔humano já vivem ali e uma seção "Quem atendeu" ao lado seria dois lugares contando a mesma
história. O motivo que a pessoa escreve ao transferir passa a ir no `reason` da atividade — hoje ele
morre no `metadata` do audit, que só `admin` lê.

**R5 — o furo de RLS que a medição achou de brinde.** `cae_select` é org-flat enquanto
`conversations_select` é visibility-aware: um `agent` em modo `own` lê 0 conversas do colega e **1** linha
de `conversation_assignment_events` da mesma conversa (medido). A policy passa a herdar o escopo, no molde
de `messages_select`, e ganha caso em `gov-5-visibility-scope.test.ts`.

## Léxico
A palavra do estado é **"automático"**, não "IA" — já é contrato em 4 arquivos e está travada por
`tests/unit/handoff-por-orcamento.test.ts`, cujo controle NEGATIVO usa literalmente "Voltar para a IA"
como a sabotagem que deve reprovar. Rótulos novos: "Assumiu a conversa", "Transferiu a conversa",
"Liberou a conversa", "Pausou o automático". Nenhum verbo nu, nenhum termina em preposição.
Todo rótulo novo passado por `t()` ganha entrada em `lib/i18n/dicionario.ts` no mesmo commit.

## Decisões MORTAS (não ressuscitar)
- ~~`or v.assignee_kind='user'` em `isLeadInHandoff`~~ — o gate é por CONTATO e `Fechar` não solta o dono:
  medido em pg17, o fim normal de um atendimento (Assumir→Fechar) deixava a IA muda para sempre naquele
  contato, inclusive em conversa NOVA de outro número.
- ~~`conversation_assignment_events` ganha `from_kind`/`to_kind`/`to_agent_id`/`note` + rota de leitura~~ —
  a premissa era falsa (as duas transições que importam já geram atividade visível); `note` levaria texto
  livre sobre cliente de uma tabela que só `admin` lê para uma que todo membro lê, fora da cascata LGPD e
  sem retenção; e a FK do agente quebrava `DELETE` de agente com 23514 numa tabela append-only.
- ~~`p_note` em `fn_conversation_assign`~~ — `create or replace` não substitui assinatura: vira overload e
  as 5 chamadas por nome falham com *is not unique* (medido).

## DoD específico
Migration versionada + apêndice idempotente no `baseline.sql` + linha no MANIFEST · `pnpm test:db` local ·
E2E pela TELA em banco fresco (DoD 12) · rótulo novo em `dicionario.ts` · `revoke ... from public, anon`
nas duas origens em qualquer função tocada · mapa `escalacao-ciclo-humano.architecture.json` atualizado.
