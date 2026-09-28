/**
 * QUANDO O TEMPO REAL MORRE CALADO, O QUE O USUÁRIO VÊ?
 *
 * Hoje ficou provado que a entrega de postgres_changes pode morrer enquanto o
 * canal se declara SUBSCRIBED. Isso torna urgente uma pergunta que é de PRODUTO
 * e sobrevive a qualquer conserto daquele defeito: com a entrega morta, a tela
 * avisa? Ela se recupera sozinha? Ou fica mostrando dado velho para sempre, com
 * cara de saudável?
 *
 * O ESTADO QUE FALTA É O TERCEIRO. Não é "ao vivo" contra "morto": é ao vivo,
 * morto e NÃO SEI. Uma tela que só sabe dizer "conectado" transforma o não sei em
 * saudável — e é o pior dos três, porque some sem deixar rastro.
 *
 * COMO EU MATO A ENTREGA SEM DERRUBAR O CANAL: um proxy de WebSocket engole
 * apenas os quadros de DADOS (`"event":"postgres_changes"`) e deixa passar todo o
 * resto — join, phx_reply, heartbeat. O canal continua confirmando e o app
 * continua achando que está vivo. Fechar o socket seria outro defeito, visível,
 * e mediria uma tela que não é a que me interessa.
 *
 * CONTROLE POSITIVO OBRIGATÓRIO: cada superfície roda DUAS vezes, com o mesmo
 * proxy no caminho — uma repassando tudo, outra engolindo os dados. Sem a rodada
 * transparente, "nada apareceu" não distingue "a entrega morreu" de "o meu proxy
 * quebrou a página" nem de "o gatilho não produziu nada". A refutação sem
 * controle positivo fecha a linha e ninguém volta.
 *
 * O OBSERVÁVEL foi escolhido por ESCOPO e INVARIÂNCIA DE APRESENTAÇÃO: eu não
 * procuro um componente, procuro (1) o texto da tela mudar sozinho e (2) QUALQUER
 * sinal de degradação em texto visível. Exigir um badge específico reprovaria uma
 * tela que avisa de outro jeito, e é exatamente o falso vermelho que me pegou
 * sete vezes na wave 6.
 *
 * Run: E2E_PORT=3020 npx tsx tests/prova-raio-do-silencio.ts
 */
