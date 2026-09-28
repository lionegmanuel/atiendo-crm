import { randomInt, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";
import { test, expect, type Page } from "./helpers/test";

import { credenciaisSupabaseDeTeste } from "../../scripts/lib/env-de-teste";

/**
 * A BUSCA DENTRO DA CONVERSA (#1795, extraída do #1793) — pela tela, como o
 * atendente faz: lupa no cabeçalho, digita, vê as bolhas marcadas e o contador,
 * Esc fecha, troca de conversa.
 *
 * Os testes de unidade do PR provam a lógica com a `MessageBubble` real, mas
 * não provam que o anel APARECE no CSS que o build entrega (a classe existe e
 * o Tailwind pode não gerá-la), nem que a lupa cabe na barra. Por isso a marca
 * é medida por `getComputedStyle` — o `box-shadow` que o `ring-2 ring-offset-2`
 * produz —, nunca pela presença da classe.
 *
 * O dado é deste arquivo (mesmo molde de `inbox-responder-citando`): um canal,
 * duas conversas e as mensagens, criados no `beforeAll` e apagados no
 * `afterAll`. A conversa B TAMBÉM contém o termo: sem isso, "a busca não vazou
 * para B" passaria mesmo se vazasse, por falta do que marcar.
 */

interface E2ECreds {
  password: string;
  users: Record<string, { id: string; email: string; role: string }>;
}

const creds = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), ".e2e-creds.json"), "utf8"),
) as E2ECreds;
const EVIDENCE = path.join(process.cwd(), "evidence", "busca-na-conversa");

const credenciais = credenciaisSupabaseDeTeste();
const db = createClient(credenciais.url, credenciais.serviceRole, {
  auth: { persistSession: false },
});

const SUFIXO = randomUUID().slice(0, 8);
const NOME_A = `Cliente busca A ${SUFIXO}`;
const NOME_B = `Cliente busca B ${SUFIXO}`;
/** Presente em 2 mensagens de A (uma em maiúsculas: a busca ignora caixa) e em 1 de B. */
const TERMO = "boleto";

const MENSAGENS_A = [
  { direcao: "inbound", texto: "Oi, bom dia" },
  { direcao: "inbound", texto: "Pode me mandar o boleto de novo?" },
  { direcao: "outbound", texto: "Claro! Segue o BOLETO atualizado" },
  { direcao: "inbound", texto: "Obrigado, até mais" },
] as const;
const MENSAGENS_B = [{ direcao: "inbound", texto: "Recebi o boleto, obrigado" }] as const;

let orgId = "";
let canal = "";
const conversas: string[] = [];
const contatos: string[] = [];

async function insere(tabela: string, valores: Record<string, unknown>): Promise<string> {
  const { data, error } = await db.from(tabela).insert(valores).select("id").single();
  if (error) throw new Error(`${tabela}: ${error.message}`);
  return (data as { id: string }).id;
}

async function conversaCom(
  nome: string,
  mensagens: ReadonlyArray<{ direcao: "inbound" | "outbound"; texto: string }>,
): Promise<string> {
  const contato = await insere("contacts", {
    organization_id: orgId,
    name: nome,
    phone_number: `+5511${randomInt(100000000, 1000000000)}`,
  });
  const conversa = await insere("conversations", {
    organization_id: orgId,
    contact_id: contato,
    channel_session_id: canal,
    status: "open",
    last_message_at: new Date().toISOString(),
  });
  contatos.push(contato);
  conversas.push(conversa);
  // Um segundo entre elas: a ordem da conversa não depende do relógio do banco.
  const base = Date.now() - mensagens.length * 1000;
  for (const [i, m] of mensagens.entries()) {
    await insere("messages", {
      organization_id: orgId,
      contact_id: contato,
      conversation_id: conversa,
      channel_session_id: canal,
      direction: m.direcao,
      type: "text",
      status: m.direcao === "inbound" ? "received" : "sent",
      body: m.texto,
      sent_at: new Date(base + i * 1000).toISOString(),
      external_id: `busca-${SUFIXO}-${randomUUID()}`,
    });
  }
  return conversa;
}

