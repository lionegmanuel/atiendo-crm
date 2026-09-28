#!/usr/bin/env bash
# Uma VAGA do executor próprio: pede ao GitHub uma credencial de uso único
# (runner JIT, que executa no máximo um job e some), sobe um contêiner limpo com
# ela, espera o job terminar e repete. Roda como serviço systemd
# `deskcomm-vaga@N` (N = número da vaga), instalado por instalar.sh.
#
# Uma vaga = um job por vez. As vagas não colidem entre si mesmo com portas
# fixas (o e2e sobe o Supabase em 54321/54322, o teste de imagem usa :3000)
# porque cada contêiner tem o próprio Docker e a própria rede.
set -uo pipefail

VAGA="${1:?uso: vaga.sh <número da vaga>}"
CONF=/etc/deskcomm-executor
REPO="$(cat "$CONF/repo" 2>/dev/null || echo melgarafael/DeskcommCRM)"
CPUS="$(cat "$CONF/cpus-por-vaga" 2>/dev/null || echo 4)"
MEMORIA="$(cat "$CONF/memoria-por-vaga" 2>/dev/null || echo 14g)"
IMAGEM=deskcomm-executor:atual
ROTULO=deskcomm-proprio

while true; do
  token="$(cat "$CONF/token" 2>/dev/null)" || token=""
  if [ -z "$token" ]; then
    echo "vaga ${VAGA}: sem token em ${CONF}/token — esperando" >&2
    sleep 60
    continue
  fi

  nome="deskcomm-vaga-${VAGA}-$(date +%s)"
  resposta=$(curl -fsS -X POST \
      -H "Authorization: Bearer ${token}" \
      -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      "https://api.github.com/repos/${REPO}/actions/runners/generate-jitconfig" \
      -d "{\"name\":\"${nome}\",\"runner_group_id\":1,\"labels\":[\"${ROTULO}\"],\"work_folder\":\"_work\"}") \
    || { echo "vaga ${VAGA}: o GitHub recusou a credencial (token vencido ou sem permissão Administration?) — nova tentativa em 60s" >&2; sleep 60; continue; }
  cfg=$(printf '%s' "$resposta" | jq -r '.encoded_jit_config // empty')
  [ -n "$cfg" ] || { echo "vaga ${VAGA}: resposta sem encoded_jit_config — nova tentativa em 60s" >&2; sleep 60; continue; }

  # Contêiner que sobrou de rodada anterior (queda de energia, kill) faria o
  # `--name` fixo falhar na hora — e cada volta queimaria uma credencial nova.
  docker rm -f "deskcomm-vaga-${VAGA}" >/dev/null 2>&1 || true

  echo "vaga ${VAGA}: ${nome} pronto, esperando job"
  docker run --rm --runtime=sysbox-runc \
    --name "deskcomm-vaga-${VAGA}" \
    --cpus "$CPUS" --memory "$MEMORIA" \
    -e JIT_CONFIG="$cfg" \
    "$IMAGEM"
  echo "vaga ${VAGA}: ${nome} terminou (código $?)"
  sleep 2
done
