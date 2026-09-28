# Design — Central de Conexões WhatsApp + Alternador de Canais no Inbox

Data: 2026-07-02 · Autor: terminal QA "Assistente e Testes" (Lina)

## Problema

Quando uma conexão WhatsApp cai, não há área fácil de encontrar para reconectar,
e só é possível gerenciar **um** canal. O Inbox mistura conversas de todos os números.

## Critérios de aceite

1. Usuário tem uma área de fácil acesso para verificar a saúde das conexões,
   reconectar e conectar novos números WhatsApp.
2. O Inbox tem um alternador de canais; ao alternar, a lista mostra **só** as
   conversas do número selecionado — sem misturar.

## Descobertas do codebase (estado atual)

- Schema já suporta multi-número: `channel_sessions` (1 linha = 1 número WAHA),
  `conversations.channel_session_id` e `messages.channel_session_id` são `NOT NULL`.
  **Nenhuma migração é necessária.**
- Filtro por canal no backend do inbox **já existe** ponta a ponta (Zod → route →
  handler `.eq("channel_session_id")` → hook). Falta só a UI.
- `waha_session_name` está hardcoded como `org_<8chars>` — assume 1 número/org.
- Cliente WAHA (`lib/waha/client.ts`) só tem start/getStatus/send — falta stop.
- Fluxo de QR + polling do onboarding (`app/onboarding/connect-whatsapp/_client.tsx`)
  é reaproveitável.
- Sem cron de health; `last_health_check_at` nunca é escrito (coluna morta).

## Solução

### Parte 1 — Central de Conexões (`/app/connections`)
- Rota dedicada na **sidebar** (item "Conexões" com **sinal de saúde** verde/amarelo/vermelho).
- Um card por número: badge de status (`WORKING`→verde, `SCAN_QR_CODE`/`STARTING`→amarelo,
  `FAILED`/`STOPPED`→vermelho), telefone, última verificação.
- Botão **Reconectar** (stop+start no WAHA; se deslogado, reabre QR).
- Botão **+ Conectar novo WhatsApp** → dialog com QR (parear novo número).
- Health ao vivo: ao abrir/atualizar, consulta o WAHA por sessão e grava
  `status` + `last_health_check_at` (preenche a coluna morta).
- Gate: admin (segue o padrão de `settings/tenant/*`).

### Parte 2 — Alternador no Inbox
- `<Select>` de canais no topo da lista (`InboxFilters`): "Todos os números" + um por canal.
- Alternar injeta `channel_session_id` nos filtros → a lista já filtra (backend pronto).
- Envio outbound **não muda** (número é herdado da conversa). Alternador é só de visão.

## Superfície de API (nova, sob `/api/v1/`)

| Método | Rota | Função |
|---|---|---|
| GET | `/channel-sessions` | Lista canais da org (DB). Usada por inbox, sidebar, central. |
| POST | `/channel-sessions` | Cria novo canal (nome único) + inicia no WAHA. |
| GET | `/channel-sessions/[id]` | Status ao vivo do WAHA + grava health no DB. |
| POST | `/channel-sessions/[id]/reconnect` | stop + start no WAHA. |
| GET | `/channel-sessions/[id]/qr` | Proxy do QR por sessão (`<img src>`). |

Cliente WAHA: adicionar `stopSession(name)`. Reconnect = stop + `startSession` (idempotente).
Nome de sessão para novos canais: `org_<8chars>_<rand6>` (único, salvo no DB).

## Fora de escopo (YAGNI)

- Cron de reconciliação de health (health on-demand cobre o critério).
- Seleção de número no envio (herdado da conversa por design).
- Deletar/arquivar canal (só conectar/reconectar por ora).

## Testes

- Typecheck + lint zerados.
- Isolamento RLS (canais de org B não vazam para org A) — endpoint filtra `organization_id`.
- E2E: abrir central, ver saúde; alternar canal no inbox e confirmar que conversas
  não se misturam.
