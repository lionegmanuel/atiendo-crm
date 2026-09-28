/**
 * Wave 5 — o score aparece no card, com o porquê (cenário 15) e o vazio honesto
 * (cenário 17).
 *
 * As armadilhas que esta sonda existe para não cair, todas levantadas ANTES do
 * código:
 *
 *  3. PRECEDÊNCIA — com proposta pendente ou esfriando, o medidor não aparece,
 *     e isso é ACERTO. A sonda AFIRMA a pré-condição antes de olhar o medidor;
 *     sem isso, um vermelho aqui mandaria alguém caçar bug num score correto.
 *  6. O PAR NA MESMA TELA — um lead COM score e um SEM, lado a lado. Sem o par,
 *     "não apareceu" é compatível com "não funciona", e o cenário 17 passaria
 *     por vácuo.
 *
 * Run: E2E_PORT=3020 npx tsx tests/sonda-score-no-card.ts
 */
import * as fs from "node:fs";

import { chromium } from "@playwright/test";
import { Pool } from "pg";

import { BASE, CARD_ATTR, carimbar, login } from "./qa-helpers";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const sufixo = carimbar([
  "tests/sonda-score-no-card.ts",
  "components/kanban/ScoreSlot.tsx",
  "lib/kanban/card-state.ts",
  "lib/leads/score-writer.ts",
  "app/api/v1/pipelines/[id]/board/route.ts",
]);

const DB = carregarEnvLocal().SUPABASE_DB_URL!;

/**
 * Onde a sonda anota o que tirou, ANTES de tirar.
 *
 * Repor no `finally` não sobrevive à morte do processo — e ela acontece: um
 * `| head` no terminal fecha o pipe, o SIGPIPE mata o tsx, e o estado fica
 * alterado sem ninguém saber. A execução seguinte não tem como perceber,
 * porque o banco já parece "normal" (só que sem a proposta que existia).
 *
 * Por isso a reposição é IDEMPOTENTE e roda na ENTRADA: quem morreu não repõe,
 * mas o próximo a entrar repõe por ele.
 */
const RESIDUO = "evidence/.sonda-score-residuo.json";

interface Residuo {
  org: string;
  contact: string;
  texto: string;
}

async function reponResiduo(pool: Pool): Promise<void> {
  if (!fs.existsSync(RESIDUO)) return;
  const r = JSON.parse(fs.readFileSync(RESIDUO, "utf8")) as Residuo;
  await pool.query(
    `update lead_state set next_action = $3, next_action_seq = next_action_seq + 1
      where organization_id = $1 and contact_id = $2 and next_action is null`,
    [r.org, r.contact, r.texto],
  );
  fs.unlinkSync(RESIDUO);
  console.info("(repus a proposta que uma execução anterior deixou pendente)");
}

