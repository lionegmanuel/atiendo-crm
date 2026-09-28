# O adapter oficial fala com a Meta — Fase 3b

Saída literal em [adapter-meta-real.txt](evidence/canais/fase4/adapter-meta-real.txt):

```
isConfigured: true
destinatario resolvido: 5531998966398
ENVIADO: {"externalId":"wamid.HBgMNTUzMTk4OTY2Mzk4FQIAERgSNkQwQjNDNjVCMkVGODhBMzFCAA=="}
```

Caminho completo pelo seam: `getAdapter("meta_cloud")` → `resolveRecipient` (E.164 em
dígitos, sem `+`) → `send` → Graph API → `wamid`.

## O que este envio provou sem querer

Texto **livre** foi aceito. A Cloud API recusa texto livre fora da janela de 24 horas
com `131047` (re-engagement). Se passou, **a janela está aberta** — e ela só abre
quando o contato escreve.

Ou seja: o dono do repo respondeu a um dos templates enviados nas tasks anteriores, a
janela abriu, e o texto livre passou a ser permitido. É exatamente o que
`isWindowOpen(now, last_inbound_at)` calcula (`lib/agent-engine/guardrails/messaging-window.ts`).

A regra implementada como função pura foi observada acontecendo na plataforma real —
prova melhor do que qualquer mock, e ninguém a projetou assim.

## As três armadilhas que o adapter resolve (medidas, não deduzidas)

1. **Não existe "sessão".** O `phone_number_id` entra na URL, não no corpo. No corpo,
   a Meta devolve 400 sem explicar. Há teste assertando que o corpo **não** tem
   `session`.
2. **Destinatário é E.164 em dígitos.** Nada de `@c.us`; um `+` sobrevivente vira
   `(#131009) Parameter value is not valid`.
3. **Áudio só vira nota de voz com `voice: true`.** Sem a flag, um `.ogg/opus` chega
   como anexo de música. E a Meta **não converte** — o canal não-oficial converte por
   nós, este não.

## Sabotagens (12 casos)

| Sabotagem | Vermelho |
|---|---|
| áudio sem `voice: true` | o caso da nota de voz |
| não normalizar o telefone | o caso do E.164 |
| deixar grupo passar | o caso de grupo |
| lançar em vez de noop sem credencial | o caso do noop |

Cada uma restaurada, 12 verdes de volta.