import { chromium, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import { BASE, CREDS, carimbar, login, mensagemDeSonda, shotPage } from "./qa-helpers";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const env = carregarEnvLocal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ORG = CREDS.org_id as string;
const RUN = randomUUID().slice(0, 6);
/** O pipeline SAUDÁVEL. Medir isto no CRM Vivo seria medir o defeito de entrega
 *  em cima do defeito de silêncio: a rodada de controle não teria como passar, e
 *  eu não saberia distinguir as duas mortes. */
const PIPELINE_VIVO = "48c02b4a-0ca1-4bca-8ef0-206b6d240d23";

/** Vocabulário de degradação. Deliberadamente largo: o critério é "a tela diz
 *  ALGUMA coisa", não "a tela diz do meu jeito". */
const AVISO =
  /(offline|sem conex|desconect|reconect|desatualiz|atualiz(ando|e a p)|tempo real|ao vivo|pausad|erro de conex|stale|parad)/i;

interface Superficie {
  nome: string;
  abrir: (p: Page) => Promise<void>;
  gatilho: () => Promise<string>;
  desfazer: () => Promise<void>;
}

/** Entrega de verdade: `[join_ref, ref, topic, "postgres_changes", payload]`. O
 *  `phx_reply` que confirma a assinatura tem a mesma palavra no corpo, então
 *  qualquer casamento por texto solto confunde recibo com entrega. */
function ehQuadroDeDados(bruto: string): boolean {
  try {
    const q: unknown = JSON.parse(bruto);
    return Array.isArray(q) && q[3] === "postgres_changes";
  } catch {
    return false;
  }
}

async function texto(p: Page): Promise<string> {
  return ((await p.locator("body").innerText().catch(() => "")) ?? "").replace(/\s+/g, " ");
}

async function medir(sup: Superficie, engolir: boolean): Promise<Record<string, string>> {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.setDefaultTimeout(60_000);

  let engolidos = 0;
  let repassados = 0;
  // CONTADOR DO PRÓPRIO PROXY. "0 engolidos" tem dois pais: não passou quadro de
  // dados, ou o proxy não está no caminho. O segundo faz as duas rodadas serem a
  // mesma rodada, e eu leria "a tela se recupera sozinha" de um experimento que
  // nunca matou nada. Instrumento sem autoteste mente calado.
  let quadrosTotais = 0;
  // O PROXY ESTÁ NO CAMINHO NAS DUAS RODADAS. Se ele só existisse na rodada que
  // engole, a comparação teria duas variáveis — o proxy e o engolir — e eu
  // estaria repetindo o teste confundido que me custou o dia.
  await page.routeWebSocket(/realtime/i, (route) => {
    const servidor = route.connectToServer();
    route.onMessage((m) => servidor.send(m));
    servidor.onMessage((m) => {
      const s = String(m);
      quadrosTotais++;
      // O QUADRO DO PHOENIX É UM ARRAY, NÃO UM OBJETO:
      //   [join_ref, ref, topic, event, payload]
      // Não existe chave `"event":` nenhuma. Meu filtro procurava por ela e nunca
      // casava — as duas rodadas eram a mesma rodada e eu ia ler "a tela se
      // recupera sozinha" de um experimento que não matou nada. É a segunda vez
      // hoje que este mesmo quadro me engana: antes eu casava a SUBSTRING
      // "postgres_changes" e contava recibo como entrega; ao consertar exigindo
      // `"event":`, troquei falso positivo por falso NEGATIVO. Agora eu leio a
      // posição, que é onde a informação mora.
      if (ehQuadroDeDados(s)) {
        if (engolir) {
          engolidos++;
          return;
        }
        repassados++;
      }
      route.send(m);
    });
  });

  await login(page, "manager");
  await sup.abrir(page);
  await page.waitForTimeout(4000);

  const antes = await texto(page);
  const statusAntes = (await page.locator("[data-realtime-status]").first().getAttribute("data-realtime-status").catch(() => null)) ?? "(não exposto)";
  const marca = await sup.gatilho();

  // AMOSTRAGEM AO LONGO DO TEMPO, não uma foto no fim: "não apareceu" e
  // "apareceu depois de 20s por um refetch de segurança" são produtos
  // diferentes, e a foto única confunde os dois num vermelho só.
  let quandoApareceu = -1;
  for (let t = 2; t <= 30; t += 2) {
    await page.waitForTimeout(2000);
    if ((await texto(page)).includes(marca)) {
      quandoApareceu = t;
      break;
    }
  }
  // TROCAR DE ABA E VOLTAR. "Fica velha para sempre" e "fica velha até você
  // voltar para a aba" são produtos diferentes, e o usuário troca de aba o tempo
  // todo — se houver recuperação por foco, o defeito tem um teto e o laudo muda.
  // Sem medir isto eu estaria afirmando o pior caso sem ter olhado para ele.
  let recuperouNoFoco = "não testado";
  if (quandoApareceu < 0) {
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("blur"));
    });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    await page.waitForTimeout(6000);
    recuperouNoFoco = (await texto(page)).includes(marca) ? "SIM, ao voltar para a aba" : "não";
  }

  const depois = await texto(page);
  const statusDepois = (await page.locator("[data-realtime-status]").first().getAttribute("data-realtime-status").catch(() => null)) ?? "(não exposto)";
  const avisoNovo = (depois.match(AVISO) ?? [])[0] ?? "";
  const avisoJaEstava = AVISO.test(antes);

  await shotPage(page, `raio-${sup.nome}-${engolir ? "MORTO" : "controle"}.png`, false);
  await sup.desfazer();
  await browser.close();

  return {
    apareceu: quandoApareceu > 0 ? `sim, em ~${quandoApareceu}s` : "NÃO, em 30s",
    foco: recuperouNoFoco,
    aviso: avisoNovo && !avisoJaEstava ? `"${avisoNovo}"` : "NENHUM",
    status: statusAntes === statusDepois ? statusAntes : `${statusAntes}→${statusDepois}`,
    quadros:
      quadrosTotais === 0
        ? "PROXY FORA DO CAMINHO (0 quadros) — esta linha não mede nada"
        : engolir
          ? `${engolidos} engolido(s) de ${quadrosTotais}`
          : `${repassados} repassado(s) de ${quadrosTotais}`,
  };
}

