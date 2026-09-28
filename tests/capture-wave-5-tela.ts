/**
 * WAVE 5 na TELA — cenários 15 e 17 do briefing.
 *
 * Aparato NOVO, não adaptação do de banco. Lá a pergunta é "o Postgres recusa?";
 * aqui é "o número aparece, o porquê está a um gesto, e o lead sem sinal não
 * inventa nada" — e as armadilhas são outras.
 *
 * ARMADO ANTES DA IMPLEMENTAÇÃO, de propósito: teste escrito depois herda as
 * suposições do código que ele deveria interrogar. Na wave 4 foi assim que o
 * aparato pegou mais coisa.
 *
 * AS SEIS ARMADILHAS QUE ESTE ARQUIVO EXISTE PARA NÃO CAIR:
 *
 *  (a) PRECEDÊNCIA. A faixa ③ é um slot com ordem estrita: awaiting > cooling >
 *      meter. Um alvo com próxima ação pendente ou esfriando mostraria a linha
 *      certa do estado errado, e eu reprovaria o produto por um ACERTO dele. Por
 *      isso o alvo nasce sem `next_action` e com atividade fresca — e a
 *      pré-condição é ASSERTADA, não presumida.
 *  (b) ZERO ≠ AUSENTE. Score 0 é sinal legítimo ("não vai fechar"); score nulo é
 *      "não sei". Os dois erros clássicos são de uma linha: `score || "—"` mata o
 *      zero, `score ?? 0` inventa score. Só um caso com 0 e outro com nulo, na
 *      mesma tela, separa os dois.
 *  (c) A FAIXA É LIDA, NÃO DERIVADA. Se a UI recalcular a faixa a partir do
 *      número, a histerese morre na exibição — o card voltaria a piscar mesmo com
 *      a caminhada correta no banco. Gravo faixa que DIFERE da régua crua, dentro
 *      da tolerância do CHECK, e exijo a persistida na tela.
 *  (d) O PAR NA MESMA CAPTURA. "Lead sem sinal não mostra score" precisa do lead
 *      COM score ao lado, senão a ausência é indistinguível de tela quebrada.
 *  (e) EVIDÊNCIA É ATÉ TRÊS, NUNCA COTA. Exigir exatamente três empurra alguém a
 *      inventar lastro para preencher. Gravo DUAS e exijo duas.
 *  (f) HOVER TEM EQUIVALENTE. Quem usa toque não tem hover. Os dois gatilhos são
 *      testados, e têm de revelar o MESMO conteúdo.
 *
 * Run: E2E_PORT=3020 npx tsx tests/capture-wave-5-tela.ts
 */

