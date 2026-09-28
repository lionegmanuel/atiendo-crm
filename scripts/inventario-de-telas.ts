/**
 * Reconcilia `docs/design-system/screen-flow/03-screen-inventory.md` com o disco.
 *
 * Uso: `pnpm exec tsx scripts/inventario-de-telas.ts`
 *
 * O doc é um PLANO (`version: 0.1`, 2026-04-28), não um mapa do que existe.
 * Este script é o instrumento que diz **onde plano e realidade divergem** — e a
 * saída dele é o que se cola na seção "Reconciliação com o disco" do próprio doc
 * quando alguém for atualizá-la. Ele não reescreve nada.
 *
 * Sai ≠0 quando o instrumento não pode ter medido (conjunto vazio, doc curto
 * demais) ou quando a catraca da lista de não-construído afrouxou. Sai 0 com o
 * relatório impresso no caso normal — divergência plano×disco é o estado
 * esperado de um plano, não um defeito.
 *
 * A lógica mora em `inventario-de-telas.leitura.ts` porque este arquivo varre o
 * disco e chama `process.exit`: importá-lo de um teste rodaria a varredura.
 * Mesmo motivo de `lint-channels.pattern.ts`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  conferirVacuidade,
  lerInventario,
  reconciliar,
  rotasNoDisco,
} from "./inventario-de-telas.leitura";

const DOC = "docs/design-system/screen-flow/03-screen-inventory.md";
const RAIZ_DAS_PAGINAS = "app";

const inventario = lerInventario(readFileSync(DOC, "utf8"));
const rotas = rotasNoDisco(RAIZ_DAS_PAGINAS, (dir) =>
  readdirSync(dir, { withFileTypes: true }).map((e) => ({
    nome: e.name,
    diretorio: e.isDirectory(),
  })),
).sort();

try {
  conferirVacuidade(inventario, rotas);
} catch (erro) {
  console.error(erro instanceof Error ? erro.message : String(erro));
  process.exit(1);
}

const r = reconciliar(inventario, rotas);

console.info(`Inventário: ${inventario.linhas.length} linhas numeradas em ${inventario.secoes.length} seções`);
console.info(`Disco: ${rotas.length} páginas (${join(RAIZ_DAS_PAGINAS, "**/page.tsx")})\n`);

for (const s of inventario.secoes) {
  const marca = s.declarado === s.contadas ? "ok" : `DIVERGE (cabeçalho ${s.declarado})`;
  console.info(`  ${s.letra}. ${s.contadas} linhas — ${marca}`);
}

console.info(`\nPlanejadas e ainda não construídas: ${r.fantasmas.length} linhas`);
for (const l of r.fantasmas) console.info(`  #${l.numero} ${l.rota}`);

console.info(`\nConstruídas fora deste plano: ${r.foraDoInventario.length} páginas`);
for (const rota of r.foraDoInventario) console.info(`  ${rota}`);

const falhas: string[] = [];
if (r.curadas.length > 0) {
  falhas.push(
    `A lista de não-construído tem rota que JÁ existe no disco — ela só encolhe:\n    ` +
      r.curadas.join("\n    ") +
      `\n  Apague a linha da lista em ${DOC}.`,
  );
}
if (r.naoDeclarados.length > 0) {
  falhas.push(
    `Linha do doc sem rota no disco e sem declaração:\n    ` +
      r.naoDeclarados.map((l) => `#${l.numero} ${l.rota}`).join("\n    "),
  );
}
if (r.inventadas.length > 0) {
  falhas.push(`Rota declarada que não tem linha numerada:\n    ` + r.inventadas.join("\n    "));
}

if (falhas.length > 0) {
  console.error(`\n${falhas.join("\n\n  ")}`);
  process.exit(1);
}

console.info("\ninventario-de-telas: ok");
