#!/usr/bin/env bash
# Roda os turnos UM POR VEZ (a corrida com todos na mesma sessão derruba o admin
# com 401 — lição registrada no cabeçalho do spec). Re-semeia a credencial antes
# de cada corrida porque o seed rotaciona o factor TOTP.
set -uo pipefail
cd "$(dirname "$0")/../../.."

set -a; . ./.env.local; set +a
export QA_LLM_API_KEY="${OPENAI_API_KEY}"
export QA_LLM_PROVIDER=openai
export QA_LLM_MODEL=gpt-5.6-terra
export E2E_PORT=3031

rodar() { # $1 = QA_PROMPT ("" p/ operador), $2 = prefixo do cenário
  local prompt="$1" cen="$2"
  echo "=================== ${prompt:-operador} :: ${cen} ==================="
  npx tsx scripts/seed-e2e-credentials.ts > /dev/null 2>&1 || { echo "SEED FALHOU"; return 1; }
  QA_PROMPT="$prompt" QA_CENARIO="$cen" \
    npx playwright test tests/e2e/qa-agente-usa-as-maos.spec.ts --reporter=line 2>&1 \
    | grep -E '^\[QA\]|passed|failed|Error|timeout' | head -20
}

for c in 2- 3- 4- 5- 6- 7- 8- 9- 10-; do rodar "" "$c"; done
for c in c1 c2 c3 c4 c5 c6 c7 c8; do rodar "atendimento" "$c"; done

echo "=================== FIM ==================="
ls -1 evidence/ia-360-w4/medicao-vazamento/turnos/ | wc -l
