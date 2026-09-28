/**
 * PROVA DE TELA do toggle de split de mensagens na configuração do agente.
 *
 * O defeito era mudo: a coluna existia no banco e o runtime a lia, mas a tela
 * não tinha o campo — e mesmo se tivesse, o Zod `.strict()` rejeitaria o save.
 * A prova precisa fechar o ciclo do usuário: LIGA na tela → SALVA → RECARREGA →
 * continua ligado (é aqui que o bug de drift de coluna se manifesta, o campo
 * "desmarcando sozinho") → e o valor está na linha da draft no banco.
 *
 * Roda com: E2E_PORT=3000 npx tsx tests/sonda-split-na-tela.ts
 */

import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { BASE, login } from "./qa-helpers";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const env = carregarEnvLocal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const ORG = "6e567068-fd1c-4f94-ae1f-40e0334be190";
const AGENT = "69d04579-169d-40ac-bd43-ca5869598ace"; // Lia — AgendaPlus
const MAX_CHARS = 240;

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await login(page, "admin");

  await page.goto(`${BASE}/app/ai/agents/${AGENT}`, { waitUntil: "networkidle" });

  const toggle = page.locator("#split_messages");
  await toggle.waitFor({ state: "visible", timeout: 15_000 });
  const antes = await toggle.getAttribute("data-state");
  console.log(`[1] campo existe na tela — estado inicial: ${antes}`);
  if (antes === "checked") throw new Error("já estava ligado: a prova precisa partir de desligado");

  await toggle.click();
  const campoChars = page.locator("#split_max_chars");
  await campoChars.waitFor({ state: "visible", timeout: 5_000 });
  await campoChars.fill(String(MAX_CHARS));
  await page.screenshot({ path: "evidence/split-toggle-ligado.png", fullPage: false });

  await page.getByRole("button", { name: /Salvar rascunho/i }).click();
  await page.getByText(/Rascunho v\d+ salvo/i).waitFor({ timeout: 15_000 });
  console.log("[2] save aceito pelo servidor (toast de rascunho salvo)");

  await page.reload({ waitUntil: "networkidle" });
  const depois = await page.locator("#split_messages").getAttribute("data-state");
  const charsDepois = await page.locator("#split_max_chars").inputValue();
  console.log(`[3] após reload — toggle: ${depois}, max_chars: ${charsDepois}`);
  if (depois !== "checked") throw new Error("REGREDIU: o toggle se desmarcou depois do reload");
  if (charsDepois !== String(MAX_CHARS)) {
    throw new Error(`REGREDIU: max_chars voltou para ${charsDepois}`);
  }
  await page.screenshot({ path: "evidence/split-persistiu-apos-reload.png", fullPage: false });

  const { data: draft } = await admin
    .from("ai_agent_versions")
    .select("version_number, status, split_messages, split_max_chars")
    .eq("organization_id", ORG)
    .eq("agent_id", AGENT)
    .eq("status", "draft")
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  console.log("[4] linha da draft no banco:", draft);
  if (draft?.split_messages !== true || draft?.split_max_chars !== MAX_CHARS) {
    throw new Error("banco não recebeu os valores da tela");
  }

  console.log("\nPASS — tela grava, servidor persiste, reload devolve.");
  await browser.close();
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
