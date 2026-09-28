#!/usr/bin/env bash
# migration-populacao.sh — a POPULAÇÃO da pergunta "esse número de migration já
# foi usado ou reservado?" (issue #1273).
#
# ## Por que isto é uma biblioteca, e não mais uma cópia
#
# Oito lugares do repo respondiam a essa pergunta, e cada um media um recorte
# menor que o da pergunta (issue #1273): a main de um FORK em vez da main do
# produto, só branches locais sem os PRs abertos, cabeças já buscadas de PRs
# FECHADOS, o DISCO em vez da main atual, e uma cópia VELHA da cabeça de um PR.
# Cada recorte era uma reimplementação da mesma função — e uma regra que diverge
# oito vezes é a assinatura de que ela precisa de UM lugar só.
#
# A referência do padrão é `scripts/checar-colisao-de-migration.sh` (o #1269):
# a mesma âncora de NNNN, a mesma lista de PRs ABERTOS (nunca o curinga
# refs/pull/*, que persiste depois do fechamento), e o mesmo "NÃO MEDIDO"
# declarado em vez de silêncio. Este arquivo é a parte que hooks locais e
# pré-voo podem usar sem ir à rede; o script de CI, que pode ir, continua
# medindo também as cabeças dos PRs abertos.
#
# ## Uso
#
#   source scripts/migration-populacao.sh
#   ref="$(pop_main_do_produto)"        # a main do PRODUTO, ou nada + rc 1
#   pop_refs_de_outrem "$ref"           # a população local de refs
#   pop_migrations "$ref" $(pop_refs_de_outrem "$ref")   # "<ref> <arquivo>"
#   ... | pop_nnnn_de                   # só o NNNN, com a âncora certa
#
# ## Ausência da biblioteca: degrada, não quebra
#
# Quem chama (hooks de pre-commit, pré-voo) faz `source` com `|| true` e, sem
# este arquivo, mantém a população antiga e DIZ que é a antiga. Um hook que
# encolhe o universo sem dizer é o defeito que esta issue corrige; então a
# ausência nunca é silenciosa, e nunca vira bloqueio novo: sem a biblioteca o
# comportamento é byte-a-byte o de antes, mais uma linha declarando.
#
# O `guard-hooks-atualizados.sh` (primeiro do dispatcher) compara `loop/hooks/`
# com a `origin/main`; esta biblioteca mora fora dele porque ela não é um hook.
# Isso é seguro pelo motivo declarado: hook e biblioteca viajam no MESMO
# commit, então um checkout nunca tem o hook novo com a biblioteca velha — e
# quando falta a biblioteca, o caminho de declaração é o de antes.
#
# ## O que aqui NÃO cabe, e por quê
#
# Os PRs ABERTOS não entram: hooks de pre-commit não vão à rede. O que este
# arquivo faz é entregar a metade que é LOCAL e nomear o que ficou de fora,
# com o comando que cobre o resto (`pnpm checar:colisao-de-migration`). Um hook
# que trava commit por falta de rede troca um risco raro por um travamento
# diário — o mesmo critério do `guard-hooks-atualizados.sh` (§"O que este
# guard NÃO faz, declarado").

# ─────────────────────────────────────────────────────────────────────────────
# pop_slug_de <url> — "dono/repo" em minúsculas, sem esquema/host e sem ".git".
# A URL vem CRUA de `git config --get remote.<n>.url`: `git remote get-url` já
# aplica o insteadOf, e o insteadOf é justamente o que faz um fork parecer o
# principal. (ssh `git@github.com:dono/repo.git` e https caem nos dois mesmos.)
pop_slug_de() {
  printf '%s' "${1:-}" | tr 'A-Z' 'a-z' \
    | sed -E 's#^.*github\.com[:/]+##; s#\.git$##; s#/+$##'
}

