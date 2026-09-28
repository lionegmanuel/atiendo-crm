#!/usr/bin/env bash
# ── #1266 — a guarda do #1042 NÃO pode matar a recuperação do #1060/#1143 ─────
#
# O DEFEITO, e por que os dois testes que já existiam não o pegaram:
#
#   A guarda de arquitetura (#1042) estava no TOPO do `source _common.sh`, e
#   saía com `exit 1` assim que `uname -m` não era x86_64/amd64. A recuperação
#   por build local (#1060/#1143, `construir_aqui_e_subir` + o overlay
#   `docker-compose.build.yml`) vive bem DEPOIS, no corpo do update.sh. As duas
#   mudanças tinham teste verde ISOLADAMENTE — `arquitetura-kit.test.sh` prova
#   que a recusa acontece; nenhum teste rodava `update.sh` de ponta a ponta com
#   um `uname` de ARM. Juntas, a recusa matava o script na primeira linha e a
#   recuperação ficava inalcançável: quem JÁ TINHA uma instalação ARM
#   funcionando ficava sem poder rodar `update.sh` nunca mais, sem bandeira.
#
# O QUE ESTE ARQUIVO PROVA, e o que NÃO prova:
#
#   Prova que com `uname -m` = aarch64 e uma instalação que JÁ EXISTE
#   (compose + `.env`), o `update.sh` ALCANÇA o caminho de recuperação: o
#   `docker compose -f docker-compose.build.yml build` é executado e o update
#   termina com o CRM no ar. Prova também que a instalação NOVA em ARM
#   continua recusada com a mesma mensagem do #1042, e que x86_64 não mudou
#   nada.
#
#   NÃO prova nada numa VPS ARM de verdade: `docker`, `curl`, `crontab`, `psql`
#   e `uname` são dublês, o repositório git é descartável (mktemp) e nenhum
#   contêiner sobe. O que se prova é o CAMINHO DO SCRIPT, que é onde as duas
#   mudanças se cruzavam.
#
#   bash tests/shell/guarda-arm-nao-mata-a-recuperacao.test.sh
set -uo pipefail
# Isolamento do git: um GIT_DIR herdado (suíte rodada de dentro de um hook ou
# de um `rebase --exec`) manda por cima de todo `cd`/`git init` dos repositórios
# descartáveis abaixo e escreve no repositório de quem roda. Zera o ambiente
# local do git e dá a identidade por ambiente: nenhum teste aqui mede o autor.
unset $(git rev-parse --local-env-vars)
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t.t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t.t

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
# O namespace das imagens publicado, lido da FONTE (_common.sh) em vez de
# repetido aqui: o que este arquivo mede independe de quem publica as imagens.
NS="$(sed -n 's/^IMG_NS="\(.*\)"$/\1/p' "$REPO_ROOT/hostgator-setup-kit/_common.sh" | head -1)"
[ -n "$NS" ] || { echo "não consegui ler IMG_NS de _common.sh"; exit 1; }
export NS

WORK="$(mktemp -d)"
# Guarda de raio de ação: com TMPDIR apontando para diretório inexistente o
# `mktemp` acima falha e WORK fica VAZIA — aí "$WORK/bin/docker" vira
# /bin/docker e os dublês abaixo sobrescrevem os binários da máquina de quem
# roda. Sem sandbox próprio não há prova honesta: para antes de plantar nada.
if [ -z "$WORK" ] || [ ! -d "$WORK" ] || [ "$WORK" = / ]; then
  echo "abortado: mktemp -d não devolveu um sandbox (WORK='$WORK') — TMPDIR inválido?" >&2
  exit 1
fi
trap '[ "${DK_KEEP:-0}" = 1 ] || rm -rf "$WORK"' EXIT

REAL_UNAME="$(command -v uname)"
FAILS=0
check() {  # check <descrição> <comando de verificação...>
  if "${@:2}"; then printf '  ✓ %s\n' "$1"; else printf '  ✗ %s\n' "$1"; FAILS=$((FAILS + 1)); fi
}
nao_contem() { ! grep -q -- "$1" "$2"; }  # nao_contem <texto> <arquivo>

