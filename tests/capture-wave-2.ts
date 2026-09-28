/**
 * Wave 2 — o slot: gate de ALTURA CONSTANTE do card (Lei B da §5).
 *
 * Critério, sem margem: `Set(alturas de todos os cards).size === 1`.
 * O card não pode crescer com o dado — título de 2 linhas, valor ausente, tag a
 * mais ou a menos não podem mudar a altura.
 *
 * A mensagem de falha NUNCA é um número solto: lista cada altura distinta com os
 * cards que a têm, para dizer *o que* faz o card crescer, não só *que* cresce.
 *
 * Linha de base da Wave 0 (medida, não estimada): min 116 · max 154 · 38px de
 * variação em 10 cards. É esse 38 que a Wave 2 tem de zerar.
 *
 * Run: E2E_PORT=3020 npx tsx tests/capture-wave-2.ts
 */

import AxeBuilder from "@axe-core/playwright";
import { chromium, type Page } from "@playwright/test";
import * as fs from "node:fs";

import { CARD_ATTR, EVIDENCE, gotoBoard, login, shotPage } from "./qa-helpers";

const USER = process.env.E2E_USER ?? "manager";
const BASELINE_VARIACAO_PX = 38;

interface CardMedida {
  titulo: string;
  altura: number;
  largura: number;
  elementos: number;
}

async function medirCards(page: Page): Promise<CardMedida[]> {
  // O dev server recompila enquanto alguém edita o card: o board remonta e some
  // por instantes. Esperar o card reaparecer é determinístico; medir sem esperar
  // produz "board vazio" que é artefato de ambiente, não defeito do produto.
  await page
    .locator(`[${CARD_ATTR}]`)
    .first()
    .waitFor({ state: "visible", timeout: 20_000 });

  const medidas = await page.evaluate((attr: string) => {
    const out: { titulo: string; altura: number; largura: number; elementos: number }[] = [];
    for (const card of Array.from(document.querySelectorAll(`[${attr}]`))) {
      const r = card.getBoundingClientRect();
      const h3 = card.querySelector("h3");
      // "Elementos" = filhos diretos com caixa visível, o orçamento da Lei B.
      let elementos = 0;
      for (const filho of Array.from(card.children)) {
        const fr = filho.getBoundingClientRect();
        if (fr.width > 0 && fr.height > 0) elementos++;
      }
      out.push({
        titulo: (h3?.textContent ?? card.textContent ?? "").trim().slice(0, 44),
        altura: Math.round(r.height),
        largura: Math.round(r.width),
        elementos,
      });
    }
    return out;
  }, CARD_ATTR);

  if (medidas.length === 0) {
    throw new Error(`[gate] nenhum card [${CARD_ATTR}] no board — nada a medir`);
  }
  return medidas;
}

/** Agrupa por altura para a mensagem dizer O QUE faz o card crescer. */
function relatorioAlturas(cards: CardMedida[]): string {
  const porAltura = new Map<number, string[]>();
  for (const c of cards) {
    porAltura.set(c.altura, [...(porAltura.get(c.altura) ?? []), c.titulo]);
  }
  return [...porAltura.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([h, titulos]) => `    ${String(h).padStart(4)}px — ${titulos.join(" · ")}`)
    .join("\n");
}

/**
 * Medidas reais da linha de base da Wave 0 — as 5 alturas distintas medidas no
 * board antes do slot. Servem ao `DEMO=1`, que imprime a mensagem de falha sem
 * precisar do navegador: o formato do relatório fica auditável mesmo quando o
 * board está fora do ar ou já corrigido.
 */
const BASELINE_WAVE_0: CardMedida[] = [
  { titulo: "Marina Costa — clareamento", altura: 116, largura: 302, elementos: 4 },
  { titulo: "Rogério Paiva — avaliação inicial", altura: 119, largura: 302, elementos: 4 },
  { titulo: "Clínica Vitalis — implantes", altura: 143, largura: 302, elementos: 5 },
  { titulo: "Família Andrade — 4 tratamentos", altura: 143, largura: 302, elementos: 5 },
  { titulo: "Bruno Tavares — protocolo superior", altura: 143, largura: 302, elementos: 5 },
  { titulo: "Caio Ribeiro — dor de dente", altura: 143, largura: 302, elementos: 5 },
  { titulo: "Patrícia Nunes — prótese fixa", altura: 143, largura: 302, elementos: 5 },
  { titulo: "Helena Marques — ortodontia adulto", altura: 145, largura: 302, elementos: 5 },
  { titulo: "Grupo Odonto Sul — contrato corporativo", altura: 154, largura: 302, elementos: 5 },
  { titulo: "Clínica Vitalis — pacote completo de implant", altura: 154, largura: 302, elementos: 5 },
];

/** A mensagem de falha do gate. Nunca um número solto: altura → quais cards. */
function mensagemFalha(cards: CardMedida[]): string {
  const alturas = new Set(cards.map((c) => c.altura));
  const min = Math.min(...alturas);
  const max = Math.max(...alturas);
  return (
    `FALHA [gate altura] ${alturas.size} alturas distintas em ${cards.length} cards — esperado 1.\n` +
    `    variação ${max - min}px (min ${min}, max ${max}); linha de base da Wave 0 era ${BASELINE_VARIACAO_PX}px\n` +
    relatorioAlturas(cards)
  );
}

