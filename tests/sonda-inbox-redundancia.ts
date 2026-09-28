/**
 * POR QUE O INBOX ÀS VEZES SE RECUPERA — a investigação antes de pendurar a rede.
 *
 * Hipótese, lida no código: existe REDUNDÂNCIA CRUZADA não declarada. São DOIS
 * canais, e o de `messages` invalida `["conversations"]` além de `["messages"]`.
 * Então a lista de conversas tem DOIS caminhos para se atualizar — e o segundo
 * só existe quando há uma conversa ABERTA (`useMessagesRealtime` fica desligado
 * sem `conversationId`).
 *
 * Se for isso, "às vezes recupera" não é intermitência: é DOIS ESTADOS
 * DIFERENTES do produto sendo medidos como se fossem um.
 */

import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { BASE, login, mensagemDeSonda } from "./qa-helpers";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const env = carregarEnvLocal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const ORG = "6e567068-fd1c-4f94-ae1f-40e0334be190";

async function main(): Promise<void> {
  const { data: conv } = await admin
    .from("conversations").select("id, contact_id").eq("organization_id", ORG).limit(1).maybeSingle();
  const c = conv as { id: string; contact_id: string };

  const browser = await chromium.launch();
  const page = await browser.newContext({ viewport: { width: 1500, height: 950 } }).then((c2) => c2.newPage());
  await login(page, "manager");
  await page.goto(`${BASE}/app/inbox`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3500);

  // Quantos canais o socket abriu — a resposta direta sobre a redundância.
  const canais = async (): Promise<string[]> => {
    const r = await fetch("https://api.supabase.com/v1/projects/rrydmwnporysaiysiztn/database/query", {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.SB_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query: "select entity::text as t from realtime.subscription order by 1",
      }),
    });
    const j = (await r.json()) as Array<{ t: string }>;
    return j.map((x) => x.t);
  };

  console.info(`SEM conversa aberta · canais: ${JSON.stringify(await canais())}`);

  // Abre uma conversa: é aqui que o SEGUNDO canal nasce.
  const item = page.locator("a[href*='/app/inbox/'], [data-conversation-id]").first();
  if (await item.count()) {
    await item.click();
    await page.waitForTimeout(4000);
  }
  console.info(`COM conversa aberta · canais: ${JSON.stringify(await canais())}`);

  // O CAMINHO CRUZADO: uma MENSAGEM nova atualiza a LISTA DE CONVERSAS?
  const antes = (await page.locator("body").textContent())?.length ?? 0;
  // Passa pelo MESMO escritor que o ingest usa — ver `mensagemDeSonda`. Inserir
  // direto pularia o carimbo da conversa e a próxima medição leria, na tela, um
  // defeito que a sonda acabou de plantar.
  const plantada = await mensagemDeSonda(admin, {
    organizationId: ORG,
    conversationId: c.id,
    direction: "inbound",
    body: `sonda de redundância ${new Date().toISOString().slice(11, 19)}`,
  });
  await page.waitForTimeout(6000);
  const depois = (await page.locator("body").textContent())?.length ?? 0;
  console.info(`INSERT em messages → a tela mudou? ${depois !== antes ? "SIM" : "NÃO"} (${antes} → ${depois} chars)`);

  await page.screenshot({ path: "evidence/wave7-inbox-redundancia.png" });

  // A sonda apaga o que plantou, pelo ID — e `apaga()` estoura se não casar
  // com exatamente uma linha.
  await plantada.apaga();
  await browser.close();
}
void main();
