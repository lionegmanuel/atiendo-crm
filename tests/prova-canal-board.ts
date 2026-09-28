/**
 * PROVA do canal do board — por que a aba B parou de receber?
 *
 * O regente já eliminou as duas ramificações caras: o aparato da wave 3 na
 * versão original falha igual contra o código de hoje (não é a minha
 * refatoração), e a camada de banco está íntegra (publicação, replica identity,
 * policies). Sobra a ENTREGA AO NAVEGADOR — e é aqui que ela se decompõe.
 *
 * A sonda mede QUATRO elos, em ordem, e o primeiro que falhar explica os
 * seguintes. Medir o último sozinho ("não chegou evento") é o que produz uma
 * semana de caça:
 *
 *   1. o endpoint do token responde? em quanto tempo?  ← há um teto de 1,5s no
 *      hook: token lento não é erro, vira canal ANÔNIMO em silêncio
 *   2. o token que ele devolve VALE? (role, sub, exp) ← 200 não é "token bom"
 *   3. o join do canal leva `access_token`?           ← a digital do setAuth
 *   4. um UPDATE real vira quadro `postgres_changes`? ← a entrega em si
 *
 * O elo 2 existe porque o meu próprio critério da wave 3 afirmava que a resposta
 * do token chega com `cache-control: no-store`. Isso prova que ela não é
 * cacheada — NÃO prova que o token serve. Foi a lacuna que o regente apontou, e
 * ela é do instrumento, não do produto.
 *
 * Não conserta nada. Só mede.
 *
 * Run: E2E_PORT=3020 npx tsx tests/prova-canal-board.ts
 */