async function main(): Promise<void> {
  // `DEMO=1`: imprime a mensagem de falha sobre a linha de base medida da Wave 0,
  // sem navegador. Prova o FORMATO do relatório quando não há board para reprovar.
  if (process.env.DEMO === "1") {
    console.info("=== como o gate reprova (dados reais da linha de base da Wave 0) ===");
    console.info(mensagemFalha(BASELINE_WAVE_0));
    return;
  }

  fs.mkdirSync(EVIDENCE, { recursive: true });
  const browser = await chromium.launch();
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 } })
  ).newPage();

  await login(page, USER);
  await gotoBoard(page);

  // AUTOTESTE DO INSTRUMENTO (`SELFCHECK=1`): infla um card por CSS e exige que
  // o gate REPROVE. Um gate que só foi visto passando não é gate — é carimbo.
  // Isto não toca código de produção: é estilo injetado na página do teste.
  if (process.env.SELFCHECK === "1") {
    await page.addStyleTag({
      content: `[${CARD_ATTR}]:first-of-type { padding-bottom: 40px !important; }`,
    });
    await page.waitForTimeout(300);
    const cardsFalsos = await medirCards(page);
    const alturasFalsas = new Set(cardsFalsos.map((c) => c.altura));
    const reprovou = alturasFalsas.size > 1;
    console.info(
      reprovou
        ? `PASS  [autoteste] o gate REPROVA quando as alturas divergem — ${alturasFalsas.size} alturas distintas detectadas:\n${relatorioAlturas(cardsFalsos)}`
        : `FALHA [autoteste] inflei um card e o gate NÃO percebeu — o instrumento está cego`,
    );
    await browser.close();
    process.exit(reprovou ? 0 : 1);
  }

  await shotPage(page, "wave-2-board-depois.png");

  const cards = await medirCards(page);
  const alturas = new Set(cards.map((c) => c.altura));
  const min = Math.min(...alturas);

  console.info(`[medida] ${cards.length} cards no board`);
  console.info(relatorioAlturas(cards));

  const alturaConstante = alturas.size === 1;
  console.info(
    alturaConstante
      ? `PASS  [gate altura] altura constante: ${min}px em ${cards.length} cards (linha de base era ${BASELINE_VARIACAO_PX}px de variação)`
      : mensagemFalha(cards),
  );

  // Lei B também fixa o orçamento de elementos: 5, contados como filhos diretos
  // visíveis do card. Reportado junto porque é o outro eixo do mesmo contrato.
  const acimaDoOrcamento = cards.filter((c) => c.elementos > 5);
  console.info(
    acimaDoOrcamento.length === 0
      ? `PASS  [gate elementos] nenhum card acima de 5 elementos (máx observado: ${Math.max(...cards.map((c) => c.elementos))})`
      : `FALHA [gate elementos] ${acimaDoOrcamento.length} card(s) acima de 5:\n` +
          acimaDoOrcamento.map((c) => `    ${c.elementos} elementos — ${c.titulo}`).join("\n"),
  );

  // Cenário 7 da §7: o card de borda (título de 123 caracteres, valor nulo e 8
  // tags) não pode quebrar o layout — mesma altura dos demais, sem vazar largura.
  const bordas = [
    { nome: "título de 123 caracteres", chave: "Clínica Vitalis — pacote completo" },
    { nome: "valor nulo", chave: "Rogério Paiva" },
    { nome: "8 tags", chave: "Família Andrade" },
  ];
  const larguraPadrao = cards[0]!.largura;
  const quebras: string[] = [];
  for (const b of bordas) {
    const c = cards.find((x) => x.titulo.includes(b.chave.slice(0, 22)));
    if (!c) {
      quebras.push(`${b.nome}: card não encontrado no board`);
      continue;
    }
    if (c.altura !== min) quebras.push(`${b.nome}: altura ${c.altura}px ≠ ${min}px dos demais`);
    if (c.largura !== larguraPadrao) {
      quebras.push(`${b.nome}: largura ${c.largura}px ≠ ${larguraPadrao}px dos demais`);
    }
  }
  console.info(
    quebras.length === 0
      ? `PASS  [cenário 7] título de 123 chars, valor nulo e 8 tags não quebram o layout (todos ${min}×${larguraPadrao}px)`
      : `FALHA [cenário 7] ${quebras.length} quebra(s):\n${quebras.map((q) => `    ${q}`).join("\n")}`,
  );

  // axe-core: o número que o regente quer com build novo. Era 11 nós serious.
  const axe = await new AxeBuilder({ page }).analyze();
  const graves = axe.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  const nested = axe.violations.find((v) => v.id === "nested-interactive");
  console.info(
    graves.length === 0
      ? `PASS  [axe] zero violação serious/critical (nested-interactive: ${nested ? `${nested.nodes.length} nós` : "ZERADO, era 11"})`
      : `FALHA [axe] ${graves.length} violação(ões) grave(s): ` +
          graves.map((v) => `${v.impact}:${v.id}(${v.nodes.length} nós)`).join(", "),
  );

  await browser.close();
  if (!alturaConstante || acimaDoOrcamento.length > 0 || quebras.length > 0 || graves.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("❌ Gate da Wave 2 falhou:", err);
  process.exit(1);
});
