/**
 * OS TRÊS PREDICADOS, JULGADOS CONTRA OS DOIS QUADROS QUE EXISTEM.
 *
 * Eu errei o mesmo contador duas vezes: primeiro casando a SUBSTRING
 * "postgres_changes" (que conta o RECIBO de inscrição como entrega), depois
 * exigindo `"event":"postgres_changes"` (que não casa nada, porque o quadro do
 * Phoenix é um ARRAY — `[join_ref, ref, topic, event, payload]` — e não tem essa
 * chave). Cada conserto foi validado só contra o caso quebrado, onde zero era o
 * resultado esperado — e ali "consertado" e "quebrado de outro jeito" produzem a
 * MESMA observação.
 *
 * Restam duas sondas com um TERCEIRO predicado, que eu ainda não julguei:
 * `capture-wave-3-cenarios.ts` e `prova-canal-board.ts` exigem a substring MAIS
 * `"type":"INSERT|UPDATE|DELETE"`. Ele parece correto — mas "parece correto" é
 * exatamente o que eu disse das duas versões anteriores.
 *
 * Então aqui os três predicados são aplicados a TODOS os quadros de uma sessão
 * SAUDÁVEL, onde recibo e entrega acontecem os dois. A tabela resultante não
 * depende da minha leitura do protocolo: ela mostra o que cada predicado disse
 * sobre cada quadro real.
 *
 * Run: E2E_PORT=3020 npx tsx tests/prova-predicados-de-quadro.ts
 */
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import { BASE, carimbar, login } from "./qa-helpers";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const env = carregarEnvLocal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const PIPELINE_VIVO = "48c02b4a-0ca1-4bca-8ef0-206b6d240d23";
const RUN = randomUUID().slice(0, 6);

const PREDICADOS: { nome: string; f: (s: string) => boolean }[] = [
  { nome: "v1 substring", f: (s) => /"postgres_changes"/.test(s) },
  { nome: "v2 chave event", f: (s) => /"event":"postgres_changes"/.test(s) },
  {
    nome: "v3 substring+type",
    f: (s) => /"postgres_changes"/.test(s) && /"type"\s*:\s*"(INSERT|UPDATE|DELETE)"/.test(s),
  },
  {
    nome: "v4 posição",
    f: (s) => {
      try {
        const q: unknown = JSON.parse(s);
        return Array.isArray(q) && q[3] === "postgres_changes";
      } catch {
        return false;
      }
    },
  },
];

async function main(): Promise<void> {
  carimbar(["tests/prova-predicados-de-quadro.ts"]);
  const { data: leads } = await admin
    .from("crm_leads")
    .select("id,title")
    .eq("pipeline_id", PIPELINE_VIVO)
    .order("id")
    .limit(1);
  const lead = (leads ?? [])[0] as { id: string; title: string };

  const quadros: string[] = [];
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.setDefaultTimeout(60_000);
  page.on("websocket", (ws) => {
    if (!ws.url().includes("supabase")) return;
    ws.on("framereceived", (f) => quadros.push(String(f.payload)));
  });
  await login(page, "manager");
  await page.goto(`${BASE}/app/pipelines/${PIPELINE_VIVO}`);
  await page.waitForTimeout(5000);
  const marca = `PRED${RUN}`;
  await admin.from("crm_leads").update({ title: `${lead.title} ${marca}` }).eq("id", lead.id);
  await page.waitForTimeout(7000);
  await admin.from("crm_leads").update({ title: lead.title }).eq("id", lead.id);
  await browser.close();

  // A VERDADE DE REFERÊNCIA NÃO É NENHUM DOS PREDICADOS EM JULGAMENTO: é o
  // marcador que eu mesmo plantei. O quadro que carrega a marca É a entrega —
  // não porque um predicado disse, mas porque só a entrega pode conter o texto
  // que eu escrevi no banco depois de a página já estar aberta.
  const entregaVerdadeira = quadros.filter((q) => q.includes(marca));
  const recibos = quadros.filter((q) => /phx_reply/.test(q) && /postgres_changes/.test(q));

  console.info(`\n  quadros observados: ${quadros.length} · entregas de verdade (com a marca): ` +
    `${entregaVerdadeira.length} · recibos de inscrição: ${recibos.length}`);
  if (entregaVerdadeira.length === 0 || recibos.length === 0) {
    console.info(
      "\n==> SEM OS DOIS TIPOS DE QUADRO ESTA SESSÃO NÃO JULGA NADA. Um predicado só se prova\n" +
        "    errado onde ele tem chance de errar: sem recibo não se pega falso positivo, sem\n" +
        "    entrega não se pega falso negativo.",
    );
    process.exit(1);
  }

  console.info(`\n  ${"predicado".padEnd(20)} ${"acerta a ENTREGA".padEnd(18)} confunde RECIBO`);
  for (const p of PREDICADOS) {
    const pegouEntrega = entregaVerdadeira.every((q) => p.f(q));
    const pegouRecibo = recibos.some((q) => p.f(q));
    console.info(
      `  ${p.nome.padEnd(20)} ${(pegouEntrega ? "sim" : "NÃO (falso neg.)").padEnd(18)} ` +
        `${pegouRecibo ? "SIM (falso pos.)" : "não"}`,
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ prova falhou:", err);
  process.exit(1);
});