# ── Dublês ───────────────────────────────────────────────────────────────────
mkdir -p "$WORK/bin"
# O `docker` é o teatro inteiro desta prova. Ele:
#   * registra CADA chamada em $DOCKER_LOG (é por isso que se prova que o
#     overlay de build local foi MESMO invocado, e não que a mensagem apareceu);
#   * FAZ FALHAR o `pull` e o `up -d` das IMAGENS PUBLICADAS quando a
#     arquitetura não tem manifest — é o "no matching manifest" que o #1143
#     existe para consertar, reproduzido pelo código de SAÍDA, nunca por texto
#     em inglês;
#   * faz o `build` e o `up -d` do OVERLAY (`-f docker-compose.build.yml`)
#     terem sucesso, porque é o que o `construir_aqui_e_subir` exige para seguir:
#     as imagens construídas aqui estão no disco e o overlay traz
#     `pull_policy: never`, então o segundo `up` sobe o que foi construído;
#   * responde 'healthy' ao probe do app, para o update.sh fechar com sucesso.
cat > "$WORK/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$DOCKER_LOG"
case " $* " in
  # O overlay de build local: build e up são sucesso por definição aqui, e é a
  # diferença entre as DUAS chamadas de `up -d` que o update.sh faz.
  *" -f docker-compose.build.yml "*) exit 0 ;;
esac
# Sem imagem publicada para a arquitetura desta VPS, o pull e o up falham.
# `ARM_SEM_IMAGEM` é o interruptor: em x86_64 o pull funciona, e é por isso que
# o caso de amd64 prova que aquele caminho não mudou.
if [ "${ARM_SEM_IMAGEM:-0}" = 1 ]; then
  case " $* " in
    *" pull"*|*" up -d"*) exit 1 ;;
  esac
fi
case " $* " in
  *" exec "*) printf 'healthy\n{"data":{"status":"healthy","version":"0.9.0","checks":{"supabase":{"status":"ok","latency_ms":12}}}}\n' ;;
esac
exit 0
STUB
# `crontab` guarda a tabela num arquivo: o update.sh instala a linha do agente
# no fim, e escrever no crontab real de quem roda a suíte não é aceitável.
cat > "$WORK/bin/crontab" <<'STUB'
#!/usr/bin/env bash
[ "${1:-}" = "-l" ] && { [ -f "$FAKE_CRONTAB" ] && cat "$FAKE_CRONTAB"; exit 0; }
[ "${1:-}" = "-" ] && { cat > "$FAKE_CRONTAB"; exit 0; }
exit 0
STUB
# flock não existe no macOS e o kit depende dele; a exclusão mútua não está sob
# prova aqui, então este dublê só deixa passar.
cat > "$WORK/bin/flock" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
# curl: o update.sh pede a release mais recente ao GitHub. A resposta tem de ser
# a MESMA JSON que a API devolve, com a tag que o fixture tem — senão o
# `ultima_release_estavel` não encontra nada e o script morre por outro motivo.
cat > "$WORK/bin/curl" <<'STUB'
#!/usr/bin/env bash
printf '{"tag_name":"v0.9.0"}'
STUB
# `uname -m` é a ARQUITETURA que o teste escolhe, e é o único uso dublado: o
# resto de `uname` vai para o binário real. A guarda do #1042 e o veredito
# novo (#1266) leem exatamente isto.
cat > "$WORK/bin/uname" <<STUB
#!/usr/bin/env bash
[ "\$*" = "-m" ] && { printf '%s\n' "\${FAKE_ARCH:-x86_64}"; exit 0; }
exec "$REAL_UNAME" "\$@"
STUB
# `docker compose` é o que o kit chama; e o `psql` nunca chega a rodar porque
# o baseline do fixture é um SELECT — mas o dublê existe para que, se um dia
# chegar, ele não vá ao banco de quem roda a suíte.
cat > "$WORK/bin/psql" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
chmod +x "$WORK/bin/docker" "$WORK/bin/crontab" "$WORK/bin/flock" "$WORK/bin/curl" "$WORK/bin/uname" "$WORK/bin/psql"
export DOCKER_LOG="$WORK/docker.log" FAKE_CRONTAB="$WORK/crontab.txt"
export PATH="$WORK/bin:$PATH"