async function login(page: Page): Promise<void> {
  // `agent`, não `admin`: o admin pode parar em `/login/mfa` (ver a spec irmã).
  await page.goto("/login");
  await page.locator("#email").fill(creds.users.agent!.email);
  await page.locator("#password").fill(creds.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/app\//);
}

const bolhas = (page: Page) => page.getByTestId("message-bubble");
const itemDaLista = (page: Page, id: string) =>
  page.locator(`button[data-conversation-id="${id}"]`);

interface BolhaMedida {
  texto: string;
  marcada: boolean;
  /** Cor do anel externo (o `0 0 0 4px` do ring-2 + offset-2), ou null sem anel. */
  anel: string | null;
  fundo: string;
  boxShadow: string;
}

/** Mede cada bolha pelo estilo COMPUTADO — o que o navegador pinta. */
function medirBolhas(page: Page): Promise<BolhaMedida[]> {
  return bolhas(page).evaluateAll((els) =>
    els.map((el) => {
      const cs = getComputedStyle(el);
      // Separa as sombras pelas vírgulas de fora dos parênteses de `rgb(...)`.
      const partes = cs.boxShadow.split(/,(?![^(]*\))/).map((s) => s.trim());
      const anel = partes.find((p) => /\s0px 0px 0px 4px$/.test(p));
      return {
        texto: el.textContent ?? "",
        marcada: el.parentElement?.getAttribute("data-search-match") === "true",
        anel: anel ? anel.replace(/\s+0px 0px 0px 4px$/, "") : null,
        fundo: cs.backgroundColor,
        boxShadow: cs.boxShadow,
      };
    }),
  );
}

test.beforeAll(async () => {
  const { data, error } = await db
    .from("user_organizations")
    .select("organization_id")
    .eq("user_id", creds.users.agent!.id)
    .limit(1)
    .maybeSingle();
  if (error || !data) throw new Error(`organização do agente: ${error?.message ?? "não achei"}`);
  orgId = (data as { organization_id: string }).organization_id;

  canal = await insere("channel_sessions", {
    organization_id: orgId,
    waha_session_name: `busca-${SUFIXO}`,
    display_name: `Canal busca ${SUFIXO}`,
    status: "WORKING",
    webhook_secret_encrypted: "\\x00",
  });
  await conversaCom(NOME_A, MENSAGENS_A);
  await conversaCom(NOME_B, MENSAGENS_B);
});

test.afterAll(async () => {
  if (conversas.length) await db.from("conversations").delete().in("id", conversas);
  if (contatos.length) await db.from("contacts").delete().in("id", contatos);
  if (canal) await db.from("channel_sessions").delete().eq("id", canal);
});

test.describe("busca dentro da conversa", () => {
  test.describe.configure({ timeout: 180_000 });

  test("marca as bolhas certas, Esc devolve o foco à lupa, e a busca não vaza para outra conversa", async ({
    page,
  }) => {
    const [conversaA, conversaB] = conversas as [string, string];
    await login(page);
    // `filter=all`: a aba padrão depende de haver agente no ar, e a troca de
    // conversa abaixo é pela LISTA — a conversa B precisa estar nela.
    await page.goto(`/app/inbox?id=${conversaA}&filter=all`);
    await expect(bolhas(page)).toHaveCount(MENSAGENS_A.length, { timeout: 30_000 });

    // ── abrir a busca pela lupa
    const lupa = page.getByRole("button", { name: "Buscar nesta conversa" });
    await expect(lupa).toHaveAttribute("aria-expanded", "false");
    // A lupa acrescenta ~38px à barra. A barra PODE quebrar (ver o comentário
    // dela no ConversationHeader); a pergunta é se é a LUPA que a faz quebrar.
    // Por isso mede as fileiras com a lupa e, contrafactual, com ela fora do
    // fluxo (`display: none`, restaurado logo em seguida).
    const barra = await lupa.evaluate((b) => {
      const fileiras = () => {
        // Só filho com caixa: um filho sem tamanho (portal, span vazio) tem
        // top 0 e inventaria uma fileira.
        const caixas = [...(b.parentElement?.children ?? [])]
          .map((c) => c.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.height > 0)
          .sort((x, y) => x.top - y.top);
        let n = 0;
        let fundo = -Infinity;
        for (const r of caixas) {
          if (r.top >= fundo) n += 1;
          fundo = Math.max(r.top >= fundo ? r.bottom : fundo, r.bottom);
        }
        return n;
      };
      const comLupa = fileiras();
      const display = b.style.display;
      b.style.display = "none";
      const semLupa = fileiras();
      b.style.display = display;
      return { viewport: window.innerWidth, comLupa, semLupa };
    });
    console.info(`busca-na-conversa · fileiras da barra de ações: ${JSON.stringify(barra)}`);
    // soft: o resto da jornada roda e é medido mesmo se a lupa quebrar a barra.
    expect.soft(barra.comLupa, "a lupa fez a barra de ações ganhar uma fileira em 1280px").toBe(barra.semLupa);

    await lupa.click();
    const campo = page.getByRole("searchbox", { name: "Buscar nas mensagens carregadas" });
    await expect(campo).toBeVisible();
    await expect(campo, "o campo abre com o foco").toBeFocused();
    await expect(lupa).toHaveAttribute("aria-expanded", "true");

    // ── digitar o termo: contador e marca
    await campo.fill(TERMO);
    const contador = page.getByRole("status").filter({ hasText: "Resultados nas mensagens carregadas" });
    await expect(contador).toHaveText(/Resultados nas mensagens carregadas:\s*2$/);
    await expect(page.locator('[data-search-match="true"]')).toHaveCount(2);

    const medidas = await medirBolhas(page);
    console.info(`busca-na-conversa · bolhas: ${JSON.stringify(medidas)}`);
    const comTermo = medidas.filter((m) => m.texto.toLocaleLowerCase().includes(TERMO));
    const semTermo = medidas.filter((m) => !m.texto.toLocaleLowerCase().includes(TERMO));
    expect(comTermo, "as 2 mensagens com o termo").toHaveLength(2);
    expect(semTermo, "as 2 mensagens sem o termo").toHaveLength(2);
    for (const m of comTermo) {
      expect(m.marcada, `marcada: "${m.texto}"`).toBe(true);
      expect(m.anel, `anel pintado em "${m.texto}" — box-shadow: ${m.boxShadow}`).not.toBeNull();
      expect(m.anel, `anel transparente em "${m.texto}"`).not.toMatch(/^rgba\(0, 0, 0, 0\)$/);
      expect(m.anel, `anel da cor do fundo em "${m.texto}" — não se vê`).not.toBe(m.fundo);
    }
    for (const m of semTermo) {
      expect(m.marcada, `não marcada: "${m.texto}"`).toBe(false);
      expect(m.anel, `sem anel em "${m.texto}" — box-shadow: ${m.boxShadow}`).toBeNull();
    }
    // Uma enviada e uma recebida entre as marcadas: o anel nas duas cores de bolha.
    expect(new Set(comTermo.map((m) => m.fundo)).size, "anel sobre os dois fundos de bolha").toBe(2);

    fs.mkdirSync(EVIDENCE, { recursive: true });
    await page.screenshot({ path: path.join(EVIDENCE, "1-duas-bolhas-marcadas.png") });

    // ── Esc fecha e devolve o foco à lupa
    await campo.press("Escape");
    await expect(campo).toHaveCount(0);
    await expect(contador).toHaveCount(0);
    await expect(page.locator('[data-search-match="true"]')).toHaveCount(0);
    await expect(lupa, "o Esc devolve o foco à lupa").toBeFocused();
    await expect(lupa).toHaveAttribute("aria-expanded", "false");

    // ── reabrir com o termo, trocar de conversa PELA LISTA (sem recarregar)
    await lupa.click();
    await campo.fill(TERMO);
    await expect(page.locator('[data-search-match="true"]')).toHaveCount(2);

    const buscaDaLista = page.getByLabel("Buscar conversas", { exact: true });
    await buscaDaLista.fill(NOME_B);
    await itemDaLista(page, conversaB).click();
    await expect(itemDaLista(page, conversaB)).toHaveAttribute("aria-current", "true");
    await expect(bolhas(page)).toHaveCount(MENSAGENS_B.length, { timeout: 30_000 });
    await expect(bolhas(page).first()).toContainText(TERMO);

    await expect(campo, "o campo da busca sobreviveu à troca de conversa").toHaveCount(0);
    await expect(contador).toHaveCount(0);
    await expect(
      page.locator('[data-search-match="true"]'),
      "a conversa B tem o termo e ganhou a marca da busca feita em A",
    ).toHaveCount(0);
    const lupaB = page.getByRole("button", { name: "Buscar nesta conversa" });
    await expect(lupaB).toHaveAttribute("aria-expanded", "false");
    await page.screenshot({ path: path.join(EVIDENCE, "2-outra-conversa-sem-busca.png") });

    // Abrir a busca em B começa vazia: o termo de A não veio junto.
    await lupaB.click();
    await expect(campo).toHaveValue("");
  });
});
