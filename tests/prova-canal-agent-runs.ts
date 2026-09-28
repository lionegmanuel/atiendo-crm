/**
 * PROVA: o canal de realtime de `useAgentRuns` está morto — assina como anônimo
 * e nunca recebe evento.
 *
 * A lista de canais suspeitos do regente é inferência de código (grep). Isto a
 * torna FATO por observação, do mesmo jeito que provamos o canal do board:
 *   1. abre a tela com sessão real (gerente logado);
 *   2. lê o token que o socket usa — é `anon` ou é o usuário?
 *   3. provoca uma mudança REAL na tabela vigiada, com o filtro do canal;
 *   4. mede se algum quadro chega e se a tela muda SEM recarregar;
 *   5. devolve o dado ao estado anterior.
 *
 * Não conserta nada. Só prova.
 *
 * Run: E2E_PORT=3020 npx tsx tests/prova-canal-agent-runs.ts
 */

import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";

import { BASE, CREDS, EVIDENCE, login, shotPage } from "./qa-helpers";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const env = carregarEnvLocal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * ATENÇÃO DE MÉTODO: o parâmetro `apikey` da URL do socket é SEMPRE a chave
 * pública — isso é do desenho do Supabase e NÃO prova anonimato. Quem carrega a
 * identidade do usuário é o `access_token` dentro do quadro de assinatura
 * (ou um setAuth antes dele). Portanto a pergunta certa é: o join do canal leva
 * access_token de usuário, ou vai sem identidade?
 */
/** Lê o papel do JWT sem validar assinatura — só para dizer QUEM o socket diz ser. */
function papelDoToken(jwt: string | undefined): string {
  if (!jwt) return "(sem token)";
  try {
    const corpo = JSON.parse(
      Buffer.from(jwt.replace(/^Bearer /, "").split(".")[1]!, "base64").toString(),
    );
    return `role=${corpo.role}${corpo.sub ? ` sub=${String(corpo.sub).slice(0, 8)}` : " sub=(nenhum)"}`;
  } catch {
    return "(jwt ilegível)";
  }
}