# ── Fixture ──────────────────────────────────────────────────────────────────
# Uma instalação REAL do kit: o kit dentro do projeto, compose, `.env`, baseline
# e um repo git descartável com uma tag publicada. `com_env` = 1 é a instalação
# que JÁ EXISTE (o caso da issue); `com_env` = 0 é a instalação NOVA, em que o
# clone ainda não tem `.env` nenhum — que é como o install.sh chega ao
# `source _common.sh` na prática.
montar_instalacao() {  # montar_instalacao <raiz> <0|1 sem .env>
  local raiz="$1" sem_env="${2:-0}" proj="$1/deskcommcrm"
  mkdir -p "$proj"
  cp -RL "$REPO_ROOT/hostgator-setup-kit" "$proj/"
  mkdir -p "$proj/supabase"
  printf 'select 1;\n' > "$proj/supabase/baseline.sql"
  printf 'services:\n  app:\n    image: \${APP_IMAGE:-x}\n' > "$proj/docker-compose.prod.yml"
  if [ "$sem_env" = 0 ]; then
    cat > "$proj/.env" <<ENV
APP_IMAGE=${NS}/deskcommcrm:0.9.0
APP_PULL_POLICY=missing
SUPABASE_DB_URL=postgresql://x/y
NEXT_PUBLIC_APP_URL=https://crm.exemplo.com.br
INTERNAL_SECRET=segredo
NUVEMSHOP_OAUTH_ENCRYPTION_KEY=chave
ENV
    chmod 600 "$proj/.env"
    # O marcador que o install.sh grava com a stack no ar (#1778). Esta fixture
    # representa uma instalação que JÁ PASSOU pelo instalador, então ela tem o
    # marcador — e, mesmo sem ele, teria o contêiner do projeto, que é o outro
    # sinal de instalação real. Sem esta linha o `docker ps -a -q` do dublê (que
    # devolve vazio) faria esta prova medir uma instalação NOVA, que não é o caso
    # que ela existe para provar.
    printf 'instalado_em=2026-09-27T00:00:00Z\nversao=0.9.0\n' > "$proj/.deskcomm-instalado"
    chmod 600 "$proj/.deskcomm-instalado"
  fi
  # O overlay do #1143 precisa EXISTIR no projeto: o `construir_aqui_e_subir`
  # passa `-f $COMPOSE_BUILD` para o compose, e um `-f` de arquivo inexistente
  # morre antes de qualquer construção.
  cp "$REPO_ROOT/docker-compose.build.yml" "$proj/"
  (
    cd "$proj" || exit 1
    git init --quiet
    git add -A
    git commit --quiet -m "v0.9.0"
    git tag v0.9.0
    echo topo > topo.txt
    git add -A
    git commit --quiet -m "topo da main"
  ) >/dev/null 2>&1
}

# rodar_update <raiz> <arch> <0|1 sem imagem publicada> <saída> → RC global
#
# A invocação é RELATIVA (`bash deskcommcrm/hostgator-setup-kit/update.sh`) de
# propósito: com o caminho absoluto o `cd` do `enter_project` não mudaria nada
# e a prova mediria menos. `--to v0.9.0 --force` fixa o alvo, para o teste não
# depender de nenhum tag novo. `< /dev/null` evita travar num `read -p`.
rodar_update() {
  local raiz="$1" arch="$2" sem_imagem="$3" saida="$4"
  : > "$DOCKER_LOG"
  RC=0
  ( cd "$raiz" && \
    env FAKE_ARCH="$arch" ARM_SEM_IMAGEM="$sem_imagem" \
        bash deskcommcrm/hostgator-setup-kit/update.sh --to v0.9.0 --force \
  ) > "$saida" 2>&1 < /dev/null || RC=$?
}

# ─────────────────────────────────────────────────────────────────────────────
echo '── 1. A DEFEITO: aarch64 numa instalação que JÁ EXISTE tem que alcançar a'
echo '      recuperação por build local, e não morrer na guarda do #1042'
# É o relato da issue, palavra por palavra: um clone de ARM, com o CRM no ar,
# e o `bash hostgator-setup-kit/update.sh` não passando de "Procurando
# atualizações". As três asserções juntas são a prova: a guarda deixou passar,
# o overlay de build foi MESMO executado, e o update terminou bem.
R1="$WORK/caso1"; mkdir -p "$R1"; montar_instalacao "$R1" 0
OUT1="$WORK/saida1.txt"
rodar_update "$R1" aarch64 1 "$OUT1"; RC1="$RC"
check "o update.sh NÃO morre na guarda de arquitetura (o 'Procurando atualizações' aparece)" \
  grep -q 'Procurando atualizações' "$OUT1"
check "a guarda em vez de recusar AVISA que a instalação já existe" \
  grep -q 'JÁ EXISTE' "$OUT1"
check "a arquitetura encontrada é dita ao dono (aarch64)" \
  grep -q 'aarch64' "$OUT1"
# O update.sh relê o _common.sh depois do checkout (update.sh, passo 3), e a
# guarda roda de novo no topo dele: sem a trava por processo, o mesmo aviso
# saía duas vezes na mesma atualização.
check "o aviso sai UMA vez só, mesmo com a releitura do _common.sh depois do checkout" \
  test "$(grep -c 'JÁ EXISTE' "$OUT1")" -eq 1
