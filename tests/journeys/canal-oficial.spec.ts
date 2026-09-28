/**
 * Prova pela TELA da Fase 5: conectar o canal oficial pelo frontend.
 *
 * O que precisa ser provado, e não só "a página abre":
 *   1. o admin chega pelo hub de configurações, clicando;
 *   2. credencial ERRADA é recusada **com o motivo da Meta** e nada é gravado —
 *      este é o caso que distingue "validar" de "aceitar e torcer";
 *   3. credencial certa conecta, e a tela mostra o que colar no painel da Meta.
 *
 * O caso 2 usa a Graph API REAL. Não há mock: o valor da tela é justamente falar
 * com a Meta antes de gravar, e mockar isso testaria o mock.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { expect, test } from "@playwright/test";




const EVIDENCE = path.join(
  process.cwd(),
  process.env.CANAIS_EVIDENCE_DIR ?? "evidence/canais/fase5",
);
fs.mkdirSync(EVIDENCE, { recursive: true });

/** Credenciais reais da WABA de teste, do ambiente — nunca hardcoded no spec. */
const REAL = {
  phoneNumberId: process.env.META_PHONE_NUMBER_ID ?? "",
  wabaId: process.env.META_WABA_ID ?? "",
  token: process.env.META_SYSTEM_USER_TOKEN ?? "",
};


test.describe.configure({ mode: "serial" });

test("o admin chega ao canal oficial pela área de Conexões", async ({ page }) => {
  // A tela MUDOU DE LUGAR de propósito (2026-07-31): conectar canal — por QR ou
  // oficial — vive em Conexões, e não mais espalhado em Configurações. Este caso
  // acompanha a decisão em vez de fossilizar o caminho antigo; o redirect da rota
  // velha e o card-ponte do hub são cobertos por `conexoes-abas.spec.ts`.
  await page.goto("/app/connections");

  // Foto ANTES da asserção: quando a aba não aparece, o artefato de erro do
  // Playwright nem sempre traz o snapshot, e ler evidência indireta me levou a
  // três diagnósticos errados seguidos.
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${EVIDENCE}/00-hub-antes-da-assercao.png`, fullPage: true });

  await page.getByRole("tab", { name: /API Oficial/i }).click();

  await page.waitForURL(/aba=oficial/, { timeout: 20_000 });
  await expect(page.getByTestId("canal-oficial-root")).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: `${EVIDENCE}/01-tela-conexao.png`, fullPage: true });
});

test("credencial errada é RECUSADA com o motivo da Meta, e nada é gravado", async ({ page }) => {
  // É o caso que separa "validar" de "aceitar e torcer". Sem ele, o operador acharia
  // que conectou e só entenderia que não na primeira mensagem que não sai.
  await page.goto("/app/connections?aba=oficial");
  await expect(page.getByTestId("canal-oficial-root")).toBeVisible({ timeout: 20_000 });

  await page.locator("#pnid").fill("000000000000000");
  await page.locator("#waba").fill("000000000000000");
  await page.locator("#tok").fill("EAAtoken-invalido-de-proposito-para-o-teste");

  const resposta = page.waitForResponse(
    (r) => r.url().includes("/api/v1/channels/official") && r.request().method() === "POST",
    { timeout: 60_000 },
  );
  await page.getByTestId("btn-conectar").click();
  const res = await resposta;

  // 422, não 500: credencial ruim é entrada inválida, não falha nossa.
  expect(res.status()).toBe(422);

  // A asserção original era `toHaveCount(0)` — ela presumia estado limpo e
  // vermelheceu porque já existe uma conexão desta org. O que importa não é
  // "nada conectado": é que a tentativa RUIM **não estragou a conexão boa**.
  // Uma credencial errada não pode derrubar quem já estava enviando.
  await page.reload();
  await expect(page.getByTestId("canal-oficial-root")).toBeVisible({ timeout: 20_000 });
  // A conexão anterior segue INTACTA: o número real continua lá e o id inventado
  // não entrou em lugar nenhum. Não asserto "credencial guardada" aqui porque
  // neste ponto da série ainda não houve conexão bem-sucedida — asserção que
  // presume um estado futuro é como a anterior falhou.
  await expect(page.getByTestId("canal-conectado")).toContainText("1103328999528818");
  await expect(page.getByTestId("canal-conectado")).not.toContainText("000000000000000");
  await page.screenshot({ path: `${EVIDENCE}/02-credencial-recusada.png`, fullPage: true });
});

test("credencial real conecta e a tela mostra o que colar na Meta", async ({ page }) => {
  test.skip(!REAL.token, "sem META_SYSTEM_USER_TOKEN no ambiente");

  await page.goto("/app/connections?aba=oficial");
  await expect(page.getByTestId("canal-oficial-root")).toBeVisible({ timeout: 20_000 });

  await page.locator("#pnid").fill(REAL.phoneNumberId);
  await page.locator("#waba").fill(REAL.wabaId);
  await page.locator("#tok").fill(REAL.token);

  const resposta = page.waitForResponse(
    (r) => r.url().includes("/api/v1/channels/official") && r.request().method() === "POST",
    { timeout: 60_000 },
  );
  await page.getByTestId("btn-conectar").click();
  expect((await resposta).status()).toBe(200);

  // O nome vem da Meta, não do que digitamos — é a prova de que a validação
  // realmente falou com a plataforma.
  await expect(page.getByTestId("canal-conectado")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("canal-conectado")).toContainText(/Test Number/i);
  await expect(page.getByTestId("canal-conectado")).toContainText("credencial guardada");

  // Sem o webhook colado no painel da Meta o canal envia e não recebe — a tela
  // precisa entregar a URL pronta, não descrever onde achá-la.
  await expect(page.getByText(/URL de callback/i)).toBeVisible();
  await expect(page.getByText(/api\/v1\/webhooks\/meta\//)).toBeVisible();

  await page.screenshot({ path: `${EVIDENCE}/03-conectado.png`, fullPage: true });
});
