#!/usr/bin/env bash
# O comando de extensão do kit PREPARA, e não instala — e isto é uma cerca, não um comentário.
#
# A decisão (DEC-007, escolha 2) foi que o comando seja cliente da mesma porta que a tela usa.
# Medido em `lib/extensions/http.ts:41-93`, essa porta exige sessão com verificação em duas
# etapas, que um script no servidor não tem. Dar uma a ele significaria poder de plataforma
# atrás de um segredo em arquivo — a "segunda porta" que a decisão recusou.
#
# O risco real não é o script de hoje: é o de amanhã. Alguém com pressa acrescenta um `curl`
# para a rota de instalação, ou pega a service key do `.env` e escreve no banco, e a partir dali
# a auditoria passa a registrar instalação atribuída a quem não a fez. Este arquivo reprova isso.
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="${RAIZ}/hostgator-setup-kit/extensao.sh"
falhas=0

ok()   { echo "  ok   — $1"; }
erro() { echo "  FALHA — $1" >&2; falhas=$((falhas + 1)); }

echo "extensao.sh — cerca e comportamento"

# ── A CERCA ─────────────────────────────────────────────────────────────────
for proibido in \
  '/api/v1/extensions/install' \
  '/api/v1/extensions/catalogs' \
  'SUPABASE_SERVICE_ROLE_KEY' \
  'INTERNAL_CRON_SECRET' \
  'psql'
do
  if grep -q "$proibido" "$SCRIPT"; then
    erro "o script passou a usar '$proibido' — instalar é pela tela, com 2 etapas e autoria"
  else
    ok "não usa '$proibido'"
  fi
done

# Controle positivo da sonda: se o grep estiver quebrado, tudo acima passa sem medir nada.
if grep -q 'catalogo.json' "$SCRIPT"; then
  ok "controle: a sonda enxerga texto que EXISTE no script"
else
  erro "controle falhou — o grep não achou 'catalogo.json', que existe; as checagens acima não valem"
fi

# ── COMPORTAMENTO ───────────────────────────────────────────────────────────
saida="$(mktemp)"; trap 'rm -f "$saida"' EXIT

if EXTENSOES_ORIGEM="https://origem.invalida.test" PROJECT_DIR="$(dirname "$saida")" \
   bash "$SCRIPT" listar >"$saida" 2>&1; then
  erro "origem inalcançável devolveu sucesso — falha de rede tem de falhar"
else
  ok "origem inalcançável devolve erro (e não sucesso silencioso)"
fi
grep -q "Não consegui baixar o catálogo" "$saida" \
  && ok "a mensagem diz o que houve, em português" \
  || erro "a mensagem de falha não explica nada a quem opera"

# A validação de FORMA, exercida direto — sem rede.
# A primeira versão deste caso chamava `baixar_para` com um caminho local e passava pelo
# motivo errado: o `curl` recusa o protocolo antes de a validação rodar, então tirar a
# validação inteira do script NÃO deixava este teste vermelho. Medido com sabotagem.
eval "$(sed -n '/^catalogo_tem_forma()/,/^}/p' "$SCRIPT")"

bom="$(mktemp)"; echo '{"format_version":1,"origin":"https://x.test","revision":1,"entries":[]}' > "$bom"
ruim="$(mktemp)"; echo '{"qualquer":"coisa"}' > "$ruim"
vazio="$(mktemp)"; : > "$vazio"

catalogo_tem_forma "$bom"  && ok "catálogo com a forma certa é aceito" \
                           || erro "controle positivo falhou: um catálogo VÁLIDO foi recusado"
catalogo_tem_forma "$ruim" && erro "JSON sem forma de catálogo foi aceito" \
                           || ok "JSON sem forma de catálogo é recusado"
catalogo_tem_forma "$vazio" && erro "arquivo vazio foi aceito" \
                            || ok "arquivo vazio é recusado"
rm -f "$bom" "$ruim" "$vazio"

bash -n "$SCRIPT" && ok "sintaxe válida"

if [ "$falhas" -gt 0 ]; then echo "FALHOU: $falhas"; exit 1; fi
echo "tudo verde"
