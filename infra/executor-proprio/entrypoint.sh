#!/usr/bin/env bash
# Sobe o Docker de DENTRO da vaga (o sysbox isola um daemon por contêiner, sem
# --privileged) e entrega o controle ao runner do GitHub para exatamente UM job.
# A configuração JIT chega por variável e sai do ambiente antes do runner
# começar: o job herda o ambiente do processo do runner.
set -euo pipefail

cfg="${JIT_CONFIG:-}"
unset JIT_CONFIG
[ -n "$cfg" ] || { echo "entrypoint: JIT_CONFIG vazio — nada a fazer" >&2; exit 1; }

dockerd >/var/log/dockerd.log 2>&1 &
for _ in $(seq 1 60); do
  docker info >/dev/null 2>&1 && break
  sleep 1
done
docker info >/dev/null 2>&1 || { echo "entrypoint: dockerd não subiu em 60s" >&2; tail -50 /var/log/dockerd.log >&2; exit 1; }

cd /home/runner/actions-runner
exec runuser -u runner -- ./run.sh --jitconfig "$cfg"
