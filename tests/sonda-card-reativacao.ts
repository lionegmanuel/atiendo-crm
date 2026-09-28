/**
 * O CARD com a proposta de retomada — a prova de tela do cenário 23.
 *
 * Cobra o que o desenho promete: a faixa mostra o prazo (proposta com prazo que
 * não mostra o prazo é a mesma simulação de atenção que o prazo evita), os dois
 * botões decidem, e o card NÃO CRESCE — a faixa ③ tem altura fixa.
 */
import { randomUUID } from "node:crypto";

import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { BASE, CARD_ATTR, login } from "./qa-helpers";
import { propoeReativacao } from "@/lib/leads/reactivation";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const env = carregarEnvLocal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const ORG = "6e567068-fd1c-4f94-ae1f-40e0334be190";
const PIPE = "35bf4ac9-c5e0-4f7d-846a-99b1bcc92d69";

async function main(): Promise<void> {
  const { data: st } = await admin
    .from("crm_stages").select("id").eq("pipeline_id", PIPE).order("position").limit(1).maybeSingle();
  const { data: ct } = await admin
    .from("contacts").select("id").eq("organization_id", ORG).limit(1).maybeSingle();

  const leadId = randomUUID();
  await admin.from("crm_leads").insert({
    id: leadId, organization_id: ORG, pipeline_id: PIPE,
    stage_id: (st as { id: string }).id, contact_id: (ct as { id: string }).id,
    title: `Retomada — prova de tela`,
    last_activity_at: new Date(Date.now() - 100 * 3_600_000).toISOString(),
    position_in_stage: 1,
  });
  const p = await propoeReativacao(admin, { organizationId: ORG, leadId, coldHours: 48 });
  if (!p) throw new Error("a proposta não nasceu — sem alvo não há medição");

  const browser = await chromium.launch();
  const page = await browser.newContext({ viewport: { width: 1500, height: 950 } }).then((c) => c.newPage());
  await login(page, "manager");
  await page.goto(`${BASE}/app/pipelines/${PIPE}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  const card = page.locator(`[${CARD_ATTR}="${leadId}"]`);
  await card.waitFor({ timeout: 15000 });
  const alturaComProposta = (await card.boundingBox())?.height ?? 0;
  const texto = (await card.textContent())?.replace(/\s+/g, " ").trim() ?? "";

  // Um card VIZINHO sem proposta, para a altura ser comparada e não julgada.
  const vizinho = page.locator(`[${CARD_ATTR}]`).filter({ hasNotText: "Retomada — prova" }).first();
  const alturaSemProposta = (await vizinho.boundingBox())?.height ?? 0;

  console.info(`1. a faixa mostra a proposta? ${texto.includes("Retomar contato?") ? "SIM" : "NÃO"}`);
  console.info(`2. mostra o PRAZO? ${/· \d+[hdm]/.test(texto) ? "SIM — " + (texto.match(/· \d+[hdm]/)?.[0] ?? "") : "NÃO ← proposta com prazo que esconde o prazo"}`);
  console.info(`3. os dois botões existem? Retomar=${await card.getByRole("button", { name: /Retomar contato com/ }).count()} Encerrar=${await card.getByRole("button", { name: /Encerrar/ }).count()}`);
  console.info(`4. o card cresceu? com=${alturaComProposta}px sem=${alturaSemProposta}px → ${Math.abs(alturaComProposta - alturaSemProposta) <= 2 ? "NÃO (mesma altura)" : "SIM ← quebra o orçamento do card"}`);
  await page.screenshot({ path: "evidence/wave7-card-reativacao.png" });

  // 5. o clique DECIDE — e o card volta ao estado sem proposta.
  await card.getByRole("button", { name: /Retomar contato com/ }).click();
  await page.waitForTimeout(3500);
  const { data: depois } = await admin
    .from("crm_lead_reactivations").select("status").eq("id", p.id).maybeSingle();
  const textoDepois = (await card.textContent())?.replace(/\s+/g, " ").trim() ?? "";
  console.info(`5. clicar em Retomar → status=${(depois as { status: string }).status} · a faixa ainda oferece? ${textoDepois.includes("Retomar contato?") ? "SIM ← defeito" : "NÃO"}`);
  await page.screenshot({ path: "evidence/wave7-card-reativacao-decidido.png" });

  await admin.from("crm_leads").delete().eq("id", leadId);
  await browser.close();
}
void main();
