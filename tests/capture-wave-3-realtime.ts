/**
 * Wave 3 — cenário 9 da §7: realtime com DUAS ABAS, sem F5. Mais o negativo de
 * isolamento entre tenants.
 *
 * Desenho (aprovado pelo regente):
 *   ABA A — manager da org A, move o card de estágio pelo TECLADO (o dnd mantém
 *           o handle mesmo com role="group": espaço levanta, seta move, espaço solta).
 *           É interação de usuário real e não sofre a fragilidade do arrasto de mouse.
 *   ABA B — outro BrowserContext, sessão independente, mesma org. Tem que ver o
 *           card mudar de coluna SEM RELOAD.
 *   ABA C — usuário de OUTRA ORG. NÃO pode receber nada. Sem este, o teste prova
 *           entrega e não prova isolamento — e realtime que vaza entre tenants é
 *           pior que realtime que não funciona.
 *
 * DIAGNÓSTICO SEPARADO — o detalhe que faz o relatório valer:
 *   "não apareceu"            → o evento nunca saiu. Investigar publicação/trigger.
 *   "só apareceu após reload" → o evento saiu e o cliente não escutou. Investigar
 *                               o hook e o filtro do canal.
 * Juntar os dois manda o dev para o lugar errado metade das vezes.
 *
 * Run: E2E_PORT=3020 npx tsx tests/capture-wave-3-realtime.ts
 */

import { chromium, type BrowserContext, type Page } from "@playwright/test";
import * as fs from "node:fs";

import { BASE, CARD_ATTR, CREDS, EVIDENCE, gotoBoard, login, loginAs, shotPage } from "./qa-helpers";

const ALVO = "Marina Costa — clareamento";
const ESPERA_REALTIME_MS = 15_000;

const resultados: { nome: string; ok: boolean; detalhe: string }[] = [];
function record(nome: string, ok: boolean, detalhe: string): void {
  resultados.push({ nome, ok, detalhe });
  console.info(`${ok ? "PASS" : "FALHA"}  ${nome} — ${detalhe}`);
}

/** Em que coluna o card está, lido do DOM (índice da coluna droppable). */
async function colunaDoCard(page: Page, titulo: string): Promise<string | null> {
  return page.evaluate(
    ({ attr, alvo }: { attr: string; alvo: string }) => {
      for (const card of Array.from(document.querySelectorAll(`[${attr}]`))) {
        if (!(card.textContent ?? "").includes(alvo)) continue;
        const coluna = card.closest("[data-rfd-droppable-id]");
        const titulo = coluna?.parentElement?.querySelector("h2, h3, header")?.textContent;
        return (titulo ?? coluna?.getAttribute("data-rfd-droppable-id") ?? "?").trim();
      }
      return null;
    },
    { attr: CARD_ATTR, alvo: titulo },
  );
}

/** Move o card para a coluna seguinte pelo teclado — como faria quem não usa mouse. */
async function moverPorTeclado(page: Page, titulo: string): Promise<void> {
  const card = page.locator(`[${CARD_ATTR}]`).filter({ hasText: titulo }).first();
  await card.focus();
  await page.keyboard.press("Space"); // levanta
  await page.waitForTimeout(400);
  await page.keyboard.press("ArrowRight"); // move para a coluna seguinte
  await page.waitForTimeout(400);
  await page.keyboard.press("Space"); // solta
  await page.waitForTimeout(1200);
}

/**
 * Espera a mudança chegar SEM reload. Se estourar, recarrega e olha de novo —
 * é o que separa "evento nunca saiu" de "cliente não escutou".
 */
async function esperarSemReload(
  page: Page,
  titulo: string,
  colunaAntiga: string,
): Promise<{ chegou: boolean; apenasAposReload: boolean; colunaFinal: string | null }> {
  const limite = Date.now() + ESPERA_REALTIME_MS;
  while (Date.now() < limite) {
    const atual = await colunaDoCard(page, titulo);
    if (atual && atual !== colunaAntiga) {
      return { chegou: true, apenasAposReload: false, colunaFinal: atual };
    }
    await page.waitForTimeout(500);
  }
  await page.reload();
  await page
    .locator(`[${CARD_ATTR}]`)
    .first()
    .waitFor({ state: "visible", timeout: 20_000 })
    .catch(() => null);
  const depois = await colunaDoCard(page, titulo);
  return {
    chegou: false,
    apenasAposReload: !!depois && depois !== colunaAntiga,
    colunaFinal: depois,
  };
}

async function abrirTenantB(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  const b = CREDS.tenant_b;
  // Login PELO HELPER, não à mão. A versão anterior preenchia email e senha e
  // esperava `/app/` — e o usuário do tenant B tem TOTP enrolado, então a
  // navegação parava em `/login/mfa` e a espera estourava. O sintoma parecia
  // "o tenant descartável quebrou"; a causa era um segundo login caseiro que não
  // conhecia MFA, ao lado de um helper que conhece.
  //
  // O segredo é POR USUÁRIO: usar o do admin da org de teste falha de um jeito
  // que parece senha errada.
  await loginAs(page, {
    email: b.email,
    password: b.password,
    totpSecret: b.totp?.secret,
    rotulo: "tenant B",
  });
  await page.goto(`${BASE}/app/pipelines/${b.pipeline_id}`);
  await page.waitForLoadState("networkidle").catch(() => null);
  console.info(`[aba C] tenant B logado (${b.email}) → ${page.url()}`);
  return page;
}

