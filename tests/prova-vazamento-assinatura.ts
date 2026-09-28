/**
 * PROVA de vazamento de assinatura no INBOX — a superfície mais usada.
 *
 * A pergunta: quando a tela que assina realtime é desmontada, o canal é
 * desfeito? Ninguém responde isso lendo o código com confiança suficiente, e
 * teste curto nunca pega: **canal órfão só incomoda quando ACUMULA**. Abrir e
 * fechar uma vez deixa um órfão que ninguém sente.
 *
 * DECISÃO DE MÉTODO QUE DECIDE A MEDIÇÃO INTEIRA: a navegação é por CLIQUE, não
 * por `goto`. `goto` recarrega a página, destrói o contexto de JS e mata os
 * canais junto — sob recarga, vazamento nenhum é observável, e a sonda diria
 * "não vaza" sobre uma tela que vaza em todo uso real. O vazamento vive na
 * navegação client-side, que é a que o usuário faz.
 *
 * O instrumento é a diferença entre ENTRADAS e SAÍDAS no socket:
 *   `phx_join`  — o cliente entrando num canal
 *   `phx_leave` — o cliente saindo (é o que `removeChannel` envia)
 * Se a tela desassina, cada entrada tem a sua saída. Se não, a diferença cresce
 * com o número de visitas — e a INCLINAÇÃO é o vazamento, não o valor absoluto:
 * uma diferença fixa é assinatura viva; uma diferença que cresce é órfão
 * acumulando.
 *
 * Não conserta nada — é código de produção e é do @DevVivo. Só mede.
 *
 * Run: E2E_PORT=3020 npx tsx tests/prova-vazamento-assinatura.ts
 */

import { chromium } from "@playwright/test";

import { BASE, carimbar, gotoBoard, login } from "./qa-helpers";

interface Evento {
  tipo: "join" | "leave";
  canal: string;
  visita: number;
}

/**
 * Prefixo do canal sem o sufixo de instância (`::_r_9_`).
 *
 * O regex do uuid é ancorado por grupos: `[0-9a-f-]{36}` casava 36 caracteres a
 * partir de qualquer ponto e deixava um dígito solto no nome — "inbox<id>0".
 * Nome deformado num relatório é ruído que parece dado.
 */
function familia(canal: string): string {
  return canal
    .replace(/::.*$/, "")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, "<id>");
}

async function main(): Promise<void> {
  carimbar([
    "tests/prova-vazamento-assinatura.ts",
    "hooks/realtime/useRealtimeChannel.ts",
    "app/app/inbox",
  ]);

  const browser = await chromium.launch();
  const page = await browser
    .newContext({ viewport: { width: 1440, height: 900 } })
    .then((c) => c.newPage());
  page.setDefaultTimeout(60_000);

  const eventos: Evento[] = [];
  let visita = 0;
  page.on("websocket", (ws) => {
    if (!ws.url().includes("supabase")) return;
    ws.on("framesent", (f) => {
      const s = String(f.payload);
      const canal = (s.match(/realtime:([^"]+)/) ?? [])[1];
      if (!canal) return;
      if (/phx_join/.test(s)) {
        eventos.push({ tipo: "join", canal, visita });
        console.info(`    [v${visita}] JOIN  ${canal}`);
      }
      if (/phx_leave/.test(s)) {
        eventos.push({ tipo: "leave", canal, visita });
        console.info(`    [v${visita}] LEAVE ${canal}`);
      }
    });
  });

  await login(page, "manager");

  const VISITAS = 4;
  for (let i = 1; i <= VISITAS; i++) {
    visita = i;
    // CLIQUE, não `goto`: navegação client-side preserva o contexto de JS, que é
    // a única condição em que um canal órfão sobrevive para ser contado.
    await page.getByRole("link", { name: "Inbox", exact: true }).click();
    await page.waitForURL(/\/app\/inbox/, { timeout: 20_000 });
    await page.waitForTimeout(2500);
    // O BOARD, não a LISTA de pipelines. `/app/kanban` é o índice — o canal do
    // kanban só nasce DENTRO do pipeline, e visitar o índice mediria uma tela
    // que não assina nada. É o mesmo erro do `goto` noutra escala: parecer que
    // se visitou a superfície sem ter entrado nela.
    await gotoBoard(page);
    await page.waitForTimeout(2500);
    const j = eventos.filter((e) => e.visita === i && e.tipo === "join").length;
    const l = eventos.filter((e) => e.visita === i && e.tipo === "leave").length;
    console.info(`[visita ${i}] inbox → board · entradas=${j} saídas=${l}`);
  }

  await browser.close();

  /**
   * A CONTA CERTA NÃO É "entradas menos saídas".
   *
   * O supabase-js manda um `phx_leave` ANTES do `phx_join` do mesmo tópico (para
   * derrubar qualquer instância anterior) e outro na desmontagem. Resultado: por
   * visita saem 2 entradas e 4 saídas — e a diferença negativa fez a minha
   * primeira versão relatar um número que não significava nada.
   *
   * A pergunta é por TÓPICO: entrou e nunca saiu? Cada visita cria sufixos de
   * instância novos (`_r_9_`, `_r_17_`, `_r_23_`), então um tópico órfão fica
   * visível como um nome que aparece em JOIN e nunca em LEAVE.
   */
  const entrou = new Set(eventos.filter((e) => e.tipo === "join").map((e) => e.canal));
  const saiu = new Set(eventos.filter((e) => e.tipo === "leave").map((e) => e.canal));
  const orfaos = [...entrou].filter((c) => !saiu.has(c));

  console.info(`\n=== ${VISITAS} visitas à tela, navegando por clique ===`);
  const porFamilia = new Map<string, number>();
  for (const c of entrou) porFamilia.set(familia(c), (porFamilia.get(familia(c)) ?? 0) + 1);
  for (const [f, n] of [...porFamilia.entries()].sort()) {
    console.info(`  ${f.padEnd(22)} ${n} tópico(s) distinto(s) assinado(s) em ${VISITAS} visitas`);
  }
  console.info(`  tópicos que entraram: ${entrou.size} · que saíram: ${saiu.size}`);

  const vazando = orfaos.map((c) => `${c} entrou e NUNCA saiu`);
  console.info(
    vazando.length === 0
      ? "\n==> SEM VAZAMENTO: todo tópico que entrou também saiu, nas DUAS superfícies que assinam."
      : `\n==> VAZAMENTO: ${vazando.length} tópico(s) órfão(s) — ${vazando.join(" · ")}\n` +
        `    Canal órfão só incomoda quando acumula, e é por isso que teste curto nunca pega.`,
  );
  console.info(
    `\n[nota] ${eventos.length} quadros de entrada/saída observados no total. A navegação foi por ` +
      `CLIQUE: com "goto" a página recarrega, os canais morrem junto e a sonda diria "não vaza" ` +
      `sobre uma tela que vaza em todo uso real.`,
  );
  if (vazando.length > 0) process.exitCode = 1;
  void BASE;
}

main().catch((err) => {
  console.error("❌ prova de vazamento falhou:", err);
  process.exit(1);
});
