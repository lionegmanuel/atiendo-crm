/**
 * Spike da Fase 3a: roda `deriveTemplateContract` contra os 5 templates REAIS da
 * WABA de teste e imprime o contrato de cada um. Serve para eyeball do desenho
 * antes de escrever o plano — não é teste, é instrumento de decisão.
 *
 *   pnpm exec tsx scripts/spike-template-contract.ts
 */
import { readFileSync } from "node:fs";
import { deriveTemplateContract, describeAddress } from "@/lib/channels/meta/template-contract";

const fixture = JSON.parse(
  readFileSync("tests/fixtures/meta/message-templates.json", "utf8"),
) as { data: { name: string; language: string; components?: unknown[] }[] };

for (const t of fixture.data) {
  const contract = deriveTemplateContract(t as Parameters<typeof deriveTemplateContract>[0]);
  console.info(`\n━━ ${contract.name} (${contract.language}) — ${contract.slots.length} slot(s)`);
  if (contract.slots.length === 0) {
    console.info("   (sem parâmetros — envio não precisa de components[])");
    continue;
  }
  for (const s of contract.slots) {
    const campo =
      s.contextBefore || s.contextAfter
        ? `${s.contextBefore}[ ${s.key} ]${s.contextAfter}`
        : `[ ${s.key} ]`;
    console.info(`   ${describeAddress(s.address).padEnd(26)} ${s.expects.padEnd(12)} ${campo}`);
  }
}
console.info();
