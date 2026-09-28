import { chromium } from "@playwright/test";
import { BASE, login } from "./qa-helpers";

/**
 * Injeta UM 401 na rota do token — o transitório que envenenava o carregamento.
 *
 * ⚠️ SEM `reload`, e a primeira versão desta sonda errava exatamente aí: recarregar
 * a página REINICIALIZA O MÓDULO e zera a memo, que é justamente o estado que o
 * defeito usa. O par saiu `authenticated` dos DOIS lados e não discriminou nada.
 *
 * O cenário real é um SEGUNDO canal no MESMO carregamento: o board leva o 401 e
 * assina anônimo de qualquer jeito (não havia token quando ele precisou); o
 * dossiê, aberto em seguida, é quem revela a diferença — com o conserto ele
 * refaz a tentativa e nasce autenticado; sem o conserto herda a memo envenenada
 * e nasce anônimo também.
 */
async function main(): Promise<void> {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "manager");

  let primeira = true;
  await page.route("**/api/v1/auth/realtime-token", async (route) => {
    if (primeira) {
      primeira = false;
      console.info("   → interceptado: devolvendo 401 (sessão 'ainda estabelecendo')");
      await route.fulfill({ status: 401, body: "{}" });
      return;
    }
    await route.continue();
  });

  await page.goto(`${BASE}/app/pipelines/35bf4ac9-c5e0-4f7d-846a-99b1bcc92d69`, {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(4000);
  // O SEGUNDO canal, no mesmo carregamento: abre o dossiê de um card.
  const card = page.locator("[data-rfd-draggable-id]").first();
  await card.locator("button").first().click();
  await page.waitForTimeout(4000);
  console.info('   → BROWSER ABERTO — medindo agora (25s)');
  await page.waitForTimeout(25_000);
  await browser.close();
}
void main();
