/**
 * CENÁRIO 23 — O CICLO INTEIRO, NUMA GRAVAÇÃO.
 *
 * O contrato promete uma volta completa: o negócio esfria, o sistema propõe
 * retomar COM PRAZO, o humano aceita, o agente envia, a atividade fica
 * registrada, o estado volta ao normal e o card anda. Sete elos — e o valor está
 * em serem SETE, não em cada um funcionar sozinho. Cada elo já foi provado
 * separado por alguém; ninguém tinha percorrido a volta.
 *
 * POR QUE UMA GRAVAÇÃO E NÃO SÓ ASSERÇÕES: a promessa é de CONTINUIDADE. Sete
 * verdes em sete execuções separadas não provam que a volta fecha — provam sete
 * pedaços. O vídeo é a única forma de alguém ver a mesma tela atravessando os
 * sete estados sem corte.
 *
 * O QUE ESTE APARATO NÃO CONSEGUE PROVAR, e vai declarado antes de rodar: o elo
 * do ENVIO depende de um worker consumindo `cron_jobs`, e não há worker vivo
 * neste ambiente — há inclusive 4 `followup_turn` vencidos na fila, de aceites
 * anteriores que ninguém consumiu. Eu não subo worker: consumir fila alheia é
 * proibido e roubaria trabalho de outra sessão. Então aquele elo é BLOQUEADO com
 * a razão, nunca verde por omissão — e o que dá para provar dele é o COMPROMISSO
 * (a linha em `cron_jobs` que o aceite cria), que é coisa diferente do envio.
 *
 * Run: E2E_PORT=3020 npx tsx tests/capture-cenario-23-ciclo.ts
 */
