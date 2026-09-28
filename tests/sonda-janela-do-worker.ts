/**
 * A JANELA DO WORKER — o ciclo acontecendo com a tela aberta e ninguém tocando.
 *
 * É o fechamento dos cenários 22 e 23 na superfície: o negócio esfria porque o
 * RELÓGIO andou, o worker observa a travessia, a proposta nasce, e o card muda
 * SEM RELOAD e SEM ninguém interagir.
 *
 * ⚠️ E ELE JÁ NÃO DEPENDE DO REALTIME. Era esse o bloqueio declarado no
 * fechamento da wave; a rede de segurança o removeu — o refetch traz a mudança
 * e denuncia se o canal não trouxe. O que estava travado por uma investigação
 * em disputa passou a ser provável por uma peça que não pode mentir.
 */
import { randomUUID } from "node:crypto";

import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { BASE, CARD_ATTR, login } from "./qa-helpers";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const env = carregarEnvLocal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const ORG = "6e567068-fd1c-4f94-ae1f-40e0334be190";
const PIPE = "35bf4ac9-c5e0-4f7d-846a-99b1bcc92d69";
const SEGREDO = env.INTERNAL_CRON_SECRET ?? env.INTERNAL_SECRET;

async function main(): Promise<void> {
  const { data: st } = await admin
    .from("crm_stages").select("id").eq("pipeline_id", PIPE).order("position").limit(1).maybeSingle();
  const { data: ct } = await admin
    .from("contacts").select("id").eq("organization_id", ORG).limit(1).maybeSingle();

  // Um negócio JÁ frio, mas sem estado gravado: é o que o worker vai observar.
  const leadId = randomUUID();
  await admin.from("crm_leads").insert({
    id: leadId, organization_id: ORG, pipeline_id: PIPE,
    stage_id: (st as { id: string }).id, contact_id: (ct as { id: string }).id,
    title: `janela do worker ${new Date().toISOString().slice(11, 19)}`,
    last_activity_at: new Date(Date.now() - 200 * 3_600_000).toISOString(),
    position_in_stage: 1,
  });

  const browser = await chromium.launch();
  const page = await browser.newContext({ viewport: { width: 1500, height: 950 } }).then((c) => c.newPage());
  await login(page, "manager");
  await page.goto(`${BASE}/app/pipelines/${PIPE}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3500);

  const card = page.locator(`[${CARD_ATTR}="${leadId}"]`);
  await card.waitFor({ timeout: 15000 });
  const antes = (await card.textContent())?.replace(/\s+/g, " ").trim() ?? "";
  console.info(`ANTES · o card oferece retomada? ${antes.includes("Retomar contato?") ? "SIM" : "NÃO"}`);
  console.info(`   faixa: ${antes.match(/(Retomar contato\?[^·]*|Sem resposta[^·]*|Propõe[^·]*)/)?.[0]?.trim() ?? "(sem faixa de ação)"}`);

  // ── O WORKER RODA. Ninguém toca na tela. ─────────────────────────────────
  const r = await page.evaluate(async (s) => {
    const res = await fetch("/api/v1/cron/risk-watcher", { headers: { authorization: `Bearer ${s}` } });
    return { http: res.status, corpo: await res.text() };
  }, SEGREDO);
  const dados = (() => { try { return JSON.parse(r.corpo).data; } catch { return {}; } })();
  console.info(`WORKER · http ${r.http} · travessias=${dados.travessias} esfriaram=${dados.esfriaram} propostas=${dados.propostas_criadas}`);

  // A rede roda a cada 45s; o retorno à aba a exercita antes disso.
  // ⚠️ ESPERA REAL, não a que eu gostaria: a lista de propostas tem polling
  // próprio de 60s (não vem por canal, então não há perda a curar — há
  // latência). Medir com 7s e concluir "não chegou" seria medir a minha
  // impaciência, não o produto. O contrato pede SEM RELOAD, não instantâneo.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(10_000);
    const t = (await card.textContent()) ?? "";
    if (t.includes("Retomar contato?")) { console.info(`   apareceu em ~${(i + 1) * 10}s`); break; }
  }

  const depois = (await card.textContent())?.replace(/\s+/g, " ").trim() ?? "";
  const board = page.locator("[data-refetch-divergencias]").first();
  console.info(`DEPOIS · o card oferece retomada? ${depois.includes("Retomar contato?") ? "SIM — sem reload e sem ninguém tocar" : "NÃO ← o ciclo não chegou à tela"}`);
  console.info(`   faixa: ${depois.match(/Retomar contato\?[^E]*/)?.[0]?.trim() ?? "(sem proposta)"}`);
  console.info(`   canal=${await board.getAttribute("data-realtime-status")} · divergências=${await board.getAttribute("data-refetch-divergencias")}`);
  await page.screenshot({ path: "evidence/wave7-janela-do-worker.png" });

  await admin.from("crm_leads").delete().eq("id", leadId);
  await browser.close();
}
void main();
