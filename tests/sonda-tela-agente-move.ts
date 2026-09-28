/**
 * A PROVA DE TELA dos cenários 25 e 26: o card ANDA no Kanban quando o agente
 * avança o funil dele — sem reload e sem ninguém tocar.
 *
 * Sem realtime de propósito, pelo mesmo caminho do cenário 23: a rede de
 * segurança traz a mudança, e o que estava bloqueado por uma investigação em
 * disputa passa a depender de uma peça que não pode mentir.
 */
import { randomUUID } from "node:crypto";

import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { BASE, CARD_ATTR, login } from "./qa-helpers";
import { sincronizaEstagioDoAgente } from "@/lib/leads/agent-stage-sync";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const env = carregarEnvLocal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const ORG = "6e567068-fd1c-4f94-ae1f-40e0334be190";
const PIPE = "35bf4ac9-c5e0-4f7d-846a-99b1bcc92d69";

/** Em que COLUNA do board o card está — a pergunta que a tela responde. */
async function colunaDoCard(page: import("@playwright/test").Page, leadId: string): Promise<string> {
  return page.evaluate((id) => {
    const card = document.querySelector(`[data-rfd-draggable-id="${id}"]`);
    if (!card) return "(card não está na tela)";
    const coluna = card.closest("[data-rfd-droppable-id]")?.parentElement;
    const titulo = coluna?.querySelector("h3, h2, [class*='font-medium']");
    return titulo?.textContent?.trim() ?? "(coluna sem título)";
  }, leadId);
}

async function main(): Promise<void> {
  const { data: st } = await admin
    .from("crm_stages").select("id, name, slug, agent_stage_hint").eq("pipeline_id", PIPE).order("position");
  const estagios = (st ?? []) as Array<{ id: string; name: string; slug: string; agent_stage_hint: string | null }>;
  const primeiro = estagios[0]!;
  const destino = estagios.find((e) => e.agent_stage_hint === "negotiating")!;

  const contactId = randomUUID();
  await admin.from("contacts").insert({ id: contactId, organization_id: ORG, name: "sonda tela 25" });
  const leadId = randomUUID();
  await admin.from("crm_leads").insert({
    id: leadId, organization_id: ORG, pipeline_id: PIPE, stage_id: primeiro.id,
    contact_id: contactId, title: "O agente vai mover este", position_in_stage: 1,
  });

  const browser = await chromium.launch();
  const page = await browser.newContext({ viewport: { width: 1600, height: 950 } }).then((c) => c.newPage());
  await login(page, "manager");
  await page.goto(`${BASE}/app/pipelines/${PIPE}`, { waitUntil: "networkidle" });
  await page.locator(`[${CARD_ATTR}="${leadId}"]`).waitFor({ timeout: 15000 });
  await page.waitForTimeout(2500);

  console.info(`ANTES · o card está em: ${await colunaDoCard(page, leadId)}`);
  console.info(`   (o tenant chama de "${primeiro.name}"; o agente vai pedir "negotiating", que aqui é "${destino.name}")`);
  await page.screenshot({ path: "evidence/wave8-agente-move-antes.png" });

  // ── O AGENTE AVANÇA O FUNIL DELE. Ninguém toca na tela. ──────────────────
  const r = await sincronizaEstagioDoAgente(admin, {
    organizationId: ORG, contactId, passo: "negotiating",
  });
  console.info(`\nAGENTE · moveu=${r.moveu} · motivo=${r.motivo} · destino=${r.stageName ?? "-"}`);

  // A rede roda a cada 45s; o retorno à aba a exercita antes.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  let onde = "";
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(8000);
    onde = await colunaDoCard(page, leadId);
    if (onde.includes(destino.name)) { console.info(`   chegou à tela em ~${(i + 1) * 8}s`); break; }
  }
  console.info(`\nDEPOIS · o card está em: ${onde}`);
  console.info(`   o card ANDOU sem reload? ${onde.includes(destino.name) ? "SIM" : "NÃO ← ficou parado"}`);
  await page.screenshot({ path: "evidence/wave8-agente-move-depois.png" });

  await admin.from("crm_leads").delete().eq("id", leadId);
  await admin.from("contacts").delete().eq("id", contactId);
  await browser.close();
}
void main();
