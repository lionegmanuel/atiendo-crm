/**
 * ATAQUE à sonda `tests/sonda-ambiguo-na-caixa.ts` — a pedido do regente.
 *
 * A pergunta que ele fez foi sobre o ESCOPO da asserção, e nesse ponto a sonda
 * está certa: ela acha a linha pelo TÍTULO do item e verifica o RÓTULO do kind,
 * que são strings diferentes vindas de lugares diferentes. Se `KIND_LABEL`
 * regredir para o genérico, a sonda fica vermelha. Escopo local para propriedade
 * local é o certo, e o genérico noutro item é assunto do outro item.
 *
 * O furo é OUTRO, e é de PROCEDÊNCIA, não de escopo:
 *
 *   `select ... where kind='next_action_ambiguous' and ref_id = <contato>`
 *
 * é medido só DEPOIS de abrir o board, sem filtro de tempo e sem a leitura
 * "antes". Ele responde "existe um aviso para este contato?" — não "o board
 * acabou de criar um aviso". São perguntas diferentes, e a segunda é a que a
 * sonda afirma provar: empate real → board detecta → caixa mostra.
 *
 * Este arquivo transforma a suspeita em fato do jeito mais direto possível:
 * PLANTA um aviso à mão, sem empate nenhum e sem rodar uma linha de código de
 * produção, e então roda as QUATRO asserções da sonda contra esse estado. Se as
 * quatro passarem, o verde delas não distingue "o board detectou" de "já havia
 * um aviso ali" — e o que a sonda promete é justamente a corrente inteira.
 *
 * Não corrige nada: a sonda é do @DevVivo. Só mede.
 *
 * Run: E2E_PORT=3020 npx tsx tests/ataque-sonda-ambiguo.ts
 */

import { chromium } from "@playwright/test";
import pg from "pg";

import { BASE, CREDS, carimbar, login, shotPage } from "./qa-helpers";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const env = carregarEnvLocal();
const ORG = CREDS.org_id as string;

async function main(): Promise<void> {
  const sufixo = carimbar([
    "tests/sonda-ambiguo-na-caixa.ts",
    "app/api/v1/pipelines/[id]/board/route.ts",
    "lib/ai/agent-inbox-copy.ts",
  ]);
  const pool = new pg.Pool({ connectionString: env.SUPABASE_DB_URL });
  let plantado: string | null = null;

  try {
    // Alvo: um contato ELEGÍVEL para a sonda — tem próxima ação e UM único
    // negócio aberto. Logo não há empate, e `resolveActiveLeadForContact` não
    // tem por que recusar nada: o board não criaria aviso algum aqui.
    const { rows: alvos } = await pool.query<{ contact_id: string; abertos: string }>(
      `select ls.contact_id,
              (select count(*) from crm_leads x
                where x.organization_id = $1 and x.contact_id = ls.contact_id
                  and x.status = 'open') as abertos
         from lead_state ls
         join crm_leads l on l.contact_id = ls.contact_id and l.status = 'open'
        where ls.organization_id = $1 and coalesce(ls.next_action, '') <> ''
          and (select count(*) from crm_leads x
                where x.organization_id = $1 and x.contact_id = ls.contact_id
                  and x.status = 'open') = 1
        order by ls.contact_id
        limit 1`,
      [ORG],
    );
    const alvo = alvos[0];
    if (!alvo) throw new Error("sem contato elegível — o ataque não se monta");
    console.info(
      `[alvo] contato ${alvo.contact_id.slice(0, 8)} com ${alvo.abertos} negócio aberto — SEM ambiguidade`,
    );

    const preexistentes = await pool.query(
      `select id from agent_inbox_items
        where organization_id = $1 and kind = 'next_action_ambiguous' and ref_id = $2`,
      [ORG, alvo.contact_id],
    );
    console.info(`[antes] avisos deste kind para o alvo: ${preexistentes.rowCount}`);

    // As strings são as MESMAS que o board escreve (route.ts:159-160). Copiar o
    // texto é o ponto: a sonda procura por ele, e não por procedência.
    const { rows: criados } = await pool.query<{ id: string }>(
      `insert into agent_inbox_items
         (organization_id, kind, severity, title, body, ref_kind, ref_id, status)
       values ($1, 'next_action_ambiguous', 'warn',
               'A IA propôs uma próxima ação, mas o contato tem 2 negócios abertos',
               'Proposta: "planta do ataque". Escolha a qual negócio ela pertence — o sistema não adivinha para não executar no negócio errado.',
               'contact', $2, 'open')
       returning id`,
      [ORG, alvo.contact_id],
    );
    plantado = criados[0]!.id;
    console.info(`[planta] aviso inserido à mão: ${plantado.slice(0, 8)} — zero código de produção rodou`);

    const browser = await chromium.launch();
    const page = await browser
      .newContext({ viewport: { width: 1440, height: 900 } })
      .then((c) => c.newPage());
    page.setDefaultTimeout(60_000);
    await login(page, "admin");

    // DE PROPÓSITO: não abro o board. A sonda abre, e é isso que ela credita
    // pela criação do item. Aqui ninguém detecta nada — e as asserções seguem.
    await page.goto(`${BASE}/app/ai/inbox`, { waitUntil: "networkidle" });

    const { rows: itens } = await pool.query(
      `select id from agent_inbox_items
        where organization_id = $1 and kind = 'next_action_ambiguous' and ref_id = $2`,
      [ORG, alvo.contact_id],
    );

    const linha = page
      .locator('[data-testid="inbox-item"]')
      .filter({ hasText: "A IA propôs uma próxima ação" });
    await linha.first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => null);
    const naTela = await linha.count();
    const texto = naTela > 0 ? await linha.first().innerText() : "";
    await shotPage(page, `wave-4-ataque-sonda-verde-sem-deteccao${sufixo}.png`);
    await browser.close();

    const nasceu = itens.length === 1 && naTela === 1;
    const rotulado = /Próxima ação sem negócio definido/.test(texto);
    const semGenerico = !/Aviso do assistente/.test(texto);
    const pedeEscolha = /Escolha a qual negócio ela pertence/.test(texto);

    console.info("\n=== AS QUATRO ASSERÇÕES DA SONDA, CONTRA UM AVISO PLANTADO ===");
    console.info(`  nasceu (itens=1 e naTela=1) : ${nasceu}`);
    console.info(`  rótulo específico            : ${rotulado}`);
    console.info(`  não cai no genérico          : ${semGenerico}`);
    console.info(`  corpo diz o que fazer        : ${pedeEscolha}`);
    console.info(
      nasceu && rotulado && semGenerico && pedeEscolha
        ? "\n==> 4/4 VERDE sem o board ter detectado nada. O verde prova o RÓTULO, não a CORRENTE.\n" +
            "    Conserto: ler a contagem ANTES de abrir o board e exigir que ela suba de 0 para 1."
        : "\n==> alguma asserção reprovou — o furo NÃO se confirma por este caminho.",
    );
  } finally {
    if (plantado) {
      const r = await pool.query(`delete from agent_inbox_items where id = $1`, [plantado]);
      console.info(`[limpeza] aviso plantado removido (${r.rowCount})`);
    }
    await pool.end();
  }
}

main().catch((err) => {
  console.error("❌ ataque falhou:", err);
  process.exit(1);
});