# pop_main_do_produto — a ref que é a main do REPOSITÓRIO PRINCIPAL.
#
# A pergunta "este número já foi usado?" é sobre o PRODUTO, não sobre o seu
# clone: num fork, a `origin/main` é a main do fork, que pode estar atrás da do
# principal (medido no caso da #1273: fork parado em 0323, principal já em
# 0324, e o hook dizia "livre" com exit 0).
#
# O remoto que aponta para o repositório principal vale com QUALQUER nome
# (`origin`, `upstream`, `produto`) — é a URL que decide, não o nome.
#
# Sai 1 (e imprime nada) quando nenhum remoto é o principal. O chamador
# ESCOLHE o que fazer: quem só tem remotos de fork declara NÃO MEDIDO; quem
# está em fixture sem rede nenhuma (nenhum remoto de GitHub) continua medindo o
# que já media.
# ─────────────────────────────────────────────────────────────────────────────
pop_main_do_produto() {
  local r url slug
  for r in $(git remote 2>/dev/null); do
    url="$(git config --get "remote.$r.url" 2>/dev/null || true)"
    [ -n "$url" ] || continue
    slug="$(pop_slug_de "$url")"
    # Os DOIS padrões: o slug exato, e o slug com algum caminho antes dele (uma
    # URL com host/prefixo que o `sed` não tirou). Só o de `*/` NÃO casa o slug
    # exato — `*/x` exige a barra — e isso devolvia vazio num clone cujo remoto
    # do produto estava certinho.
    case "$slug" in
      melgarafael/deskcommcrm | */melgarafael/deskcommcrm)
        printf '%s/main\n' "$r"; return 0 ;;
    esac
  done
  return 1
}

# pop_repo_do_produto — "dono/repo" do principal, para o `gh` (`--repo`).
# As mesmas duas formas de slug do `pop_main_do_produto`, pelo mesmo motivo.
pop_repo_do_produto() {
  local r url slug
  for r in $(git remote 2>/dev/null); do
    url="$(git config --get "remote.$r.url" 2>/dev/null || true)"
    [ -n "$url" ] || continue
    slug="$(pop_slug_de "$url")"
    case "$slug" in
      melgarafael/deskcommcrm | */melgarafael/deskcommcrm)
        printf 'melgarafael/DeskcommCRM\n'; return 0 ;;
    esac
  done
  return 1
}

# pop_tem_remoto_de_github — existe algum remoto de GitHub (mesmo de fork)?
# Serve para distinguir "clone de fork sem o remoto do principal" (que precisa
# declarar NÃO MEDIDO) de "fixture sem nenhum remoto" (que só tem o que tem).
pop_tem_remoto_de_github() {
  local url
  for url in $(git remote 2>/dev/null); do
    case "$(git config --get "remote.$url.url" 2>/dev/null || true)" in
      *github.com*) return 0 ;;
    esac
  done
  return 1
}

# ─────────────────────────────────────────────────────────────────────────────
# pop_refs_de_outrem <base> — as refs cujas migrations entram na conta local.
#
#   * a BASE entra sempre que resolver: é a main do produto.
#   * `refs/heads` e `refs/remotes` entram JUNTAS. Só as locais (o
#     `git branch` de antes) deixava de fora a branch que só existe no remoto
#     (a de outra máquina, a do fork de um colega).
#   * as cópias de PR em `refs/remotes/[<remoto>/]pr/N` ficam DE FORA (as duas
#     formas: a triagem busca em `refs/remotes/pr/N`, 1336 no clone do
#     mantenedor em 27/09/2026). Por isso o 0269 do #965, que vivia só na
#     cópia `refs/remotes/origin/pr/965`, NÃO entra aqui: elas são cópias
#     de cabeças, não PRs abertos, e sobrevivem ao fechamento do PR (medido no
#     clone do mantenedor em 19/09/2026: 965 cabeças contra 43 PRs abertos).
#     Medi-las traria de volta, pela porta dos fundos, o número de um PR morto
#     — o que é exatamente o defeito que o #1269 fechou no script de CI.
#   * `refs/remotes/*/HEAD` é ponteiro de conveniência, nunca um dono.
#   * a ref que resolve para o MESMO commit da base (já medida) ou do HEAD (o
#     PR de quem roda) sai da conta, senão a varredura acusa o autor de colidir
#     com a própria branch (armadilha da #1155).
# ─────────────────────────────────────────────────────────────────────────────
pop_refs_de_outrem() {
  local base="${1:-}"
  local bc hc
  bc="$(git rev-parse -q --verify "${base}^{commit}" 2>/dev/null || true)"
  hc="$(git rev-parse -q --verify "HEAD^{commit}" 2>/dev/null || true)"
  git for-each-ref --format='%(objectname) %(refname)' refs/heads refs/remotes 2>/dev/null \
    | awk -v b="$bc" -v h="$hc" '
        $1 != b && $1 != h && $2 !~ /\/HEAD$/ \
          && $2 !~ /^refs\/remotes\/(.+\/)?pr\/[0-9]+$/ { print $2 }'
  [ -n "$base" ] || return 0
  git rev-parse -q --verify "${base}^{commit}" >/dev/null 2>&1 && printf '%s\n' "$base"
  return 0
}

