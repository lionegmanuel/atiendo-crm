/**
 * Wave 4 — a próxima ação do agente aparece e pode ser decidida (cenários 13 e 14).
 *
 * O defeito que esta wave mata: `next_action` era calculada, gravada e NUNCA
 * exibida a ninguém. A prova, portanto, tem que ser NA TELA — ver o texto que o
 * agente escreveu e decidir sobre ele.
 *
 * 13. card com proposta mostra a linha do agente com os botões; Aprovar gera
 *     atividade; Descartar TAMBÉM gera atividade (a recusa é sinal);
 * 14. card sem proposta mostra o estado NORMAL — nunca slot vazio, nunca "—".
 *
 * Run: E2E_PORT=3020 npx tsx tests/sonda-proxima-acao.ts
 */
import * as fs from "node:fs";

import { chromium, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { BASE, CARD_ATTR, carimbar, login } from "./qa-helpers";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const OUT = "evidence";
const sufixo = carimbar([
  // A PRÓPRIA SONDA entra na lista: instrumento não commitado produz veredito
  // irreprodutível do mesmo jeito que produto não commitado. Declarar só as
  // dependências do produto deixa o carimbo dizer "limpas" enquanto a régua
  // muda debaixo do resultado.
  "tests/sonda-proxima-acao.ts",
  "lib/leads/next-action.ts",
  "components/kanban/NextActionSlot.tsx",
  "hooks/kanban/useNextAction.ts",
  "app/api/v1/leads/[id]/next-action/route.ts",
  "app/api/v1/pipelines/[id]/board/route.ts",
]);

const env = carregarEnvLocal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function foto(page: Page, nome: string): Promise<void> {
  await page.screenshot({ path: `${OUT}/wave4-${nome}${sufixo}.png` });
}

async function main(): Promise<void> {
  const creds = JSON.parse(fs.readFileSync(".e2e-creds.json", "utf8")) as {
    crm_vivo: { pipeline_id: string };
  };
  const pipelineId = creds.crm_vivo.pipeline_id;

  const { data: pipeline } = await admin
    .from("crm_pipelines")
    .select("organization_id")
    .eq("id", pipelineId)
    .maybeSingle();
  const org = (pipeline as { organization_id: string }).organization_id;

  // Alvo REAL: um negócio cujo contato tem `next_action` escrita pelo agente.
  const { data: estados } = await admin
    .from("lead_state")
    .select("contact_id, next_action")
    .eq("organization_id", org)
    .not("next_action", "is", null);
  const contatos = (estados ?? []).map((e) => (e as { contact_id: string }).contact_id);
  const { data: leads } = await admin
    .from("crm_leads")
    .select("id, title, contact_id")
    .eq("pipeline_id", pipelineId)
    .eq("status", "open")
    .in("contact_id", contatos);
  const alvo = (leads ?? [])[0] as { id: string; title: string; contact_id: string } | undefined;
  if (!alvo) throw new Error("nenhum negócio com próxima ação — nada a provar");
  const proposta = (estados ?? []).find(
    (e) => (e as { contact_id: string }).contact_id === alvo.contact_id,
  ) as { next_action: string };

  // Lead SEM proposta, para o cenário 14 — na MESMA tela, senão a comparação
  // seria entre dois estados do produto em momentos diferentes.
  const { data: semProposta } = await admin
    .from("crm_leads")
    .select("id, title")
    .eq("pipeline_id", pipelineId)
    .eq("status", "open")
    .not("contact_id", "in", `(${contatos.join(",")})`)
    .limit(1);
  const controle = (semProposta ?? [])[0] as { id: string; title: string } | undefined;

  console.info(`alvo COM proposta: "${alvo.title}"`);
  console.info(`  proposta do agente: "${proposta.next_action}"`);
  console.info(`controle SEM proposta: "${controle?.title ?? "(nenhum)"}"`);

  /**
   * Escreve a proposta como o AGENTE escreve: incrementando a identidade.
   *
   * Um UPDATE que só troca o texto não é o caminho de produção — `next_action_seq`
   * é o que distingue "a mesma proposta" de "a mesma frase", e a sonda que
   * esquecesse o incremento estaria testando um estado que o sistema nunca
   * produz. O incremento real vive em `applyLeadStateUpdate`; aqui ele é
   * reproduzido, e o invariante `next-action-identity` prova que o de lá faz o
   * mesmo contra Postgres de verdade.
   */
  async function reescreveProposta(texto: string): Promise<void> {
    const { data: atual } = await admin
      .from("lead_state")
      .select("next_action_seq")
      .eq("organization_id", org)
      .eq("contact_id", alvo!.contact_id)
      .maybeSingle();
    await admin
      .from("lead_state")
      .update({
        next_action: texto,
        next_action_seq: ((atual as { next_action_seq: number } | null)?.next_action_seq ?? 0) + 1,
      })
      .eq("organization_id", org)
      .eq("contact_id", alvo!.contact_id);
  }

  const browser = await chromium.launch();
  const page = await browser
    .newContext({ viewport: { width: 1900, height: 950 } })
    .then((c) => c.newPage());
  await login(page, "manager");
  await page.goto(`${BASE}/app/pipelines/${pipelineId}`, { waitUntil: "networkidle" });

  const card = page.locator(`[${CARD_ATTR}="${alvo.id}"]`);
  await card.waitFor({ state: "visible", timeout: 20_000 });
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1_200);
  await foto(page, "13-antes");

  // CENÁRIO 13 — o texto do agente está na tela, com decisão ao lado.
  const textoNaTela = (await card.textContent()) ?? "";
  const mostraProposta = textoNaTela.includes(proposta.next_action.slice(0, 30));
  const temAprovar = await card.getByRole("button", { name: /^Aprovar:/ }).isVisible();
  const temDescartar = await card.getByRole("button", { name: /^Ignorar:/ }).isVisible();
  console.info(`13a. o card mostra o texto que o agente escreveu: ${mostraProposta}`);
  console.info(`13b. botões de decisão visíveis: aprovar=${temAprovar} ignorar=${temDescartar}`);

  // CENÁRIO 14 — o card sem proposta não inventa slot vazio nem "—".
  let semSlotVazio = true;
  if (controle) {
    const cardCtrl = page.locator(`[${CARD_ATTR}="${controle.id}"]`);
    await cardCtrl.waitFor({ state: "visible", timeout: 10_000 });
    const temBotao = await cardCtrl.getByRole("button", { name: /^(Aprovar|Ignorar):/ }).count();
    const texto = (await cardCtrl.textContent()) ?? "";
    semSlotVazio = temBotao === 0 && !texto.includes("Propõe:");
    console.info(`14. card sem proposta fica no estado normal: ${semSlotVazio}`);
  }

  // APROVAR gera atividade.
  const antes = await admin
    .from("crm_lead_activities")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", alvo.id);
  await card.getByRole("button", { name: /^Aprovar:/ }).click();
  await page.waitForTimeout(2_500);
  await foto(page, "13-depois-de-aprovar");
  const { data: atividades } = await admin
    .from("crm_lead_activities")
    .select("type, reason, actor_kind")
    .eq("lead_id", alvo.id)
    .in("type", ["next_action_approved", "next_action_dismissed"]);
  const aprovou = (atividades ?? []).some(
    (a) => (a as { type: string }).type === "next_action_approved",
  );
  console.info(`13c. aprovar gerou atividade: ${aprovou} (antes havia ${antes.count ?? 0} no total)`);
  if (aprovou) {
    const a = (atividades ?? []).find(
      (x) => (x as { type: string }).type === "next_action_approved",
    ) as { reason: string; actor_kind: string };
    console.info(`     motivo legível: "${a.reason}" · ator: ${a.actor_kind}`);
  }

  // O slot some depois de decidido — senão o card pediria a mesma decisão de novo.
  const aindaPede = await card.getByRole("button", { name: /^Aprovar:/ }).count();
  console.info(`13d. a proposta sai de cena depois de decidida: ${aindaPede === 0}`);

  // IGNORAR também gera atividade — a recusa é sinal. Sem esta perna, "os dois
  // geram atividade" ficaria pela metade e ninguém notaria: o caminho feliz
  // sozinho passa igual.
  await reescreveProposta(proposta.next_action);
  await page.reload({ waitUntil: "networkidle" });
  await card.getByRole("button", { name: /^Ignorar:/ }).click();
  await page.waitForTimeout(2_500);
  await foto(page, "13-depois-de-ignorar");
  const { data: apósIgnorar } = await admin
    .from("crm_lead_activities")
    .select("type, reason")
    .eq("lead_id", alvo.id)
    .eq("type", "next_action_dismissed");
  const ignorou = (apósIgnorar ?? []).length > 0;
  console.info(`13e. ignorar gerou atividade: ${ignorou}`);
  if (ignorou) {
    console.info(`     motivo: "${(apósIgnorar ?? [])[0]!.reason}"`);
  }

  // AUTORIZAÇÃO VENCIDA: o agente reescreve a proposta entre o render e o
  // clique. O sistema não pode executar a NOVA em nome de quem leu a ANTIGA.
  await reescreveProposta(proposta.next_action);
  await page.reload({ waitUntil: "networkidle" });
  await card.getByRole("button", { name: /^Aprovar:/ }).waitFor({ timeout: 10_000 });
  // ... e AGORA o agente muda de ideia, com a tela já renderizada.
  // O TEXTO É O MESMO de propósito: é o caso que derrubou a trava por texto.
  // Se a trava ainda comparasse o texto, isto passaria — e o humano teria
  // autorizado uma proposta para o sistema executar outra.
  await reescreveProposta(proposta.next_action);
  const antesDaTrava = (
    await admin
      .from("crm_lead_activities")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", alvo.id)
  ).count ?? 0;
  const resposta = page.waitForResponse((r) => r.url().includes("/next-action"), {
    timeout: 15_000,
  });
  await card.getByRole("button", { name: /^Aprovar:/ }).click();
  const status = (await resposta).status();
  await page.waitForTimeout(1_500);
  const depoisDaTrava = (
    await admin
      .from("crm_lead_activities")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", alvo.id)
  ).count ?? 0;
  const travou = status === 409 && depoisDaTrava === antesDaTrava;
  console.info(
    `13f. autorização vencida recusada: ${travou} (HTTP ${status}, atividades ${antesDaTrava} → ${depoisDaTrava})`,
  );
  await foto(page, "13-autorizacao-vencida");

  // Limpa o que escreveu: a sonda não pode deixar o banco diferente de como
  // achou, senão a próxima execução mede outro produto.
  await reescreveProposta(proposta.next_action);

  const passou =
    mostraProposta && temAprovar && temDescartar && semSlotVazio && aprovou && ignorou && travou;
  console.info(passou ? "PASS   cenários 13 e 14" : "FALHA  ver linhas acima");
  if (!passou) process.exitCode = 1;

  await browser.close();
}

void main();
