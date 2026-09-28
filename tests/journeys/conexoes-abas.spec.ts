/**
 * Conexões: um lugar só para conectar canal.
 *
 * O defeito que esta jornada trava: conectar por QR ficava em `/app/connections`,
 * conectar o número OFICIAL ficava em Configurações, e os templates numa terceira
 * tela. O usuário precisava saber de antemão que "conectar meu WhatsApp" tinha
 * resposta diferente dependendo de QUAL WhatsApp — que é conhecimento sobre o nosso
 * código, não sobre o negócio dele.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { expect, test } from "@playwright/test";

const EVIDENCE = path.join(process.cwd(), "evidence/canais/conexoes");
fs.mkdirSync(EVIDENCE, { recursive: true });

test("as duas formas de conectar vivem lado a lado, na mesma tela", async ({ page }) => {
  await page.goto("/app/connections");
  await expect(page.getByRole("tab", { name: /Números por QR/i })).toBeVisible();
  await expect(page.getByRole("tab", { name: /API Oficial/i })).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE}/01-abas.png`, fullPage: true });
});

test("a aba oficial abre a conexão e tem os templates da Meta como sub-aba", async ({ page }) => {
  await page.goto("/app/connections");
  await page.getByRole("tab", { name: /API Oficial/i }).click();

  // A tela de conectar é a MESMA de antes — mudou o lugar, não o que ela faz.
  await expect(page.getByTestId("canal-oficial-root")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("tab", { name: /Templates da Meta/i })).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE}/02-oficial-conexao.png`, fullPage: true });

  await page.getByRole("tab", { name: /Templates da Meta/i }).click();
  await expect(page.getByRole("tab", { name: /Templates da Meta/i })).toHaveAttribute(
    "data-state",
    "active",
  );
  await page.screenshot({ path: `${EVIDENCE}/03-oficial-templates.png`, fullPage: true });
});

test("a aba fica na URL — link colado abre onde deveria", async ({ page }) => {
  // Aba que só vive em `useState` transforma todo link salvo em "abre e procura
  // de novo". É também o que faz os redirects das rotas antigas funcionarem.
  await page.goto("/app/connections?aba=oficial&sub=templates");
  await expect(page.getByRole("tab", { name: /Templates da Meta/i })).toHaveAttribute(
    "data-state",
    "active",
  );
});

test("quem tinha o link antigo salvo não cai em 404", async ({ page }) => {
  await page.goto("/app/settings/canal-oficial");
  await page.waitForURL(/\/app\/connections\?aba=oficial/);
  await expect(page.getByTestId("canal-oficial-root")).toBeVisible({ timeout: 20_000 });

  await page.goto("/app/settings/templates");
  await page.waitForURL(/sub=templates/);
  await expect(page.getByRole("tab", { name: /Templates da Meta/i })).toHaveAttribute(
    "data-state",
    "active",
  );
});

test("o card em Configurações leva ao MESMO lugar, não a um segundo", async ({ page }) => {
  // O defeito era ter dois destinos para a mesma pergunta. Se este caso falhar
  // porque o card sumiu, tudo bem; se falhar porque ele leva a outra tela, o
  // problema voltou.
  await page.goto("/app/settings");
  const card = page.getByRole("link", { name: /Canal oficial/i });
  await expect(card).toBeVisible();
  await card.click();
  await page.waitForURL(/\/app\/connections/);
  await expect(page.getByTestId("canal-oficial-root")).toBeVisible({ timeout: 20_000 });
});
