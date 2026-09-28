#!/usr/bin/env bash
# preflight.sh — o ambiente está mentindo hoje?
#
#   bash triagem/instrumentos/preflight.sh [raiz-do-repo]
#
# Três vezes num dia o ambiente devolveu número falso. Este script checa e REPORTA
# (não conserta nada):
#   1. node_modules por symlink — serve ao vitest e MENTE no tsc;
#   2. dependência declarada no package.json e ausente do node_modules;
#   3. docker vivo, sondado com a operação que se vai usar (`docker ps`), com teto;
#   4. `timeout` ausente (macOS) — e quais scripts do repo dependem dele;
#   5. o checkout principal não é a main.
#
# Cada linha é OK, AVISO ou NÃO MEDIDO. NÃO MEDIDO nunca é "está fora".
# Saída: 0 = tudo OK · 1 = há AVISO (o ambiente mente em algo) · 2 = só NÃO MEDIDO.
#
# bash, não zsh: nada aqui itera `$VAR` por espaço — listas vão para arquivo e
# são lidas com `while read -r`, com `wc -l` impresso como controle.
set -uo pipefail

RAIZ="${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
DOCKER_S="${PREFLIGHT_DOCKER_S:-20}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

avisos=0; nao_medidos=0
ok()   { printf 'OK          %s\n' "$1"; }
aviso(){ printf 'AVISO       %s\n' "$1"; avisos=$((avisos+1)); }
nm()   { printf 'NÃO MEDIDO  %s\n' "$1"; nao_medidos=$((nao_medidos+1)); }
det()  { printf '            %s\n' "$1"; }

# ── 1. node_modules por symlink ──────────────────────────────────────────────
if [ -L "$RAIZ/node_modules" ]; then
  aviso "node_modules é SYMLINK ($(readlink "$RAIZ/node_modules"))"
  det "o vitest resolve por ele; o tsc NÃO — typecheck local aqui não é autoridade, o do CI é"
elif [ -d "$RAIZ/node_modules" ]; then
  ok "node_modules é diretório real"
else
  nm "não há node_modules em $RAIZ"
fi

# ── 2. dependência declarada e ausente ───────────────────────────────────────
if [ -f "$RAIZ/package.json" ] && [ -e "$RAIZ/node_modules" ]; then
  python3 - "$RAIZ/package.json" > "$TMP/deps" <<'PY'
import json, sys
p = json.load(open(sys.argv[1]))
for secao in ("dependencies", "devDependencies"):
    for nome in sorted(p.get(secao) or {}):
        print(nome)
PY
  total=$(wc -l < "$TMP/deps" | tr -d ' ')
  : > "$TMP/ausentes"; presentes=0
  while read -r dep; do
    if [ -e "$RAIZ/node_modules/$dep/package.json" ]; then
      presentes=$((presentes+1))
    else
      printf '%s\n' "$dep" >> "$TMP/ausentes"
    fi
  done < "$TMP/deps"
  n_aus=$(wc -l < "$TMP/ausentes" | tr -d ' ')
  # Controle positivo: se NENHUMA declarada está presente, o instrumento está cego
  # (caminho errado, node_modules vazio) — isso não é "faltam todas".
  if [ "$total" -eq 0 ] || [ "$presentes" -eq 0 ]; then
    nm "dependências: $total declaradas, $presentes presentes — a sonda não enxerga o node_modules"
  elif [ "$n_aus" -gt 0 ]; then
    aviso "$n_aus de $total dependências declaradas AUSENTES do node_modules (controle: $presentes presentes)"
    while read -r dep; do det "- $dep"; done < "$TMP/ausentes"
    det "envenenam a suíte de toda sessão que usa este node_modules, com falha que parece do PR"
  else
    ok "as $total dependências declaradas estão no node_modules"
  fi
else
  nm "sem package.json ou sem node_modules em $RAIZ"
fi

# ── 3. docker vivo, pela operação que se vai usar ────────────────────────────
# `docker info` respondeu na hora num dia em que `docker ps` levou 2219s. E o teto
# é do próprio bash: `timeout` não existe no macOS.
if ! command -v docker >/dev/null 2>&1; then
  nm "docker não está no PATH"