async function main(): Promise<void> {
  carimbar([
    "tests/prova-raio-do-silencio.ts",
    "hooks/realtime/useRealtimeChannel.ts",
    "hooks/kanban/useBoard.ts",
    "hooks/leads/useLeadTimeline.ts",
    "hooks/inbox/useConversationsRealtime.ts",
    "hooks/inbox/useMessagesRealtime.ts",
  ]);

  const { data: leads } = await admin
    .from("crm_leads")
    .select("id,title")
    .eq("pipeline_id", PIPELINE_VIVO)
    .order("id")
    .limit(1);
  const lead = (leads ?? [])[0] as { id: string; title: string };
  const { data: convs } = await admin
    .from("conversations")
    .select("id,channel_session_id,contact_id")
    .eq("organization_id", ORG)
    .order("id")
    .limit(1);
  const conversa = (convs ?? [])[0] as { id: string; channel_session_id: string; contact_id: string };

  // O que a superfície de inbox plantou, para o `desfazer` apagar pelo ID.
  let plantada: Awaited<ReturnType<typeof mensagemDeSonda>> | null = null;
  const superficies: Superficie[] = [
    {
      nome: "board",
      abrir: async (p) => {
        await p.goto(`${BASE}/app/pipelines/${PIPELINE_VIVO}`);
      },
      gatilho: async () => {
        const marca = `RAIO${RUN}`;
        const { error } = await admin
          .from("crm_leads")
          .update({ title: `${lead.title} ${marca}` })
          .eq("id", lead.id);
        if (error) throw new Error(`gatilho board: ${error.message}`);
        return marca;
      },
      desfazer: async () => {
        await admin.from("crm_leads").update({ title: lead.title }).eq("id", lead.id);
      },
    },
    {
      nome: "dossie",
      abrir: async (p) => {
        await p.goto(`${BASE}/app/pipelines/${PIPELINE_VIVO}`);
        await p.waitForTimeout(2500);
        await p.locator(`[data-rfd-draggable-id="${lead.id}"]`).first().click();
        await p.waitForTimeout(1500);
      },
      gatilho: async () => {
        const marca = `RAIO${RUN}`;
        const { error } = await admin.from("crm_lead_activities").insert({
          organization_id: ORG,
          lead_id: lead.id,
          source_module: "qa",
          type: "note",
          actor_kind: "system",
          reason: `nota do raio ${marca}`,
          evidence: {},
          performed_at: new Date().toISOString(),
        } as never);
        if (error) throw new Error(`gatilho dossiê: ${error.message}`);
        return marca;
      },
      desfazer: async () => {
        await admin.from("crm_lead_activities").delete().like("reason", `nota do raio RAIO${RUN}%`);
      },
    },
    {
      nome: "inbox",
      // A CONVERSA PRECISA ESTAR ABERTA. Na rodada anterior eu fiquei na lista, e
      // `useMessagesRealtime` só assina com uma conversa selecionada — o controle
      // não mudou nada e a linha inteira virou inconclusiva. Medir a superfície
      // errada dá o mesmo zero que medir a certa quebrada.
      abrir: async (p) => {
        await p.goto(`${BASE}/app/inbox?id=${conversa.id}`);
        await p.waitForTimeout(2500);
      },
      gatilho: async () => {
        const marca = `RAIO${RUN}`;
        // PASSA PELO ESCRITOR REAL (`mensagemDeSonda` → a mesma RPC do ingest).
        //
        // Inserindo direto, a conversa nunca recebia o carimbo de última
        // mensagem — e esta sonda mede justamente se a LISTA acompanha. Ela
        // estaria cobrando da tela uma atualização que nenhum escritor tinha
        // mandado fazer, e chamando de "não recuperou" o que era gatilho mudo.
        plantada = await mensagemDeSonda(admin, {
          organizationId: ORG,
          conversationId: conversa.id,
          contactId: conversa.contact_id,
          channelSessionId: conversa.channel_session_id,
          direction: "inbound",
          // A marca no COMEÇO: a lista mostra prévia truncada, e marca no fim
          // seria cortada pela apresentação — falso vermelho por forma.
          body: `${marca} mensagem do raio`,
        });
        return marca;
      },
      desfazer: async () => {
        await plantada?.apaga();
        plantada = null;
      },
    },
  ];

  const linhas: string[] = [];
  // SUPERFICIE/CONDICAO/REPETIR existem porque o inbox discordou de si mesmo
  // entre duas execuções (não recuperou em 30s numa, recuperou em ~10s na
  // outra). Com resultado alternando, cada rodada isolada é sorteio — e eu já
  // reportei um sorteio como veredito hoje. Repetição é o preço.
  const so = process.env.SUPERFICIE;
  const condicoes: boolean[] =
    process.env.CONDICAO === "morta" ? [true] : process.env.CONDICAO === "viva" ? [false] : [false, true];
  const REPETIR = Number(process.env.REPETIR ?? "1");
  for (const sup of superficies.filter((x) => !so || x.nome === so)) {
    for (const engolir of condicoes) {
      for (let r = 0; r < REPETIR; r++) {
      const r = await medir(sup, engolir);
      const rotulo = `${sup.nome.padEnd(7)} ${engolir ? "ENTREGA MORTA" : "controle vivo "}`;
      const linha =
        `${rotulo} · mudou sozinha: ${r.apareceu!.padEnd(14)} · volta ao focar: ${r.foco!.padEnd(24)} · avisa: ${r.aviso!.padEnd(8)} · ` +
        `status exposto: ${r.status} · ${r.quadros}`;
      console.info(`  ${linha}`);
      linhas.push(linha);
      }
    }
  }

  console.info(`\n=== RAIO DO SILÊNCIO ===\n  ${linhas.join("\n  ")}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ prova falhou:", err);
  process.exit(1);
});