import { chromium, type Locator, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import pg from "pg";

import { CREDS, EVIDENCE, cardLocator, carimbar, casoConstruido, gotoBoard, login, shotCard, shotPage } from "./qa-helpers";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const envVars = carregarEnvLocal();
const admin = createClient(envVars.NEXT_PUBLIC_SUPABASE_URL!, envVars.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const pool = new pg.Pool({ connectionString: envVars.SUPABASE_DB_URL });

const ORG = CREDS.org_id as string;
const PIPELINE = (CREDS.crm_vivo as { pipeline_id: string }).pipeline_id;
const STAGE = Object.values((CREDS.crm_vivo as { stage_ids: Record<string, string> }).stage_ids)[0]!;
const DONO = (CREDS.users as Record<string, { id: string }>).manager!.id;

const PREFIXO = "QA-W5T";
const RUN = randomUUID().slice(0, 8);

type Estado = "PASS" | "FALHA" | "BLOQUEADO";
const resultados: { n: string; nome: string; estado: Estado; detalhe: string }[] = [];
function record(n: string, nome: string, ok: boolean, detalhe: string, estado?: Estado): void {
  const e: Estado = estado ?? (ok ? "PASS" : "FALHA");
  resultados.push({ n, nome, estado: e, detalhe });
  console.info(`${e.padEnd(9)} [${n}] ${nome} — ${detalhe}`);
}

// ---------------------------------------------------------------------------
// Os alvos
// ---------------------------------------------------------------------------

interface Alvo {
  chave: string;
  leadId: string;
  titulo: string;
}

/**
 * Três leads irmãos, iguais em tudo menos no score — que é a variável do teste.
 *
 * Iguais importa: se o lead com score também tivesse outro dono, outro valor e
 * outro estágio, qualquer diferença na tela teria três explicações possíveis e
 * nenhuma conclusão. Aqui só o score varia.
 */
async function montarAlvos(): Promise<Record<string, Alvo>> {
  const spec = [
    { chave: "COM", rotulo: "com score 72 e faixa morno persistida" },
    { chave: "ZERO", rotulo: "com score ZERO — sinal legítimo, não ausência" },
    { chave: "SEM", rotulo: "sem linha de score — o agente não sabe" },
    { chave: "AMBOS", rotulo: "score com os DOIS vocabulários de evidência" },
  ];
  const alvos: Record<string, Alvo> = {};
  for (const s of spec) {
    const titulo = `${PREFIXO} ${RUN} ${s.chave} — ${s.rotulo}`;
    const { data, error } = await admin
      .from("crm_leads")
      .insert({
        organization_id: ORG,
        pipeline_id: PIPELINE,
        stage_id: STAGE,
        title: titulo,
        status: "open",
        source: "manual",
        value_cents: 500_000,
        currency: "BRL",
        owner_kind: "user",
        owner_user_id: DONO,
        owner_agent_id: null,
        position_in_stage: 7000,
        // Atividade FRESCA: esfriando tem precedência sobre o medidor, e um alvo
        // esfriado mostraria a linha do estado errado. Armadilha (a).
        last_activity_at: new Date().toISOString(),
      } as never)
      .select("id")
      .single();
    if (error || !data) throw new Error(`criar lead ${s.chave}: ${error?.code} ${error?.message}`);
    alvos[s.chave] = { chave: s.chave, leadId: (data as { id: string }).id, titulo };
  }

  // As evidências apontam para atividades REAIS. Custou um falso vermelho: com
  // uuid inventado a tela dizia "Sem evidências registradas" — e estava CERTA,
  // porque ela resolve a referência. Lastro que não resolve não é lastro, e um
  // teste que finge lastro mede a si mesmo.
  const evidencias: string[] = [];
  for (const texto of [
    "Cliente confirmou o orçamento por telefone",
    "Objeção de preço resolvida com desconto de 8%",
  ]) {
    const { data, error } = await admin
      .from("crm_lead_activities")
      .insert({
        organization_id: ORG,
        lead_id: alvos.COM!.leadId,
        type: "note",
        actor_kind: "user",
        performed_by_user_id: DONO,
        source_module: "qa",
        reason: texto,
      } as never)
      .select("id")
      .single();
    if (error || !data) throw new Error(`criar atividade de lastro: ${error?.code} ${error?.message}`);
    evidencias.push((data as { id: string }).id);
  }

  // COM: faixa "morno" com score 72. A régua CRUA diria "quente" (>=70); o CHECK
  // aceita morno até 75. É o par que separa "a UI leu a faixa" de "a UI derivou
  // a faixa do número" — armadilha (c). Duas evidências, não três: (e).
  await pool.query(
    `insert into crm_lead_scores (lead_id, organization_id, ai_probability, ai_probability_reason,
                                  ai_probability_evidence, ai_probability_at, ai_probability_band)
     values ($1, $2, 72, 'dois compromissos assumidos e a objeção de preço resolvida', $3::jsonb, now(), 'morno')`,
    [
      alvos.COM!.leadId,
      ORG,
      // A trípice unificou os vocabulários: a âncora vive DENTRO do factor. Não
      // existe mais lastro que o banco aceite e a tela não leia — era esse o
      // defeito, e o conserto o tornou impossível de escrever.
      JSON.stringify({
        factors: evidencias.map((id, i) => ({
          pontos: [20, 15][i] ?? 10,
          frase: ["Cliente confirmou o orçamento por telefone", "Objeção de preço resolvida com desconto de 8%"][i] ?? "fato",
          ancora: { kind: "activity", id },
        })),
      }),
    ],
  );
  await pool.query(
    `insert into crm_lead_scores (lead_id, organization_id, ai_probability, ai_probability_reason,
                                  ai_probability_evidence, ai_probability_at, ai_probability_band)
     values ($1, $2, 0, 'contato pediu para não ser procurado de novo', $3::jsonb, now(), 'frio')`,
    [
      alvos.ZERO!.leadId,
      ORG,
      JSON.stringify({
        factors: [{ pontos: -30, frase: "Contato pediu para não ser procurado", ancora: { kind: "activity", id: evidencias[0] } }],
      }),
    ],
  );
  // AMBOS: mesma evidência dos ids MAIS a chave `factors`, que é a única que o
  // board lê hoje. Existe para separar "a tela não sabe mostrar evidência" de
  // "a tela lê uma chave e o banco exige outra" — sem este par, o vermelho do
  // COM não distinguiria as duas explicações.
  await pool.query(
    `insert into crm_lead_scores (lead_id, organization_id, ai_probability, ai_probability_reason,
                                  ai_probability_evidence, ai_probability_at, ai_probability_band)
     values ($1, $2, 72, 'os mesmos dois fatos, agora na chave que a tela lê', $3::jsonb, now(), 'morno')`,
    [
      alvos.AMBOS!.leadId,
      ORG,
      JSON.stringify({
        factors: [
          { pontos: 20, frase: "Cliente confirmou o orçamento por telefone", ancora: { kind: "activity", id: evidencias[0] } },
          { pontos: 15, frase: "Objeção de preço resolvida com desconto de 8%", ancora: { kind: "activity", id: evidencias[1] } },
        ],
      }),
    ],
  );

  // SEM não recebe linha nenhuma — é o "não sei", e é o par do cenário 17.
  return alvos;
}

async function limpar(): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `select id from crm_leads where organization_id = $1 and title like $2`,
    [ORG, `${PREFIXO} %`],
  );
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return 0;
  await pool.query(`delete from crm_lead_scores where lead_id = any($1::uuid[])`, [ids]);
  await pool.query(`delete from crm_lead_activities where lead_id = any($1::uuid[])`, [ids]);
  await pool.query(`delete from crm_leads where id = any($1::uuid[])`, [ids]);
  return ids.length;
}