# ─────────────────────────────────────────────────────────────────────────────
# pop_migrations <rev>... — "<rev> <nome do arquivo>", a lista INTEIRA de
# supabase/migrations de cada rev, em três processos para quantas revs houver.
#
# Por que não um `git ls-tree` por ref: no clone do mantenedor (188 heads + 337
# remotes) são 525 processos, e o `git branch --format=… | while` do hook antigo
# reescrevia a lista a cada volta. Aqui: `cat-file --batch-check` resolve as
# árvores de supabase/migrations de TODAS as revs numa chamada; as árvores
# ÚNICAS são listadas por um `diff-tree` contra a árvore vazia, em outra; e o
# awk cola cada rev à sua árvore. Revs que são o MESMO commit (mesma árvore)
# compartilham a listagem — que é o caso comum num clone com muitas branches.
#
# Como o git resolve QUALQUER revisão, `HEAD` e a base entram na mesma chamada,
# sem caso especial.
#
# Rev que não resolve, ou que não tem supabase/migrations, responde `missing` e
# não aparece. Isso é "não há o que medir" (a árvore não existe), e não o NÃO
# MEDIDO de uma cabeça de PR que não pôde ser buscada — esse caso é do script de
# CI, que NOMEIA o PR em vez de pulá-lo calado.
# ─────────────────────────────────────────────────────────────────────────────
pop_migrations() {
  [ "$#" -gt 0 ] || return 0
  local tmp vazia
  tmp="$(mktemp 2>/dev/null)" || return 0
  # "<rev>:supabase/migrations" → a ÁRVORE de cada rev, num processo só. O `paste`
  # cola a lista de revs na resposta, que o `cat-file` não sabe fazer sozinho.
  printf '%s:supabase/migrations\n' "$@" \
    | git cat-file --batch-check='%(objectname) %(objecttype)' 2>/dev/null \
    | paste -d' ' <(printf '%s\n' "$@") - \
    | awk '$3 == "tree" { print $1, $2 }' > "$tmp" || true
  [ -s "$tmp" ] || { rm -f "$tmp"; return 0; }
  # As árvores ÚNICAS contra a árvore VAZIA listam cada árvore inteira, e
  # `diff-tree --stdin` faz isso num processo para quantas forem. Revs que são o
  # MESMO commit compartilham a listagem — que é o caso comum num clone com
  # muita branch. Este é o mesmo caminho do #1269 (`nomes_por_arvore`), que foi
  # medido no clone do mantenedor (525 refs): um `ls-tree` por ref eram 525
  # processos, e a lista era reescrita a cada volta do `while`.
  vazia="$(git hash-object -t tree /dev/null)"
  cut -d' ' -f2 "$tmp" | sort -u | sed "s#^#$vazia #" \
    | git diff-tree -r --name-only --stdin 2>/dev/null \
    | awk -v v="$vazia" '$1 == v && NF == 2 { a = $2; next } { print a, $0 }' > "$tmp.nomes"
  # "$tmp" = "<rev> <árvore>"; "$tmp.nomes" = "<árvore> <nome>", uma linha por
  # arquivo. A junção é pela ÁRVORE (é o que o diff-tree devolveu) e a SAÍDA sai
  # em DOIS campos "<rev> <nome>" — quem consome chega ao nome com
  # `cut -d' ' -f2-`, e um terceiro campo viraria parte do nome dele.
  awk 'NR == FNR { arvores[$1] = arvores[$1] (arvores[$1] ? "\n" : "") $2; next }
       ($2 in arvores) { m = split(arvores[$2], l, "\n");
         for (i = 1; i <= m; i++) if (l[i] != "") print $1, l[i] }' \
    "$tmp.nomes" "$tmp"
  rm -f "$tmp" "$tmp.nomes"
  return 0
}