async function main(): Promise<void> {
  fs.mkdirSync(EVIDENCE, { recursive: true });

  const runsRes = await admin
    .from("ai_agent_runs")
    .select("id,agent_id,latency_ms")
    .eq("organization_id", CREDS.org_id)
    .order("created_at", { ascending: false })
    .limit(1);
  if (runsRes.error) throw new Error(`runs: ${runsRes.error.message}`);
  const run = (runsRes.data ?? [])[0] as { id: string; agent_id: string; latency_ms: number | null };
  if (!run) throw new Error("nenhuma execução de agente na org — sem caso para provar");
  const latenciaOriginal = run.latency_ms;

  const browser = await chromium.launch();
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 } })
  ).newPage();
  page.setDefaultTimeout(90_000);
  page.setDefaultNavigationTimeout(90_000);

  const quadros: string[] = [];
  let tokenDoSocket = "(socket não abriu)";
  let entrouNoCanal = false;
  let joinDoCanal = "";
  const joins: { canal: string; temToken: boolean }[] = [];
  page.on("websocket", (ws) => {
    if (!ws.url().includes("supabase")) return;
    const url = new URL(ws.url());
    tokenDoSocket = papelDoToken(url.searchParams.get("apikey") ?? undefined);
    ws.on("framesent", (f) => {
      const s = String(f.payload);
      if (s.includes("ai-agent-runs")) {
        entrouNoCanal = true;
        // O quadro INTEIRO do canal sob teste: é nele que se vê se há identidade.
        joinDoCanal = s;
      }
      if (/phx_join/.test(s)) {
        // A/B na MESMA página: canal curado (passa pelo hook, com setAuth) contra
        // canal cru (abre .channel direto). A digital é o access_token no join.
        const nome = (s.match(/realtime:([^"]+)/) ?? [])[1] ?? "?";
        joins.push({ canal: nome.slice(0, 46), temToken: /access_token/.test(s) });
      }
      if (/phx_join|access_token/.test(s)) quadros.push(`ENVIOU ${s.slice(0, 220)}`);
    });
    ws.on("framereceived", (f) => {
      const s = String(f.payload);
      if (/postgres_changes|phx_reply|error/.test(s)) quadros.push(`RECEBEU ${s.slice(0, 220)}`);
    });
  });

  await login(page, "manager");
  await page.goto(`${BASE}/app/ai/agents/${run.agent_id}`);
  await page.waitForLoadState("networkidle").catch(() => null);
  // O canal só liga quando a aba de execuções abre — sem clicar, eu mediria uma
  // tela que nunca assinou e concluiria "canal morto" sobre um canal ausente.
  const abaRuns = page.getByRole("tab", { name: /runs|execu/i }).first();
  if ((await abaRuns.count()) > 0) {
    await abaRuns.click();
    console.info("[nav] abriu a aba de execuções");
  } else {
    console.info("[nav] ATENÇÃO: aba de execuções não encontrada — o canal pode nem ligar");
  }
  await page.waitForTimeout(6000);
  await shotPage(page, "prova-canal-agent-runs-antes.png", false);

  const textoAntes = ((await page.locator("main").first().innerText()) ?? "").replace(/\s+/g, " ");
  const marcaAntes = quadros.length;

  // GATILHO: mudança real na tabela vigiada, dentro do filtro do canal.
  const novaLatencia = (latenciaOriginal ?? 0) + 4242;
  const up = await admin
    .from("ai_agent_runs")
    .update({ latency_ms: novaLatencia } as never)
    .eq("id", run.id);
  if (up.error) throw new Error(`gatilho: ${up.error.message}`);
  console.info(`[gatilho] latency_ms ${latenciaOriginal} -> ${novaLatencia} no run ${run.id.slice(0, 8)}`);

  await page.waitForTimeout(12_000);
  const textoDepois = ((await page.locator("main").first().innerText()) ?? "").replace(/\s+/g, " ");
  const quadrosNovos = quadros.length - marcaAntes;
  const telaMudou = textoAntes !== textoDepois;

  // Restaura o dado — a prova não pode deixar rastro.
  const back = await admin
    .from("ai_agent_runs")
    .update({ latency_ms: latenciaOriginal } as never)
    .eq("id", run.id);
  if (back.error) throw new Error(`restaurar: ${back.error.message}`);

  await shotPage(page, "prova-canal-agent-runs-depois.png", false);
  await browser.close();

  console.info("\n=== RESULTADO ===");
  console.info(`  socket abriu com: ${tokenDoSocket}`);
  console.info(`  entrou no canal ai-agent-runs? ${entrouNoCanal ? "SIM" : "NÃO"}`);
  if (joinDoCanal) {
    const temToken = /access_token/.test(joinDoCanal);
    console.info(`  o join do canal leva access_token de usuário? ${temToken ? "SIM" : "NÃO — vai sem identidade"}`);
    console.info(`  quadro do join: ${joinDoCanal.slice(0, 300)}`);
  }
  console.info("\n  A/B dos canais nesta MESMA página (identidade no join):");
  for (const j of joins) {
    console.info(`    ${j.temToken ? "COM token " : "SEM token "} ${j.canal}`);
  }
  console.info(`\n  quadros novos após o gatilho: ${quadrosNovos}`);
  console.info(`  a tela mudou sem recarregar? ${telaMudou ? "SIM" : "NÃO"}`);
  console.info(`  [restaurado] latency_ms de volta para ${latenciaOriginal}`);
  if (quadros.length) {
    console.info("\n  amostra de quadros:");
    for (const q of quadros.slice(0, 4)) console.info(`    ${q.slice(0, 180)}`);
  }

  const canalMorto = entrouNoCanal && quadrosNovos === 0 && !telaMudou;
  console.info(
    canalMorto
      ? "\n==> CANAL MORTO CONFIRMADO: assina, recebe ok, e não entrega evento."
      : "\n==> NÃO confirmado como morto — ver números acima antes de concluir.",
  );
}

main().catch((err) => {
  console.error("❌ Prova do canal falhou:", err);
  process.exit(1);
});
