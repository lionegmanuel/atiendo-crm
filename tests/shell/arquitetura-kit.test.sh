#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMMON="$ROOT/hostgator-setup-kit/_common.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"

# `uname` é o único sinal que a guarda lê. Os outros três são sentinelas: se o
# `_common.sh` chamar docker, curl ou git antes de a guarda recusar, fica rastro
# e o teste reprova mesmo que a mensagem final pareça correta.
#
# O alcance é o `_common.sh`, não o install.sh/update.sh reais. Os chamadores
# abaixo são wrappers mínimos que só carregam o `_common.sh` com o NOME do
# script, que é o que a guarda confere. O install.sh real já chama docker e git
# (conferência de dependências e, se preciso, o clone) antes de carregar o
# `_common.sh`, e isso fica fora desta prova; o que ela mede é que a recusa vem
# antes de qualquer trabalho feito pelo próprio `_common.sh`.
#
# ⚠️ ESTE ARQUIVO MEDE A INSTALAÇÃO **NOVA** (#1042) — e nova é o diretório de
# trabalho do teste: rodado de `$TMP`, que não tem compose nem `.env`, é
# exatamente o estado em que o install.sh chega ao `source _common.sh` logo após
# clonar (ele escreve o `.env` só depois). A instalação que JÁ EXISTE, em que a
# recusa vira aviso para o script alcançar a recuperação por build local
# (#1060/#1143), tem prova própria e de ponta a ponta em
# `tests/shell/guarda-arm-nao-mata-a-recuperacao.test.sh` (#1266).
cat > "$TMP/bin/uname" <<'SH'
#!/usr/bin/env bash
if [ "${1:-}" = "-m" ]; then
  printf '%s\n' "${FAKE_ARCH:-x86_64}"
  exit 0
fi
printf '%s\n' "${FAKE_ARCH:-x86_64}"
SH

for cmd in docker curl git; do
  cat > "$TMP/bin/$cmd" <<SH
#!/usr/bin/env bash
touch "$TMP/tocou-$cmd"
printf 'sentinela $cmd não deveria ter sido chamado\n' >&2
exit 99
SH
  chmod +x "$TMP/bin/$cmd"
done
chmod +x "$TMP/bin/uname"

fail=0

rodar_como() {
  local nome="$1" arch="$2" wrapper="$TMP/$nome" out rc
  cat > "$wrapper" <<SH
#!/usr/bin/env bash
. "$COMMON"
printf 'DEPOIS_DA_GUARDA\n'
SH
  chmod +x "$wrapper"

  # O `cd "$TMP"` é o que mantém esta prova medindo a INSTALAÇÃO NOVA. A guarda
  # do #1266 decide por o que existe no disco (compose + `.env`), e o
  # diretório de onde o `pnpm test:shell` roda é o clone — que tem o
  # `docker-compose.prod.yml`. Sem este `cd`, o teste passaria a medir a
  # instalação existente de quem tem o clone na mão, viraria vermelho com a
  # mudança do #1266 e, pior, o conserto poderia voltar a ser "verde" por rodar
  # no diretório errado. `$TMP` não tem nenhum dos dois.
  if out="$(cd "$TMP" && env FAKE_ARCH="$arch" PATH="$TMP/bin:$PATH" bash "$wrapper" 2>&1)"; then rc=0; else rc=$?; fi
  printf '%s\n' "$rc" > "$TMP/rc-$nome-$arch"
  printf '%s' "$out" > "$TMP/out-$nome-$arch"
}

for nome in install.sh update.sh; do
  rodar_como "$nome" aarch64
  rc="$(cat "$TMP/rc-$nome-aarch64")"
  out="$(cat "$TMP/out-$nome-aarch64")"

  if [ "$rc" -eq 0 ]; then
    printf '✗ %s aceitou aarch64\n' "$nome"; fail=1
  elif ! printf '%s' "$out" | grep -q 'aarch64'; then
    printf '✗ %s recusou sem dizer a arquitetura encontrada\n' "$nome"; fail=1
  elif ! printf '%s' "$out" | grep -q 'linux/amd64'; then
    printf '✗ %s recusou sem dizer qual imagem existe hoje\n' "$nome"; fail=1
  elif ! printf '%s' "$out" | grep -q 'x86_64/amd64'; then
    printf '✗ %s recusou sem orientar a arquitetura de VPS suportada\n' "$nome"; fail=1
  elif printf '%s' "$out" | grep -q 'DEPOIS_DA_GUARDA'; then
    printf '✗ %s continuou depois da recusa\n' "$nome"; fail=1
  else
    printf '✓ %s recusa ARM64 com a causa correta\n' "$nome"
  fi
done

for cmd in docker curl git; do
  if [ -e "$TMP/tocou-$cmd" ]; then
    printf '✗ a guarda tocou em %s antes de recusar ARM64\n' "$cmd"; fail=1
  else
    printf '✓ _common.sh recusa ARM64 antes de tocar em %s\n' "$cmd"
  fi
done

# Contrapeso: a guarda não pode transformar o requisito amd64 numa recusa geral.
rodar_como update.sh x86_64
rc="$(cat "$TMP/rc-update.sh-x86_64")"
out="$(cat "$TMP/out-update.sh-x86_64")"
if [ "$rc" -ne 0 ] || ! printf '%s' "$out" | grep -q 'DEPOIS_DA_GUARDA'; then
  printf '✗ x86_64 deveria atravessar a guarda\n'; fail=1
else
  printf '✓ x86_64 atravessa a guarda\n'
fi

exit "$fail"
