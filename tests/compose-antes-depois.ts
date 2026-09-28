/**
 * Cenário 8 da §7 — o antes/depois do board, lado a lado numa imagem só.
 *
 * Compõe `wave-0-board-antes.png` e `wave-2-board-depois.png` numa página HTML
 * e fotografa o resultado. Sem dependência de imagem: o navegador que já está
 * no projeto é o compositor.
 *
 * Run: npx tsx tests/compose-antes-depois.ts
 */

import { chromium } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

import { EVIDENCE } from "./qa-helpers";

const ANTES = path.join(EVIDENCE, "wave-0-board-antes.png");
const DEPOIS = path.join(EVIDENCE, "wave-2-board-depois.png");
const SAIDA = path.join(EVIDENCE, "wave-2-antes-depois.png");

function dataUri(file: string): string {
  if (!fs.existsSync(file)) throw new Error(`[cenário 8] falta a captura: ${file}`);
  return `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;
}

async function main(): Promise<void> {
  const html = `<!doctype html>
<meta charset="utf-8">
<style>
  body { margin: 0; background: #f6f5f2; font: 14px/1.4 system-ui, sans-serif; color: #2b2a27; }
  .par { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; padding: 24px; }
  figure { margin: 0; }
  figcaption { font-weight: 600; margin-bottom: 8px; }
  figcaption span { font-weight: 400; color: #6b6a66; }
  img { width: 100%; border: 1px solid #d8d6d0; border-radius: 6px; display: block; }
</style>
<div class="par">
  <figure>
    <figcaption>ANTES — Wave 0 <span>· 5 alturas distintas, 116→154px (38px de variação) · tags no card</span></figcaption>
    <img src="${dataUri(ANTES)}">
  </figure>
  <figure>
    <figcaption>DEPOIS — Wave 2 <span>· altura constante 144px em 12 cards · tags fora · quem esfriou aparece</span></figcaption>
    <img src="${dataUri(DEPOIS)}">
  </figure>
</div>`;

  const browser = await chromium.launch();
  const page = await (
    await browser.newContext({ viewport: { width: 2400, height: 1000 } })
  ).newPage();
  await page.setContent(html);
  await page.waitForLoadState("networkidle").catch(() => null);
  await page.screenshot({ path: SAIDA, fullPage: true });
  await browser.close();
  console.info(`[evidencia] evidence/${path.basename(SAIDA)} — antes/depois lado a lado`);
}

main().catch((err) => {
  console.error("❌ Composição antes/depois falhou:", err);
  process.exit(1);
});
