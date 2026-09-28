/**
 * LGPD — prova do REDACT pelo caminho do usuário (a tela), não pelo RPC.
 *
 * Prova de banco mostra que a função roda. Prova na tela mostra que o caminho
 * que o usuário usa CHEGA até ela. São coisas diferentes, e só a segunda vale
 * como garantia de produto.
 *
 * Verifica os DOIS lados — porque um redact que apaga demais é tão errado
 * quanto um que apaga de menos:
 *
 *   DEVE SUMIR                       DEVE SOBREVIVER
 *   contato anonimizado              activity.actor_kind (fato de auditoria)
 *   mensagens: body/metadata         activity.evidence (só ids, não é PII)
 *   activity.payload/metadata        timestamps (histórico preservado)
 *   activity.reason (texto de LLM)
 *
 * Run: E2E_PORT=3020 npx tsx tests/capture-lgpd-redact.ts
 */

import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";

import { CREDS, EVIDENCE, login, shotPage } from "./qa-helpers";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const env = carregarEnvLocal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const L = CREDS.lgpd as {
  contact_id: string;
  contact_name: string;
  contact_phone: string;
  lead_id: string;
  activity_ai_id: string;
  request_id: string;
};

const resultados: { nome: string; ok: boolean; detalhe: string }[] = [];
function record(nome: string, ok: boolean, detalhe: string): void {
  resultados.push({ nome, ok, detalhe });
  console.info(`${ok ? "PASS" : "FALHA"}  ${nome} — ${detalhe}`);
}

async function estado() {
  const c = await admin
    .from("contacts")
    .select("name,email,phone_number,is_anonymized")
    .eq("id", L.contact_id)
    .single();
  if (c.error) throw new Error(`contato: ${c.error.message}`);
  const m = await admin
    .from("messages")
    .select("id,body,metadata")
    .eq("contact_id", L.contact_id);
  if (m.error) throw new Error(`mensagens: ${m.error.message}`);
  const a = await admin
    .from("crm_lead_activities")
    .select("id,type,actor_kind,reason,evidence,payload,metadata,created_at")
    .eq("lead_id", L.lead_id);
  if (a.error) throw new Error(`atividades: ${a.error.message}`);
  const r = await admin.from("lgpd_requests").select("status").eq("id", L.request_id).single();
  if (r.error) throw new Error(`request: ${r.error.message}`);
  return {
    contato: c.data as Record<string, unknown>,
    mensagens: m.data as { id: string; body: string | null; metadata: unknown }[],
    atividades: a.data as Record<string, unknown>[],
    status: (r.data as { status: string }).status,
  };
}

