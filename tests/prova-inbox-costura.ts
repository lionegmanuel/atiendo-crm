/**
 * O INBOX SE CONTRADIZ NA MESMA TELA — por quanto tempo?
 *
 * Na captura do raio do silêncio, a conversa aberta já mostrava a mensagem nova
 * enquanto a lista à esquerda, na MESMA foto, continuava dizendo "Sem mensagens"
 * para aquela mesma conversa. Dois painéis da mesma tela discordando sobre o
 * mesmo fato.
 *
 * Isso não depende de realtime estar morto: é defeito de COSTURA, e a costura é
 * o único lugar sem dono — cada painel está certo sozinho. O que ninguém mediu é
 * QUANTO TEMPO a tela fica mentindo, e essa duração é o defeito: se for 200ms,
 * ninguém vê; se for indefinida, o operador atende pela lista e a lista está
 * errada.
 *
 * E o inbox foi a superfície mais instável do dia — quatro rodadas idênticas,
 * três resultados diferentes. Por isso aqui é TAXA, nunca uma foto.
 *
 * O QUE SE MEDE, por painel e por rodada:
 *   quando a CONVERSA aberta passa a mostrar a mensagem;
 *   quando a LISTA passa a refletir que aquela conversa tem mensagem nova;
 *   a JANELA DE DISCORDÂNCIA = |um − outro|, que é o tempo em que a tela mente.
 *
 * Sem proxy e sem sabotagem: a entrega está viva hoje, e o objetivo é o
 * comportamento NORMAL do produto — não o degradado, que já está medido.
 *
 * Run: E2E_PORT=3020 RODADAS=4 npx tsx tests/prova-inbox-costura.ts
 */
