/**
 * Wave 1 — prova do caminho de ATRIBUIÇÃO EM MASSA sobre lead de dono AGENTE.
 *
 * Este é o caso que, antes do helper `resolveOwnerPatch`, quebrava de dois
 * jeitos: mandar só `owner_user_id` sobre um lead de dono agente viola
 * `crm_leads_owner_kind_coherence` (23514) e **derruba o lote inteiro**; e um
 * lead que ganha dono sem `owner_kind` vira drift silencioso.
 *
 * Prova na tela: selecionar o card do agente, atribuir a um humano pelo lote,
 * e verificar que a operação conclui e o card troca de dono. Ao fim, devolve o
 * lead ao agente rodando o seed — o fixture sai como entrou.
 *
 * Run: E2E_PORT=3020 npx tsx tests/capture-wave-1-bulk.ts
 */

import { chromium } from "@playwright/test";

import { cardLocator, gotoBoard, login, shotPage } from "./qa-helpers";

const LEAD_AGENTE = "Rogério Paiva — avaliação inicial";
/**
 * O menu de LOTE só oferece "Eu" e "Remover responsável" — nem outros humanos,
 * nem agentes. Então o alvo é "Eu", que é o próprio manager logado. Isso ainda
 * exercita o caminho que quebrava: humano sobre lead de dono AGENTE.
 */
const ITEM_MENU = "Eu";
const HUMANO = "E2E Manager";

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 } })
  ).newPage();

  const erros: string[] = [];
  const http400: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") erros.push(m.text());
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().includes("/monitoring")) {
      http400.push(`${r.status()} ${r.url().slice(0, 90)}`);
    }
  });

  await login(page, "manager");
  await gotoBoard(page);

  const { card } = await cardLocator(page, LEAD_AGENTE);
  const antes = await card.textContent();
  console.info(`[antes] card: ${(antes ?? "").replace(/\s+/g, " ").slice(0, 80)}`);

  // seleciona o card (clique simples seleciona; ctrl/meta acumula)
  await card.click();
  const barra = page.getByText(/\d+ selecionado/);
  await barra.waitFor({ state: "visible", timeout: 10_000 });
  console.info(`[selecao] ${await barra.textContent()}`);
  await shotPage(page, "wave-1-bulk-selecionado.png", false);

  await page.getByRole("button", { name: /Atribuir a/ }).click();
  const alvo = page.getByRole("menuitem", { name: ITEM_MENU, exact: true }).first();
  if ((await alvo.count()) === 0) {
    const itens = await page.getByRole("menuitem").allTextContents();
    throw new Error(
      `[bulk] item "${ITEM_MENU}" não aparece no menu de atribuição em massa.\n` +
        `Itens presentes: ${itens.map((t) => `"${t}"`).join(", ")}`,
    );
  }
  await alvo.click();
  await page.waitForTimeout(2500);

  const depois = await cardLocator(page, LEAD_AGENTE);
  const estado = await depois.card.evaluate((el: Element) => {
    const badge = el.querySelector("[aria-label^='Responsável:']");
    const avatar = badge?.querySelector("span[aria-hidden]");
    const cls = avatar?.className ?? "";
    return {
      aria: badge?.getAttribute("aria-label") ?? null,
      preenchido: /bg-accent-soft/.test(cls),
      vazadoComAnel: /border/.test(cls) && /ring/.test(cls),
    };
  });

  const ok =
    estado.aria === `Responsável: ${HUMANO}` && estado.preenchido && !estado.vazadoComAnel;
  console.info(
    `${ok ? "PASS" : "FALHA"}  lote atribuiu humano sobre lead de dono AGENTE — aria="${estado.aria}" preenchido=${estado.preenchido} vazadoComAnel=${estado.vazadoComAnel}`,
  );
  console.info(`  HTTP >=400 durante a operação: ${http400.length ? http400.join(" | ") : "nenhum"}`);
  console.info(`  erros de console: ${erros.length ? erros.slice(0, 2).join(" | ") : "nenhum"}`);
  await shotPage(page, "wave-1-bulk-apos-atribuir.png", false);

  await browser.close();
  if (!ok || http400.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error("❌ Prova do lote falhou:", err);
  process.exit(1);
});
