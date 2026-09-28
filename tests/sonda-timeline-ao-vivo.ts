/**
 * Wave 6, bloco 2 — a timeline ESCUTA `crm_lead_activities`.
 *
 * Antes disto não havia UM assinante da tabela no front: ela está na publicação
 * desde a 0071, então o dado chegava ao Postgres e ninguém escutava. O cenário
 * 21 ("ação do agente na outra aba entra na timeline ao vivo") não era prova de
 * nada — era implementação ausente.
 *
 * A prova usa o MESMO canal que `useLeadTimeline` assina (mesma tabela, mesmo
 * filtro por `contact_id`, mesmo token da sessão real), e a atividade nasce pelo
 * CAMINHO DE PRODUÇÃO: um PATCH na API, que emite `lead_edited`. INSERT à mão
 * provaria o canal e mentiria sobre a origem.
 *
 * Run: E2E_PORT=3020 npx tsx tests/sonda-timeline-ao-vivo.ts
 */
import * as fs from "node:fs";
import { execFileSync } from "node:child_process";

import { chromium } from "@playwright/test";

import { BASE, carimbar, login } from "./qa-helpers";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

carimbar([
  "tests/sonda-timeline-ao-vivo.ts",
  "hooks/leads/useLeadTimeline.ts",
  "app/api/v1/leads/_handler.ts",
]);

const DB = carregarEnvLocal().SUPABASE_DB_URL!;

const sql = (q: string): string =>
  execFileSync("psql", [DB, "-tA", "-c", q], { encoding: "utf8" }).trim();

async function main(): Promise<void> {
  const creds = JSON.parse(fs.readFileSync(".e2e-creds.json", "utf8")) as {
    crm_vivo: { pipeline_id: string };
  };
  const [leadId, contactId] = sql(
    `select l.id || '|' || l.contact_id
       from crm_leads l
      where l.pipeline_id = '${creds.crm_vivo.pipeline_id}'
        and l.contact_id is not null and l.status = 'open'
      order by l.title
      limit 1`,
  ).split("|");
  console.info(`alvo: lead ${leadId} / contato ${contactId}`);

  const browser = await chromium.launch();
  const page = await browser.newContext().then((c) => c.newPage());
  try {
    await login(page, "manager");
    await page.goto(`${BASE}/app/inbox`, { waitUntil: "networkidle" });

    // Assina o MESMO canal do hook, com o token real da sessão (o cookie é
    // httpOnly, então o token vem pela rota — sem ele o canal fica anônimo e a
    // RLS filtra tudo, que foi o defeito da wave 3).
    // `process.env` vence o `.env.local` (scripts/lib/env-de-teste.ts).
    const amb = carregarEnvLocal();
    const url = amb.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = amb.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const assinou = await page.evaluate(async ({ contato, url, anon }) => {
      const w = window as unknown as { __eventos: string[]; __status: string };
      w.__eventos = [];
      const r = await fetch("/api/v1/auth/realtime-token", { credentials: "include" });
      const body = (await r.json()) as { data?: { access_token?: string } };
      const token = body.data?.access_token;
      if (!token) return "sem_token";

      // Import por URL dentro do browser: o `tsc` não resolve especificador
      // remoto (TS2307), e não deve mesmo — quem executa isto é o Chrome, não o
      // Node. A indireção pela variável tira a string do olhar do compilador
      // sem esconder nada de quem lê.
      const cdn = "https://esm.sh/@supabase/supabase-js@2";
      const mod = (await import(/* @vite-ignore */ cdn)) as {
        createClient: (u: string, k: string) => {
          realtime: { setAuth: (t: string) => void };
          channel: (n: string) => {
            on: (e: string, f: unknown, cb: (p: { new?: { type?: string } }) => void) => {
              subscribe: (cb: (st: string) => void) => void;
            };
          };
        };
      };
      const sb = mod.createClient(url, anon);
      sb.realtime.setAuth(token);
      return await new Promise<string>((resolve) => {
        sb.channel(`prova-timeline-${contato}`)
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "crm_lead_activities",
              filter: `contact_id=eq.${contato}`,
            },
            (p: { new?: { type?: string } }) => {
              w.__eventos.push(p.new?.type ?? "?");
            },
          )
          .subscribe((st: string) => {
            w.__status = st;
            if (st === "SUBSCRIBED" || st === "CHANNEL_ERROR") resolve(st);
          });
      });
    }, { contato: contactId, url, anon });
    console.info(`1. o canal da timeline assinou: ${assinou}`);

    // LEITURA ANTES — sem ela, "chegou 1" é compatível com "já tinha 1".
    const antes = await page.evaluate(
      () => (window as unknown as { __eventos: string[] }).__eventos.length,
    );
    console.info(`   eventos antes da ação: ${antes}`);

    // A ATIVIDADE NASCE PELO CAMINHO DE PRODUÇÃO.
    const r = await page.request.patch(`${BASE}/api/v1/leads/${leadId}`, {
      data: { description: `editado pela sonda ${Date.now()}` },
    });
    console.info(`2. PATCH pela API: ${r.status()}`);
    await page.waitForTimeout(4_000);

    const depois = await page.evaluate(
      () => (window as unknown as { __eventos: string[] }).__eventos,
    );
    const chegou = depois.length > antes;
    console.info(`3. a atividade CHEGOU ao browser ao vivo: ${chegou} (${depois.join(", ")})`);
    console.info(`4. e é a edição humana: ${depois.includes("lead_edited")}`);

    const passou = assinou === "SUBSCRIBED" && chegou && depois.includes("lead_edited");
    console.info(
      passou
        ? "PASS   a timeline escuta crm_lead_activities e recebe a edição humana"
        : "FALHA  ver as linhas acima",
    );
    if (!passou) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

void main();