async function main(): Promise<void> {
  const creds = JSON.parse(fs.readFileSync(".e2e-creds.json", "utf8")) as {
    crm_vivo: { pipeline_id: string };
  };
  const pipelineId = creds.crm_vivo.pipeline_id;
  const pool = new Pool({ connectionString: DB });
  await reponResiduo(pool);

  // ALVO COM SCORE que satisfaz a pré-condição da precedência: sem proposta
  // pendente (o slot é um só) e sem estar esfriando.
  const { rows: comScore } = await pool.query<{ id: string; title: string; prob: string; band: string }>(
    `select l.id, l.title, sc.ai_probability::text as prob, sc.ai_probability_band as band
       from crm_leads l
       join crm_lead_scores sc on sc.lead_id = l.id
       left join lead_state ls
              on ls.contact_id = l.contact_id and ls.organization_id = l.organization_id
      where l.pipeline_id = $1 and l.status = 'open'
        and sc.ai_probability is not null
        and (ls.next_action is null or btrim(ls.next_action) = '')
      order by l.title
      limit 1`,
    [pipelineId],
  );
  let alvo = comScore[0];
  let propostaLiberada: { contact: string; org: string; texto: string } | null = null;

  if (!alvo) {
    // ACHADO, não contorno: no dado real TODO lead com sinal suficiente tem
    // proposta pendente — os dois vêm do harness, que escreve checkpoint e
    // next_action no mesmo turno. Como o slot é um só e `awaiting` vem antes de
    // `meter`, o medidor fica escondido justamente onde o score existe.
    //
    // A sonda encena o gesto que o produto espera: o humano DECIDE a proposta,
    // o slot libera, e o score aparece. Guarda o texto e repõe no fim — não se
    // deixa o banco diferente de como se achou.
    const { rows } = await pool.query<{
      id: string; title: string; prob: string; band: string; contact_id: string;
      organization_id: string; next_action: string;
    }>(
      `select l.id, l.title, sc.ai_probability::text as prob, sc.ai_probability_band as band,
              l.contact_id, l.organization_id, ls.next_action
         from crm_leads l
         join crm_lead_scores sc on sc.lead_id = l.id
         join lead_state ls
           on ls.contact_id = l.contact_id and ls.organization_id = l.organization_id
        where l.pipeline_id = $1 and l.status = 'open' and sc.ai_probability is not null
        order by l.title
        limit 1`,
      [pipelineId],
    );
    const candidato = rows[0];
    if (!candidato) throw new Error("nenhum lead com score no board — nada a provar");
    console.info(
      `PRECEDÊNCIA: "${candidato.title}" tem proposta pendente, então o medidor está escondido ` +
        `pelo slot único. Encenando a decisão humana para liberá-lo.`,
    );
    // ANOTA ANTES DE TIRAR: se este processo morrer agora, a execução seguinte
    // encontra o bilhete e repõe. Anotar depois seria anotar o que talvez não
    // tenha acontecido; anotar antes, no pior caso, repõe o que já estava lá.
    fs.writeFileSync(
      RESIDUO,
      JSON.stringify({
        org: candidato.organization_id,
        contact: candidato.contact_id,
        texto: candidato.next_action,
      }),
    );
    await pool.query(
      `update lead_state set next_action = null, next_action_seq = next_action_seq + 1
        where organization_id = $1 and contact_id = $2`,
      [candidato.organization_id, candidato.contact_id],
    );
    propostaLiberada = {
      contact: candidato.contact_id,
      org: candidato.organization_id,
      texto: candidato.next_action,
    };
    alvo = { id: candidato.id, title: candidato.title, prob: candidato.prob, band: candidato.band };
  }

  const { rows: semScore } = await pool.query<{ id: string; title: string }>(
    `select l.id, l.title
       from crm_leads l
       left join crm_lead_scores sc on sc.lead_id = l.id
      where l.pipeline_id = $1 and l.status = 'open'
        and (sc.lead_id is null or sc.ai_probability is null)
      order by l.title
      limit 1`,
    [pipelineId],
  );
  const controle = semScore[0];
  if (!controle) throw new Error("nenhum lead SEM score — o par do cenário 17 não existe");

  console.info(`alvo COM score:  "${alvo.title}" → ${alvo.prob}% ${alvo.band}`);
  console.info(`controle SEM:    "${controle.title}"`);

  const browser = await chromium.launch();
  const page = await browser
    .newContext({ viewport: { width: 1900, height: 950 } })
    .then((c) => c.newPage());
  try {
    await login(page, "manager");
    await page.goto(`${BASE}/app/pipelines/${pipelineId}`, { waitUntil: "networkidle" });

    const card = page.locator(`[${CARD_ATTR}="${alvo.id}"]`);
    await card.waitFor({ state: "visible", timeout: 20_000 });
    // Centraliza o alvo: o popover abre para cima quando o card está no rodapé
    // da coluna, e a captura sai cobrindo o card VIZINHO — quem olhasse a
    // evidência veria o painel ancorado no lugar errado. Evidência ambígua é
    // evidência fraca.
    await card.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(1_000);

    // PRÉ-CONDIÇÃO EXPLÍCITA (armadilha 3), no teste e não no comentário.
    const temProposta = await card.getByRole("button", { name: /^Aprovar:/ }).count();
    console.info(`0. pré-condição — o alvo NÃO tem proposta pendente: ${temProposta === 0}`);

    const medidor = card.getByRole("button", { name: /^Probabilidade/ });
    const mostraMedidor = await medidor.isVisible().catch(() => false);
    const texto = (await card.textContent()) ?? "";
    const mostraNumero = texto.includes(`${Math.round(Number(alvo.prob))}%`);
    console.info(`1. o card mostra o medidor: ${mostraMedidor}`);
    console.info(`2. e o número: ${mostraNumero}`);

    await page.screenshot({ path: `evidence/wave5-15-card-com-score${sufixo}.png` });

    // O PORQUÊ a um gesto: clique (que é o gatilho que existe em toque também).
    await medidor.click();
    await page.waitForTimeout(600);
    const painel = page.getByTestId("score-evidencias");
    const abriu = await painel.isVisible().catch(() => false);
    const conteudo = abriu ? ((await painel.textContent()) ?? "") : "";
    const temEvidencias = /[+−]\d+/.test(conteudo);
    console.info(`3. o porquê abre ao clique: ${abriu}`);
    console.info(`4. e traz as evidências com peso: ${temEvidencias}`);
    if (abriu) console.info(`   painel: ${conteudo.slice(0, 120).replace(/\s+/g, " ")}`);
    await page.screenshot({ path: `evidence/wave5-15-evidencias-abertas${sufixo}.png` });
    await page.keyboard.press("Escape");

    // CENÁRIO 17, NA MESMA TELA (armadilha 6).
    const cardCtrl = page.locator(`[${CARD_ATTR}="${controle.id}"]`);
    await cardCtrl.waitFor({ state: "visible", timeout: 10_000 });
    const ctrlMedidor = await cardCtrl.getByRole("button", { name: /^Probabilidade/ }).count();
    const ctrlTexto = (await cardCtrl.textContent()) ?? "";
    const semScoreInventado = ctrlMedidor === 0 && !/\d+%/.test(ctrlTexto);
    console.info(`5. o lead sem sinal NÃO mostra score inventado: ${semScoreInventado}`);

    const passou =
      temProposta === 0 && mostraMedidor && mostraNumero && abriu && temEvidencias && semScoreInventado;
    console.info(
      passou
        ? "PASS   cenário 15 (medidor + porquê) e 17 (vazio honesto), na mesma tela"
        : "FALHA  ver as linhas acima",
    );
    if (!passou) process.exitCode = 1;
  } finally {
    await browser.close();
    if (propostaLiberada) {
      // Repõe o que a sonda tirou: o banco tem de ficar como estava.
      await pool.query(
        `update lead_state set next_action = $3, next_action_seq = next_action_seq + 1
          where organization_id = $1 and contact_id = $2`,
        [propostaLiberada.org, propostaLiberada.contact, propostaLiberada.texto],
      );
      if (fs.existsSync(RESIDUO)) fs.unlinkSync(RESIDUO);
    }
    await pool.end();
  }
}

void main();
