/**
 * Prova pela TELA da Fase 3a Task 5 (doutrina de QA Visual: `curl` não conta).
 *
 * O que esta jornada tem que provar, e não só "a página abre":
 *   1. o operador chega na tela pelo hub de configurações, clicando;
 *   2. os parâmetros aparecem **derivados**, com o texto ao redor como rótulo —
 *      inclusive o header de mídia, que não tem `{{n}}` nenhum e é justamente o
 *      slot que a contagem ingênua não vê;
 *   3. o botão de sincronizar **faz** o que promete (fala com a Graph API real).
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { expect, test } from "@playwright/test";




const EVIDENCE = path.join(
  process.cwd(),
  process.env.CANAIS_EVIDENCE_DIR ?? "evidence/canais/fase3a/tela",
);
fs.mkdirSync(EVIDENCE, { recursive: true });

/**
 * A tela de templates é admin-only, e o admin da org de e2e tem MFA. Reusa o
 * mesmo fluxo de TOTP da jornada baseline — reimplementar daria um segundo
 * login para manter em sincronia.
 */

test.describe.configure({ mode: "serial" });

test("o operador chega aos templates pela aba do canal oficial", async ({ page }) => {
  // MUDOU DE LUGAR de propósito (2026-07-31): template só existe por causa do
  // canal oficial, então vive como sub-aba dele em Conexões — não como tela solta
  // em Configurações. O redirect da rota antiga é coberto por `conexoes-abas.spec.ts`.
  await page.goto("/app/connections?aba=oficial");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${EVIDENCE}/01-hub-settings.png`, fullPage: true });

  await page.getByRole("tab", { name: /Templates da Meta/i }).click();
  await page.waitForURL(/sub=templates/, { timeout: 20_000 });
  await expect(page.getByTestId("templates-root")).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: `${EVIDENCE}/02-tela-templates.png`, fullPage: true });
});

test("os parâmetros aparecem derivados, com o contexto como rótulo", async ({ page }) => {
  await page.goto("/app/connections?aba=oficial&sub=templates");
  await expect(page.getByTestId("templates-root")).toBeVisible({ timeout: 20_000 });

  const cards = page.getByTestId("template-card");
  await expect(cards.first()).toBeVisible();

  // O template de confirmação de pedido tem 3 parâmetros no CORPO, e o texto ao
  // redor tem que aparecer — é o que substitui o `example` que a Meta não manda.
  const pedido = cards.filter({ hasText: "jaspers_market_order_confirmation_v1" });
  await expect(pedido).toContainText("3 parâmetro(s)");
  await expect(pedido).toContainText("order number is");

  // O de header IMAGE tem 1 parâmetro e NENHUM `{{n}}` no template. Se a tela
  // mostrasse "sem parâmetros" aqui, o operador montaria um envio que a Meta
  // recusa com 132012 — e é exatamente esse o defeito que a fase cura.
  const imagem = cards.filter({ hasText: "jaspers_market_image_cta_v1" });
  await expect(imagem).toContainText("1 parâmetro(s)");
  await expect(imagem).toContainText("cabeçalho");

  // Carrossel: um slot por card, com o endereço aninhado visível.
  const carrossel = cards.filter({ hasText: "jaspers_market_media_carousel_v1" });
  await expect(carrossel).toContainText("2 parâmetro(s)");
  await expect(carrossel).toContainText("card 2");

  await page.screenshot({ path: `${EVIDENCE}/03-parametros-derivados.png`, fullPage: true });
});

test("o botão Sincronizar fala com a Graph API de verdade", async ({ page }) => {
  await page.goto("/app/connections?aba=oficial&sub=templates");

  const botao = page.getByTestId("btn-sync");
  await expect(botao).toBeEnabled({ timeout: 20_000 });

  const resposta = page.waitForResponse(
    (r) => r.url().includes("/api/v1/channels/templates") && r.request().method() === "POST",
    { timeout: 60_000 },
  );
  await botao.click();
  const res = await resposta;
  expect(res.status()).toBe(200);

  // O toast é a prova de que o resultado chegou ao operador, não só ao console.
  await expect(page.getByText(/Sincronizado:/i)).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: `${EVIDENCE}/04-sync-executado.png`, fullPage: true });
});
