/**
 * O UPDATE em `crm_leads` chega ao canal? — teste da hipótese da replica identity.
 *
 * Com REPLICA IDENTITY DEFAULT, o `old_record` de um UPDATE carrega SÓ A CHAVE
 * PRIMÁRIA. O Realtime avalia a policy de RLS sobre o old_record também, e a
 * policy de `crm_leads` checa `organization_id` — que não está lá. O evento é
 * descartado para todo mundo, sem erro.
 *
 * INSERT não tem old_record, e é por isso que `crm_lead_activities` entrega no
 * mesmo instante em que `crm_leads` some.
 */

import { chromium } from "@playwright/test";

import { BASE, login } from "./qa-helpers";
import { createClient } from "@supabase/supabase-js";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const e = carregarEnvLocal();
const admin = createClient(e.NEXT_PUBLIC_SUPABASE_URL!, e.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const PIPE = "35bf4ac9-c5e0-4f7d-846a-99b1bcc92d69";

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newContext().then((c) => c.newPage());
  await login(page, "manager");

  // Conta os eventos que o canal do board entrega, direto do cliente.
  await page.goto(`${BASE}/app/pipelines/${PIPE}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    (window as unknown as { __ev: number }).__ev = 0;
  });
  // O board já assina; para contar sem depender da UI, observo o refetch que o
  // hook dispara — a marca é o próprio número de linhas mudando não serve, então
  // uso o console do app.
  const eventos: string[] = [];
  page.on("console", (m) => {
    if (m.text().includes("[realtime]")) eventos.push(m.text());
  });

  const { data: lead } = await admin
    .from("crm_leads").select("id, title").eq("pipeline_id", PIPE).limit(1).maybeSingle();
  const l = lead as { id: string; title: string };

  const antes = await page.locator(`[data-rfd-draggable-id="${l.id}"]`).textContent();
  const marca = `RI ${new Date().toISOString().slice(11, 19)}`;
  await admin.from("crm_leads").update({ title: `${l.title.split(" · RI ")[0]} · ${marca}` }).eq("id", l.id);
  await page.waitForTimeout(6000);
  const depois = await page.locator(`[data-rfd-draggable-id="${l.id}"]`).textContent();

  console.info(`UPDATE em crm_leads chegou ao board SEM reload? ${depois?.includes(marca) ? "SIM" : "NÃO"}`);
  console.info(`  antes:  ${antes?.slice(0, 60)}`);
  console.info(`  depois: ${depois?.slice(0, 60)}`);

  await admin.from("crm_leads").update({ title: l.title }).eq("id", l.id);
  await browser.close();
}
void main();