# O gatilho do #1143 é o CÓDIGO DE SAÍDA de quem falhou, e o seu conserto é o
# `dc -f $COMPOSE_BUILD build`. Provar pelo log do docker (e não por uma
# mensagem) é o que separa "construiu" de "disse que ia construir".
check "a recuperação por build local foi EXECUTADA (docker compose ... -f docker-compose.build.yml build)" \
  grep -q -- '-f docker-compose.build.yml build' "$DOCKER_LOG"
check "e o serviço subiu pelo mesmo overlay" \
  grep -q -- '-f docker-compose.build.yml up -d' "$DOCKER_LOG"
check "a atualização terminou com o CRM no ar" \
  grep -q 'containers no ar\|Atualização concluída\|construídas aqui' "$OUT1"
check "o update.sh saiu com 0 (rc=$RC1)" test "$RC1" -eq 0
# O aviso da guarda não pode ser a recusa: a recusa do #1042 começa com '✖' e
# manda usar VPS x86_64, e é a mensagem que o dono lia antes.
check "a saída NÃO diz 'Use uma VPS x86_64/amd64' (a recusa do #1042)" \
  nao_contem 'Use uma VPS x86_64/amd64' "$OUT1"

# ─────────────────────────────────────────────────────────────────────────────
echo
echo '── 2. A GUARDA DO #1042 CONTINUA: instalação NOVA em aarch64 é recusada'
# Contrapeso obrigatório, e é o motivo de a guarda não ter sido removida: numa
# instalação nova não existe build local para recuperar — não há imagem, não há
# `.env`, e o `construir_aqui_e_subir` só é alcançado DEPOIS do provisionamento
# do banco. O que muda é que a recusa volta a ser a do #1042, com a causa certa.
R2="$WORK/caso2"; mkdir -p "$R2"; montar_instalacao "$R2" 1
OUT2="$WORK/saida2.txt"
rodar_update "$R2" aarch64 1 "$OUT2"; RC2="$RC"
check "a instalação NOVA em ARM é recusada (rc=$RC2, e != 0)" test "$RC2" -ne 0
check "a recusa diz qual arquitetura foi encontrada" \
  grep -q 'aarch64' "$OUT2"
check "a recusa diz qual é a imagem que existe hoje" \
  grep -q 'linux/amd64' "$OUT2"
check "a recusa orienta a VPS suportada (o texto do #1042, intacto)" \
  grep -q 'Use uma VPS x86_64/amd64' "$OUT2"
check "a instalação NOVA em ARM NÃO tenta construir imagens aqui" \
  nao_contem '-f docker-compose.build.yml build' "$DOCKER_LOG"

# ─────────────────────────────────────────────────────────────────────────────
echo
echo '── 3. x86_64 NÃO MUDA: nem a guarda nem a recuperação aparecem'
# Um `dc pull` que funciona é o caminho de sempre; sem imagem local para
# construir e sem a guarda, o `construir_aqui_e_subir` nem é chamado. É o que
# garante que em amd64 continua valendo exatamente o que valia antes.
R3="$WORK/caso3"; mkdir -p "$R3"; montar_instalacao "$R3" 0
OUT3="$WORK/saida3.txt"
rodar_update "$R3" x86_64 0 "$OUT3"; RC3="$RC"
check "em x86_64 o update.sh sai com 0 (rc=$RC3)" test "$RC3" -eq 0
check "em x86_64 a guarda não diz nada sobre arquitetura" \
  nao_contem 'arquitetura' "$OUT3"
check "em x86_64 não há construção local (o pull resolveu)" \
  nao_contem '-f docker-compose.build.yml build' "$DOCKER_LOG"
check "em x86_64 a atualização pullou a imagem do app" \
  grep -q 'compose .*pull' "$DOCKER_LOG"

# ─────────────────────────────────────────────────────────────────────────────
echo
echo '── 4. A DECISÃO, isolada: a função pura que decide'
# As três respostas, sem `uname` e sem disco — é o que permite ao gate ler a
# decisão sem montar instalação nenhuma, e cobre o limite: em amd64, existir ou
# não uma instalação é a MESMA resposta.
R4="$WORK/caso4"; mkdir -p "$R4"
OUT4="$R4/veredito.txt"
(
  . "$REPO_ROOT/hostgator-setup-kit/_common.sh"
  for par in "x86_64 0" "amd64 1" "aarch64 0" "aarch64 1" "arm64 1" "riscv64 0"; do
    # shellcheck disable=SC2086
    set -- $par
    printf '%s %s → %s\n' "$1" "$2" "$(veredito_da_arquitetura "$1" "$2")"
  done
) > "$OUT4" 2>&1
check "amd64 (nova ou existente) → amd64" \
  grep -q '^x86_64 0 → amd64$' "$OUT4"