# ─────────────────────────────────────────────────────────────────────────────
# pop_nnnn_de — stdin com NOMES de migration (com ou sem pasta, e com ou sem o
# "<rev> " na frente, como sai de `pop_migrations`), stdout só com os NNNN, na
# posição certa do nome canônico. O `cut -f2-` é o que faz as duas formas
# entrarem: com nome solto ele é identidade.
#
# A âncora `^[0-9]{14}_([0-9]{4})_` é a mesma do #1269 (`nnnn_das`) e o mesmo
# motivo: `grep -oE '_[0-9]{4}_'` e `sed -E 's/.*_([0-9]{4})_.*/\1/'` pegam
# qualquer grupo de 4 dígitos entre `_`, inclusive um que esteja no SLUG. Com
# `…_0326_relatorio_2024_anual.sql` a extração solta dá teto 2024 e esconde
# uma duplicata real de 0326; e o `s#.*/#` antes do `sed` é obrigatório porque
# o caminho com pasta (`supabase/migrations/…`) não casa a âncora (medido: 0
# linhas de saída).
# ─────────────────────────────────────────────────────────────────────────────
pop_nnnn_de() { pop_campos | sed 's#.*/##' | sed -nE 's/^[0-9]{14}_([0-9]{4})_.*$/\1/p'; }

# pop_campos — stdin no formato de `pop_migrations` ("<rev> <nome>"), stdout só
# com os NOMES. Sem ele, todo teste de colisão teria de lembrar de tirar a
# ref da frente, e um `^` de âncora casaria a linha errada em silêncio.
pop_campos() { cut -d' ' -f2-; }

# pop_teto_da_populacao — o MAIOR NNNN já usado na população que entrou.
pop_teto_da_populacao() { pop_nnnn_de | sort -n | tail -1; }

# pop_tem_nnnn <nnnn> — o NNNN já está em uso na população? Sai 0 se sim.
# Entrada: a lista de `pop_migrations` ("<ref> <nome>"). O padrão casa o NNNN na
# POSIÇÃO do nome canônico e não qualquer "_NNNN_": é a mesma âncora de
# `pop_nnnn_de`, e é ela que impede 0400 de casar em `…_0400_` e também
# `0400` de casar no meio de `_10400_`.
pop_tem_nnnn() { pop_campos | grep -qE "[0-9]{14}_${1}_"; }

# pop_ts_em_uso <timestamp> — o instantâneo já está em uso? Mesma posição, outro
# campo: o Supabase usa o timestamp como identidade da migration.
pop_ts_em_uso() { pop_campos | grep -qE "^${1}_[0-9]{4}_"; }

# pop_dica_proximo_livre <nnnn> <base> <populacao> — a dica de renumeração.
#
# A dica anterior ("Próximo livre: … | tail -1") era DUAS coisas erradas de uma
# vez: devolvia o MAIOR número já usado (não o próximo livre — 0335, que já
# existia na main, era declarado "livre"), e media só a `origin/main` com um `sed`
# guloso que pegava o número do slug. Agora devolve o MAIOR + 1, contado sobre a
# MESMA população que o hook confere, e diz sobre qual população foi.
pop_dica_proximo_livre() { # $1 = o NNNN em colisão, $2 = base, $3 = população
  local colidindo="$1" base="${2:-}" pop="${3:-}"
  local teto proximo
  teto="$(pop_nnnn_de <<<"$pop" | sort -n | tail -1)"
  if [ -z "$teto" ]; then
    echo "  Nenhuma migration com NNNN entrou na população medida; troque o NNNN e o timestamp e meça de novo."
  else
    proximo="$(printf '%04d' $((10#$teto + 1)))"
    echo "  Teto medido sobre a população do próprio hook${base:+ (base '$base')}: NNNN=${teto} → próximo livre ${proximo}."
    [ "$proximo" = "$colidindo" ] && \
      echo "  (o número que você tentou é o próximo livre da população; o que está tomado é o de outra branch ou de um PR aberto)"
  fi
  pop_aviso_populacao "$base" | sed 's/^/  /'
}

# pop_aviso_populacao — a linha que DECLARA o que a conta não cobriu.
# População sem escopo declarado é o defeito que a #1155 registrou: número sem
# régua declarada é número que alguém renumera errado.
pop_aviso_populacao() { # $1 = "base" ou vazio; $2 = nome da base
  local base="${1:-}" nome="${2:-origin/main}"
  if [ -z "$base" ]; then
    printf 'NÃO MEDIDO: a main do PRODUTO (remoto que aponta para melgarafael/DeskcommCRM) não está neste clone.\n'
  fi
  printf 'PRs ABERTOS (inclusive de fork) NÃO foram medidos aqui: hook e pré-voo não vão à rede.\n'
  printf '  Para medir também os PRs abertos: pnpm checar:colisao-de-migration (roda depois do commit).\n'
}