else
  docker ps > "$TMP/docker.out" 2>&1 &
  pid=$!
  passou=0
  while kill -0 "$pid" 2>/dev/null && [ "$passou" -lt "$DOCKER_S" ]; do
    sleep 1; passou=$((passou+1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
    nm "\`docker ps\` não respondeu em ${DOCKER_S}s — isso NÃO quer dizer que o docker está fora"
  else
    wait "$pid"; rc=$?
    if [ "$rc" -eq 0 ]; then
      ok "\`docker ps\` respondeu em ~${passou}s ($(($(wc -l < "$TMP/docker.out") - 1)) contêineres)"
    else
      aviso "\`docker ps\` saiu $rc: $(head -1 "$TMP/docker.out")"
    fi
  fi
fi

# ── 4. `timeout` ausente ─────────────────────────────────────────────────────
if command -v timeout >/dev/null 2>&1; then
  ok "\`timeout\` existe ($(command -v timeout))"
else
  PADRAO='(^|[;&|(]|then|do)[[:space:]]*timeout[[:space:]]+[0-9]'
  git -C "$RAIZ" grep -l -E "$PADRAO" -- '*.sh' 'loop/hooks/*' ':!triagem/instrumentos/**' > "$TMP/usa_timeout" 2>/dev/null
  rc=$?
  n=$(wc -l < "$TMP/usa_timeout" | tr -d ' ')
  # Controle no MESMO padrão: ele tem de casar uma chamada sabida. Sem isto, "0
  # scripts" lê igual para "ninguém usa" e para "o padrão está quebrado".
  if ! printf 'if x; then timeout 5 docker ps; fi\n' | grep -qE "$PADRAO"; then
    aviso "\`timeout\` AUSENTE; quem depende dele: NÃO MEDIDO (o padrão de busca não casa nem o controle)"
  elif [ "$rc" -gt 1 ]; then
    aviso "\`timeout\` AUSENTE; quem depende dele: NÃO MEDIDO (git grep saiu $rc)"
  else
    aviso "\`timeout\` AUSENTE: \`timeout N cmd\` vira exit 127, e um \`2>&1 | grep\` o lê como 'não achei erro'"
    det "$n script(s) do repo chamam \`timeout\`:"
    while read -r f; do det "- $f"; done < "$TMP/usa_timeout"
    command -v gtimeout >/dev/null 2>&1 && det "(há \`gtimeout\` do coreutils: $(command -v gtimeout))"
  fi
fi

# ── 5. o checkout principal não é a main ─────────────────────────────────────
principal="$(git -C "$RAIZ" worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')"
if [ -z "$principal" ]; then
  nm "git worktree list não devolveu o checkout principal"
else
  ramo="$(git -C "$principal" symbolic-ref --short -q HEAD || echo "(HEAD solto)")"
  sujos=$(git -C "$principal" status --porcelain --untracked-files=no 2>/dev/null | wc -l | tr -d ' ')
  if [ "$ramo" != "main" ] || [ "$sujos" -gt 0 ]; then
    aviso "o checkout principal ($principal) está em '$ramo' com $sujos arquivo(s) rastreado(s) modificado(s)"
    det "ele costuma ser de OUTRA sessão: não trabalhe nele, e toda afirmação sobre a main sai de"
    det "\`git show origin/main:<arquivo>\` — nunca do disco"
  else
    ok "o checkout principal está na main e limpo"
  fi
fi
aqui="$(git -C "$RAIZ" symbolic-ref --short -q HEAD || echo "(HEAD solto)")"
idade="$(git -C "$RAIZ" log -1 --format=%cr origin/main 2>/dev/null || echo "?")"
det "este checkout: $RAIZ em '$aqui'; origin/main local: $(git -C "$RAIZ" rev-parse --short origin/main 2>/dev/null || echo '?') ($idade)"

echo "---"
echo "avisos=$avisos nao_medidos=$nao_medidos"
if [ "$avisos" -gt 0 ]; then exit 1; fi
if [ "$nao_medidos" -gt 0 ]; then exit 2; fi
exit 0
