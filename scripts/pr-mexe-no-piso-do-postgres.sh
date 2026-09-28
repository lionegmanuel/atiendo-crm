#!/usr/bin/env bash
# Lê caminhos (um por linha) na entrada e responde `sim` se ALGUM deles pode
# mudar o comportamento do banco na major de PISO (pg15); `nao` quando nenhum
# alcança. Entrada vazia responde `sim`: não saber o que mudou nunca pode virar
# "não precisa".
#
# Usado pelo ci.yml em pull_request, para escolher a matriz do
# `invariants-majors`. A major de CIMA (pg17) roda SEMPRE, em todo PR e na
# `main`; é ela que reprova invariante de RLS, de governança e de vocabulário
# banco × TypeScript, que não dependem da versão do Postgres.
#
# O piso existe por outra razão (issue #454): provar que o `baseline.sql` que o
# self-hoster aplica sobe na MENOR major que dizemos suportar. Isso só muda
# quando muda o schema, o script que o aplica ou o kit que o instala — e não
# quando muda código de produto. Medido em 18/09/2026: 55 dos 199 PRs recentes
# (28%) tocam essas superfícies, e os outros 72% pagavam uma segunda passada de
# ~8 min sem chance de reprovar por razão de major.
#
# Aqui a lista é de quem ALCANÇA (e não de quem não alcança, como nos scripts
# irmãos), porque a superfície do piso é pequena e nomeável: schema, os scripts
# que o aplicam, o kit e os próprios invariantes. Na `main` a pergunta nem é
# feita — lá as duas majors rodam sempre.
set -euo pipefail

algum=nao
while IFS= read -r caminho || [ -n "$caminho" ]; do
  [ -z "$caminho" ] && continue
  algum=sim
  case "$caminho" in
    # O schema, em qualquer forma: baseline, migrations, MANIFEST, config.
    supabase/*) echo sim; exit 0 ;;
    # Quem aplica o schema e quem mede o resultado.
    scripts/test-db.sh | scripts/test-update-com-dados.sh) echo sim; exit 0 ;;
    tests/invariants/*) echo sim; exit 0 ;;
    # O kit do self-hoster aplica o baseline no install e no update.
    hostgator-setup-kit/*) echo sim; exit 0 ;;
    # O próprio workflow que decide isto.
    .github/workflows/ci.yml) echo sim; exit 0 ;;
    # E o script desta regra.
    scripts/pr-mexe-no-piso-do-postgres.sh) echo sim; exit 0 ;;
  esac
done

# Nenhuma linha lida: não sei o que mudou, então roda as duas.
if [ "$algum" = nao ]; then echo sim; else echo nao; fi