async function main(): Promise<void> {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  if (!CREDS.tenant_b) {
    throw new Error("falta o bloco tenant_b — rode: npx tsx scripts/seed-e2e-tenant-b.ts");
  }
  const browser = await chromium.launch();

  // Contextos INDEPENDENTES: duas páginas do mesmo contexto compartilham storage
  // e provariam estado compartilhado no cliente, não entrega pelo servidor.
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ctxC = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  const abaA = await ctxA.newPage();
  const abaB = await ctxB.newPage();
  await login(abaA, "manager");
  await gotoBoard(abaA);
  await login(abaB, "manager");
  await gotoBoard(abaB);
  const abaC = await abrirTenantB(ctxC);

  const colunaAntesA = await colunaDoCard(abaA, ALVO);
  const colunaAntesB = await colunaDoCard(abaB, ALVO);
  const cardsDeC = await abaC.locator(`[${CARD_ATTR}]`).allTextContents();
  const vazouAntes = cardsDeC.some((t) => t.includes(ALVO));
  console.info(`[estado] A="${colunaAntesA}"  B="${colunaAntesB}"  C vê o lead da org A? ${vazouAntes}`);
  // PERNA POSITIVA: "não enxerga o lead alheio" é trivialmente verdade num board
  // que não renderizou NADA. A capacidade de exibir cards é pré-condição para a
  // afirmação de ausência significar isolamento em vez de tela vazia.
  record(
    "aba C renderizou o board DELA — pré-condição do isolamento",
    cardsDeC.length > 0,
    cardsDeC.length > 0
      ? `${cardsDeC.length} card(s) do tenant B na tela`
      : "board do tenant B VAZIO — qualquer afirmação de isolamento aqui passa por ausência, não por acerto",
  );
  record(
    "isolamento inicial: aba C não enxerga lead de outra org",
    cardsDeC.length > 0 && !vazouAntes,
    cardsDeC.length === 0
      ? "inconclusivo: board do tenant B vazio"
      : vazouAntes
        ? "VAZOU — o board do tenant B mostra lead da org A"
        : "board do tenant B só com dados dele",
  );

  await shotPage(abaB, "wave-3-aba-b-antes.png", false);

  console.info(`[ação] aba A move "${ALVO}" pelo teclado…`);
  await moverPorTeclado(abaA, ALVO);
  const colunaDepoisA = await colunaDoCard(abaA, ALVO);
  record(
    "aba A: card mudou de coluna",
    !!colunaDepoisA && colunaDepoisA !== colunaAntesA,
    `"${colunaAntesA}" → "${colunaDepoisA}"`,
  );

  const r = await esperarSemReload(abaB, ALVO, colunaAntesB ?? "");
  record(
    "aba B: mudança aparece SEM reload",
    r.chegou,
    r.chegou
      ? `chegou em "${r.colunaFinal}" sem F5`
      : r.apenasAposReload
        ? `SÓ APARECEU APÓS RELOAD — o evento saiu, o cliente não escutou. Investigar o hook e o filtro do canal (não a publicação).`
        : `NÃO APARECEU nem após reload (coluna final "${r.colunaFinal}") — o evento nunca saiu. Investigar publicação e trigger.`,
  );
  await shotPage(abaB, "wave-3-aba-b-depois.png", false);

  const vazouDepois = (await abaC.locator(`[${CARD_ATTR}]`).allTextContents()).some((t) =>
    t.includes(ALVO),
  );
  // A pré-condição é a ENTREGA estar viva. Este foi o furo real: houve um dia em
  // que o canal do board estava morto para TODO MUNDO — e, naquele dia, "o outro
  // tenant não recebeu" teria passado por o produto não entregar a ninguém. Uma
  // afirmação de que o evento NÃO atravessa a fronteira só vale se o evento
  // atravessa alguma coisa.
  record(
    "isolamento: aba C NÃO recebeu o evento da org A",
    r.chegou && !vazouDepois,
    !r.chegou
      ? "inconclusivo: a aba B também não recebeu — com a entrega morta, o silêncio do tenant B não prova isolamento"
      : vazouDepois
        ? "VAZOU entre tenants"
        : "a entrega funcionou para o tenant A e nada chegou no tenant B",
  );
  await shotPage(abaC, "wave-3-aba-c-outro-tenant.png", false);

  await browser.close();

  const falhas = resultados.filter((x) => !x.ok);
  console.info(`\n=== WAVE 3 / cenário 9: ${resultados.length - falhas.length}/${resultados.length} PASS ===`);
  for (const f of falhas) console.info(`  FALHA ${f.nome}: ${f.detalhe}`);
  if (falhas.length) process.exit(1);
}

main().catch((err) => {
  console.error("❌ Realtime (cenário 9) falhou:", err);
  process.exit(1);
});
