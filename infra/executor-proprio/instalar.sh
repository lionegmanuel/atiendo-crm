#!/usr/bin/env bash
# Instala o executor próprio do DeskcommCRM numa máquina Ubuntu 24.04 amd64
# DEDICADA a isso. Rode como root, de dentro de um clone do repositório:
#
#   sudo bash infra/executor-proprio/instalar.sh            # instala ou reinstala
#   sudo bash infra/executor-proprio/instalar.sh atualizar  # reconstrói a imagem
#
# O que ele faz, e nada além disso:
#   1. instala Docker e Sysbox (Docker isolado dentro de cada vaga);
#   2. pede o token do GitHub e o número de vagas, e grava em /etc/deskcomm-executor;
#   3. constrói a imagem da vaga com a versão mais nova do runner do GitHub;
#   4. liga N serviços `deskcomm-vaga@N` e um timer semanal que reconstrói a imagem.
#
# Não liga nada no GitHub. Os jobs só vêm para cá quando a variável de
# repositório EXECUTOR_PROPRIO valer `ligado` (tutorial: pasta de decisões, doc 39).
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
CONF=/etc/deskcomm-executor
DESTINO=/opt/deskcomm-executor
SYSBOX_VERSAO=0.7.1

falha() { echo "ERRO: $*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || falha "rode com sudo"
[ "$(uname -m)" = x86_64 ] || falha "a máquina precisa ser amd64 (x86_64); esta é $(uname -m)"
# shellcheck source=/dev/null
. /etc/os-release
[ "${VERSION_ID:-}" = "24.04" ] || echo "AVISO: testado em Ubuntu 24.04; esta é ${PRETTY_NAME:-desconhecida}" >&2

construir_imagem() {
  local versao
  versao=$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | jq -r '.tag_name' | sed 's/^v//')
  [ -n "$versao" ] && [ "$versao" != null ] || falha "não consegui ler a versão do runner no GitHub"
  echo "==> construindo a imagem da vaga (runner ${versao})"
  docker build --pull --build-arg "RUNNER_VERSION=${versao}" -t deskcomm-executor:atual "$DIR"
  # Imagens antigas desta mesma tag viram <none>; limpa sem tocar em nada em uso.
  docker image prune -f >/dev/null
}

if [ "${1:-}" = atualizar ]; then
  construir_imagem
  echo "==> imagem atualizada. As vagas usam a nova a partir do próximo job."
  exit 0
fi

echo "==> pacotes base"
apt-get update -q
apt-get install -y -q ca-certificates curl jq git

if ! command -v docker >/dev/null; then
  echo "==> instalando Docker"
  curl -fsSL https://get.docker.com | sh
fi

if ! command -v sysbox-runc >/dev/null; then
  echo "==> instalando Sysbox ${SYSBOX_VERSAO}"
  # O instalador do sysbox reinicia o Docker e exige que não haja contêiner rodando.
  deb="/tmp/sysbox-ce_${SYSBOX_VERSAO}.linux_amd64.deb"
  curl -fsSL -o "$deb" "https://github.com/nestybox/sysbox/releases/download/v${SYSBOX_VERSAO}/sysbox-ce_${SYSBOX_VERSAO}.linux_amd64.deb"
  apt-get install -y -q "$deb"
  rm -f "$deb"
fi
systemctl is-active --quiet sysbox || falha "o serviço sysbox não está ativo (systemctl status sysbox)"

mkdir -p "$CONF"
chmod 0700 "$CONF"
if [ ! -s "$CONF/token" ]; then
  echo
  echo "Cole o token do GitHub (fine-grained, só o repositório DeskcommCRM,"
  echo "permissão 'Administration: Read and write'). Ele não aparece na tela:"
  read -r -s token
  echo
  [ -n "$token" ] || falha "token vazio"
  umask 077
  printf '%s' "$token" > "$CONF/token"
fi
# Confere o token AGORA, em vez de descobrir pelo log de uma vaga parada.
codigo=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $(cat "$CONF/token")" \
  "https://api.github.com/repos/melgarafael/DeskcommCRM/actions/runners")
[ "$codigo" = 200 ] || falha "o token não lê os runners do repositório (HTTP ${codigo}). Confira a permissão Administration."
echo "melgarafael/DeskcommCRM" > "$CONF/repo"

nucleos=$(nproc)
memoria_gb=$(awk '/MemTotal/ {printf "%d", $2/1024/1024}' /proc/meminfo)
sugestao=$(( nucleos / 4 ))
[ $(( memoria_gb / 14 )) -lt "$sugestao" ] && sugestao=$(( memoria_gb / 14 ))
[ "$sugestao" -ge 1 ] || falha "máquina pequena demais: ${nucleos} núcleos e ${memoria_gb} GB (uma vaga pede 4 núcleos e 14 GB)"
vagas_atual=$(cat "$CONF/vagas" 2>/dev/null || echo "$sugestao")
echo
echo "Esta máquina tem ${nucleos} núcleos e ${memoria_gb} GB: cabem ${sugestao} vaga(s) de 4 núcleos / 14 GB."
read -r -p "Quantas vagas ligar? [${vagas_atual}] " vagas
vagas="${vagas:-$vagas_atual}"
[[ "$vagas" =~ ^[0-9]+$ ]] && [ "$vagas" -ge 1 ] || falha "número de vagas inválido"
echo "$vagas" > "$CONF/vagas"
echo 4 > "$CONF/cpus-por-vaga"
echo 14g > "$CONF/memoria-por-vaga"

construir_imagem

echo "==> serviços"
install -d "$DESTINO"
install -m 0755 "$DIR/vaga.sh" "$DESTINO/vaga.sh"
install -m 0755 "$DIR/instalar.sh" "$DESTINO/instalar.sh"
cp "$DIR/Dockerfile" "$DIR/entrypoint.sh" "$DIR/so-o-que-e-nosso.sh" "$DESTINO/"

cat > /etc/systemd/system/deskcomm-vaga@.service <<EOF
[Unit]
Description=DeskcommCRM — vaga %i do executor próprio
After=docker.service sysbox.service network-online.target
Requires=docker.service sysbox.service

[Service]
ExecStart=${DESTINO}/vaga.sh %i
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/deskcomm-executor-atualizar.service <<EOF
[Unit]
Description=DeskcommCRM — reconstrói a imagem do executor (runner novo + pacotes)

[Service]
Type=oneshot
ExecStart=${DESTINO}/instalar.sh atualizar
EOF

cat > /etc/systemd/system/deskcomm-executor-atualizar.timer <<EOF
[Unit]
Description=DeskcommCRM — atualização semanal do executor

[Timer]
OnCalendar=Sun 04:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
# Desliga vagas acima do número novo (reinstalação com menos vagas).
for unidade in $(systemctl list-units --all --plain --no-legend 'deskcomm-vaga@*' | awk '{print $1}'); do
  n="${unidade#deskcomm-vaga@}"; n="${n%.service}"
  [ "$n" -le "$vagas" ] || systemctl disable --now "$unidade"
done
for n in $(seq 1 "$vagas"); do
  systemctl enable --now "deskcomm-vaga@${n}"
done
systemctl enable --now deskcomm-executor-atualizar.timer

echo
echo "==> pronto: ${vagas} vaga(s) ligada(s)."
echo "Confira em https://github.com/melgarafael/DeskcommCRM/settings/actions/runners"
echo "(cada vaga aparece como deskcomm-vaga-N-<hora>, status Idle)."
echo "Logs de uma vaga: journalctl -u deskcomm-vaga@1 -f"
