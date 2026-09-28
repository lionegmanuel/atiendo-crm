/**
 * Sonda do orquestrador — o item ambíguo se anuncia em pt-BR na caixa de avisos?
 *
 * O bloco da Wave 4 que criou o kind `next_action_ambiguous` foi provado no
 * banco (o item nasce, deduplicado) e nunca foi OLHADO na tela. Ao conferir os
 * rótulos achei o defeito: `KIND_LABEL` era `Record<string, string>` — um tipo
 * que aceita qualquer chave e **não exige nenhuma** —, então o kind novo caía
 * no genérico "Aviso do assistente". Um item cuja razão de existir é pedir uma
 * escolha chegava ao usuário sem dizer de quê. Falha macia: a tela parece certa.
 *
 * Esta sonda fecha a corrente inteira com o código de produção:
 *   empate real no banco → GET do board (rota real) detecta e cria o item
 *   → caixa de avisos mostra o rótulo específico.
 *
 * ⚠️ ELA ESCREVE E DESFAZ. Cria um SEGUNDO negócio aberto para um contato que
 * já tem próxima ação, empatado no mesmo instante de atividade — é a única
 * condição em que `resolveActiveLeadForContact` se recusa a adivinhar. Sem o
 * desfazer, um contato real do banco compartilhado ficaria com um negócio
 * fantasma e um aviso perpétuo (a lição da sonda de veto, que contaminou uma
 * timeline real por não limpar).
 *
 * Run: E2E_PORT=3020 npx tsx tests/sonda-ambiguo-na-caixa.ts
 */
import { randomUUID } from "node:crypto";

import { chromium } from "@playwright/test";
import pg from "pg";

import { BASE, CREDS, EVIDENCE, carimbar, login, shotPage } from "./qa-helpers";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const SUFIXO = carimbar([
  "lib/ai/agent-inbox-copy.ts",
  "lib/agent-engine/db/repository.ts",
  "app/api/v1/pipelines/[id]/board/route.ts",
  "app/app/ai/inbox/_components/AgentInboxList.tsx",
]);

const env = carregarEnvLocal();