import { chromium, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import { BASE, CREDS, carimbar, criarPlacar, login, mensagemDeSonda } from "./qa-helpers";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

/**
 * LINHA DE BASE DECLARADA, medida em 25/07 no commit e65eb5f, ANTES da wave 8.
 *
 * Sem ela este critério reprovaria a wave 8 por um defeito que ela não causou —
 * o suspeito mais recente levando a culpa. Com ela, o critério distingue três
 * coisas que um passa/falha funde: REGRESSÃO (piorou), DEFEITO PREEXISTENTE
 * (igual) e CONSERTO (melhorou, e aí alguém tem de subir a linha de base).
 *
 * A raiz já está nomeada pelo regente: `last_message_preview` e
 * `last_message_at` são colunas desnormalizadas em `conversations` mantidas por
 * CAMINHO DE APLICAÇÃO, sem trigger em `messages`. A mediana de defasagem é
 * 0,0h — o fluxo comum funciona; o defeito está na CAUDA (uma conversa com
 * preview nulo tendo mensagens, outra defasada em 69 dias). Então a pergunta
 * não é "está quebrado?", é "qual caminho de escrita não atualiza?".
 */
const LINHA_DE_BASE = {
  quando: "25/07, medida pelo caminho de produção",
  desfecho: "acompanha ao vivo" as Desfecho,
};

/**
 * ⚠️ A BASE ANTERIOR ERA "nem recarregando" E ESTAVA ERRADA — e a distinção
 * importa para quem ler daqui a seis meses: ela NÃO subiu porque um conserto
 * entrou. Ela subiu porque a medição que a produziu era inválida.
 *
 * Aquela versão inseria em `messages` direto pelo cliente de serviço e nunca
 * chamava `fn_mark_conversation_message` — a RPC que `lib/waha/ingest.ts` executa
 * DEPOIS do insert e que mantém `last_message_preview`/`last_message_at`. A lista
 * lê essa coluna. Eu pulei o escritor e cobrei o resultado dele.
 *
 * Medido pelo caminho certo: 0ms de discordância, 2 de 2. A tela sempre esteve
 * certa — ela mostra o que a coluna diz, e a coluna não tinha por que mudar.
 *
 * Se alguém marcar isto como "conserto de 25/07" vai procurar um commit que não
 * existe.
 */

/** Os três desfechos, em ordem de gravidade crescente. O contrato do 27 pedia
 *  "sem regressão", e passa/falha não distingue regressão de defeito herdado. */
type Desfecho =
  | "acompanha ao vivo"
  | "apareceu e foi desfeito"
  | "só recarregando"
  | "nem recarregando"
  | "indecidível";
// A ORDEM É DE GRAVIDADE CRESCENTE, e "apareceu e foi desfeito" vem logo depois
// do ideal de propósito: é pior que acompanhar e melhor que nunca aparecer, mas
// é o ÚNICO que engana quem olhou uma vez.
const GRAVIDADE: Desfecho[] = [
  "acompanha ao vivo",
  "apareceu e foi desfeito",
  "só recarregando",
  "nem recarregando",
  "indecidível",
];

const env = carregarEnvLocal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const ORG = CREDS.org_id as string;
const RUN = randomUUID().slice(0, 6);

interface Rodada {
  conversa: number | null;
  lista: number | null;
  entregue: boolean;
  /** Apareceu e depois SUMIU — o estado que a medição única não enxerga. */
  sumiuDepois: boolean;
  /** `true` se a lista só passou a refletir DEPOIS de um recarregamento. */
  recarregouCorrigiu: boolean | null;
}

async function rodada(page: Page, conversaId: string, contactId: string, sessionId: string, i: number): Promise<Rodada> {
  await page.goto(`${BASE}/app/inbox?id=${conversaId}`);
  await page.waitForTimeout(3500);

  // OS DOIS PAINÉIS SÃO LIDOS PELO MESMO CRITÉRIO: o texto da marca. Ler a
  // conversa por texto e a lista por "tem badge" mediria coisas diferentes e a
  // discordância viria da minha régua, não da tela.
  const corpo = async (): Promise<string> =>
    ((await page.locator("body").innerText().catch(() => "")) ?? "").replace(/\s+/g, " ");

  // O ESTADO DERIVADO ANTES DA AÇÃO, para poder ser DEVOLVIDO. A RPC que mantém
  // essas colunas sobrescreve sem `greatest` E INCREMENTA `unread_count_for_assignee`
  // — então cada rodada minha deixava a conversa com a prévia de uma mensagem que
  // eu já tinha apagado e o contador de não lidos inflado. Apagar a mensagem não
  // desfaz o efeito dela nas colunas derivadas: limpeza que só remove a linha
  // deixa o rastro exatamente onde a próxima rodada vai medir.
  const { data: antesDerivado } = await admin
    .from("conversations")
    .select("last_message_preview,last_message_at,last_inbound_at,last_outbound_at,unread_count_for_assignee")
    .eq("id", conversaId)
    .single();

  const marca = `COSTURA${RUN}${i}`;
  const antes = await corpo();
  if (antes.includes(marca)) throw new Error("a marca já estava na tela antes da ação");

  const t0 = Date.now();
  // ESCRITA PELO HELPER DO @DevVivo, não à mão. Ele insere E chama
  // `fn_mark_conversation_message` — o mesmo escritor do ingest — e devolve um
  // `apaga()` que remove PELO ID e estoura se não casar exatamente uma linha.
  //
  // As duas coisas consertam erros meus de hoje: a minha versão inseria direto e
  // media uma coluna que ninguém tinha mandado atualizar (achado falso de
  // produto), e a minha limpeza casava por `LIKE` no corpo — que apaga zero em
  // silêncio quando o padrão não bate, e foi assim que duas mensagens minhas
  // sobreviveram a uma limpeza que "rodou". Dois aparatos chegaram ao mesmo
  // conserto no mesmo dia; usar o dele é mais barato que manter o meu igual.
  const msg = await mensagemDeSonda(admin, {
    organizationId: ORG,
    conversationId: conversaId,
    contactId,
    channelSessionId: sessionId,
    direction: "inbound",
    body: `${marca} mensagem de costura`,
  });

  // A LINHA DA CONVERSA ABERTA, não a coluna inteira. `ConversationListItem`
  // marca a selecionada com `aria-current="true"` — é o único atributo estável
  // que a lista expõe, e isola exatamente o painel que se contradizia com a
  // thread na captura de hoje. Ler a coluna inteira misturaria as outras
  // conversas e o filtro; ler o corpo da página faria a lista "acertar" por
  // causa da thread ao lado.
  const listaLoc = page.locator('button[aria-current="true"]').first();
  // TIMEOUT CURTO E EXPLÍCITO. O `.catch(() => "")` NÃO evita a espera — ele só
  // engole o erro DEPOIS do timeout padrão de 60s. Com 15 amostras por rodada,
  // o meu próprio aparato levaria 15 minutos por rodada e eu ia culpar o
  // ambiente. Instrumento lento é instrumento quebrado com outra roupa.
  const lista = async (): Promise<string> =>
    ((await listaLoc.innerText({ timeout: 1500 }).catch(() => "")) ?? "").replace(/\s+/g, " ");

  // PRÉ-CONDIÇÃO: o painel da lista PRECISA existir. Sem esta checagem, um
  // localizador que nunca resolve produziria "a lista nunca acompanhou em 4/4" —
  // vermelho sobre o produto causado pelo meu seletor. É a família que eu venho
  // caçando o dia inteiro, agora na minha própria mão.
  if ((await listaLoc.count()) === 0) {
    throw new Error(
      "[pré-condição] não encontrei o painel da LISTA de conversas — sem ele não há costura a medir, " +
        "e reportar 'a lista não acompanhou' seria acusar o produto pelo meu seletor",
    );
  }

  // ⚠️ ESTE CRITÉRIO NÃO COMPARA CARIMBO DE BANCO, E ISSO É DELIBERADO.
  //
  // Os dois números abaixo são deslocamentos do MEU relógio (`Date.now()`), lidos
  // do DOM pelos dois painéis com a mesma régua. `last_message_at` só aparece
  // neste arquivo no backup/restauração das colunas derivadas — nunca numa
  // comparação.
  //
  // Por que isso importa: `sent_at` vem do relógio do APARELHO (o timestamp que o
  // WhatsApp manda) e o carimbo da conversa vem do relógio do SERVIDOR, e a
  // migration 0027 recalcula pelo do aparelho. A MESMA COLUNA CARREGA RELÓGIOS
  // DIFERENTES conforme quem escreveu por último — há conversa no banco com 3,3s
  // de diferença por isso. Um critério que comparasse essas colunas precisaria de
  // tolerância declarada; este não precisa, porque não as compara.
  //
  // SE ALGUÉM TROCAR O OBSERVÁVEL pelo rótulo de tempo que a linha exibe
  // ("há 20 horas"), a deriva dos dois relógios ENTRA — e aí a tolerância passa a
  // ser obrigatória, com o motivo escrito, senão vira falso vermelho com a
  // autoridade de um critério feito para pegar regressão.
  let naConversa: number | null = null;
  let naLista: number | null = null;
  for (let t = 0; t < 15 && (naConversa === null || naLista === null); t++) {
    await page.waitForTimeout(2000);
    const ms = Date.now() - t0;
    if (naConversa === null && (await corpo()).includes(marca)) naConversa = ms;
    if (naLista === null && (await lista()).includes(marca)) naLista = ms;
  }

  // E O QUE A LINHA DIZ, para o laudo não ser só "não apareceu": sem o texto
  // observado, "a lista não acompanhou" não distingue lista velha de lista que
  // mostra outra coisa.
  // E A SEGUNDA LEITURA, DEPOIS DE UM INTERVALO DECLARADO: a lista precisa
  // CONTINUAR certa, não só ficar certa. "Apareceu" e "está lá" são coisas
  // diferentes — um refetch com dado velho sobrescreveria o painel e o operador
  // veria a linha voltar a "Sem mensagens" sem nada acusar. A medição única não
  // distingue "nunca apareceu" de "apareceu e foi desfeito", e o segundo é o
  // único que engana: quem olhou uma vez guarda a lembrança de que estava certo.
  let sumiuDepois = false;
  if (naLista !== null && naConversa !== null) {
    await new Promise((r) => setTimeout(r, 10_000));
    sumiuDepois = !(await lista()).includes(marca) || !(await corpo()).includes(marca);
  }

  // E O RECARREGAMENTO SEPARA DOIS DEFEITOS MUITO DIFERENTES: "não atualiza ao
  // vivo" (o operador aperta F5 e resolve) e "não atualiza nem recarregando" (a
  // lista está errada e continua errada). Sem esta leitura eu reportaria o
  // primeiro e o segundo seria descoberto por um atendente.
  let apoRecarga = "(não medido)";
  if (naLista === null) {
    await page.reload();
    await page.waitForTimeout(4000);
    apoRecarga = (await lista()).includes(marca) ? "SIM, depois de recarregar" : "NEM recarregando";
  }
  const textoDaLinha = (await lista()).slice(0, 110);
  await msg.apaga();
  // A DEVOLUÇÃO É POR UPDATE DIRETO, e aqui isso é o certo: não estou simulando
  // uma operação do produto, estou DESFAZENDO a minha contaminação. Usar a RPC
  // para restaurar incrementaria o contador de novo — o "conserto" repetindo o
  // dano é o que já me pegou uma vez hoje.
  if (antesDerivado) await admin.from("conversations").update(antesDerivado as never).eq("id", conversaId);
  if (naLista === null)
    console.info(`      (a linha dizia: "${textoDaLinha}") · corrige ao recarregar: ${apoRecarga}`);
  return {
    conversa: naConversa,
    lista: naLista,
    entregue: naConversa !== null,
    sumiuDepois,
    recarregouCorrigiu: apoRecarga === "(não medido)" ? null : apoRecarga.startsWith("SIM"),
  };
}

async function main(): Promise<void> {
  carimbar([
    "tests/prova-inbox-costura.ts",
    "hooks/inbox/useMessagesRealtime.ts",
    "hooks/inbox/useConversationsRealtime.ts",
  ]);
  const RODADAS = Number(process.env.RODADAS ?? "4");

  const { data: convs } = await admin
    .from("conversations")
    .select("id,contact_id,channel_session_id")
    .eq("organization_id", ORG)
    .order("id")
    .limit(1);
  const c = (convs ?? [])[0] as { id: string; contact_id: string; channel_session_id: string };

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.setDefaultTimeout(60_000);
  await login(page, "manager");

  const rs: Rodada[] = [];
  // O `try/finally` EXISTE PELO QUE ACONTECE QUANDO ESTOURA, não pelo caminho
  // feliz. Sem ele: a mensagem inserida fica no banco, o estado derivado da
  // conversa fica com a marca da sonda, e o navegador nunca fecha — e o
  // Playwright segura o event loop, então o processo pendura até um timeout
  // externo. Sonda que pendura em CI é pior que sonda que suja banco: a segunda
  // alguém limpa, a primeira bloqueia a fila de todo mundo.
  try {
  for (let i = 1; i <= RODADAS; i++) {
    const r = await rodada(page, c.id, c.contact_id, c.channel_session_id, i);
    const conv = r.conversa === null ? "NUNCA (30s)" : `${r.conversa}ms`;
    const lst = r.lista === null ? "NUNCA (30s)" : `${r.lista}ms`;
    const janela =
      r.conversa !== null && r.lista !== null
        ? `${Math.abs(r.lista - r.conversa)}ms de discordância`
        : r.conversa !== null
          ? "discordância NÃO FECHOU em 30s"
          : "(a conversa nem recebeu — nada a comparar)";
    console.info(`  rodada ${i} · conversa=${conv.padEnd(12)} lista=${lst.padEnd(12)} · ${janela}`);
    rs.push(r);
  }
  } finally {
    await browser.close();
  }

  const recebeu = rs.filter((r) => r.conversa !== null).length;
  const listaOk = rs.filter((r) => r.lista !== null).length;

  // ---- o critério do cenário 27 --------------------------------------------
  const { record, fechar } = criarPlacar("CENÁRIO 27 · a lista acompanha a conversa", ["C27.costura"]);
  const recarregou = rs.some((r) => r.recarregouCorrigiu === true);
  const desfeito = rs.some((r) => r.sumiuDepois);
  const desfechoMedido: Desfecho =
    desfeito
      ? "apareceu e foi desfeito"
      : recebeu === 0
      ? "indecidível"
      : listaOk === recebeu
        ? "acompanha ao vivo"
        : recarregou
          ? "só recarregando"
          : "nem recarregando";
  // C27_SIMULA força o desfecho para exercitar os ramos. Os três só rodam
  // naturalmente em dias diferentes — "melhorou" só no dia do conserto, e é
  // justamente o dia em que ninguém repara que a cerca não avisou. E a
  // sabotagem tem de atingir a CONJUNÇÃO inteira: aqui o desfecho é a única
  // condição, mas eu já fui pego sabotando metade de um `&&`.
  const desfecho: Desfecho = (process.env.C27_SIMULA as Desfecho) ?? desfechoMedido;
  const piorou = GRAVIDADE.indexOf(desfecho) > GRAVIDADE.indexOf(LINHA_DE_BASE.desfecho);
  const melhorou = GRAVIDADE.indexOf(desfecho) < GRAVIDADE.indexOf(LINHA_DE_BASE.desfecho);
  // "IGUAL À BASE" SÓ É BLOQUEADO SE A BASE FOR UM DEFEITO. Com a base saudável,
  // igualar-se a ela é o resultado desejado — e a versão anterior deste critério
  // dizia "defeito preexistente" sobre o estado bom, carregando o texto de um
  // achado que eu já tinha retratado. Veredito herdando a redação da hipótese
  // morta é a mesma folclorização que eu consertei no D21.
  const ideal = desfecho === "acompanha ao vivo";
  record(
    "C27.costura",
    "a linha da conversa aberta reflete a mensagem que a thread já mostra",
    ideal && !piorou,
    desfecho === "indecidível"
      ? "INDECIDÍVEL: nem a conversa recebeu a mensagem — sem isso não há costura a julgar"
      : melhorou
        ? `MELHOROU: desfecho "${desfecho}" contra a linha de base "${LINHA_DE_BASE.desfecho}" ` +
          `(${LINHA_DE_BASE.quando}). SUBA A LINHA DE BASE — senão este critério para de detectar ` +
          `a próxima regressão.`
        : piorou
          ? `REGRESSÃO: desfecho "${desfecho}" contra a linha de base "${LINHA_DE_BASE.desfecho}" ` +
            `(${LINHA_DE_BASE.quando}) — piorou nesta wave. A lista deixou de acompanhar a thread.`
          : ideal
            ? `a lista acompanhou a thread nas ${RODADAS} rodada(s), com discordância de ` +
              `${rs.map((r) => (r.lista !== null && r.conversa !== null ? Math.abs(r.lista - r.conversa) : -1)).join("/")}ms — ` +
              `medido pelo caminho de produção (o insert MAIS a RPC que mantém a coluna que a lista lê)`
            : `DEFEITO PREEXISTENTE, não regressão desta wave: desfecho "${desfecho}", igual à ` +
              `linha de base de ${LINHA_DE_BASE.quando}`,
    desfecho === "indecidível"
      ? "INCONCLUSIVO"
      : melhorou
        ? "FALHA"
        : !piorou && !ideal
          ? "BLOQUEADO"
          : undefined,
  );

  if (fechar() > 0) process.exitCode = 1;
  process.exit(process.exitCode ?? 0);
}

main().catch((err) => {
  console.error("❌ prova falhou:", err);
  process.exit(1);
});
