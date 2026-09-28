#!/usr/bin/env bash
# Prova que o desinstalador limita toda descoberta e remocao ao projeto atual.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
SCRIPT="$ROOT_DIR/desinstalar_docker.sh"
FAILS=0
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

check() {
  local descricao="$1"
  shift
  if "$@"; then
    printf '  ✓ %s\n' "$descricao"
  else
    printf '  ✗ %s\n' "$descricao"
    FAILS=$((FAILS + 1))
  fi
}

echo "desinstalador Docker limitado ao projeto"
check "sintaxe Bash valida" bash -n "$SCRIPT"
check "nao executa docker system prune" bash -c '! grep -q "docker system prune" "$1"' _ "$SCRIPT"
check "nao executa docker builder prune" bash -c '! grep -q "docker builder prune" "$1"' _ "$SCRIPT"
check "nao remove imagens" bash -c '! grep -q "docker image rm" "$1"' _ "$SCRIPT"

mkdir -p "$TMP_DIR/bin"
cat >"$TMP_DIR/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf '%q ' "$@" >>"$DOCKER_LOG"
printf '\n' >>"$DOCKER_LOG"

case "${1:-} ${2:-}" in
  "info ") exit 0 ;;
  "context show") printf 'contexto-teste\n'; exit 0 ;;
  "container ls")
    if [[ " $* " == *" --format "* ]]; then
      printf '%s\n' "$TEST_ROOT"
    elif [[ " ${3:-} " == " -q " ]]; then
      printf 'crm-app-1\n'
    elif [[ " ${3:-} " == " -aq " ]]; then
      printf 'crm-app-1\ncrm-worker-1\n'
    fi
    exit 0
    ;;
  "volume ls") printf 'crm-waha-data\n'; exit 0 ;;
  "network ls") printf 'crm-internal\n'; exit 0 ;;
  "container stop"|"container rm"|"volume rm"|"network rm") exit 0 ;;
esac

printf 'comando inesperado: %s\n' "$*" >&2
exit 99
STUB
chmod +x "$TMP_DIR/bin/docker"

saida="$({
  PATH="$TMP_DIR/bin:$PATH" \
    DOCKER_LOG="$TMP_DIR/docker.log" \
    TEST_ROOT="$ROOT_DIR" \
    bash "$SCRIPT" --force --project-name crm_teste
} 2>&1)"
rc=$?

check "execucao seletiva simulada termina com sucesso" test "$rc" -eq 0
check "informa o projeto selecionado" grep -q "Projeto selecionado: crm_teste" <<<"$saida"
check "todas as descobertas usam o label do projeto" \
  test "$(grep -c 'label=com\.docker\.compose\.project=crm_teste' "$TMP_DIR/docker.log")" -eq 5
check "para apenas o container em execucao encontrado" \
  grep -q '^container stop crm-app-1 ' "$TMP_DIR/docker.log"
check "remove apenas os containers encontrados" \
  grep -q '^container rm -f crm-app-1 crm-worker-1 ' "$TMP_DIR/docker.log"
check "remove apenas o volume encontrado" \
  grep -q '^volume rm -f crm-waha-data ' "$TMP_DIR/docker.log"
check "remove apenas a rede encontrada" \
  grep -q '^network rm crm-internal ' "$TMP_DIR/docker.log"

if [[ "$FAILS" -ne 0 ]]; then
  printf '\n%d teste(s) falharam.\n' "$FAILS"
  exit 1
fi

printf '\nTodos os testes do desinstalador seletivo passaram.\n'
