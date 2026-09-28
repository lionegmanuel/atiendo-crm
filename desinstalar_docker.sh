#!/usr/bin/env bash
#
# Remove somente os recursos Docker desta instalacao. A selecao usa os labels
# que o Docker Compose grava nos containers, volumes e redes do projeto; nunca
# enumera nem limpa globalmente o daemon Docker.

set -Eeuo pipefail

readonly ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

uso() {
  cat <<'EOF'
Uso: bash desinstalar_docker.sh [--force] [--project-name NOME]

Para e remove somente os recursos Docker da aplicacao deste diretorio:
  1. containers com o label do projeto Docker Compose atual;
  2. volumes do projeto, inclusive sessoes locais do WhatsApp;
  3. redes internas criadas por este projeto.

Outras aplicacoes do mesmo daemon, imagens, cache de build, redes externas do
proxy, codigo, .env, backups e bancos Supabase externos sao preservados.

O nome do projeto vem, nesta ordem, de --project-name, COMPOSE_PROJECT_NAME,
COMPOSE_PROJECT_NAME no .env ou do nome deste diretorio.

Sem --force, o script mostra os recursos encontrados e pede uma confirmacao
com o nome exato do projeto antes de remover qualquer coisa.
EOF
}

falhar() {
  printf 'Erro: %s\n' "$*" >&2
  exit 1
}

normalizar_projeto() {
  local nome="$1"
  nome="$(printf '%s' "$nome" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')"
  printf '%s' "${nome#"${nome%%[!_-]*}"}"
}

projeto_do_env() {
  local arquivo="$ROOT_DIR/.env" valor=""
  [[ -f "$arquivo" ]] || return 0

  valor="$(sed -n 's/^[[:space:]]*COMPOSE_PROJECT_NAME[[:space:]]*=[[:space:]]*//p' "$arquivo" | tail -1)"
  valor="${valor%$'\r'}"
  valor="${valor#\"}"
  valor="${valor%\"}"
  valor="${valor#\'}"
  valor="${valor%\'}"
  printf '%s' "$valor"
}

forcar=false
projeto_informado=""

while (($#)); do
  case "$1" in
    --force)
      forcar=true
      ;;
    --project-name)
      shift
      (($#)) || falhar "--project-name exige um nome."
      projeto_informado="$1"
      ;;
    -h|--help)
      uso
      exit 0
      ;;
    *)
      uso >&2
      exit 2
      ;;
  esac
  shift
done

command -v docker >/dev/null 2>&1 || falhar "Docker nao esta instalado ou nao esta no PATH."
docker info >/dev/null 2>&1 || falhar "Nao foi possivel acessar o daemon Docker atual."

projeto_bruto="${projeto_informado:-${COMPOSE_PROJECT_NAME:-}}"
if [[ -z "$projeto_bruto" ]]; then
  projeto_bruto="$(projeto_do_env)"
fi
if [[ -z "$projeto_bruto" ]]; then
  projeto_bruto="$(basename "$ROOT_DIR")"
fi

projeto="$(normalizar_projeto "$projeto_bruto")"
[[ -n "$projeto" ]] || falhar "Nao foi possivel determinar o nome do projeto Docker Compose."

readonly LABEL_PROJETO="com.docker.compose.project=$projeto"
readonly CONFIRMACAO="REMOVER-$projeto"

# Uma segunda copia do repositorio pode ter o mesmo basename e, portanto, o
# mesmo nome Compose. Se ela ainda existe, apagar pelo label atingiria a outra
# instalacao. Falhamos antes da primeira mutacao em vez de assumir propriedade.
mapfile -t diretorios_dos_containers < <(
  docker container ls -a \
    --filter "label=$LABEL_PROJETO" \
    --format '{{.Label "com.docker.compose.project.working_dir"}}' \
    | sed '/^$/d' | sort -u
)

for diretorio in "${diretorios_dos_containers[@]}"; do
  [[ "$diretorio" == "$ROOT_DIR" ]] && continue
  if [[ -d "$diretorio" && -f "$diretorio/docker-compose.prod.yml" ]]; then
    falhar "O projeto '$projeto' pertence a outra instalacao ativa: $diretorio. Execute o desinstalador a partir dela."
  fi
  printf 'Aviso: os containers ainda registram o caminho antigo %s; ele nao existe mais e sera tratado como esta instalacao.\n' "$diretorio"
done

mapfile -t containers_em_execucao < <(
  docker container ls -q --filter "label=$LABEL_PROJETO"
)
mapfile -t todos_containers < <(
  docker container ls -aq --filter "label=$LABEL_PROJETO"
)
mapfile -t volumes_do_projeto < <(
  docker volume ls -q --filter "label=$LABEL_PROJETO"
)
mapfile -t redes_do_projeto < <(
  docker network ls -q --filter "label=$LABEL_PROJETO"
)

contexto="$(docker context show 2>/dev/null || true)"
printf 'Daemon Docker selecionado: %s\n' "${contexto:-desconhecido}"
printf 'Projeto selecionado: %s\n' "$projeto"
printf 'Diretorio da instalacao: %s\n\n' "$ROOT_DIR"

if ((${#todos_containers[@]} == 0 && ${#volumes_do_projeto[@]} == 0 && ${#redes_do_projeto[@]} == 0)); then
  printf 'Nenhum recurso Docker deste projeto foi encontrado. Nada foi removido.\n'
  exit 0
fi

printf 'Recursos que pertencem a esta aplicacao:\n'
printf '  containers: %d\n' "${#todos_containers[@]}"
printf '  volumes:    %d\n' "${#volumes_do_projeto[@]}"
printf '  redes:      %d\n' "${#redes_do_projeto[@]}"
printf '\nOs volumes listados serao apagados, incluindo sessoes locais do WhatsApp.\n'
printf 'Outras aplicacoes, imagens e recursos globais do Docker nao serao alterados.\n\n'

if [[ "$forcar" != true ]]; then
  read -r -p "Digite ${CONFIRMACAO} para continuar: " resposta
  [[ "$resposta" == "$CONFIRMACAO" ]] || falhar "Operacao cancelada."
fi

if ((${#containers_em_execucao[@]})); then
  printf 'Parando %d container(s) desta aplicacao...\n' "${#containers_em_execucao[@]}"
  docker container stop "${containers_em_execucao[@]}"
fi

if ((${#todos_containers[@]})); then
  printf 'Removendo %d container(s) desta aplicacao...\n' "${#todos_containers[@]}"
  docker container rm -f "${todos_containers[@]}"
fi

if ((${#volumes_do_projeto[@]})); then
  printf 'Removendo %d volume(s) desta aplicacao...\n' "${#volumes_do_projeto[@]}"
  docker volume rm -f "${volumes_do_projeto[@]}"
fi

if ((${#redes_do_projeto[@]})); then
  printf 'Removendo %d rede(s) interna(s) desta aplicacao...\n' "${#redes_do_projeto[@]}"
  docker network rm "${redes_do_projeto[@]}"
fi

printf '\nAplicacao removida do Docker. Codigo, .env, backups, imagens e outras aplicacoes foram preservados.\n'
