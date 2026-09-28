# O canal oficial passa a receber — provado nos dois sentidos

2026-07-29/30. Mensagem enviada de um celular real para `+1 555-632-0979`, entregue
pela Meta ao webhook da aplicação por túnel público.

## O que entrou

```
type=text  body="oi"  external_id=wamid.HBgMNTUzMTk4OTY2Mzk4…  status=delivered
last_inbound_at = 2026-07-29 16:20:28+00
```

O `last_inbound_at` é o item que fecha o épico: é dele que
`lib/agent-engine/guardrails/messaging-window.ts` deriva a janela de 24h. Sem inbound,
ele nunca se moveria no canal oficial e o gate da Fase 4 vetaria **para sempre** —
o sistema só saberia falar por template, sem volta.

## O nono dígito, provado com contraprova

O cenário que importa (contato gravado com 13 dígitos, `wa_id` chegando com 12) **não
acontece sozinho** — a primeira medição não o exercitou porque não havia contato
prévio, e eu quase reportei "não duplicou" como se fosse prova. Foi preciso construí-lo:

| | Resultado |
|---|---|
| COM `phoneLookupVariants` | **1 contato**, conversa `156fa752…`, formato gravado preservado |
| SEM (sabotado para buscar só o número cru) | **2 contatos**, conversa `4fc3474a…` — **duplicou** |

Duas conversas para a mesma pessoa. É o defeito acontecendo em dado real, e é o que dá
sentido ao módulo — sem a contraprova, "1 contato" não distingue conserto de sorte.

## Dois defeitos meus encontrados aqui

**1. Falha silenciosa que eu escrevi.** A rota fazia `await ingestMetaInbound(...)` e
**descartava o retorno**. O insert falhava por `channel_session_id` NOT NULL e a
resposta era `{"received": 1}` — "chegou e falhou" indistinguível de "não chegou".
Custou uma hora de diagnóstico no túnel e na Meta, que estavam certos.

Corrigido: a rota devolve `outcomes` no corpo e loga estruturado. O 2xx continua
(senão a Meta re-entrega em backoff por horas), mas o silêncio acabou.

**2. `wa_identity` é coluna GERADA.** Meu primeiro `update` do cenário falhou tentando
escrevê-la; ela deriva de `phone_number`.

## Reproduzir

Túnel efêmero (`cloudflared tunnel --url http://localhost:3007`), subscription via
`POST /{app-id}/subscriptions` apontando para
`/api/v1/webhooks/meta/<webhook_path_token>`, e uma mensagem real. A subscription foi
removida ao fim — callback morto faz a Meta re-tentar e pode sinalizar o app.