import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { CARD_ATTR, CREDS, carimbar, escolherAlvo, gotoBoard, login } from "./qa-helpers";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const env = carregarEnvLocal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Lê as claims sem validar assinatura — a pergunta é QUEM o token diz ser. */
function claims(jwt: string | undefined): { role?: string; sub?: string; exp?: number } | null {
  if (!jwt) return null;
  try {
    return JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64").toString());
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  carimbar([
    // O APARATO ENTRA NA PRÓPRIA LISTA — ideia do @DevVivo, e ele está certo:
    // instrumento não commitado produz veredito irreprodutível do mesmo jeito que
    // produto não commitado. Declarar só as dependências do produto deixa o carimbo
    // dizer "todas limpas" enquanto a RÉGUA muda debaixo do resultado.
    "tests/prova-canal-board.ts",
    "hooks/realtime/useRealtimeChannel.ts",
    "hooks/kanban/useBoard.ts",
    "app/api/v1/auth/realtime-token/route.ts",
  ]);

  const browser = await chromium.launch();
  const page = await browser
    .newContext({ viewport: { width: 1440, height: 900 } })
    .then((c) => c.newPage());
  page.setDefaultTimeout(60_000);

  // ---- elo 1 e 2: o endpoint do token --------------------------------------
  let tokenStatus = 0;
  let tokenMs = -1;
  let tokenBody = "";
  const inicio: Record<string, number> = {};
  page.on("request", (r) => {
    if (r.url().includes("realtime-token")) inicio[r.url()] = Date.now();
  });
  page.on("response", async (r) => {
    if (!r.url().includes("realtime-token")) return;
    tokenStatus = r.status();
    tokenMs = Date.now() - (inicio[r.url()] ?? Date.now());
    tokenBody = await r.text().catch(() => "");
  });

  // ---- elo 3: o join do canal do board -------------------------------------
  const joins: { canal: string; comToken: boolean; claims: ReturnType<typeof claims> }[] = [];
  const replies: string[] = [];
  let quadrosDeMudanca = 0;
  page.on("websocket", (ws) => {
    if (!ws.url().includes("supabase")) return;
    ws.on("framesent", (f) => {
      const s = String(f.payload);
      if (!/phx_join/.test(s)) return;
      const canal = (s.match(/realtime:([^"]+)/) ?? [])[1] ?? "?";
      const tok = (s.match(/"access_token":"([^"]+)"/) ?? [])[1];
      joins.push({ canal: canal.slice(0, 50), comToken: Boolean(tok), claims: claims(tok) });
      if (/kanban/i.test(canal)) {
        // O JOIN INTEIRO do canal do board: é aqui que se lê a TABELA e o FILTRO
        // que o cliente pediu. Sem isso, "não chegou evento" tem cinco causas
        // possíveis e nenhuma se distingue.
        console.info(`\n[join do kanban] ${s.slice(0, 700)}`);
      }
    });
    ws.on("framereceived", (f) => {
      const s = String(f.payload);
      // O quadro real diz `"type":"UPDATE"` dentro de `data`, não `"event"`.
      // Meu contador procurava a chave errada e marcava ZERO enquanto os quadros
      // chegavam — eu quase reportei "a entrega falhou" sobre uma entrega viva.
      if (/"postgres_changes"/.test(s) && /"type"\s*:\s*"(INSERT|UPDATE|DELETE)"/.test(s)) {
        quadrosDeMudanca++;
        const id = (s.match(/"id":\s*"([0-9a-f-]{36})"/) ?? [])[1] ?? "?";
        const stage = (s.match(/"stage_id":\s*"([0-9a-f-]{36})"/) ?? [])[1] ?? "?";
        console.info(`  [quadro] UPDATE lead=${id.slice(0, 8)} stage=${stage.slice(0, 8)}`);
      }
      if (/phx_reply/.test(s) && /"status":"(ok|error)"/.test(s)) replies.push(s.slice(0, 160));
      // A CONFIRMAÇÃO do servidor para o canal do board: ele aceitou a
      // assinatura de postgres_changes, e com que id? Resposta sem essa lista é
      // canal conectado que não vai receber nada — conectado não é assinado.
      if (/kanban/i.test(s) && /phx_reply|system|error/.test(s)) {
        console.info(`[resposta ao kanban] ${s.slice(0, 500)}`);
      }
    });
  });

  await login(page, "manager");
  await gotoBoard(page);
  await page.waitForTimeout(4000);

  const c = claims(((JSON.parse(tokenBody || "{}") as { data?: { access_token?: string } }).data ?? {}).access_token);
  const agora = Math.floor(Date.now() / 1000);

  console.info("\n=== ELO 1 — o endpoint do token ===");
  console.info(`  status=${tokenStatus} · ${tokenMs}ms (o hook desiste em 1500ms e segue ANÔNIMO)`);
  console.info("\n=== ELO 2 — o token VALE? (200 não é 'token bom') ===");
  console.info(
    c
      ? `  role=${c.role} · sub=${c.sub?.slice(0, 8) ?? "(nenhum)"} · expira em ${(c.exp ?? 0) - agora}s`
      : "  (nenhum token no corpo da resposta)",
  );

  // ELO 3.5 — o que a TELA declara, ao lado do que o socket fez.
  //
  // `data-realtime-status` passou a ser exposto, e ele elimina "o canal caiu".
  // NÃO elimina "o canal está autenticado": o defeito do 24b9ec2 era exatamente
  // um canal que assinava como ANÔNIMO e reportava sucesso. Os dois valores
  // juntos é que fecham — status diz que conectou, o JWT do join diz QUEM.
  const statusNaTela = await page
    .locator("[data-realtime-status]")
    .first()
    .getAttribute("data-realtime-status")
    .catch(() => null);

  console.info("\n=== ELO 3 — os joins do socket ===");
  console.info(`  a TELA declara: data-realtime-status=${statusNaTela ?? "(atributo ausente)"}`);
  for (const j of joins) {
    console.info(
      `  ${j.comToken ? "COM token" : "SEM token"} ${j.canal}` +
        (j.claims ? ` (role=${j.claims.role} sub=${j.claims.sub?.slice(0, 8) ?? "-"})` : ""),
    );
  }
  if (joins.length === 0) console.info("  (nenhum join — o socket não abriu)");
  for (const r of replies.slice(0, 3)) console.info(`  resposta: ${r}`);

  // ---- elo 4: a entrega ----------------------------------------------------
  // ALVO E DESTINO DETERMINÍSTICOS. A primeira versão pegava dois leads com
  // `limit(2)` e usava o estágio do segundo como destino — e quando os dois
  // caíam no mesmo estágio o elo 4 era PULADO em silêncio, deixando o veredito
  // "zero quadros" de pé sem que nada tivesse sido disparado. É a armadilha do
  // alvo sorteado, que eu já tinha apontado em sonda alheia.
  const { data: leads } = await admin
    .from("crm_leads")
    .select("id,title,stage_id")
    .eq("organization_id", CREDS.org_id)
    .eq("pipeline_id", (CREDS.crm_vivo as { pipeline_id: string }).pipeline_id)
    .eq("status", "open")
    .order("id")
    .limit(1);
  const alvo = escolherAlvo(
    (leads ?? []) as { id: string; title: string; stage_id: string }[],
    (l) => l.id,
    "lead do board para o gatilho",
  );
  const { data: estagios } = await admin
    .from("crm_stages")
    .select("id")
    .eq("pipeline_id", (CREDS.crm_vivo as { pipeline_id: string }).pipeline_id)
    .order("id");
  const destino = ((estagios ?? []) as { id: string }[]).find((e) => e.id !== alvo.stage_id);
  const outro = destino ? { stage_id: destino.id } : undefined;
  if (!outro) {
    console.info("\n[elo 4] sem lead aberto ou sem segundo estágio no pipeline — não dá para disparar");
  } else {
    const antes = quadrosDeMudanca;
    const cardsAntes = await page.locator(`[${CARD_ATTR}]`).count();
    await admin.from("crm_leads").update({ stage_id: outro.stage_id } as never).eq("id", alvo.id);
    await page.waitForTimeout(8000);
    console.info("\n=== ELO 4 — a entrega ===");
    console.info(`  quadros de mudança após o UPDATE: ${quadrosDeMudanca - antes}`);
    console.info(`  cards na tela: ${cardsAntes} → ${await page.locator(`[${CARD_ATTR}]`).count()}`);
    // O elo que faltava: quadro chegando não é card andando. São perguntas
    // diferentes e a resposta pode ser sim para uma e não para a outra.
    const colunaDepois = await page.evaluate((id: string) => {
      const card = document.querySelector(`[data-rfd-draggable-id="${id}"]`);
      const col = card?.closest("[data-rfd-droppable-id]");
      return col?.getAttribute("data-rfd-droppable-id") ?? "(card não encontrado)";
    }, alvo.id);
    console.info(`  coluna do alvo na TELA depois do UPDATE: ${colunaDepois.slice(0, 8)}`);
    console.info(`  esperado (o novo stage_id): ${outro.stage_id.slice(0, 8)}`);
    console.info(
      colunaDepois === outro.stage_id
        ? "  ==> o card ANDOU: quadro chegou E a UI aplicou"
        : "  ==> o card NÃO andou: se o quadro chegou, o defeito está em quem APLICA a mudança",
    );
    await admin.from("crm_leads").update({ stage_id: alvo.stage_id } as never).eq("id", alvo.id);
    console.info(`  [restaurado] "${alvo.title.slice(0, 40)}" voltou ao estágio original`);
  }

  // O elo "mudança nascida na UI de outra aba" VIVIA AQUI e saiu.
  //
  // Ele dependia de um arrasto por teclado escrito à mão nesta sonda, e o meu
  // não engatava: a rota nem era chamada. "Zero quadros na aba B" é o que se vê
  // tanto quando a entrega falha quanto quando nada foi movido — instrumento
  // pior medindo a mesma coisa que `tests/capture-wave-3-realtime.ts` já mede
  // com o helper que funciona, e com a guarda de que a ação PERSISTIU.
  //
  // Dois instrumentos para a mesma pergunta, um deles quebrado, é como se
  // fabrica um vermelho falso. Esta sonda cobre a CONEXÃO; a travessia entre
  // abas é lá.

  await browser.close();

  const boardJoin = joins.find((j) => /board|lead|kanban|pipeline/i.test(j.canal));
  console.info("\n=== VEREDITO POR ELO ===");
  console.info(`  1. endpoint do token .... ${tokenStatus === 200 ? `ok (${tokenMs}ms)` : `FALHA (${tokenStatus})`}`);
  console.info(`  2. token válido ......... ${c?.role === "authenticated" && (c.exp ?? 0) > agora ? "ok" : "FALHA"}`);
  console.info(
    `  3. join com identidade .. ${boardJoin ? (boardJoin.comToken ? `ok (role=${boardJoin.claims?.role})` : "FALHA — canal ANÔNIMO") : "não achei o canal do board"}`,
  );
  console.info(
    `  3.5 status na tela ...... ${statusNaTela ?? "(ausente)"} — "subscribed" sozinho NÃO prova autenticado`,
  );
  console.info(`  4. entrega .............. ${quadrosDeMudanca > 0 ? "ok" : "FALHA — zero quadros"}`);
}

main().catch((err) => {
  console.error("❌ prova do canal do board falhou:", err);
  process.exit(1);
});