import { chromium, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { BASE, CARD_ATTR, CREDS, carimbar, criarPlacar, login } from "./qa-helpers";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const env = carregarEnvLocal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const ORG = CREDS.org_id as string;
const PIPE = (CREDS.crm_vivo as { pipeline_id: string }).pipeline_id;
const DONO = (CREDS.users as Record<string, { id: string }>).manager!.id;
const RUN = randomUUID().slice(0, 6);
const TITULO = `QA-C23 ${RUN}`;
const VIDEO_DIR = path.join(process.cwd(), "evidence", "video-c23");

/**
 * TODA CONSULTA PASSA POR AQUI, e a razão é um vermelho que eu quase reportei
 * como defeito do produto: eu ordenei `crm_lead_reactivations` por `created_at`,
 * que não existe naquela tabela. O PostgREST devolveu erro, eu li só o `data`
 * (null), e o critério anunciou "a proposta ficou (nenhuma)" — acusando o
 * servidor de não gravar uma decisão que ele tinha gravado. Consulta que falha
 * e consulta que não encontra produzem o MESMO `data`, e só o `error` separa.
 *
 * Isto conta fragilidade: se algum dia o schema mudar debaixo deste aparato, ele
 * PARA em vez de reprovar o produto por engano.
 */
async function consulta<T>(rotulo: string, p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T | null> {
  const { data, error } = await p;
  if (error) throw new Error(`[consulta ${rotulo}] ${error.message}`);
  return data;
}

/** O relógio do produto, não o meu: a passada do risco é a mesma que o cron
 *  dispara em produção, chamada do mesmo jeito. Mexer no estado por SQL
 *  provaria a tela e mentiria sobre a origem. */
async function passadaDoRisco(): Promise<number> {
  const segredo = env.INTERNAL_CRON_SECRET ?? env.INTERNAL_SECRET;
  const r = await fetch(`${BASE}/api/v1/cron/risk-watcher`, {
    method: "POST",
    headers: { authorization: `Bearer ${segredo}` },
  });
  return r.status;
}

async function main(): Promise<void> {
  carimbar([
    "tests/capture-cenario-23-ciclo.ts",
    "components/kanban/ReactivationSlot.tsx",
    "app/api/v1/leads/[id]/reactivation/route.ts",
    "lib/leads/reactivation.ts",
    "lib/leads/risk-worker.ts",
  ]);

  const { record, fechar } = criarPlacar("CENÁRIO 23 · o ciclo", [
    "E1.esfria",
    "E2.propoe-com-prazo",
    "E3.humano-aceita",
    "E4.agente-envia",
    "E5.atividade-registrada",
    "E6.estado-volta",
    "E7.card-anda",
  ]);

  // ---- o caso: um negócio COM CONTATO que parou de responder ----------------
  const { data: estagios } = await admin
    .from("crm_stages")
    .select("id")
    .eq("pipeline_id", PIPE)
    .order("position")
    .limit(1);
  const stageId = ((estagios ?? [])[0] as { id: string }).id;
  const { data: contatos } = await admin
    .from("contacts")
    .select("id")
    .eq("organization_id", ORG)
    .order("id")
    .limit(1);
  const contactId = ((contatos ?? [])[0] as { id: string }).id;

  const parado = new Date(Date.now() - 45 * 24 * 3_600_000).toISOString();
  const { data: criado, error: erroLead } = await admin
    .from("crm_leads")
    .insert({
      organization_id: ORG,
      pipeline_id: PIPE,
      stage_id: stageId,
      contact_id: contactId,
      title: TITULO,
      owner_user_id: DONO,
      owner_kind: "user",
      status: "open",
      position_in_stage: 500,
      last_activity_at: parado,
    } as never)
    .select("id")
    .single();
  if (erroLead || !criado) throw new Error(`criar lead: ${erroLead?.message}`);
  const leadId = (criado as { id: string }).id;
  console.info(`[caso] ${TITULO} · lead ${leadId.slice(0, 8)} · parado desde ${parado.slice(0, 10)}`);

  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: VIDEO_DIR, size: { width: 1440, height: 900 } },
  });
  const page: Page = await ctx.newPage();
  page.setDefaultTimeout(60_000);

  const card = () => page.locator(`[${CARD_ATTR}="${leadId}"]`).first();
  const textoDoCard = async (): Promise<string> =>
    ((await card().innerText().catch(() => "")) ?? "").replace(/\s+/g, " ");

  try {
    await login(page, "manager");
    await page.goto(`${BASE}/app/pipelines/${PIPE}`);
    await page.waitForTimeout(2500);

    // ---- E1: esfria ---------------------------------------------------------
    const status = await passadaDoRisco();
    await page.reload();
    await page.waitForTimeout(2500);
    const { data: esfriou } = await admin
      .from("crm_lead_activities")
      .select("type,reason")
      .eq("lead_id", leadId)
      .eq("type", "lead_cooled");
    const linhasFrias = ((esfriou ?? []) as unknown[]).length;
    record(
      "E1.esfria",
      "o negócio parado é reconhecido como esfriado, pela passada do produto",
      linhasFrias > 0,
      status !== 200
        ? `INCONCLUSIVO: a passada do risco respondeu ${status} — sem ela rodar, "não esfriou" ` +
          `não distingue produto de ambiente`
        : linhasFrias > 0
          ? `a passada registrou ${linhasFrias} linha(s) de esfriamento na timeline`
          : `a passada rodou (200) e o negócio parado há 45 dias NÃO foi marcado como esfriado`,
      status !== 200 ? "INCONCLUSIVO" : undefined,
    );

    // ---- E2: propõe com prazo ----------------------------------------------
    const txt2 = await textoDoCard();
    const ofereceu = /retomar contato/i.test(txt2);
    // O PRAZO É O CRITÉRIO, não a oferta. Proposta com prazo que não mostra o
    // prazo é a simulação de atenção que o prazo existe para evitar — e passaria
    // num teste que só procurasse o botão.
    const mostraPrazo = /·\s*(vencendo|\d+\s*(min|h|d))\b/i.test(txt2);
    record(
      "E2.propoe-com-prazo",
      "o card oferece retomar E mostra quanto tempo resta",
      ofereceu && mostraPrazo,
      !ofereceu
        ? `o card não oferece retomada — texto: "${txt2.slice(0, 120)}"`
        : mostraPrazo
          ? `oferta e prazo na mesma faixa: "${txt2.slice(0, 120)}"`
          : `oferece retomar SEM dizer quanto resta: "${txt2.slice(0, 120)}"`,
    );

    // ---- E3: humano aceita --------------------------------------------------
    const botao = card().getByRole("button", { name: /retomar/i }).first();
    const temBotao = (await botao.count()) > 0;
    if (temBotao) {
      await botao.click();
      await page.waitForTimeout(3000);
    }
    const proposta = await consulta<{ status: string }[]>(
      "proposta",
      admin
        .from("crm_lead_reactivations")
        .select("status")
        .eq("lead_id", leadId)
        .order("proposed_at", { ascending: false })
        .limit(1),
    );
    const estadoProposta = (proposta ?? [])[0]?.status ?? "(nenhuma)";
    record(
      "E3.humano-aceita",
      "o clique do humano vira decisão registrada no servidor",
      estadoProposta === "accepted",
      !temBotao
        ? "BLOQUEADO: não havia botão para clicar — o elo anterior não entregou a oferta"
        : `a proposta ficou "${estadoProposta}" (esperado accepted)`,
      !temBotao ? "BLOQUEADO" : undefined,
    );

    // ---- E4: agente envia ---------------------------------------------------
    // O COMPROMISSO PRECISA SOBREVIVER, não só nascer. A versão anterior lia a
    // linha logo depois do aceite e dizia "o compromisso existe" — medição no
    // instante zero. Varrendo o banco depois, achei SETE envios de reativação
    // todos com `enabled=false`, sem erro registrado e sem nenhum turno de
    // agente: o padrão da coluna é `true`, então algo os desabilitou DEPOIS. Um
    // compromisso que nasce e é desligado em silêncio passaria no meu critério
    // e não chegaria ao cliente.
    await new Promise((r) => setTimeout(r, 5000));
    const jobs = await consulta<{ enabled: boolean; payload?: { source?: string } }[]>(
      "cron_jobs",
      admin
        .from("cron_jobs")
        .select("id,job_kind,next_run_at,enabled,payload")
        .eq("organization_id", ORG)
        .eq("contact_id", contactId)
        .eq("job_kind", "followup_turn")
        .order("next_run_at", { ascending: false })
        .limit(1),
    );
    const job = (jobs ?? [])[0];
    const comprometeu = job?.payload?.source === "reactivation";
    const continuaLigado = job?.enabled === true;
    record(
      "E4.agente-envia",
      "o aceite vira envio do agente",
      false,
      `BLOQUEADO: não há worker consumindo cron_jobs neste ambiente (4 followup_turn já vencidos ` +
        `na fila, de aceites anteriores). Subir um consumiria fila de outra sessão. O que dá para ` +
        `provar é o COMPROMISSO: ${
          !comprometeu
            ? "NENHUMA linha de envio foi criada — nem o compromisso existe"
            : continuaLigado
              ? "a linha de envio foi criada com source=reactivation e CONTINUA habilitada 5s depois"
              : "a linha de envio foi criada com source=reactivation e JÁ ESTAVA DESABILITADA 5s " +
                "depois — o compromisso nasceu e foi desligado, o que nenhum critério que lê no " +
                "instante zero enxergaria"
        }. ` +
        `Compromisso não é envio, e chamar isto de verde seria dar por entregue o único elo que ` +
        `fala com o cliente.`,
      "BLOQUEADO",
    );

    // ---- E5: atividade registrada ------------------------------------------
    await card().click();
    await page.waitForTimeout(2000);
    const painel = page.locator('[role="dialog"], [data-state="open"]').last();
    const txtPainel = ((await painel.innerText().catch(() => "")) ?? "").replace(/\s+/g, " ");
    const { data: ativs } = await admin
      .from("crm_lead_activities")
      .select("type")
      .eq("lead_id", leadId)
      .eq("type", "reactivation_accepted");
    const registrou = ((ativs ?? []) as unknown[]).length > 0;
    // NA TELA, não só no banco: "registrado" que não aparece é log morto, e a
    // wave 6 inteira foi sobre isso.
    const apareceNaTimeline = /retomad|reativa|retomar/i.test(txtPainel);
    record(
      "E5.atividade-registrada",
      "a decisão vira linha na timeline do negócio, visível",
      registrou && apareceNaTimeline,
      !registrou
        ? "nenhuma atividade de retomada foi gravada"
        : apareceNaTimeline
          ? "a decisão está gravada E aparece no dossiê"
          : `gravada no banco mas AUSENTE do dossiê — painel: "${txtPainel.slice(0, 140)}"`,
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1200);

    // ---- E6: estado volta ao normal ----------------------------------------
    const status2 = await passadaDoRisco();
    await page.reload();
    await page.waitForTimeout(2500);
    const estado = await consulta<{ bucket: string }[]>(
      "estado de risco",
      admin.from("crm_lead_risk_states").select("bucket").eq("lead_id", leadId).limit(1),
    );
    const bucket = (estado ?? [])[0]?.bucket ?? "(sem estado)";
    // O QUE A PASSADA LÊ PARA DECIDIR. Sem este número, "continua crítico" não
    // distingue "a retomada não moveu o relógio do negócio" de "moveu e a regra
    // de saída pede outra coisa" — e são defeitos diferentes.
    const leadAgora = await consulta<{ last_activity_at: string | null }[]>(
      "última atividade",
      admin.from("crm_leads").select("last_activity_at").eq("id", leadId).limit(1),
    );
    const ultima = (leadAgora ?? [])[0]?.last_activity_at ?? "(nula)";
    // O QUE TIRA O NEGÓCIO DO RISCO É MOVIMENTO, E `reactivation_accepted` NÃO
    // CONTA COMO MOVIMENTO — por decisão declarada no próprio gatilho, que traz
    // uma LISTA POSITIVA ("só isto conta como alguém tocou este negócio") e
    // manda ler o cabeçalho da migration antes de acrescentar linha nela.
    // Aceitar é autorizar; quem quebra o silêncio é o ENVIO, que emite `ai_turn`
    // — e `ai_turn` está na lista.
    //
    // Então este elo não é reprovável enquanto o envio não acontece: ele é
    // BLOQUEADO PELA MESMA CAUSA do E4. Chamar de vermelho seria acusar o
    // produto de não fechar um ciclo que ninguém deixou rodar até o fim — e eu
    // quase o fiz, com o número certo e a leitura errada.
    const turnos = await consulta<{ id: string }[]>(
      "turno do agente",
      admin.from("crm_lead_activities").select("id").eq("lead_id", leadId).eq("type", "ai_turn"),
    );
    const houveEnvio = (turnos ?? []).length > 0;
    record(
      "E6.estado-volta",
      "depois da retomada, a passada seguinte tira o negócio do risco",
      bucket === "em_dia",
      status2 !== 200
        ? `INCONCLUSIVO: a segunda passada respondeu ${status2}`
        : !houveEnvio
          ? `BLOQUEADO pelo mesmo elo do E4: o estado só volta quando o negócio recebe MOVIMENTO, e ` +
            `a lista positiva do gatilho não inclui reactivation_accepted — inclui ai_turn, que é o ` +
            `turno do agente. Sem worker não houve envio, sem envio não há ai_turn, e sem ai_turn a ` +
            `última atividade continua em ${String(ultima).slice(0, 10)} e o bucket em "${bucket}". ` +
            `Aceitar é AUTORIZAR; quem quebra o silêncio é o envio.`
          : `houve turno do agente e ainda assim o estado é "${bucket}" (esperado em_dia) · última ` +
            `atividade: ${ultima}`,
      status2 !== 200 ? "INCONCLUSIVO" : !houveEnvio ? "BLOQUEADO" : undefined,
    );

    // ---- E7: o card anda ----------------------------------------------------
    const txt7 = await textoDoCard();
    const aindaOferece = /retomar contato/i.test(txt7);
    // LEITURA DECLARADA: "o card anda" eu li como "o card deixa de pedir decisão
    // e volta ao normal". Nada no caminho do aceite muda o ESTÁGIO, então exigir
    // movimento de coluna reprovaria o produto por uma promessa que ele não faz.
    // Se a intenção do contrato for mudança de estágio, este critério está lendo
    // a coisa errada e eu prefiro ser corrigido a inventar o alvo.
    record(
      "E7.card-anda",
      "o card deixa de pedir decisão e volta ao normal (leitura declarada de 'anda')",
      !aindaOferece,
      aindaOferece
        ? `o card ainda oferece retomada depois de decidida: "${txt7.slice(0, 120)}"`
        : `a faixa de decisão saiu do card: "${txt7.slice(0, 120)}"`,
    );
  } finally {
    await ctx.close();
    await browser.close();
    const gravado = fs.readdirSync(VIDEO_DIR).filter((f) => f.endsWith(".webm")).sort().pop();
    if (gravado) {
      const destino = path.join(VIDEO_DIR, `cenario-23-ciclo-${RUN}.webm`);
      fs.renameSync(path.join(VIDEO_DIR, gravado), destino);
      console.info(`[vídeo] ${path.relative(process.cwd(), destino)}`);
    }
    await admin.from("crm_lead_activities").delete().eq("lead_id", leadId);
    await admin.from("crm_lead_reactivations").delete().eq("lead_id", leadId);
    await admin.from("crm_lead_risk_states").delete().eq("lead_id", leadId);
    await admin.from("crm_leads").delete().eq("id", leadId);
    console.info(`[limpeza] caso ${TITULO} removido`);
    if (fechar() > 0) process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("❌ cenário 23 falhou:", err);
  process.exit(1);
});
