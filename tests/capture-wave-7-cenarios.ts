/**
 * WAVE 7 — CORE 5: esfriando e re-engajamento. Cenários 22, 23 e 24 do briefing,
 * mais o PRAZO da proposta, que não é cenário e é a armadilha do bloco.
 *
 * Armado antes da entrega. Hoje "esfriando" não existe como ESTADO (é função pura
 * recalculada na leitura), não existe como PALAVRA (nenhum tipo de atividade de
 * risco) e o dado não é RETIDO — não dá para responder há quanto tempo esfriou
 * nem quantas vezes já voltou.
 *
 * O QUE ISSO FAZ COM O CENÁRIO 22, e é o ponto mais delicado desta wave:
 * ESFRIAR É EVENTO DE TEMPO, NÃO DE DADO. Quando o lead cruza o limiar, NADA é
 * escrito — logo nada é publicado, e nenhum realtime tem o que entregar. "Muda
 * sem reload" só é possível se a travessia virar escrita. Por isso o critério
 * carrega a pré-condição: se nada foi gravado na travessia, "o card não mudou" é
 * o comportamento esperado do que existe, e reprovar aí seria acusar a tela por
 * uma ausência que nasce três camadas antes.
 *
 * OS OBSERVÁVEIS FORAM ESCOLHIDOS ANTES DAS ASSERÇÕES, pelo par que o regente
 * formulou — ESCOPO (pertence a UMA lista identificável, nenhum vizinho a
 * satisfaz por acidente) e INVARIÂNCIA DE APRESENTAÇÃO (não muda se a tela
 * agrupar, truncar, paginar ou reordenar):
 *
 *   estado do card    → a cor computada da borda de estado, escopada ao card
 *   ciclo completo    → contagem de atividades + coluna do card, não o texto
 *   precedência       → o texto da FAIXA do card (não do painel), com perna
 *                       positiva provando que o outro estado apareceria
 *   prazo da proposta → existência do item de caixa + ausência do botão no card
 *
 * ONDE A FORMA FOI INEVITÁVEL, ELA ESTÁ MARCADA COMO PALPITE no próprio texto do
 * critério — para o vermelho ser lido como "confira se o produto fez diferente"
 * e não como "o produto errou". Sete critérios meus na wave 6 reprovaram acertos
 * por citar a forma que eu tinha imaginado.
 *
 * Run: E2E_PORT=3020 npx tsx tests/capture-wave-7-cenarios.ts
 */

import { chromium, type Locator } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";

import { RISK_COLD_HOURS } from "@/lib/leads/risk-radar";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";
import {
  CREDS,
  EVIDENCE,
  cardLocator,
  carimbar,
  casoConstruido,
  criarPlacar,
  gotoBoard,
  login,
  shotPage,
} from "./qa-helpers";

const envVars = carregarEnvLocal();
const admin = createClient(envVars.NEXT_PUBLIC_SUPABASE_URL!, envVars.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ORG = CREDS.org_id as string;
const PIPELINE = (CREDS.crm_vivo as { pipeline_id: string }).pipeline_id;
const STAGE = Object.values((CREDS.crm_vivo as { stage_ids: Record<string, string> }).stage_ids)[0]!;
const DONO = (CREDS.users as Record<string, { id: string }>).manager!.id;
const PREFIXO = "QA-W7";
const RUN = randomUUID().slice(0, 8);

const CRITERIOS = [
  "E22.pre",
  "E22",
  "E22.consistencia",
  "E23",
  "E24.pre",
  "E24",
  "E25.prazo",
  "E26.ciclo",
  "E27.naosei",
];
const { record, fechar } = criarPlacar("WAVE 7", CRITERIOS);

interface Caso {
  leadId: string;
  titulo: string;
}

/**
 * TRÊS leads, um por pergunta. Um caso por critério — reusar o de um para todos
 * foi o erro de método da wave 6: o critério mede o que quer sobre um sujeito que
 * não pode exibi-lo, e o vermelho aponta para a superfície errada.
 */
async function montarCasos(): Promise<Record<string, Caso>> {
  const spec = [
    { chave: "FRIO", horas: RISK_COLD_HOURS * 3, rotulo: "vai esfriar na travessia" },
    { chave: "CICLO", horas: RISK_COLD_HOURS * 3, rotulo: "para o ciclo de reativação" },
    { chave: "AMBOS", horas: RISK_COLD_HOURS * 3, rotulo: "esfriando E com proposta pendente" },
  ];
  const casos: Record<string, Caso> = {};
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
        value_cents: 400_000,
        currency: "BRL",
        owner_kind: "user",
        owner_user_id: DONO,
        owner_agent_id: null,
        position_in_stage: 5000,
        // FRESCO ainda: a travessia do limiar é o que o cenário 22 mede, e um
        // lead que já nasce frio não atravessa nada — mediria o estado, não a
        // mudança de estado.
        last_activity_at: new Date().toISOString(),
      } as never)
      .select("id")
      .single();
    if (error || !data) throw new Error(`criar ${s.chave}: ${error?.code} ${error?.message}`);
    casos[s.chave] = { leadId: (data as { id: string }).id, titulo };
  }
  return casos;
}

