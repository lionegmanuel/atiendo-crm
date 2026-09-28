# Cenário 23 — o ciclo inteiro, numa gravação

> Medido em 25/07 com `tests/capture-cenario-23-ciclo.ts`.
> Gravação: `video-c23/cenario-23-ciclo-5ecb8f.webm`.

O contrato promete uma volta completa: o negócio esfria, o sistema propõe retomar
**com prazo**, o humano aceita, o agente envia, a atividade fica registrada, o
estado volta ao normal e o card anda. O valor está em serem **sete elos**, não em
cada um funcionar sozinho — cada um já tinha sido provado separado; ninguém tinha
percorrido a volta.

Por isso uma gravação e não só asserções: sete verdes em sete execuções separadas
provam sete pedaços, não a continuidade. O vídeo é a única forma de ver a mesma
tela atravessando os estados sem corte.

## Veredito: 2 bloqueados · 0 vermelhos · 5 verdes

O placar começa pelo que o invalida.

| elo | resultado |
|---|---|
| E1 · esfria | verde — a passada do produto registrou o esfriamento |
| E2 · propõe com prazo | verde — "Retomar contato? · 24h", oferta e prazo na mesma faixa |
| E3 · humano aceita | verde — o clique virou `accepted` no servidor |
| E4 · agente envia | **bloqueado** |
| E5 · atividade registrada | verde — gravada e visível no dossiê |
| E6 · estado volta ao normal | **bloqueado, pela mesma causa do E4** |
| E7 · card anda | verde — a faixa de decisão saiu do card |

## Os dois bloqueios são um só

**Não há worker consumindo `cron_jobs` neste ambiente** — havia inclusive quatro
`followup_turn` vencidos na fila, de aceites anteriores que ninguém consumiu. Não
subi um: consumir fila alheia é proibido e roubaria trabalho de outra sessão.

Do E4 dá para provar o **compromisso** — a linha de envio existe, com
`source=reactivation`. Compromisso não é envio, e chamar isso de verde seria dar
por entregue o único elo que fala com o cliente.

E o E6 cai junto, por um mecanismo que vale registrar: o estado só volta quando o
negócio recebe **movimento**, e a lista positiva do gatilho de última atividade
**não inclui** `reactivation_accepted` — inclui `ai_turn`, que é o turno do
agente. Aceitar é *autorizar*; quem quebra o silêncio é o *envio*. Sem worker não
há envio, sem envio não há `ai_turn`, e o negócio fica em "crítico" com a última
atividade parada 45 dias atrás.

Eu quase reprovei esse elo. O número estava certo e a leitura, errada: teria
acusado o produto de não fechar um ciclo que ninguém deixou rodar até o fim.

## Duas leituras declaradas, para serem corrigidas se estiverem erradas

1. **"o card anda"** eu li como *o card deixa de pedir decisão e volta ao normal*.
   Nada no caminho do aceite muda o estágio, então exigir movimento de coluna
   reprovaria o produto por uma promessa que ele não faz.
2. **O ciclo não é verificável fim-a-fim aqui.** Com worker, a expectativa é que
   o envio emita `ai_turn`, o relógio do negócio ande e a passada seguinte
   devolva `em_dia`. Isso é o que o mecanismo *prevê*, não o que eu medi.
