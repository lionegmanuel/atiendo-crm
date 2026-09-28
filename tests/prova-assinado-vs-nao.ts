/**
 * É O PIPELINE, OU É TER SIDO ASSINADO?
 *
 * A grade deixou um alvo só: leads do pipeline 35bf4ac9 não têm as suas mudanças
 * entregues, e a perda é da JANELA (com eles escritos primeiro, some também o
 * que sempre chega). Só que "o pipeline 35bf4ac9" é uma propriedade que o
 * Realtime não enxerga — e há uma propriedade que ele enxerga muito bem e que
 * anda junto com ela: aquele é o pipeline que o board do CRM Vivo abre o dia
 * inteiro, e `hooks/kanban/useBoard.ts` assina com `pipeline_id=eq.<id>`.
 *
 * Se a entrega quebra porque EXISTE uma assinatura registrada com filtro naquele
 * pipeline — viva, órfã ou quebrada —, então o defeito não é do pipeline: é do
 * que acontece com uma assinatura, e o conserto é outro. A diferença entre
 * "conserte este pipeline" e "conserte assinatura órfã" é a diferença entre
 * remendo e raiz.
 *
 * O teste não precisa de acesso ao schema `realtime`: eu FABRICO um pipeline
 * novo (que ninguém nunca assinou), meço, abro o board DELE no navegador — o que
 * registra a assinatura com filtro —, meço de novo, mato o navegador e meço uma
 * terceira vez. Três leituras do MESMO lead, mudando só o estado da assinatura.
 *
 *   A (nunca assinado) → B (assinado e vivo) → C (assinante morto sem sair)
 *
 * Se A entrega e B/C não, o pipeline está inocente e a raiz é a assinatura.
 * Se as três entregam, a hipótese cai e 35bf4ac9 continua sendo o alvo.
 *
 * Run: E2E_PORT=3020 npx tsx tests/prova-assinado-vs-nao.ts
 */
import { chromium, type Browser } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import { BASE, CREDS, carimbar, login } from "./qa-helpers";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const env = carregarEnvLocal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ORG = CREDS.org_id as string;
const RUN = randomUUID().slice(0, 8);
const SLUG = `qa-assinatura-${RUN}`;

/** Uma medição = assinante NOVO, um INSERT, uma espera. Cliente novo sempre: o
 *  reaproveitado já me deu zeros que não se reproduziram, e controle suspeito
 *  não julga ninguém. */
async function medir(leadId: string, n: number): Promise<string> {
  const resultados: (number | null)[] = [];
  for (let i = 0; i < n; i++) {
    const cli = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    let chegou: number | null = null;
    let t0 = 0;
    const canal = cli.channel(`assinado-${RUN}-${i}-${Date.now() % 100000}`).on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "crm_lead_activities", filter: `lead_id=eq.${leadId}` },
      () => {
        if (chegou === null) chegou = Date.now() - t0;
      },
    );
    await new Promise<string>((r) => canal.subscribe((s) => r(s)));
    await new Promise((r) => setTimeout(r, 2500));
    const marca = `${RUN} assinado ${i}`;
    t0 = Date.now();
    const { error } = await admin.from("crm_lead_activities").insert({
      organization_id: ORG,
      lead_id: leadId,
      source_module: "qa",
      type: "note",
      actor_kind: "system",
      reason: marca,
      evidence: {},
      performed_at: new Date().toISOString(),
    } as never);
    if (error) throw new Error(`gatilho: ${error.code} ${error.message}`);
    await new Promise((r) => setTimeout(r, 7000));
    await admin.from("crm_lead_activities").delete().eq("reason", marca);
    await cli.removeAllChannels();
    resultados.push(chegou);
  }
  const ok = resultados.filter((r) => r !== null).length;
  return `${ok}/${n}${ok > 0 ? ` (${resultados.filter((r): r is number => r !== null).join("ms, ")}ms)` : ""}`;
}

