# Prova ao vivo do webhook da Meta — 2026-07-28

Cadeia completa, sem mock em nenhum ponto: **Meta real → HTTPS público → verificação
HMAC SHA-256 → efeito no banco**.

## Montagem

| Peça | Valor |
|---|---|
| App | `1296891732408534` |
| WABA | `2434045433735175` (número de teste `+1 555-632-0979`) |
| Túnel | `cloudflared` quick tunnel → `https://<efêmero>.trycloudflare.com` |
| Callback | `<túnel>/api/v1/webhooks/meta/<webhook_path_token>` |
| Sessão | linha `channel_sessions` com `provider='meta_cloud'` (exercita a união marcada da migration 0087) |

Escolhi túnel em vez de deploy na VPS: mesma prova, zero mudança de infra, e o
endpoint morre sozinho quando a sessão acaba.

## O que foi medido

1. **Handshake local** — `GET` com verify token certo devolve `PROVA123` em texto
   puro; com token errado, **403**.
2. **Handshake pelo túnel** — mesma resposta (`TUNEL456`) pela URL pública.
3. **Registro na Meta** — `POST /{app-id}/subscriptions` → `{"success": true}`.
   Isso significa que **a Meta chamou nosso GET e aceitou o challenge**: ela só
   registra depois de verificar.
4. **Túnel contabilizou 3 requisições** (`cloudflared_tunnel_total_requests`),
   `cloudflared_tunnel_request_errors 0`.
5. **WABA inscrita no app** — `POST /{waba-id}/subscribed_apps` → `{"success": true}`.
6. **Sync contra a API real** — `{"inserted":6,"updated":0,"unchanged":0,"disabled":0}`.
7. **Evento de verdade** — criei o template `deskcomm_prova_webhook_0088` (pt_BR,
   UTILITY, 2 parâmetros no corpo). Nasceu `PENDING`.
8. **A Meta aprovou e o webhook chegou sozinho.** A linha virou:

```
deskcomm_prova_webhook_0088 | APPROVED | 2026-07-28 17:41:21.726+00
```

Nenhuma ação minha entre o passo 7 e o 8 — o `updated_at` é do handler, não de um
comando meu.

## Bug real que só a prova ao vivo revelou

A Meta manda `reason: "NONE"` em template **aprovado**. O handler gravava o literal;
o sync (`template-sync.ts`) normalizava para `null`. **A mesma coluna com duas
convenções**, dependendo de quem escreveu por último — e a tela anunciaria um motivo
de recusa inexistente.

Corrigido movendo `normalizeRejectedReason` para o módulo puro
(`lib/channels/meta/webhook.ts`) e fazendo os dois escritores usarem a mesma regra.
Travado por teste + sabotagem verificada.

Nenhum teste de unidade pegaria isso: os dois lados estavam certos isoladamente.

## Reproduzir

O túnel é efêmero — a URL de então já morreu. Para repetir:
`cloudflared tunnel --url http://localhost:3007`, registrar a subscription com o
app access token (`<app_id>|<app_secret>`), e criar um template pela Graph API.
