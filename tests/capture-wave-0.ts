/**
 * Wave 0 — captura da linha de base visual do board CRM Vivo.
 *
 * Navega como usuário real (login pela tela, cliques até o board) e grava os
 * PNGs em evidence/ na raiz do worktree (§7 do briefing). É contra estas fotos
 * que a Wave 2 (o slot) vai ser julgada.
 *
 * Usa `tests/qa-helpers.ts` — mesma máquina de login, navegação e recorte de
 * card dos capturadores das waves seguintes. Antes este arquivo tinha cópia
 * própria dessas funções, com o locator antigo `getByRole("heading")`, que
 * quebra por corrida de hidratação (o card é `role="button"` e o `<h3>` perde
 * o papel de heading). Uma cópia divergente é o começo do teste que mente.
 *
 * Run: E2E_PORT=3020 npx tsx tests/capture-wave-0.ts
 */

import { chromium } from "@playwright/test";
import * as fs from "node:fs";

import { CARD_ATTR, EVIDENCE, gotoBoard, login, shotCard, shotPage } from "./qa-helpers";

const USER = process.env.E2E_USER ?? "manager";

/** Título do card de 123 caracteres — trunca na tela, então casa por prefixo. */
const LONG_TITLE_PREFIX = "Clínica Vitalis — pacote completo";
const MAIN_CARD = "Clínica Vitalis — implantes";

/** Todos os cards do seed. A variação de altura entre eles é a métrica da Wave 2. */
const CARDS = [
  MAIN_CARD,
  LONG_TITLE_PREFIX,
  "Marina Costa — clareamento",
  "Rogério Paiva — avaliação inicial",
  "Família Andrade — 4 tratamentos",
  "Bruno Tavares — protocolo superior",
  "Helena Marques — ortodontia adulto",
  "Grupo Odonto Sul — contrato corporativo",
  "Caio Ribeiro — dor de dente",
  "Patrícia Nunes — prótese fixa",
];

async function main(): Promise<void> {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const browser = await chromium.launch();
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 } })
  ).newPage();

  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  await login(page, USER);
  await gotoBoard(page);

  await shotPage(page, "wave-0-board-antes.png");
  await shotCard(page, MAIN_CARD, "wave-0-card-antes.png");
  await shotCard(page, LONG_TITLE_PREFIX, "wave-0-card-titulo-longo-antes.png");

  // Medidas por ferramenta, nunca a olho (§7). A altura constante é a promessa
  // da Wave 2 — aqui fica registrado quanto ela varia HOJE.
  const metrics = await page.evaluate(
    ({ titulos, attr }: { titulos: string[]; attr: string }) => {
      const out: { title: string; width: number; height: number }[] = [];
      const cards = Array.from(document.querySelectorAll(`[${attr}]`));
      for (const titulo of titulos) {
        for (const card of cards) {
          if (!(card.textContent ?? "").includes(titulo)) continue;
          const r = card.getBoundingClientRect();
          out.push({
            title: titulo.slice(0, 36),
            width: Math.round(r.width),
            height: Math.round(r.height),
          });
          break;
        }
      }
      return out;
    },
    { titulos: CARDS, attr: CARD_ATTR },
  );

  console.info("[medida] altura de cada card (px):");
  for (const m of metrics) console.info(`   ${String(m.height).padStart(4)}  ${m.title}`);
  const hs = metrics.map((m) => m.height);
  console.info(
    `[medida] altura min=${Math.min(...hs)} max=${Math.max(...hs)} variacao=${Math.max(...hs) - Math.min(...hs)}px em ${hs.length} cards`,
  );

  console.info(
    consoleErrors.length
      ? `[console] ${consoleErrors.length} erro(s): ${consoleErrors.slice(0, 3).map((e) => e.slice(0, 120)).join(" | ")}`
      : "[console] sem erros",
  );

  await browser.close();
  console.info("\n✅ Wave 0 — evidência capturada em evidence/");
}

main().catch((err) => {
  console.error("❌ Captura Wave 0 falhou:", err);
  process.exit(1);
});
