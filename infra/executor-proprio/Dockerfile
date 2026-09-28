# Imagem de UMA vaga do executor próprio. Cada job roda num contêiner novo desta
# imagem (runtime sysbox-runc) e o contêiner é destruído ao fim do job: nada que
# um job escreve sobrevive para o seguinte.
#
# O que está aqui é o que os jobs pesados pressupõem do `ubuntu-latest` do GitHub
# (medido nos workflows em 18/09/2026): docker + buildx + compose (e2e sobe o
# Supabase local, invariants sobe pgvector, imagens constroem), psql/pg_dump 17
# (o baseline usa GRANT MAINTAIN, pg17+), jq, gh, git, zstd (actions/cache) e
# sudo sem senha (`playwright install --with-deps` chama apt-get).
FROM ubuntu:24.04

ARG RUNNER_VERSION=2.337.0
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg git jq unzip zip zstd xz-utils sudo tzdata \
      python3 openssl procps iptables build-essential lsb-release \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc \
 && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" > /etc/apt/sources.list.d/docker.list \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/keyrings/pgdg.gpg \
 && echo "deb [signed-by=/etc/apt/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt noble-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli.gpg \
 && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/githubcli.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin \
      postgresql-client-17 gh \
 && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash runner \
 && usermod -aG docker runner \
 && echo 'runner ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/runner \
 && chmod 0440 /etc/sudoers.d/runner

WORKDIR /home/runner/actions-runner
RUN curl -fsSL -o /tmp/runner.tgz \
      "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz" \
 && tar xzf /tmp/runner.tgz \
 && rm /tmp/runner.tgz \
 && ./bin/installdependencies.sh \
 && chown -R runner:runner /home/runner

COPY so-o-que-e-nosso.sh entrypoint.sh /opt/deskcomm/
RUN chmod 0755 /opt/deskcomm/*.sh \
 # A guarda é lida pelo runner a partir do `.env` do diretório dele (método
 # documentado). Arquivo do root: o job só roda DEPOIS da guarda, e o contêiner
 # morre ao fim do job, então nada o reescreve para o próximo.
 && echo "ACTIONS_RUNNER_HOOK_JOB_STARTED=/opt/deskcomm/so-o-que-e-nosso.sh" > /home/runner/actions-runner/.env \
 && chown root:root /home/runner/actions-runner/.env \
 && chmod 0644 /home/runner/actions-runner/.env

ENTRYPOINT ["/opt/deskcomm/entrypoint.sh"]
