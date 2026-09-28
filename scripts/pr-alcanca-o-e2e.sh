#!/usr/bin/env bash
# Lê caminhos (um por linha) na entrada e responde `sim` se ALGUM deles pode
# mudar o que o e2e mede; `nao` só quando TODOS estão na lista abaixo. Entrada
# vazia responde `sim`: não saber o que mudou nunca pode virar "não precisa".
#
# Usado pelo e2e.yml em pull_request. O e2e é o maior consumidor da fila do
# Actions — 56% dos minutos de runner medidos de 15 a 18/09/2026, três partes de
# ~23 min em todo push de PR — e um PR só de documentação, teste de unidade ou
# workflow alheio pagava as três partes para medir o mesmo produto de antes.
#
# A lista é de quem NÃO alcança, e não de quem alcança, de propósito (mesma
# razão do scripts/pr-mexe-na-imagem.sh): errar para "rodar" custa vaga, errar
# para "pular" deixa passar regressão de tela com `e2e` verde.
#
# Cada entrada, e por quê:
#   - docs/, tasks/, .changes/, evidence/ e as pastas de ferramenta de agente:
#     nenhum código do produto nem spec as lê.
#   - tests/unit/, tests/invariants/, tests/cercas/, tests/shell/ e `*.test.ts(x)`
#     em qualquer pasta: são testes de OUTRAS suítes (vitest, test:db, test:shell).
#     Não mudam o comportamento do produto. O que eles quebram de compilação o
#     `build-and-size` (obrigatório) reprova. `tests/e2e/`, `tests/setup/` e
#     `tests/fixtures/` NÃO estão aqui — são do e2e ou podem ser.
#   - `.github/workflows/*.yml`, menos o próprio e2e.yml: outro workflow não
#     muda o que este roda. `.github/actions/` NÃO está aqui — o e2e usa
#     `preparar-node`.
#   - `*.md` da RAIZ e `.github/*.md`: inertes. Markdown em subdiretório fica
#     de fora da regra: há código que lê `.md` do próprio disco
#     (lib/agent-engine/playbooks/*.md).
#   - infra/executor-proprio/: a máquina que RODA os jobs, não o produto.
set -euo pipefail

algum=nao
while IFS= read -r caminho || [ -n "$caminho" ]; do
  [ -z "$caminho" ] && continue
  algum=sim
  case "$caminho" in
    .github/workflows/e2e.yml) echo sim; exit 0 ;;
    docs/* | tasks/* | .changes/* | evidence/* | infra/executor-proprio/* \
      | .agents/* | .agent/* | .claude/* | .codex/* | .cursor/* | .opencode/* \
      | .specs/* | .lina/* | scratchpad/*) ;;
    tests/unit/* | tests/invariants/* | tests/cercas/* | tests/shell/*) ;;
    tests/e2e/* | tests/setup/* | tests/fixtures/*) echo sim; exit 0 ;;
    *.test.ts | *.test.tsx) ;;
    .github/workflows/*.yml | .github/workflows/*.yaml) ;;
    .github/*.md | .github/ISSUE_TEMPLATE/*) ;;
    # Daqui para baixo, só arquivo da RAIZ: qualquer outro caminho com `/` alcança.
    */*) echo sim; exit 0 ;;
    *.md) ;;
    *) echo sim; exit 0 ;;
  esac
done

# Nenhuma linha lida: não sei o que mudou, então roda.
if [ "$algum" = nao ]; then echo sim; else echo nao; fi
