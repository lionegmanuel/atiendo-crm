/**
 * Sonda do orquestrador — o pulso é VISÍVEL, ou só existe no DOM?
 *
 * O `data-pulse` do card prova que o overlay REMONTOU. Não prova que alguém viu
 * nada. Depois do forward-fix (f5d3afb) a animação passou a viver num overlay
 * `absolute inset-0`, e ela é `box-shadow: 0 0 0 2px`, que desenha PARA FORA da
 * caixa do elemento — enquanto o card é `overflow-hidden`. Pela geometria, o
 * anel inteiro cai na área recortada.
 *
 * Nenhuma leitura de estilo computado resolve isso: `boxShadow` continua
 * reportando o valor mesmo quando o pai o recorta. Só o PIXEL decide.
 *
 * Método: fotografa o card em repouso, dispara um evento REMOTO PURO (update
 * direto no banco, ninguém agindo na aba), fotografa durante o pulso, e compara
 * os bytes. Iguais = o usuário não viu nada.
 *
 * Run: E2E_PORT=3020 npx tsx tests/sonda-pulso-visivel.ts
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";

import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { BASE, CARD_ATTR, EVIDENCE, carimbar, login } from "./qa-helpers";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const env = carregarEnvLocal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const hash = (b: Buffer): string => createHash("sha1").update(b).digest("hex").slice(0, 12);

async function main(): Promise<void> {
  const { data: leads } = await admin
    .from("crm_leads")
    .select("id, title, position_in_stage, pipeline_id")
    .limit(1)
    .order("updated_at", { ascending: false });
  const lead = leads?.[0];
  if (!lead) throw new Error("sem lead para provocar");

  // As dependências desta prova, DECLARADAS: se qualquer uma estiver suja, o
  // resultado não é veredito e o print nasce marcado. Foi medindo o globals.css
  // não commitado que esta sonda me fez desmentir uma previsão minha correta.
  const sufixo = carimbar([
    "app/globals.css",
    "components/kanban/KanbanCard.tsx",
    "hooks/kanban/useBoard.ts",
  ]);

  const browser = await chromium.launch();
  // REDUCED=1 troca o contexto para movimento reduzido: é o caminho que o §5
  // promete ser IGUAL, não degradado, e a única promessa da wave que ninguém
  // tinha medido na tela.
  const reduzido = process.env.REDUCED === "1";
  const page = await browser
    .newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: reduzido ? "reduce" : "no-preference",
      colorScheme: "light",
    })
    .then((c) => c.newPage());
  await login(page, "admin");
  await page.goto(`${BASE}/app/pipelines/${lead.pipeline_id}`, { waitUntil: "networkidle" });

  const card = page.locator(`[${CARD_ATTR}="${lead.id}"]`).first();
  await card.waitFor({ state: "visible", timeout: 20_000 });

  const repouso = await card.screenshot();
  fs.writeFileSync(`${EVIDENCE}/sonda-pulso-repouso${sufixo}.png`, repouso);

  // Evento REMOTO PURO: ninguém agiu nesta aba, então não há eco local a
  // consumir — é exatamente o caso que o pulso existe para anunciar.
  await admin
    .from("crm_leads")
    .update({ position_in_stage: Number(lead.position_in_stage ?? 1) + 0.001 })
    .eq("id", lead.id);

  // Espera o overlay NASCER (o observável que o próprio dev expôs), e só então
  // fotografa: dormir por tempo fixo fotografaria antes ou depois do pulso.
  const overlay = card.locator("[data-pulse]");
  await overlay.waitFor({ state: "attached", timeout: 15_000 });
  const contador = await overlay.getAttribute("data-pulse");

  const durante = await card.screenshot();
  fs.writeFileSync(`${EVIDENCE}/sonda-pulso-durante${sufixo}.png`, durante);

  // O A/B QUE ISOLA A VARIÁVEL: durante × DEPOIS, não durante × antes.
  // Comparar com o repouso ANTERIOR seria confundido — o evento que dispara o
  // pulso também muda o dado do card (e pode reordená-lo), então duas coisas
  // mudam entre as duas fotos. Aqui o dado é o mesmo nos dois lados e só o
  // overlay sai: uma variável. (O `repouso` fica gravado só como contexto.)
  await overlay.waitFor({ state: "detached", timeout: 15_000 });
  const depois = await card.screenshot();
  fs.writeFileSync(`${EVIDENCE}/sonda-pulso-depois${sufixo}.png`, depois);

  const iguais = hash(durante) === hash(depois);
  console.info(`overlay nasceu, data-pulse=${contador}`);
  console.info(
    `repouso(antes) ${hash(repouso)} · durante ${hash(durante)} · depois ${hash(depois)}`,
  );
  console.info(
    iguais
      ? "FALHA  durante == depois: o overlay existe no DOM e o usuário não vê nada"
      : "PASS   durante != depois: há sinal visível, e a única diferença é o overlay",
  );

  await browser.close();
  if (iguais) process.exitCode = 1;
}

void main();
