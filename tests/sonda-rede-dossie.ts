/**
 * A rede de segurança no DOSSIÊ, provada matando a entrega.
 *
 * O dossiê é o caso mais grave dos três: a timeline PROMETE contar a vida do
 * negócio, e uma timeline congelada não parece congelada — parece um negócio
 * sem novidade. O usuário não tem como distinguir.
 */
import { randomUUID } from "node:crypto";

import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { apagaExatamenteUm, BASE, CARD_ATTR, login } from "./qa-helpers";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const env = carregarEnvLocal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const ORG = "6e567068-fd1c-4f94-ae1f-40e0334be190";
const PIPE = "35bf4ac9-c5e0-4f7d-846a-99b1bcc92d69";

/** O lead que esta rodada criou — lido pelo `finally` lá embaixo. */
let leadCriado: string | null = null;
/** O browser aberto. Sem fechá-lo no `finally`, uma sonda que morre no meio
 *  NÃO ENCERRA: o Playwright segura o event loop e o processo pendura para
 *  sempre. Medido — a sabotagem que provou a limpeza travou 7 minutos até o
 *  timeout externo matá-la. */
let browserAberto: import("@playwright/test").Browser | null = null;

async function main(): Promise<void> {
  const MATAR = process.env.ENTREGA !== "viva";
  const { data: st } = await admin
    .from("crm_stages").select("id").eq("pipeline_id", PIPE).order("position").limit(1).maybeSingle();
  const leadId = randomUUID();
  leadCriado = leadId;
  await admin.from("crm_leads").insert({
    id: leadId, organization_id: ORG, pipeline_id: PIPE,
    stage_id: (st as { id: string }).id,
    title: `rede dossie ${new Date().toISOString().slice(11, 19)}`,
    position_in_stage: 1,
  });
  await admin.from("crm_lead_activities").insert({
    organization_id: ORG, lead_id: leadId, type: "note",
    source_module: "crm", source_id: leadId, actor_kind: "system",
    reason: "linha inicial da sonda",
  });

  const browser = await chromium.launch();
  browserAberto = browser;
  const page = await browser.newContext({ viewport: { width: 1400, height: 900 } }).then((c) => c.newPage());
  await login(page, "manager");
  if (MATAR) {
      // MATA A ENTREGA com a ferramenta que existe para isso: `routeWebSocket`
  // intercepta o WS de verdade. As duas tentativas anteriores foram descartadas
  // e o motivo importa:
  //   `page.route`        → intercepta HTTP e NÃO WebSocket. O canal entregou
  //                         normalmente e o "curou" era o realtime funcionando.
  //   `throw` no construtor → derrubava a página com Runtime Error do Next, o
  //                         que é OUTRA condição: app quebrado, não canal mudo.
  //   stub artesanal      → o socket seguia `subscribed`, então nem estava
  //                         sendo usado — eu media um canal vivo achando que
  //                         estava morto.
  // O defeito real é um canal que CONECTA e não entrega; é isso que se simula.
  if (MATAR) {
    await page.routeWebSocket(/realtime/, (ws) => {
      // Não conecta ao servidor: o handshake do cliente completa e nada chega.
      void ws;
    });
  }
  }
  console.info(MATAR ? "modo: ENTREGA MORTA" : "modo: ENTREGA VIVA (controle)");

  await page.goto(`${BASE}/app/pipelines/${PIPE}`, { waitUntil: "networkidle" });
  // O dossiê abre pelo TÍTULO — o card é role=group e o título virou button na
  // wave 6, para o clique no card selecionar e o clique no título abrir.
  await page.locator(`[${CARD_ATTR}="${leadId}"]`).locator("button").first().click();
  const sheet = page.locator('[role="dialog"]');
  await page.waitForTimeout(2000);
  console.info(`   diagnóstico: cards=${await page.locator(`[${CARD_ATTR}]`).count()} · o meu existe=${await page.locator(`[${CARD_ATTR}="${leadId}"]`).count()} · dialogs=${await sheet.count()}`);
  await sheet.waitFor({ timeout: 15000 });
  await page.waitForTimeout(4000);

  // ⚠️ CONTAR `li` NÃO SERVE, e a primeira versão caiu nisso: as duas
  // atividades são do mesmo ator com segundos de diferença, então o
  // agrupamento (que eu mesmo construí) junta as duas num bloco só — a
  // contagem de `li` fica igual e a "cura" parece não ter acontecido. O que
  // conta é quantas AÇÕES a timeline representa, colapsadas ou não.
  const acoesRepresentadas = async (): Promise<number> => {
    const soltas = await sheet.locator("li").count();
    const blocos = await sheet.getByText(/\d+ ações/).allTextContents();
    const dentro = blocos.reduce((a, t) => a + Number(t.match(/(\d+) ações/)?.[1] ?? 0), 0);
    return soltas - blocos.length + dentro;
  };

  const antes = {
    linhas: await acoesRepresentadas(),
    div: await sheet.getAttribute("data-refetch-divergencias"),
  };
  // O STATUS DO CANAL diz se o bloqueio pegou. Sem ele, "o canal trouxe" é
  // indistinguível de "o refetch do react-query trouxe" — e o react-query
  // refaz por foco e por staleness sozinho.
  console.info(`ANTES · linhas=${antes.linhas} · divergências=${antes.div} · canal=${await sheet.getAttribute("data-realtime-status")}`);

  // Uma atividade NOVA entra pelo banco.
  await admin.from("crm_lead_activities").insert({
    organization_id: ORG, lead_id: leadId, type: "note",
    source_module: "crm", source_id: leadId, actor_kind: "system",
    reason: "chegou com a entrega morta",
  });
  await page.waitForTimeout(8000);
  const semRede = await acoesRepresentadas();
  console.info(`1. o canal trouxe? ${semRede > antes.linhas ? "SIM" : "NÃO"} ${MATAR ? (semRede > antes.linhas ? "← o bloqueio falhou" : "— morta, como planejado") : "— viva, como esperado"}`);

  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(6000);
  const depois = {
    linhas: await acoesRepresentadas(),
    div: await sheet.getAttribute("data-refetch-divergencias"),
  };
  console.info(`2. a rede CUROU? ${depois.linhas > antes.linhas ? "SIM — a linha entrou sem reload" : "NÃO ← timeline congelada"}`);
  console.info(`3. a rede DENUNCIOU? divergências ${antes.div} → ${depois.div}`);
  await page.screenshot({ path: "evidence/wave7-rede-dossie.png" });

  await browser.close();
}
/**
 * A LIMPEZA RODA MESMO QUANDO A SONDA MORRE NO MEIO.
 *
 * Estava no fim do caminho feliz — e sonda de UI morre no meio o tempo todo
 * (locator que não resolve, timeout, página que não hidrata). Cada uma dessas
 * mortes deixava um lead no board do CRM Vivo: cinco tinham se acumulado, e eu
 * só os vi porque APARECERAM na screenshot de uma evidência que eu estava
 * tirando para outra coisa.
 *
 * Limpeza no caminho feliz não é limpeza: ela roda exatamente quando não fez
 * falta, e falta exatamente quando teria feito.
 */
void main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (!leadCriado) return;
    // `catch` aqui, e só aqui: se a sonda já está morrendo, a falha da limpeza
    // não pode substituir a causa original no log.
    await apagaExatamenteUm(admin, "crm_leads", leadCriado).catch((e: unknown) =>
      console.error(`[limpeza] o lead ${leadCriado} ficou no banco: ${String(e)}`),
    );
  })
  .finally(async () => {
    await browserAberto?.close().catch(() => null);
  });