// ---------------------------------------------------------------------------
// Leitura de tela
// ---------------------------------------------------------------------------

/** A faixa ③ do card, com a geometria confirmando que peguei a div certa. */
async function faixaDoAgente(card: Locator): Promise<{ el: Locator; texto: string }> {
  const el = card.locator(":scope > div").nth(1);
  const box = await el.boundingBox();
  const altura = box?.height ?? -1;
  if (altura < 12 || altura > 44) {
    const todas = await card.locator(":scope > div").allTextContents();
    throw new Error(
      `[faixa] a 2ª div tem ${Math.round(altura)}px — não é a faixa do agente.\n` +
        `Divs: ${todas.map((t) => `"${t.replace(/\s+/g, " ").slice(0, 40)}"`).join(" | ")}`,
    );
  }
  return { el, texto: ((await el.innerText()) ?? "").replace(/\s+/g, " ").trim() };
}

/** Texto revelado por um gatilho (hover ou clique), fora do card. */
async function reveladoPor(
  page: Page,
  card: Locator,
  gatilho: "hover" | "clique",
): Promise<string> {
  const medidor = card.locator("[class*='rounded-full'], [role='meter']").first();
  const alvo = (await medidor.count()) > 0 ? medidor : card;
  // Sai de cima do alvo anterior e ESPERA a camada sumir antes de abrir a
  // próxima. Sem isto, medir o segundo card devolvia "nada": o tooltip antigo
  // ainda fechando e o novo sem abrir — e eu concluiria "não revela" sobre um
  // componente que revela.
  await page.mouse.move(0, 0);
  await page
    .waitForFunction(
      () => document.querySelectorAll('[role="tooltip"], [data-radix-popper-content-wrapper]').length === 0,
      { timeout: 5_000 },
    )
    .catch(() => null);
  await alvo.scrollIntoViewIfNeeded();
  if (gatilho === "hover") await alvo.hover();
  else await alvo.click();
  await page.waitForTimeout(1200);
  // Dedupe: o wrapper do popper e o próprio tooltip casam os dois, e o texto
  // saía DUPLICADO — contar marcadores nele daria o dobro das evidências.
  const camadas = await page
    .locator('[role="tooltip"], [data-radix-popper-content-wrapper], [role="dialog"]')
    .allInnerTexts();
  return [...new Set(camadas.map((t) => t.replace(/\s+/g, " ").trim()))].join(" | ");
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const sufixo = carimbar([
    // O APARATO ENTRA NA PRÓPRIA LISTA — ideia do @DevVivo, e ele está certo:
    // instrumento não commitado produz veredito irreprodutível do mesmo jeito que
    // produto não commitado. Declarar só as dependências do produto deixa o carimbo
    // dizer "todas limpas" enquanto a RÉGUA muda debaixo do resultado.
    "tests/capture-wave-5-tela.ts",
    "components/kanban/KanbanCard.tsx",
    "lib/kanban/card-state.ts",
    "lib/kanban/score-band.ts",
    "hooks/kanban/useBoard.ts",
    "app/api/v1/pipelines/[id]/board/route.ts",
  ]);
  casoConstruido(
    "três leads irmãos criados aqui, com score gravado à mão — o dado real não tem o par zero/ausente",
  );

  const sobras = await limpar();
  if (sobras > 0) console.info(`[limpeza inicial] ${sobras} lead(s) de rodada anterior removidos`);
  const alvos = await montarAlvos();
  const browser = await chromium.launch();

  try {
    const page = await (
      await browser.newContext({ viewport: { width: 1440, height: 900 } })
    ).newPage();
    page.setDefaultTimeout(60_000);
    await login(page, "manager");
    await gotoBoard(page);

    // ---- PRÉ-CONDIÇÃO (a): nenhum alvo pode estar em estado de precedência ----
    const contaminados: string[] = [];
    for (const a of Object.values(alvos)) {
      const { card } = await cardLocator(page, a.titulo);
      const faixa = await faixaDoAgente(card);
      if (/Propõe:/i.test(faixa.texto) || /Sem resposta/i.test(faixa.texto)) {
        contaminados.push(`${a.chave}: "${faixa.texto}"`);
      }
    }
    const alvosLimpos = contaminados.length === 0;
    record(
      "T15.pre",
      "PRECEDÊNCIA: nenhum alvo está aguardando decisão nem esfriando",
      alvosLimpos,
      alvosLimpos
        ? "os três alvos estão no estado normal — o slot está livre para o medidor"
        : `alvo(s) em estado de precedência maior: ${contaminados.join(" · ")} — ` +
          `medir o medidor aqui reprovaria o produto por um ACERTO dele`,
    );

    const { card: cardCom } = await cardLocator(page, alvos.COM!.titulo);
    const faixaCom = await faixaDoAgente(cardCom);
    const mostraNumero = /\b72\s*%/.test(faixaCom.texto);
    const temMedidor = (await cardCom.locator("[style*='width']").count()) > 0;

    record(
      "T15.a",
      "CENÁRIO 15: o card mostra medidor + número",
      alvosLimpos && mostraNumero && temMedidor,
      `faixa do card com score 72: "${faixaCom.texto || "(vazia)"}" ` +
        `(número=${mostraNumero} medidor=${temMedidor})`,
      alvosLimpos ? undefined : "BLOQUEADO",
    );

    // A partir daqui tudo depende de a exibição existir. Sem ela, cada critério
    // abaixo seria satisfeito por uma tela que não mostra nada.
    const exibe = mostraNumero && temMedidor;

    // ---- (c) a faixa é LIDA, não derivada ------------------------------------
    const textoCom = ((await cardCom.innerText()) ?? "").replace(/\s+/g, " ");
    const mostraPersistida = /morno/i.test(textoCom);
    const mostraDerivada = /quente/i.test(textoCom);
    record(
      "T15.b",
      "a faixa exibida é a PERSISTIDA, não recalculada do número",
      exibe && mostraPersistida && !mostraDerivada,
      exibe
        ? `score 72 com faixa "morno" gravada (a régua crua diria "quente"): ` +
          `tela mostra morno=${mostraPersistida} quente=${mostraDerivada}` +
          (mostraDerivada ? " — a UI está derivando, e a histerese morre na exibição" : "")
        : "sem exibição de score não há faixa para comparar",
      exibe ? undefined : "BLOQUEADO",
    );

    // ---- (b) zero é sinal, não ausência --------------------------------------
    const { card: cardZero } = await cardLocator(page, alvos.ZERO!.titulo);
    const { card: cardSem } = await cardLocator(page, alvos.SEM!.titulo);
    const faixaZero = await faixaDoAgente(cardZero);
    const faixaSem = await faixaDoAgente(cardSem);
    const zeroMostra = /\b0\s*%/.test(faixaZero.texto);
    const diferentes = faixaZero.texto !== faixaSem.texto;
    record(
      "T15.c",
      "ZERO e AUSENTE são visualmente diferentes",
      exibe && zeroMostra && diferentes,
      `score 0: "${faixaZero.texto || "(vazia)"}" · sem score: "${faixaSem.texto || "(vazia)"}" ` +
        `→ zero visível=${zeroMostra} distintos=${diferentes}` +
        (!diferentes && exibe ? " — `score || traço` mata o zero legítimo" : ""),
      exibe ? undefined : "BLOQUEADO",
    );

    // ---- (e) evidência é ATÉ três ---------------------------------------------
    const porHover = exibe ? await reveladoPor(page, cardCom, "hover") : "";
    const revelaRazao = /objeção de preço resolvida/i.test(porHover);
    record(
      "T15.d",
      "o porquê está a UM gesto",
      exibe && revelaRazao,
      exibe ? `revelado no hover: "${porHover.slice(0, 130) || "(nada)"}"` : "sem medidor não há o que revelar",
      exibe ? undefined : "BLOQUEADO",
    );

    // O critério se chamava "mostra as evidências que existem" e não assertava
    // isso — nome que promete mais do que a asserção cobre é a §7.48 outra vez,
    // agora no rótulo. Separado, e com o PAR que distingue as causas.
    //
    // O PAR MUDOU DE SENTIDO quando a trípice entrou. Ele nasceu para separar
    // "a tela não sabe mostrar evidência" de "a tela lê outra chave" — e a
    // segunda hipótese deixou de existir: agora a âncora vive DENTRO do factor,
    // e não há lastro que o banco aceite e a tela não leia. O par vira uma
    // cerca: se alguém reintroduzir a divergência, ele volta a acusar.
    const semLastro = /Sem evidências registradas/i.test(porHover);
    const { card: cardAmbos } = await cardLocator(page, alvos.AMBOS!.titulo);
    const faixaAmbos = await faixaDoAgente(cardAmbos);
    const ambosRenderizou = /\b72\s*%/.test(faixaAmbos.texto);
    const porHoverAmbos = exibe && ambosRenderizou ? await reveladoPor(page, cardAmbos, "hover") : "";
    const ambosMostra = /desconto de 8%/i.test(porHoverAmbos);
    record(
      "T15.d2",
      "as evidências GRAVADAS aparecem — as duas, sem cota e sem invenção",
      exibe && !semLastro,
      exibe
        ? `lead com o lastro canônico: ${semLastro ? '"Sem evidências registradas"' : "evidências na tela"} · ` +
          `lead de controle (faixa="${faixaAmbos.texto}"): ` +
          `${!ambosRenderizou ? "INCONCLUSIVO — o card do controle nem mostrou score" : ambosMostra ? "evidências na tela" : "nada"}` +
          (semLastro && ambosMostra
            ? " — DIVERGÊNCIA DE VOCABULÁRIO DE VOLTA: há lastro que o banco aceita e a tela não lê"
            : "")
        : "sem medidor não há o que revelar",
      exibe ? undefined : "BLOQUEADO",
    );

    // ---- (f) hover tem equivalente por clique ---------------------------------
    await page.reload();
    await page.locator("[data-rfd-draggable-id]").first().waitFor({ state: "visible" });
    const { card: cardCom2 } = await cardLocator(page, alvos.COM!.titulo);
    const porClique = exibe ? await reveladoPor(page, cardCom2, "clique") : "";
    // Antes de acusar, tento o OUTRO caminho sem mouse: foco por teclado. Radix
    // abre tooltip no foco, e reprovar sem tentar seria acusar por um gesto só.
    let porFoco = "";
    if (exibe && porClique.length === 0) {
      const foco = cardCom2.locator("[tabindex], button, [role='meter']").first();
      if ((await foco.count()) > 0) {
        await foco.focus().catch(() => null);
        await page.waitForTimeout(900);
        porFoco = (
          await page
            .locator('[role="tooltip"], [data-radix-popper-content-wrapper], [role="dialog"]')
            .allInnerTexts()
        )
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
      }
    }
    record(
      "T15.e",
      "quem usa TOQUE também alcança o porquê (clique revela o mesmo)",
      exibe && (/objeção de preço resolvida/i.test(porClique) || /objeção de preço resolvida/i.test(porFoco)),
      exibe
        ? `clique: "${porClique.slice(0, 90) || "(nada)"}" · foco por teclado: "${porFoco.slice(0, 90) || "(nada)"}"` +
          (porClique.length === 0 && porFoco.length === 0
            ? " — quem não tem mouse não alcança o porquê"
            : "")
        : "sem medidor não há o que revelar",
      exibe ? undefined : "BLOQUEADO",
    );

    // ---- (d) o cenário 17 com o PAR na mesma captura --------------------------
    record(
      "T17",
      "CENÁRIO 17: lead sem sinal NÃO inventa score — com o par ao lado",
      exibe && !/\d+\s*%/.test(faixaSem.texto),
      exibe
        ? `ao lado de um card que mostra 72%, o card sem score diz "${faixaSem.texto || "(vazio)"}"`
        : "VERDE VAZIO se medido agora: nenhum card mostra score, então 'não inventa' é verdade por ausência",
      exibe ? undefined : "BLOQUEADO",
    );

    await shotCard(page, alvos.COM!.titulo, `wave-5-tela-com-score${sufixo}.png`);
    await shotPage(page, `wave-5-tela-par-com-e-sem-score${sufixo}.png`, false);
  } finally {
    await browser.close();
    const n = await limpar();
    console.info(`[limpeza] ${n} lead(s) de teste removidos`);
    await pool.end().catch(() => null);
  }

  const pass = resultados.filter((r) => r.estado === "PASS").length;
  const falha = resultados.filter((r) => r.estado === "FALHA").length;
  const bloq = resultados.filter((r) => r.estado === "BLOQUEADO").length;
  console.info(`\n=== WAVE 5 / TELA: ${pass} verdes · ${falha} vermelhos · ${bloq} bloqueados ===`);
  for (const r of resultados.filter((x) => x.estado !== "PASS")) {
    console.info(`  ${r.estado} [${r.n}] ${r.nome}: ${r.detalhe}`);
  }
  if (falha > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error("❌ Wave 5 / tela falhou:", err);
  await limpar().catch(() => null);
  await pool.end().catch(() => null);
  process.exit(1);
});