async function main(): Promise<void> {
  carimbar(["tests/prova-assinado-vs-nao.ts", "hooks/kanban/useBoard.ts"]);

  // ---- pipeline FABRICADO: ninguém nunca assinou este --------------------
  const { data: pipe, error: e1 } = await admin
    .from("crm_pipelines")
    .insert({ organization_id: ORG, name: `QA Assinatura ${RUN}`, slug: SLUG, position: 98 } as never)
    .select("id")
    .single();
  if (e1 || !pipe) throw new Error(`criar pipeline: ${e1?.message}`);
  const pipelineId = (pipe as { id: string }).id;
  const { data: st, error: e2 } = await admin
    .from("crm_stages")
    .insert({
      organization_id: ORG,
      pipeline_id: pipelineId,
      name: "Novo",
      slug: `qa-novo-${RUN}`,
      position: 1,
    } as never)
    .select("id")
    .single();
  if (e2 || !st) throw new Error(`criar estágio: ${e2?.message}`);
  const { data: ld, error: e3 } = await admin
    .from("crm_leads")
    .insert({
      organization_id: ORG,
      pipeline_id: pipelineId,
      stage_id: (st as { id: string }).id,
      title: `QA-ASSINATURA ${RUN}`,
      status: "open",
      position_in_stage: 1000,
    } as never)
    .select("id")
    .single();
  if (e3 || !ld) throw new Error(`criar lead: ${e3?.message}`);
  const leadId = (ld as { id: string }).id;
  console.info(`[fabricado] pipeline ${pipelineId.slice(0, 8)} · lead ${leadId.slice(0, 8)}`);

  let browser: Browser | null = null;
  try {
    const a = await medir(leadId, 3);
    console.info(`  A · pipeline NUNCA assinado ................. ${a}`);

    browser = await chromium.launch();
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    page.setDefaultTimeout(60_000);
    await login(page, "manager");
    await page.goto(`${BASE}/app/pipelines/${pipelineId}`);
    await page.waitForTimeout(6000);
    // A ASSINATURA PRECISA EXISTIR DE FATO, senão a fase B é a fase A com um
    // navegador aberto ao lado — e as duas dariam o mesmo número por não terem
    // diferença nenhuma. Sem esta checagem, "B igual a A" não distinguiria
    // "assinar não quebra" de "eu não assinei".
    const assinou = await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .some((r) => r.name.includes("realtime")),
    );
    const board = await page.locator("[data-rfd-droppable-id], [data-realtime-status]").count();
    console.info(`     (board carregado: ${board} elemento(s) · tráfego de realtime na página: ${assinou})`);

    const b = await medir(leadId, 3);
    console.info(`  B · board ABERTO, assinatura viva ........... ${b}`);

    // MATAR o navegador sem fechar as abas é o que produz assinatura órfã: o
    // `phx_leave` nunca sai. Um `close()` educado desfaria o canal e mediria o
    // caso que não interessa.
    await browser.close();
    browser = null;
    const c = await medir(leadId, 3);
    console.info(`  C · navegador MORTO, sem despedida .......... ${c}`);

    // FASE D — A HIPÓTESE NA VERSÃO QUE O TESTE ANTERIOR NÃO TOCOU.
    // A/B/C usaram UMA assinatura. O board do CRM Vivo é aberto o dia inteiro e
    // acumula uma a cada abertura, e "não quebra com uma" não é "não quebra com
    // vinte" — declarar a hipótese morta aqui seria confundir ausência de efeito
    // com efeito que precisa de volume. Oito abas no mesmo board, todas assinando
    // o pipeline, e o navegador morto sem nenhuma se despedir.
    const browserD = await chromium.launch();
    const ctxD = await browserD.newContext({ viewport: { width: 1440, height: 900 } });
    const p0 = await ctxD.newPage();
    p0.setDefaultTimeout(60_000);
    await login(p0, "manager");
    const abas = [p0];
    for (let i = 0; i < 7; i++) abas.push(await ctxD.newPage());
    for (const ab of abas) {
      await ab.goto(`${BASE}/app/pipelines/${pipelineId}`);
      await ab.waitForTimeout(1200);
    }
    await p0.waitForTimeout(4000);
    await browserD.close();
    const d = await medir(leadId, 3);
    console.info(`  D · OITO assinaturas órfãs de uma vez ....... ${d}`);

    const so = (s: string): number => Number(s.split("/")[0]);
    console.info(
      `\n=== três leituras do MESMO lead, só o estado da assinatura muda ===\n` +
        (so(a) > 0 && so(b) === 0
          ? "==> ASSINAR QUEBRA. O pipeline 35bf4ac9 está inocente: ele é só o que vive assinado.\n" +
            "    A raiz é o que o Realtime faz com uma assinatura registrada, e o conserto muda."
          : so(a) > 0 && so(b) > 0 && so(c) === 0
            ? "==> assinatura VIVA não quebra; assinante MORTO sem se despedir quebra. A raiz é a\n" +
              "    assinatura órfã, e o pipeline é só quem acumula órfãs."
            : so(a) > 0 && so(b) > 0 && so(c) > 0
              ? "==> assinar NÃO quebra, nem vivo nem órfão. A hipótese cai e 35bf4ac9 continua\n" +
                "    sendo o alvo — com uma suspeita a menos, que é ganho."
              : "==> o pipeline fabricado já não entregava na fase A. Este aparato não mede nada\n" +
                "    hoje: sem A verde, B e C não têm com o que ser comparados."),
    );
  } finally {
    if (browser) await browser.close();
    await admin.from("crm_lead_activities").delete().eq("lead_id", leadId);
    await admin.from("crm_leads").delete().eq("id", leadId);
    await admin.from("crm_stages").delete().eq("pipeline_id", pipelineId);
    await admin.from("crm_pipelines").delete().eq("id", pipelineId);
    console.info("[limpeza] pipeline, estágio e lead fabricados removidos");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ prova falhou:", err);
  process.exit(1);
});