async function limpar(): Promise<number> {
  const { data } = await admin
    .from("crm_leads")
    .select("id")
    .eq("organization_id", ORG)
    .like("title", `${PREFIXO} %`);
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  if (ids.length === 0) return 0;
  await admin.from("crm_lead_activities").delete().in("lead_id", ids);
  await admin.from("crm_leads").delete().in("id", ids);
  return ids.length;
}

/**
 * A cor do MARCADOR DE ESTADO — e o seletor é o ponto.
 *
 * `span[aria-hidden]` casa DOIS elementos no card: o marcador e o overlay do
 * pulso. E o overlay renderiza ANTES quando houve evento recente — então o
 * primeiro match MUDA conforme tenha havido pulso, e o instrumento lê elementos
 * diferentes em momentos diferentes sem avisar. Escopo pelo que só o marcador
 * tem: a barra fina colada à esquerda.
 */
async function corDaBorda(card: Locator): Promise<string> {
  return card.evaluate((el) => {
    const barra = el.querySelector('span[class*="w-0.5"][class*="left-0"]');
    if (!barra) return "(marcador não encontrado)";
    return getComputedStyle(barra).backgroundColor;
  });
}

/** A faixa ③ do card — onde a precedência se resolve. */
async function faixa(card: Locator): Promise<string> {
  const el = card.locator(":scope > div").nth(1);
  return ((await el.innerText()) ?? "").replace(/\s+/g, " ").trim();
}