const ORG = CREDS.org_id as string;
const PIPELINE = (CREDS as { crm_vivo: { pipeline_id: string } }).crm_vivo.pipeline_id;

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: env.SUPABASE_DB_URL });
  const marca = randomUUID();
  let leadFantasma: string | null = null;
  /** Só os avisos que ESTA execução fez nascer — a limpeza não pode levar junto
   *  um item que já estava lá antes e não é dela. */
  let avisosDesteRun: string[] = [];

  try {
    // Contato com próxima ação e EXATAMENTE um negócio aberto: dá para criar o
    // empate sem tocar em nada que já esteja ambíguo por conta própria.
    const { rows: alvos } = await pool.query(
      `select ls.contact_id,
              l.id            as lead_id,
              l.pipeline_id,
              l.stage_id,
              coalesce(l.last_activity_at, l.created_at) as atividade
         from lead_state ls
         join crm_leads l
           on l.contact_id = ls.contact_id and l.status = 'open'
        where ls.organization_id = $1
          and coalesce(ls.next_action, '') <> ''
          and (select count(*) from crm_leads x
                where x.organization_id = $1
                  and x.contact_id = ls.contact_id
                  and x.status = 'open') = 1
        -- ORDER BY explícito: LIMIT 1 sem ordem é alvo SORTEADO, e uma sonda que
        -- mede um alvo diferente a cada execução não produz veredito comparável
        -- — o verde de hoje não fala do vermelho de ontem.
        order by ls.contact_id
        limit 1`,
      [ORG],
    );
    const alvo = alvos[0];
    if (!alvo) throw new Error("sem contato com próxima ação e um único negócio aberto");

    // O empate precisa ser GENUÍNO: mesmo pipeline (senão o default desempata)
    // e mesmo instante de atividade (senão a ordenação escolhe um vencedor).
    const { rows: criados } = await pool.query(
      `insert into crm_leads
         (organization_id, pipeline_id, stage_id, contact_id, title, status,
          position_in_stage, last_activity_at)
       values ($1, $2, $3, $4, $5, 'open', 999999, $6)
       returning id`,
      [ORG, alvo.pipeline_id, alvo.stage_id, alvo.contact_id, `[sonda ${marca}]`, alvo.atividade],
    );
    leadFantasma = criados[0]!.id as string;
    console.info(`empate criado: negócio fantasma ${leadFantasma} ao lado de ${alvo.lead_id}`);

    // LEITURA "ANTES" — a procedência do item, não só a existência dele.
    //
    // Furo achado pelo @QAVivo atacando esta sonda: a versão anterior contava os
    // itens SÓ DEPOIS de abrir o board. Ele plantou um aviso à mão, sem empate
    // nenhum e sem rodar uma linha de código de produção, e as quatro asserções
    // fecharam 4/4. A sonda provava a tela e MENTIA SOBRE A ORIGEM — exatamente
    // o que está escrito, em português, no topo de `sonda-veto-na-tela.ts`, e
    // que eu repeti num arquivo novo.
    //
    // Guardar os ids de antes torna o veredito uma DIFERENÇA: o que a sonda
    // afirma é que o board CRIOU este item agora, não que ele existe.
    const { rows: antesRows } = await pool.query(
      `select id from agent_inbox_items
        where organization_id = $1 and kind = 'next_action_ambiguous' and ref_id = $2`,
      [ORG, alvo.contact_id],
    );
    const antes = new Set(antesRows.map((r) => r.id as string));
    console.info(`avisos deste tipo ANTES de abrir o board: ${antes.size}`);

    const browser = await chromium.launch();
    const page = await browser
      .newContext({ viewport: { width: 1440, height: 900 } })
      .then((c) => c.newPage());
    await login(page, "admin");

    // O board é quem detecta — abrir a tela É disparar o código de produção.
    await page.goto(`${BASE}/app/pipelines/${PIPELINE}`, { waitUntil: "networkidle" });

    const { rows: depoisRows } = await pool.query(
      `select id, title, status from agent_inbox_items
        where organization_id = $1 and kind = 'next_action_ambiguous' and ref_id = $2`,
      [ORG, alvo.contact_id],
    );
    // O que interessa é o DELTA: item que não existia antes e existe depois de
    // o board rodar. Um aviso plantado à mão está no "antes" e não conta.
    const novos = depoisRows.filter((r) => !antes.has(r.id as string));
    avisosDesteRun = novos.map((r) => r.id as string);
    console.info(`avisos NASCIDOS do board (delta): ${novos.length}`);

    await page.goto(`${BASE}/app/ai/inbox`, { waitUntil: "networkidle" });

    // A asserção é ESCOPADA à linha deste item, e a primeira versão não era:
    // perguntei se "Aviso do assistente" aparecia em qualquer lugar da página e
    // reprovei o produto por um acerto dele — o kind `other` renderiza esse
    // genérico porque é literalmente o que ele significa, e havia dois abertos.
    // Propriedade local se mede no elemento local.
    const linha = page
      .locator('[data-testid="inbox-item"]')
      .filter({ hasText: "A IA propôs uma próxima ação" });
    await linha.first().waitFor({ state: "visible", timeout: 15_000 });
    const naTela = await linha.count();
    const texto = await linha.first().innerText();
    await shotPage(page, `wave-4-ambiguo-na-caixa${SUFIXO}.png`);
    await browser.close();

    // `antes.size === 0` entra na decisão de propósito: se já houvesse um aviso
    // aberto para este contato, a dedup do board impediria o nascimento e a
    // sonda mediria um item que não é dela. Melhor recusar o cenário do que
    // emitir veredito sobre matéria-prima contaminada.
    const nasceu = antes.size === 0 && novos.length === 1 && naTela === 1;
    const rotulado = /Próxima ação sem negócio definido/.test(texto);
    const semGenerico = !/Aviso do assistente/.test(texto);
    const pedeEscolha = /Escolha a qual negócio ela pertence/.test(texto);

    console.info(
      `item NASCEU do board nesta execução (0 antes → 1 depois) e aparece uma vez só: ` +
        `${nasceu ? "SIM" : "NÃO"}`,
    );
    console.info(`rótulo específico na linha: ${rotulado ? "SIM" : "NÃO"}`);
    console.info(`a linha NÃO cai no genérico: ${semGenerico ? "SIM" : "NÃO"}`);
    console.info(`corpo diz o que fazer: ${pedeEscolha ? "SIM" : "NÃO"}`);
    console.info(`print: ${EVIDENCE}/wave-4-ambiguo-na-caixa${SUFIXO}.png`);

    if (!(nasceu && rotulado && semGenerico && pedeEscolha)) process.exitCode = 1;
  } finally {
    if (leadFantasma) {
      await pool.query(`delete from crm_lead_activities where lead_id = $1`, [leadFantasma]);
      await pool.query(`delete from crm_leads where id = $1`, [leadFantasma]);
      // Apaga por ID, e só os desta execução. A versão anterior apagava TODOS os
      // avisos deste tipo do contato — se um já existisse antes, a sonda o
      // destruiria de brinde. Limpeza também precisa de procedência.
      const { rowCount } = avisosDesteRun.length
        ? await pool.query(`delete from agent_inbox_items where id = any($1::uuid[])`, [
            avisosDesteRun,
          ])
        : { rowCount: 0 };
      console.info(`limpeza: negócio fantasma removido, ${rowCount} aviso(s) desta execução`);
    }
    await pool.end();
  }
}

void main();
