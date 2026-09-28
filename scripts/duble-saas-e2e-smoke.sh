#!/usr/bin/env bash
# Prova de vida do dublê de SaaS do e2e (issue #179).
#
# Exercita o CONTRATO inteiro do `scripts/duble-saas-e2e.mjs` — Resend e o
# handshake OAuth da Nuvemshop incluído — contra a porta onde ele subiu. Serve
# a dois consumidores, e é por isso que ele existe como script e não como um
# bloco de `curl` solto dentro do YAML:
#
#   1. o job do CI, que o roda ANTES da spec. Se o dublê não responde o
#      contrato, o job falha aqui, com a rota nomeada, em vez de falhar 6
#      minutos depois dentro do Playwright com "elemento não encontrado";
#   2. quem está na VPS sem Docker, onde a spec Playwright não roda: dá para
#      provar o dublê localmente com `bash scripts/duble-saas-e2e-smoke.sh`.
#
# Uso:  bash scripts/duble-saas-e2e-smoke.sh [http://127.0.0.1:3997]
#
# Sem dependência de `jq` (o runner tem, a VPS pode não ter): o que se cobra é
# o status HTTP e a presença de campos, com `grep -q`.
set -u -o pipefail

BASE="${1:-http://127.0.0.1:3997}"
CHAVE_RESEND="${E2E_RESEND_API_KEY:-re_placeholder_nao_e_segredo}"
SEGREDO_NUVEMSHOP="${NUVEMSHOP_CLIENT_SECRET:-e2e-placeholder-nao-e-segredo}"
FALHAS=0

# `-s -o corpo -w status`: o corpo fica no arquivo, o status na variável.
CORPO="$(mktemp)"
trap 'rm -f "$CORPO"' EXIT

# checar <nome> <status-esperado> <substring-no-corpo> -- <curl...>
checar() {
  local nome="$1" esperado="$2" trecho="$3"
  shift 3
  [ "${1:-}" = "--" ] && shift
  local status
  status="$(curl -s -o "$CORPO" -w '%{http_code}' "$@" || echo 000)"
  local corpo
  corpo="$(cat "$CORPO")"
  if [ "$status" != "$esperado" ]; then
    printf 'FALHOU  %-34s status=%s (esperado %s)\n' "$nome" "$status" "$esperado"
    printf '        corpo: %s\n' "${corpo:0:200}"
    FALHAS=$((FALHAS + 1))
    return 1
  fi
  if [ -n "$trecho" ] && ! printf '%s' "$corpo" | grep -q "$trecho"; then
    printf 'FALHOU  %-34s status ok, mas sem "%s" no corpo\n' "$nome" "$trecho"
    printf '        corpo: %s\n' "${corpo:0:200}"
    FALHAS=$((FALHAS + 1))
    return 1
  fi
  printf 'ok      %-34s %s\n' "$nome" "$status"
  return 0
}

echo "── dublê de SaaS do e2e em $BASE ──"

# ── Plano de controle ──
checar "saúde"                     200 '"ok":true'  "$BASE/__duble/saude"
curl -s -X DELETE "$BASE/__duble/recebidos" >/dev/null

# ── Resend ──
# Sem chave o SaaS real devolve 401: dublê permissivo esconderia do teste que o
# produto parou de mandar o `Authorization`.
checar "resend: sem chave → 401"   401 'missing_api_key' \
  -X POST "$BASE/emails" -H 'content-type: application/json' -d '{"to":"qa@deskcomm.test"}'
checar "resend: POST /emails"      200 '"id"' \
  -X POST "$BASE/emails" \
  -H "authorization: Bearer $CHAVE_RESEND" -H 'content-type: application/json' \
  -d '{"from":"qa@deskcomm.test","to":"dono@qa.local","subject":"convite","html":"<p>oi</p>"}'
ID_EMAIL="$(sed -n 's/.*"id":"\([^"]*\)".*/\1/p' "$CORPO")"
checar "resend: GET /emails/:id"   200 '"last_event"' \
  "$BASE/emails/$ID_EMAIL"

# ── Nuvemshop: handshake OAuth ──
# O 302 com `code` e `state` na query é o passo que o teste de instalação
# exercita; sem `-L` de propósito, porque o que se cobra é o redirecionamento.
STATUS_REDIR="$(curl -s -o /dev/null -w '%{http_code}' \
  "$BASE/apps/e2e-app-id/authorize?client_id=e2e-app-id&state=xyz&redirect_uri=https%3A%2F%2Fqa.local%2Fapi%2Fnuvemshop%2Fcallback")"
LOCAL="$(curl -s -D - -o /dev/null \
  "$BASE/apps/e2e-app-id/authorize?client_id=e2e-app-id&state=xyz&redirect_uri=https%3A%2F%2Fqa.local%2Fapi%2Fnuvemshop%2Fcallback" \
  | tr -d '\r' | sed -n 's/^[Ll]ocation: //p')"
if [ "$STATUS_REDIR" = "302" ] && printf '%s' "$LOCAL" | grep -q 'code=' && printf '%s' "$LOCAL" | grep -q 'state=xyz'; then
  printf 'ok      %-34s 302 → %s\n' "nuvemshop: authorize (OAuth)" "$LOCAL"
else
  printf 'FALHOU  %-34s status=%s location=%s\n' "nuvemshop: authorize (OAuth)" "$STATUS_REDIR" "$LOCAL"
  FALHAS=$((FALHAS + 1))
fi
checar "nuvemshop: authorize sem redirect" 400 'redirect_uri' \
  "$BASE/apps/e2e-app-id/authorize?state=sem-redirect"
checar "nuvemshop: token (segredo errado)" 401 'invalid_client' \
  -X POST "$BASE/apps/authorize/token" -H 'content-type: application/json' \
  -d '{"client_id":"e2e-app-id","client_secret":"errado","code":"c"}'
checar "nuvemshop: token (handshake)" 200 '"access_token"' \
  -X POST "$BASE/apps/authorize/token" -H 'content-type: application/json' \
  -d "{\"client_id\":\"e2e-app-id\",\"client_secret\":\"$SEGREDO_NUVEMSHOP\",\"code\":\"codigo-e2e\"}"

# ── Nuvemshop: API autenticada ──
checar "nuvemshop: GET /:store_id/store" 200 '"Loja E2E"' \
  "$BASE/123456/store" -H "authorization: Bearer token-e2e"
checar "nuvemshop: POST /webhooks"  201 '"order/paid"' \
  -X POST "$BASE/123456/webhooks" -H 'content-type: application/json' \
  -d '{"event":"order/paid","url":"https://qa.local/api/nuvemshop/webhook"}'
checar "nuvemshop: GET /webhooks"   200 'order/paid' \
  "$BASE/123456/webhooks"
checar "nuvemshop: DELETE /webhooks" 204 '' \
  -X DELETE "$BASE/123456/webhooks/1001"

# ── Registro ──
# É o que permite ao teste afirmar "o e-mail saiu" e "o webhook foi registrado"
# sem mock em processo.
checar "registro de recebidos"      200 '"total"' "$BASE/__duble/recebidos"
echo "        requisições registradas: $(cat "$CORPO" | sed -n 's/.*"total":\([0-9]*\).*/\1/p')"

# ── Rota desconhecida ──
checar "rota desconhecida → 404"    404 'rota_desconhecida' "$BASE/nao-existe"

if [ "$FALHAS" -ne 0 ]; then
  echo "── $FALHAS de 13 verificações FALHARAM ──"
  exit 1
fi
echo "── 13 de 13 verificações passaram ──"
