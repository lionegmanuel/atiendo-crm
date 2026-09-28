#!/usr/bin/env bash
# Valida um pacote de extensão contra o schema REAL do host — o mesmo módulo que a
# instalação usa (lib/extensions/manifest.ts), não uma cópia das regras.
#
#   bash .agents/skills/deskcomm-extensao/scripts/validar-pacote.sh caminho/do/pacote.json
#
# Sai 0 quando o pacote passa por parseManifest() e por checkCompatibility(); sai 1
# quando é recusado, e imprime o que a entrada de catálogo teria de dizer (sha256 e
# byte_length) para quem for publicá-lo.
set -euo pipefail

pacote="${1:-}"
if [ -z "$pacote" ]; then
  echo "uso: bash .agents/skills/deskcomm-extensao/scripts/validar-pacote.sh <pacote.json>" >&2
  exit 2
fi
if [ ! -f "$pacote" ]; then
  echo "não achei o arquivo: $pacote" >&2
  exit 2
fi
pacote="$(cd "$(dirname "$pacote")" && pwd)/$(basename "$pacote")"

raiz="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$raiz" ] || [ ! -f "$raiz/lib/extensions/manifest.ts" ]; then
  echo "NÃO MEDIDO — rode de dentro de um clone do DeskcommCRM (com as dependências instaladas)." >&2
  echo "O schema do pacote mora em lib/extensions/manifest.ts; sem ele não há contra o que validar." >&2
  exit 2
fi
cd "$raiz"

pnpm exec tsx -e '
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { EXTENSION_LIMITS, checkCompatibility, parseManifest } from "./lib/extensions/manifest";
import { destinoDaCapacidade, permissaoDaCapacidade } from "./lib/extensions/capacidades";

const caminho = process.argv[1];
const bytes = readFileSync(caminho);
console.info(`arquivo: ${caminho}`);
console.info(`bytes: ${bytes.byteLength} (teto do pacote: ${EXTENSION_LIMITS.packageBytes})`);

let manifesto;
try {
  manifesto = parseManifest(new Uint8Array(bytes));
} catch (erro) {
  console.error(`RECUSADO pelo schema: ${erro instanceof Error ? erro.message : String(erro)}`);
  console.error("O schema é estrito: chave desconhecida, chave repetida, texto vazio, valor fora");
  console.error("do vocabulário e estouro de limite recusam o pacote inteiro, sem apontar o campo.");
  console.error("Compare campo a campo com references/contrato-do-pacote.md.");
  process.exit(1);
}

const compat = checkCompatibility(manifesto);
if (!compat.compatible) {
  console.error(`RECUSADO por compatibilidade: ${compat.reason}`);
  process.exit(1);
}

console.info(`identidade: ${manifesto.publisher}/${manifesto.name} ${manifesto.version}`);
console.info(`host_api declarado: min=${manifesto.host_api.min} max=${manifesto.host_api.max}`);
console.info(`permissões: ${manifesto.permissions.join(", ")}`);
for (const card of manifesto.contributions.crm_cards) {
  const cap = card.action.capability;
  console.info(
    `card ${card.id}: ${cap} -> ${destinoDaCapacidade(cap)} (coberto por ${permissaoDaCapacidade(cap)})`,
  );
}
console.info("");
console.info("VÁLIDO — o pacote passa no parser e na compatibilidade deste host.");
console.info("Entrada de catálogo correspondente (os bytes são o que vale; não reformate depois):");
console.info(
  JSON.stringify(
    {
      publisher: manifesto.publisher,
      name: manifesto.name,
      version: manifesto.version,
      license: manifesto.license,
      host_api: manifesto.host_api,
      display: manifesto.display,
      permissions: manifesto.permissions,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byte_length: bytes.byteLength,
    },
    null,
    2,
  ),
);
' "$pacote"