async function main(): Promise<void> {
  fs.mkdirSync(EVIDENCE, { recursive: true });

  const antes = await estado();
  console.info("=== ANTES ===");
  console.info(`  contato: name="${antes.contato.name}" anonimizado=${antes.contato.is_anonymized}`);
  console.info(`  mensagens: ${antes.mensagens.length}, com body: ${antes.mensagens.filter((x) => x.body).length}`);
  const aiAntes = antes.atividades.find((x) => x.id === L.activity_ai_id)!;
  console.info(`  atividade IA: reason=${aiAntes.reason ? "TEM PII" : "null"} evidence=${JSON.stringify(aiAntes.evidence)} actor_kind=${aiAntes.actor_kind}`);
  console.info(`  request: ${antes.status}`);

  if (antes.status !== "received") {
    throw new Error(`request está em "${antes.status}" — rode scripts/seed-e2e-lgpd.ts para reiniciar o caso`);
  }

  // ---- o caminho do usuário --------------------------------------------------
  const browser = await chromium.launch();
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 } })
  ).newPage();
  // Dev server compila por rota na primeira visita (40-80s). Paciência maior
  // aqui é ambiente, não produto — timeout curto viraria falso vermelho.
  page.setDefaultTimeout(90_000);
  page.setDefaultNavigationTimeout(90_000);
  await login(page, "admin");

  await page.getByRole("link", { name: "LGPD", exact: true }).click();
  await page.waitForURL(/\/app\/lgpd/, { timeout: 20_000 });
  // O dev server compila a rota na primeira visita: esperar a TABELA existir,
  // não o screenshot. Sem isso, a foto sai em branco e eu acusaria tela quebrada.
  // Esperar o LINK da solicitação, não uma linha qualquer: as primeiras linhas
  // da tabela são esqueleto de carregamento e passariam por "conteúdo pronto".
  const linkSolicitacao = page.locator(`a[href*="${L.request_id}"]`).first();
  await linkSolicitacao.waitFor({ state: "visible", timeout: 90_000 });
  console.info(`[nav] clicou em LGPD → ${page.url()} (solicitação ${L.request_id.slice(0, 8)} na lista)`);
  await shotPage(page, "lgpd-1-lista-requests.png", false);

  // Abre pelo CLIQUE na linha da solicitação — o caminho do usuário.
  // A lista mostra o titular como "ctt:<prefixo>", não pelo nome — então o alvo
  // é o link da própria solicitação.
  const linha = linkSolicitacao;
  if ((await linha.count()) === 0) {
    const texto = (await page.locator("main").first().textContent()) ?? "";
    throw new Error(
      `[lgpd] a solicitação não aparece na lista para ser clicada.\nLista diz: ${texto.replace(/\s+/g, " ").slice(0, 240)}`,
    );
  }
  await linha.click();
  await page.waitForURL(new RegExp(L.request_id), { timeout: 90_000 });
  await page.waitForLoadState("networkidle").catch(() => null);
  await shotPage(page, "lgpd-2-detalhe-request.png", false);

  const botao = page.getByRole("button", { name: /anonimiz|aprovar|confirmar/i }).first();
  if ((await botao.count()) === 0) {
    const texto = (await page.locator("main").first().textContent()) ?? "";
    throw new Error(
      `[lgpd] nenhum botão de aprovação na tela do request.\nTela diz: ${texto.replace(/\s+/g, " ").slice(0, 200)}`,
    );
  }
  await botao.click();

  const campo = page.locator("#approved_reason, textarea, input[type='text']").first();
  await campo.waitFor({ state: "visible", timeout: 10_000 });
  await campo.fill("Titular solicitou anonimizacao por e-mail em 24/07 — teste E2E do ciclo");
  await shotPage(page, "lgpd-3-confirmacao.png", false);

  const confirmar = page.getByRole("button", { name: /confirmar|anonimiz/i }).last();
  await confirmar.click();
  await page.waitForTimeout(3000);
  await shotPage(page, "lgpd-4-apos-aprovar.png", false);

  // ---- espera o cascade acontecer -------------------------------------------
  const limite = Date.now() + 45_000;
  let depois = await estado();
  while (Date.now() < limite && !depois.contato.is_anonymized) {
    await page.waitForTimeout(3000);
    depois = await estado();
  }
  await browser.close();

  console.info("\n=== DEPOIS ===");
  console.info(`  request: ${depois.status}`);
  console.info(`  contato: name="${depois.contato.name}" anonimizado=${depois.contato.is_anonymized}`);

  record(
    "UI: aprovação muda o request de received para processing",
    depois.status !== "received",
    `status "${antes.status}" → "${depois.status}"`,
  );

  const aiDepois = depois.atividades.find((x) => x.id === L.activity_ai_id);

  // --- lado A: o que TEM de sumir ---
  record(
    "contato anonimizado",
    depois.contato.is_anonymized === true && depois.contato.name !== L.contact_name,
    `is_anonymized=${depois.contato.is_anonymized} name="${depois.contato.name}"`,
  );
  const comBody = depois.mensagens.filter((x) => x.body).length;
  record(
    "mensagens: body e metadata zerados",
    comBody === 0,
    `${comBody} de ${depois.mensagens.length} mensagens ainda com body`,
  );
  record(
    "activity.reason virou NULL (texto de LLM pode ter PII)",
    aiDepois?.reason === null,
    `reason = ${aiDepois?.reason === null ? "NULL" : JSON.stringify(aiDepois?.reason).slice(0, 60)}`,
  );
  const payloadVazio =
    JSON.stringify(aiDepois?.payload ?? {}) === "{}" &&
    JSON.stringify(aiDepois?.metadata ?? {}) === "{}";
  record(
    "activity.payload e metadata zerados",
    payloadVazio,
    `payload=${JSON.stringify(aiDepois?.payload).slice(0, 50)} metadata=${JSON.stringify(aiDepois?.metadata).slice(0, 50)}`,
  );

  // --- lado B: o que NÃO pode sumir (o teste que muita gente esquece) ---
  record(
    "activity.evidence SOBREVIVEU (só ids, não é PII)",
    JSON.stringify(aiDepois?.evidence) === JSON.stringify(aiAntes.evidence),
    `antes=${JSON.stringify(aiAntes.evidence)} depois=${JSON.stringify(aiDepois?.evidence)}`,
  );
  record(
    "activity.actor_kind SOBREVIVEU (fato de auditoria)",
    aiDepois?.actor_kind === aiAntes.actor_kind,
    `antes="${aiAntes.actor_kind}" depois="${aiDepois?.actor_kind}"`,
  );
  record(
    "timestamps preservados (histórico não some)",
    aiDepois?.created_at === aiAntes.created_at,
    `created_at ${aiDepois?.created_at === aiAntes.created_at ? "intacto" : "MUDOU"}`,
  );

  const falhas = resultados.filter((x) => !x.ok);
  console.info(`\n=== LGPD: ${resultados.length - falhas.length}/${resultados.length} PASS ===`);
  for (const f of falhas) console.info(`  FALHA ${f.nome}: ${f.detalhe}`);
  if (falhas.length) process.exit(1);
}

main().catch((err) => {
  console.error("❌ Prova de LGPD falhou:", err);
  process.exit(1);
});
