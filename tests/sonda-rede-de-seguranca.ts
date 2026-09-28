/**
 * A REDE DE SEGURANÇA, provada matando a entrega.
 *
 * O cenário é o defeito do dia: o canal está vivo (SUBSCRIBED) e não entrega
 * nada. Hoje o board fica congelado num passado que parece presente — nem
 * voltar para a aba conserta.
 *
 * Como se mata a entrega SEM mexer no código sob teste: bloqueando o WebSocket
 * do lado do navegador. O canal nunca recebe evento, e o resto da página segue
 * igual — que é exatamente a condição real.
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
  const browser = await chromium.launch();
  browserAberto = browser;
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await login(page, "manager");

  const MATAR = process.env.ENTREGA !== "viva";
  console.info(MATAR ? "modo: ENTREGA MORTA" : "modo: ENTREGA VIVA (controle)");
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
  console.info(MATAR ? "modo: ENTREGA MORTA" : "modo: ENTREGA VIVA (controle)");

  await page.goto(`${BASE}/app/pipelines/${PIPE}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(4000);

  const board = page.locator("[data-refetch-divergencias]").first();
  const antes = {
    divergencias: await board.getAttribute("data-refetch-divergencias"),
    cards: await page.locator(`[${CARD_ATTR}]`).count(),
  };
  console.info(`ANTES · cards=${antes.cards} · divergências=${antes.divergencias}`);

  // Um lead NOVO entra pelo banco. Com a entrega morta, o canal não avisa.
  const { data: st } = await admin
    .from("crm_stages").select("id").eq("pipeline_id", PIPE).order("position").limit(1).maybeSingle();
  const leadId = randomUUID();
  leadCriado = leadId;
  await admin.from("crm_leads").insert({
    id: leadId, organization_id: ORG, pipeline_id: PIPE,
    stage_id: (st as { id: string }).id,
    title: `rede de seguranca ${new Date().toISOString().slice(11, 19)}`,
    position_in_stage: 1,
  });
  // O log DIZ A CONDIÇÃO QUE REALMENTE VALEU. A frase era fixa em "ENTREGA
  // MORTA" e a rodada de controle a imprimia igual — instrumento descrevendo
  // errado o que fez. Quem lesse o log do controle leria "websocket bloqueado"
  // sobre a rodada cuja razão de existir é o websocket estar aberto.
  console.info(
    MATAR
      ? "· lead criado com a ENTREGA MORTA (websocket bloqueado)"
      : "· lead criado com a ENTREGA VIVA (websocket passando)",
  );

  // 8s: o canal teria entregue em ~2s se estivesse vivo.
  await page.waitForTimeout(8000);
  const semRede = await page.locator(`[${CARD_ATTR}="${leadId}"]`).count();
  console.info(`1. o canal trouxe? ${semRede ? "SIM" : "NÃO"} ${MATAR ? (semRede ? "← o bloqueio falhou" : "— morta, como planejado") : (semRede ? "— viva, como esperado" : "← o canal deveria ter trazido")}`);

  // A REDE roda a cada 45s; volto para a aba para exercitar o outro gatilho.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(6000);

  const depois = {
    divergencias: await board.getAttribute("data-refetch-divergencias"),
    apareceu: await page.locator(`[${CARD_ATTR}="${leadId}"]`).count(),
  };
  console.info(`2. a rede CUROU? ${depois.apareceu ? "SIM — o card apareceu sem reload" : "NÃO ← a tela segue congelada"}`);
  console.info(`3. a rede DENUNCIOU? divergências ${antes.divergencias} → ${depois.divergencias}`);
  await page.screenshot({ path: "evidence/wave7-rede-de-seguranca.png" });

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