async function main(): Promise<void> {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const sufixo = carimbar([
    "tests/capture-wave-7-cenarios.ts",
    "lib/leads/risk-radar.ts",
    "lib/kanban/card-state.ts",
    "components/kanban/KanbanCard.tsx",
    "hooks/kanban/useBoard.ts",
  ]);
  casoConstruido("três leads criados aqui e envelhecidos por escrita — a travessia do limiar não acontece sozinha em minutos");

  await limpar();
  const casos = await montarCasos();
  const browser = await chromium.launch();

  try {
    const page = await (
      await browser.newContext({ viewport: { width: 1440, height: 900 } })
    ).newPage();
    page.setDefaultTimeout(60_000);
    await login(page, "manager");
    await gotoBoard(page);

    // ---- 22: a travessia do limiar, SEM reload ------------------------------
    const { card: cardFrio } = await cardLocator(page, casos.FRIO!.titulo);
    const corAntes = await corDaBorda(cardFrio);
    const faixaAntes = await faixa(cardFrio);

    // Envelhece o lead POR ESCRITA: é a única forma de provocar a travessia sem
    // esperar horas. E é escrita, então há evento — o que torna "sem reload"
    // possível de medir. Se a implementação não gravar nada NA TRAVESSIA, este
    // caminho ainda funciona, e é justamente essa diferença que o E22.pre isola.
    await admin
      .from("crm_leads")
      .update({
        last_activity_at: new Date(Date.now() - RISK_COLD_HOURS * 4 * 3_600_000).toISOString(),
      } as never)
      .eq("id", casos.FRIO!.leadId);
    await page.waitForTimeout(8000);

    const corDepois = await corDaBorda(cardFrio);
    const faixaDepois = await faixa(cardFrio);
    const mudouSemReload = corDepois !== corAntes || faixaDepois !== faixaAntes;

    // PRÉ-CONDIÇÃO: a travessia virou ESCRITA em algum lugar? Sem isso, nada é
    // publicado e "não mudou" é o comportamento do que existe, não um defeito.
    const { data: estados } = await admin
      .from("crm_lead_activities")
      .select("id,type")
      .eq("lead_id", casos.FRIO!.leadId);
    const travessiaRegistrada = ((estados ?? []) as { type: string }[]).some((a) =>
      /cool|esfri|risk|reengaj/i.test(a.type),
    );
    record(
      "E22.pre",
      "a travessia do limiar vira ESCRITA (sem escrita não há evento para entregar)",
      travessiaRegistrada,
      travessiaRegistrada
        ? "há atividade de risco registrada para o lead que atravessou"
        : "nenhuma atividade de risco — esfriar segue sendo evento de TEMPO recalculado na " +
          "leitura, e sem escrita nenhum realtime tem o que entregar",
      travessiaRegistrada ? undefined : "BLOQUEADO",
    );
    record(
      "E22",
      "CENÁRIO 22: o card passa a Esfriando SEM reload",
      travessiaRegistrada && mudouSemReload,
      `borda "${corAntes}" → "${corDepois}" · faixa "${faixaAntes}" → "${faixaDepois}"` +
        (travessiaRegistrada ? "" : " — preso ao E22.pre"),
      travessiaRegistrada ? undefined : "BLOQUEADO",
    );
    await shotPage(page, `wave-7-e22-travessia${sufixo}.png`, false);

    // ---- E22.consistencia: o MESMO lead, ao vivo e depois de recarregar ------
    //
    // O card do outro lead, envelhecido e recarregado, apareceu SEM o estado de
    // esfriamento — enquanto este, atualizado ao vivo, apareceu COM. Dois leads
    // medidos por caminhos diferentes é teste confundido: não dá para saber se a
    // diferença é do lead ou do caminho.
    //
    // Aqui o sujeito é o MESMO e só o caminho muda. Se as duas leituras
    // divergirem, quem classifica ao vivo e quem classifica na carga não
    // concordam — e o usuário vê um estado que some ao apertar F5.
    await page.reload();
    await page.locator("[data-rfd-draggable-id]").first().waitFor({ state: "visible" });
    const { card: frioRecarregado } = await cardLocator(page, casos.FRIO!.titulo);
    const faixaRecarregada = await faixa(frioRecarregado);
    const corRecarregada = await corDaBorda(frioRecarregado);

    // JANELA ou PERMANENTE? A classificação de risco vem de uma SEGUNDA consulta,
    // com ciclo de vida próprio. Se a faixa aparecer depois de esperar, a
    // divergência é a janela entre as duas cargas; se não aparecer, é permanente.
    // Duas hipóteses, uma medida — e sem ela o mesmo vermelho serviria às duas,
    // com gravidades muito diferentes.
    let faixaConvergiu = faixaRecarregada;
    for (let i = 0; i < 6 && faixaConvergiu === ""; i++) {
      await page.waitForTimeout(3000);
      faixaConvergiu = await faixa(frioRecarregado);
    }
    const ehJanela = faixaRecarregada === "" && faixaConvergiu !== "";
    // PRÉ-CONDIÇÃO: o estado precisa ser OBSERVÁVEL em algum momento. Sem isso,
    // "as duas leituras concordam" é satisfeito por AMBAS estarem vazias — que
    // foi o que aconteceu numa rodada: ao vivo "" e recarregado "", passando,
    // enquanto o estado real aparecia 18s depois. Concordância por ausência é o
    // verde mais fácil de fabricar, e ele fecha a pergunta.
    const estadoObservavel = faixaConvergiu !== "";
    record(
      "E22.consistencia",
      "quando o estado É observável, as duas leituras concordam",
      estadoObservavel && faixaRecarregada === faixaDepois && corRecarregada === corDepois,
      (estadoObservavel
        ? ""
        : "INCONCLUSIVO — o estado não apareceu em NENHUMA das leituras, então concordar não " +
          "significa concordar sobre o estado. ") +
      `ao vivo: faixa "${faixaDepois}" · logo após recarregar: "${faixaRecarregada}" · ` +
        `depois de esperar até 18s: "${faixaConvergiu}" (borda ${corRecarregada})` +
        (faixaRecarregada === faixaDepois
          ? ""
          : ehJanela
            ? " — é JANELA: a classificação de risco vem de uma SEGUNDA consulta e, enquanto ela " +
              "não chega, o card AFIRMA que o negócio está saudável em vez de dizer que não sabe. " +
              "Desconhecido virando normal, que é a afirmação que este épico existe para impedir"
            : " — é PERMANENTE nesta janela de observação: a faixa não apareceu nem depois de 18s"),
      estadoObservavel ? undefined : "INCONCLUSIVO",
    );

    // ---- 27: o TERCEIRO estado — frio, quente e NÃO SEI ---------------------
    //
    // Todo critério sobre estado derivado precisa dos TRÊS casos, porque é o
    // terceiro que hoje se disfarça de saudável: enquanto a consulta de risco não
    // chega, o card não diz "não sei" — ele afirma que está tudo bem.
    //
    // E a janela não é piscada: 18s dá para alguém abrir o quadro, varrer com o
    // olho, concluir que não há nada esfriando e sair. Pior, a consulta classifica
    // TODOS os leads, então ela CRESCE com o tamanho do tenant — fica mais longa
    // exatamente onde há mais negócio morrendo.
    record(
      "E27.naosei",
      "enquanto o risco é DESCONHECIDO, o card não afirma que está saudável",
      faixaRecarregada !== "" || !estadoObservavel,
      faixaRecarregada === "" && estadoObservavel
        ? `logo após recarregar a faixa está vazia e a borda "${corRecarregada}" — o mesmo que um ` +
          `negócio em dia. O estado era ESFRIANDO (apareceu ${faixaConvergiu ? "depois" : "nunca"}), ` +
          `e no intervalo a tela afirmou saúde em vez de representar o desconhecido`
        : "o card distingue desconhecido de saudável",
    );

    // ---- 24: precedência, com a perna positiva ANTES ------------------------
    //
    // "Mostra só Aguardando você" é asserção de AUSÊNCIA do estado de esfriando.
    // Sem provar que este lead EXIBIRIA esfriando, a ausência é trivial — o card
    // poderia não mostrar nada e o critério passaria. Então mede-se duas vezes:
    // primeiro sem proposta (tem de aparecer esfriando), depois com.
    await admin
      .from("crm_leads")
      .update({
        last_activity_at: new Date(Date.now() - RISK_COLD_HOURS * 4 * 3_600_000).toISOString(),
      } as never)
      .eq("id", casos.AMBOS!.leadId);
    await page.reload();
    await page.locator("[data-rfd-draggable-id]").first().waitFor({ state: "visible" });
    const { card: cardAmbos } = await cardLocator(page, casos.AMBOS!.titulo);
    const faixaSoFrio = await faixa(cardAmbos);
    console.info(`[diag E24] card inteiro: "${((await cardAmbos.innerText()) ?? "").replace(/\s+/g, " ")}"`);
    const exibiriaEsfriando = /sem resposta/i.test(faixaSoFrio);
    record(
      "E24.pre",
      "PERNA POSITIVA: este lead EXIBE esfriando quando não há proposta",
      exibiriaEsfriando,
      exibiriaEsfriando
        ? `a faixa mostra "${faixaSoFrio}"`
        : `a faixa mostra "${faixaSoFrio}" — sem o estado de esfriando visível, "mostra só ` +
          `Aguardando você" seria verdade por AUSÊNCIA e não por precedência`,
    );

    record(
      "E24",
      "CENÁRIO 24: esfriando + proposta pendente mostra SÓ Aguardando você",
      false,
      "a montar quando a proposta de reativação existir: exige next_action no mesmo lead " +
        "esfriando, e a asserção é a faixa mostrar a proposta E não mostrar o texto de esfriamento",
      "BLOQUEADO",
    );

    // ---- 23: o ciclo inteiro ------------------------------------------------
    record(
      "E23",
      "CENÁRIO 23: aceitar reativação → agente envia → atividade → card volta ao normal",
      false,
      "a montar quando a reativação existir. Observáveis já escolhidos, e nenhum é texto: " +
        "contagem de atividades do lead (+1), coluna do card (andou) e a faixa deixando de " +
        "mostrar esfriamento — três independentes, porque o ciclo pode falhar em qualquer elo",
      "BLOQUEADO",
    );

    // ---- 26: o ciclo que se autodestrói — mensurável HOJE --------------------
    //
    // `trg_update_last_activity_at` é AFTER INSERT FOR EACH ROW **sem cláusula
    // WHEN**, e a função faz `last_activity_at = greatest(..., performed_at)`
    // para QUALQUER tipo. Conferi na definição, não no relato.
    //
    // Consequência: no instante em que a atividade "esfriou" entrar na timeline,
    // ela zera o relógio do silêncio e o lead volta a "em dia". O PRODUTOR DO
    // ESTADO APAGA O PRÓPRIO ESTADO — e o defeito só apareceria depois da
    // entrega, com o sintoma de "o esfriamento não gruda", que manda alguém
    // investigar o classificador em vez do gatilho.
    //
    // Dá para medir HOJE porque o gatilho não filtra tipo: qualquer atividade
    // serve para exibir o mecanismo. O tipo usado aqui é PALPITE — quando o tipo
    // de risco existir, troca-se uma linha.
    const { data: antesRelogio } = await admin
      .from("crm_leads")
      .select("last_activity_at")
      .eq("id", casos.CICLO!.leadId)
      .single();
    await admin
      .from("crm_leads")
      .update({
        last_activity_at: new Date(Date.now() - RISK_COLD_HOURS * 4 * 3_600_000).toISOString(),
      } as never)
      .eq("id", casos.CICLO!.leadId);
    await admin.from("crm_lead_activities").insert({
      organization_id: ORG,
      lead_id: casos.CICLO!.leadId,
      source_module: "qa",
      type: "note",
      actor_kind: "system",
      reason: `${RUN} · faz de conta que esta atividade diz "este negócio esfriou"`,
      evidence: {},
      performed_at: new Date().toISOString(),
    } as never);
    const { data: depoisRelogio } = await admin
      .from("crm_leads")
      .select("last_activity_at")
      .eq("id", casos.CICLO!.leadId)
      .single();
    const relogioAntes = (antesRelogio as { last_activity_at: string } | null)?.last_activity_at;
    const relogioDepois = (depoisRelogio as { last_activity_at: string } | null)?.last_activity_at;
    const horasDeSilencio = relogioDepois
      ? (Date.now() - new Date(relogioDepois).getTime()) / 3_600_000
      : -1;
    const continuaFrio = horasDeSilencio >= RISK_COLD_HOURS;
    record(
      "E26.ciclo",
      "emitir a atividade do esfriamento NÃO ressuscita o relógio do silêncio",
      continuaFrio,
      continuaFrio
        ? `o lead seguiu com ${horasDeSilencio.toFixed(1)}h de silêncio depois da atividade`
        : `o relógio voltou para ${horasDeSilencio.toFixed(1)}h de silêncio — o lead estava frio ` +
          `há ${(RISK_COLD_HOURS * 4).toFixed(0)}h e a atividade o devolveu a "em dia" NO MESMO ` +
          `INSTANTE. O produtor do estado apaga o próprio estado, e o sintoma futuro seria "o ` +
          `esfriamento não gruda", mandando investigar o classificador em vez do GATILHO ` +
          `(trg_update_last_activity_at, AFTER INSERT sem cláusula WHEN)`,
    );
    void relogioAntes;

    // ---- 25: o PRAZO da proposta, que não é cenário e é a armadilha ---------
    record(
      "E25.prazo",
      "proposta de reativação sem decisão VENCE e vira item de caixa",
      false,
      "a montar. O card parado COM UM BOTÃO EM CIMA simula atenção e adia a intervenção " +
        "humana — pior que não propor nada, porque parece que alguém está cuidando. " +
        "Observáveis: o item de caixa existe E o botão sumiu do card, medidos juntos; " +
        "um sozinho não distingue 'venceu' de 'nunca existiu'",
      "BLOQUEADO",
    );
  } finally {
    await browser.close();
    console.info(`[limpeza] ${await limpar()} lead(s) de teste removidos`);
    if (fechar() > 0) process.exitCode = 1;
  }
}

main().catch(async (err) => {
  console.error("❌ Wave 7 falhou:", err);
  await limpar().catch(() => null);
  process.exit(1);
});