check "amd64 em instalação existente também é amd64" \
  grep -q '^amd64 1 → amd64$' "$OUT4"
check "aarch64 em instalação NOVA → nova (a recusa do #1042)" \
  grep -q '^aarch64 0 → nova$' "$OUT4"
check "aarch64 em instalação existente → recuperar" \
  grep -q '^aarch64 1 → recuperar$' "$OUT4"
check "arm64 em instalação existente → recuperar" \
  grep -q '^arm64 1 → recuperar$' "$OUT4"
check "outra arquitetura em instalação NOVA → nova" \
  grep -q '^riscv64 0 → nova$' "$OUT4"

# ─────────────────────────────────────────────────────────────────────────────
echo
echo '── 5. QUEM JÁ ESTÁ PRESO: o kit do disco é o da guarda velha, e o passo'
echo '      único que o fragmento de release ensina tem de funcionar'
# O update.sh dá `source` no _common.sh que está NO DISCO antes do checkout da
# versão nova. Numa VPS ARM que já tem a guarda do #1042 (v1.35.0 em diante),
# esse kit velho morre no topo e nunca baixa este conserto — nem pelo terminal
# nem pelo botão "Atualizar", que roda o mesmo update.sh. A saída é trocar o
# código à mão uma vez e rodar o update.sh da versão nova. Este caso prova as
# duas metades: que a pessoa está presa (a premissa do texto), e que o comando
# publicado no fragmento `.changes/guarda-arm-nao-mata-a-recuperacao.md` a solta.
#
# O kit "velho" é o do próprio PR com a detecção de instalação desligada, que
# é exatamente o comportamento da guarda do #1042: recusa ARM sem olhar nada.
R5="$WORK/caso5"; mkdir -p "$R5"; montar_instalacao "$R5" 0
(
  cd "$R5/deskcommcrm" || exit 1
  git checkout --quiet v0.9.0
  sed -i.bak 's/instalacao_real_do_kit_aqui && existe=1/: guarda velha/' hostgator-setup-kit/_common.sh
  rm -f hostgator-setup-kit/_common.sh.bak
  git commit --quiet -am "kit com a guarda velha"
  git tag v0.8.0
) >/dev/null 2>&1
OUT5A="$WORK/saida5a.txt"; OUT5B="$WORK/saida5b.txt"
: > "$DOCKER_LOG"; RC5A=0
( cd "$R5" && env FAKE_ARCH=aarch64 ARM_SEM_IMAGEM=1 \
    bash deskcommcrm/hostgator-setup-kit/update.sh --to v0.9.0 --force \
) > "$OUT5A" 2>&1 < /dev/null || RC5A=$?
check "com o kit velho no disco, nem --to/--force passam da guarda (rc=$RC5A, e != 0)" \
  test "$RC5A" -ne 0
check "e o que ele lê é a recusa do #1042" \
  grep -q 'Use uma VPS x86_64/amd64' "$OUT5A"
# O passo único, como o fragmento o escreve (sem o `git fetch`, que aqui não
# tem remoto: a tag já está no repositório descartável).
: > "$DOCKER_LOG"; RC5B=0
( cd "$R5/deskcommcrm" && git checkout --quiet v0.9.0 && \
  env FAKE_ARCH=aarch64 ARM_SEM_IMAGEM=1 \
    bash hostgator-setup-kit/update.sh --to v0.9.0 --force \
) > "$OUT5B" 2>&1 < /dev/null || RC5B=$?
check "depois do checkout à mão, o update.sh da versão nova sai com 0 (rc=$RC5B)" \
  test "$RC5B" -eq 0
check "e ele chega à recuperação por build local" \
  grep -q -- '-f docker-compose.build.yml build' "$DOCKER_LOG"

printf '\nstatus: caso1(ARM+recuperação)=%s caso2(nova ARM)=%s caso3(amd64)=%s\n' \
  "$RC1" "$RC2" "$RC3"
if [ "$FAILS" -eq 0 ]; then
  echo "OK — a guarda não mata a recuperação (#1266) e continua recusando a instalação nova (#1042)."
else
  echo "FALHOU — $FAILS prova(s)."
fi
exit $((FAILS > 0))
