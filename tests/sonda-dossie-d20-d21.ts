/**
 * Sonda D20 + D21 — o dossiê como superfície VIVA.
 *
 * D20: editar PELO dossiê deixa o Sheet aberto e a atividade entra na timeline.
 *      Quem edita precisa VER o registro que acabou de gerar; fechar esconderia
 *      a prova justamente de quem a produziu.
 * D21: ação vinda de FORA (outra aba, mesma sessão) entra ao vivo, marcada.
 *
 * REPARO NA ENTRADA E NA SAÍDA: a sonda anota o valor original ANTES de mutar e
 * restaura no fim — inclusive se morrer no meio (lição do SIGPIPE que deixou um
 * `next_action` apagado). O que ela NÃO desfaz são as atividades geradas: elas
 * são registro real de que a edição aconteceu, e apagá-las seria falsificar.
 */
import { chromium, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";

import { BASE, CARD_ATTR, login } from "./qa-helpers";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const DB = carregarEnvLocal().SUPABASE_DB_URL!;

const sql = (q: string): string =>
  execFileSync("psql", [DB, "-tA", "-c", q], { encoding: "utf8" }).trim();

/** Linhas da timeline dentro do Sheet, com o texto de cada uma. */
async function linhasDaTimeline(page: Page): Promise<string[]> {
  const sheet = page.locator('[role="dialog"]');
  return (await sheet.locator("li").allTextContents()).map((t) => t.replace(/\s+/g, " ").trim());
}

async function main(): Promise<void> {
  // Lead pequeno: timeline legível, e a linha nova não se perde num muro.
  const lead = sql(
    `select l.id from crm_leads l
      where (select count(*) from crm_lead_activities a where a.lead_id = l.id) between 1 and 8
      order by l.id limit 1`,
  );
  const pipe = sql(`select pipeline_id from crm_leads where id = '${lead}'`);
  const original = sql(`select coalesce(description, '') from crm_leads where id = '${lead}'`);
  const marca = `sonda D20 ${sql("select to_char(now(), 'HH24:MI:SS')")}`;
  console.info(`alvo: ${lead.slice(0, 8)} · descrição original: ${JSON.stringify(original)}`);

  const restaurar = (): void => {
    const v = original === "" ? "null" : `'${original.replace(/'/g, "''")}'`;
    sql(`update crm_leads set description = ${v} where id = '${lead}'`);
    console.info("· lead restaurado");
  };
  process.on("exit", restaurar);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  await login(page, "manager");
  await page.goto(`${BASE}/app/pipelines/${pipe}`, { waitUntil: "networkidle" });
  await page.locator(`[${CARD_ATTR}="${lead}"]`).click();
  const sheet = page.locator('[role="dialog"]');
  await sheet.waitFor({ timeout: 15_000 });
  await page.waitForTimeout(2_000);

  const antes = await linhasDaTimeline(page);
  const canal = await sheet.getAttribute("data-realtime-status");
  console.info(`ANTES: ${antes.length} linhas · canal do dossiê: ${canal}`);

  // ── D20 ────────────────────────────────────────────────────────────────
  await sheet.locator("#description").fill(marca);
  await sheet.getByRole("button", { name: "Salvar" }).click();
  await page.waitForTimeout(3_000);

  const aberto = await sheet.isVisible();
  const depois = await linhasDaTimeline(page);
  const novas = depois.filter((l) => !antes.includes(l));
  const edicao = depois.find((l) => l.includes("Dados do negócio alterados"));
  console.info(`D20.1 Sheet continua aberto ........ ${aberto}`);
  console.info(`D20.2 linhas: ${antes.length} → ${depois.length} (${novas.length} nova(s))`);
  console.info(`D20.3 linha da edição .............. ${edicao ? JSON.stringify(edicao) : "AUSENTE"}`);
  console.info(`D20.4 marcada como "agora" ......... ${edicao?.includes("agora") ?? false}`);
  // O reason NOMEIA o campo e NUNCA o valor. Se a marca vazar para a tela, é PII
  // por construção: qualquer texto que o usuário digite iria junto.
  console.info(`D20.5 valor NÃO vazou p/ a linha ... ${!depois.some((l) => l.includes(marca))}`);
  // D20.6: o registro nomeia SÓ o que mudou. Eu toquei em UM campo; se a linha
  // citar título/valor/data/tags, ela está afirmando o que não aconteceu.
  const soADescricao =
    !!edicao?.includes("a descrição") &&
    !["o título", "o valor", "a data prevista", "as tags"].some((n) => edicao.includes(n));
  console.info(`D20.6 nomeia SÓ o campo alterado ... ${soADescricao}`);
  await page.screenshot({ path: "evidence/wave6-d20-editar-sem-fechar.png" });

  // D20.7: salvar SEM mexer em nada não é acontecimento — nenhuma linha nova.
  //
  // ⚠️ A REQUISIÇÃO PRECISA TER SAÍDO. Sem contá-la, "nenhuma linha nova" passa
  // igualzinho quando o clique não fez nada (botão inerte, form não submetido) —
  // o teste acertaria pelo motivo errado, provando o oposto do que afirma.
  const antesVazio = await linhasDaTimeline(page);
  const carimboAntes = sql(`select updated_at from crm_leads where id = '${lead}'`);
  let patchesEnviados = 0;
  page.on("request", (r) => {
    if (r.method() === "PATCH" && r.url().includes(`/api/v1/leads/${lead}`)) patchesEnviados += 1;
  });
  await sheet.getByRole("button", { name: "Salvar" }).click();
  await page.waitForTimeout(3_000);
  const depoisVazio = await linhasDaTimeline(page);
  const carimboDepois = sql(`select updated_at from crm_leads where id = '${lead}'`);
  console.info(`D20.7a a requisição SAIU ........... ${patchesEnviados} PATCH`);
  console.info(`D20.7b o banco foi tocado .......... ${carimboAntes !== carimboDepois} (updated_at mudou)`);
  console.info(
    `D20.7c e mesmo assim NÃO registrou ... ${depoisVazio.length === antesVazio.length} (${antesVazio.length} → ${depoisVazio.length})`,
  );

  // ── D21: a ação vem de FORA, pela rota real que a UI usa ───────────────
  const antesD21 = await linhasDaTimeline(page);
  const outraAba = await ctx.newPage();
  await outraAba.goto(`${BASE}/app/pipelines/${pipe}`, { waitUntil: "networkidle" });
  const http = await outraAba.evaluate(
    async ([id, texto]) => {
      const r = await fetch(`/api/v1/leads/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: texto }),
      });
      return r.status;
    },
    [lead, `${marca} — da outra aba`],
  );
  await page.waitForTimeout(4_000); // a aba do dossiê NÃO é recarregada de propósito
  const depoisD21 = await linhasDaTimeline(page);
  const chegou = depoisD21.length > antesD21.length;
  const aoVivo = depoisD21.filter((l) => l.includes("agora")).length;
  console.info(`D21.1 PATCH da outra aba ........... http ${http}`);
  console.info(`D21.2 entrou sem recarregar ........ ${chegou} (${antesD21.length} → ${depoisD21.length})`);
  console.info(`D21.3 linhas marcadas "agora" ...... ${aoVivo}`);
  console.info(`D21.4 canal ........................ ${await sheet.getAttribute("data-realtime-status")}`);
  await page.screenshot({ path: "evidence/wave6-d21-outra-aba-ao-vivo.png" });

  await browser.close();
}

void main();
