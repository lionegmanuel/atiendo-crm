/**
 * A BISSECÇÃO DEU 0, 1, 0 COM O MESMO APARATO — e isso derruba o meu método,
 * não a minha hipótese.
 *
 * Eu vinha tratando cada execução como veredito: "recebe" (publicação inocente),
 * "não recebe" (defeito aqui). Com o resultado alternando entre rodadas
 * idênticas, cada uma dessas leituras foi um sorteio, e a que confirma o que eu
 * já pensava é a que eu guardei. Fenômeno intermitente exige TAXA — n rodadas
 * iguais, uma proporção — porque uma observação isolada não distingue "sempre
 * entrega" de "entrega às vezes", e todo laudo que eu emiti hoje sobre o D21
 * assumiu que distinguia.
 *
 * Aqui: N rodadas idênticas, cliente novo por rodada, mesmo lead, mesmo INSERT,
 * mesma espera. A saída é uma fração, não um sim/não.
 *
 * Run: N=10 npx tsx tests/prova-taxa-de-entrega.ts
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import { CREDS, carimbar } from "./qa-helpers";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const env = carregarEnvLocal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ORG = CREDS.org_id as string;
const PIPELINE = (CREDS.crm_vivo as { pipeline_id: string }).pipeline_id;
const STAGE = Object.values((CREDS.crm_vivo as { stage_ids: Record<string, string> }).stage_ids)[0]!;
const DONO = (CREDS.users as Record<string, { id: string }>).manager!.id;
const RUN = randomUUID().slice(0, 8);
// SEM_FILTRO separa "a linha não foi publicada" de "foi publicada e o filtro não
// casou" — os dois dão zero num assinante filtrado, e são defeitos diferentes.
const SEM_FILTRO = process.env.SEM_FILTRO === "1";

/** Uma rodada = uma assinatura nova, um insert, uma espera. Devolve o atraso em
 *  ms até o quadro chegar, ou null se não chegou dentro da espera. O ATRASO
 *  importa: se os quadros que "não chegam" na verdade chegam em 12s, o defeito é
 *  de latência e a espera do teste é que está curta — hipótese diferente, e
 *  invisível num contador de sim/não. */
async function rodada(i: number, leadId: string, esperaMs: number): Promise<number | null> {
  const cli = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let chegouEm: number | null = null;
  let t0 = 0;
  const canal = cli.channel(`taxa-${RUN}-${i}`).on(
    "postgres_changes",
    {
      event: "INSERT",
      schema: "public",
      table: "crm_lead_activities",
      ...(SEM_FILTRO ? {} : { filter: `lead_id=eq.${leadId}` }),
    },
    () => {
      if (chegouEm === null) chegouEm = Date.now() - t0;
    },
  );
  const estado = await new Promise<string>((r) => canal.subscribe((s) => r(s)));
  if (estado !== "SUBSCRIBED") {
    await cli.removeAllChannels();
    return null;
  }
  await new Promise((r) => setTimeout(r, 2500));

  const marca = `${RUN} taxa ${i}`;
  t0 = Date.now();
  const { error } = await admin.from("crm_lead_activities").insert({
    organization_id: ORG,
    lead_id: leadId,
    source_module: "qa",
    type: "note",
    actor_kind: "system",
    reason: marca,
    evidence: {},
    performed_at: new Date().toISOString(),
  } as never);
  if (error) throw new Error(`gatilho ${i}: ${error.code} ${error.message}`);

  await new Promise((r) => setTimeout(r, esperaMs));
  await admin.from("crm_lead_activities").delete().eq("reason", marca);
  await cli.removeAllChannels();
  return chegouEm;
}

async function main(): Promise<void> {
  carimbar(["tests/prova-taxa-de-entrega.ts"]);
  const N = Number(process.env.N ?? "10");
  const ESPERA = Number(process.env.ESPERA_MS ?? "8000");
  // LEAD_ID permite apontar esta sonda para o lead que OUTRO processo está
  // olhando — é o que a torna utilizável como controle externo: mesma janela,
  // mesmo lead, processo separado. Sem isso ela só sabe medir a si mesma.
  // CRIAR=1 nasce com um lead recém-criado. É a variável que sobrou depois de a
  // taxa dar 12/12 num lead antigo e 0/3 num lead criado segundos antes.
  if (process.env.CRIAR === "1") {
    const { data: novo, error } = await admin
      .from("crm_leads")
      .insert({
        organization_id: ORG,
        pipeline_id: PIPELINE,
        stage_id: STAGE,
        title: `QA-TAXA ${RUN}`,
        owner_user_id: DONO,
        status: "open",
        position_in_stage: 1000,
      } as never)
      .select("id")
      .single();
    if (error || !novo) throw new Error(`criar lead: ${error?.message}`);
    process.env.LEAD_ID = (novo as { id: string }).id;
    if (process.env.ESPERAR_ANTES) await new Promise((r) => setTimeout(r, Number(process.env.ESPERAR_ANTES)));
  }
  const { data: leads } = process.env.LEAD_ID
    ? await admin.from("crm_leads").select("id,title").eq("id", process.env.LEAD_ID).limit(1)
    : await admin
        .from("crm_leads")
        .select("id,title")
        .eq("organization_id", ORG)
        .eq("status", "open")
        .order("id")
        .limit(1);
  const lead = (leads ?? [])[0] as { id: string; title: string } | undefined;
  if (!lead) throw new Error("sem lead");
  console.info(`[alvo] lead ${lead.id.slice(0, 8)}${SEM_FILTRO ? " (assinatura SEM filtro)" : ""} · ${N} rodadas idênticas · espera ${ESPERA}ms`);

  const atrasos: (number | null)[] = [];
  for (let i = 1; i <= N; i++) {
    const a = await rodada(i, lead.id, ESPERA);
    atrasos.push(a);
    console.info(`  rodada ${String(i).padStart(2)} → ${a === null ? "NÃO CHEGOU" : `${a}ms`}`);
  }

  const chegaram = atrasos.filter((a): a is number => a !== null);
  const pior = chegaram.length > 0 ? Math.max(...chegaram) : 0;
  console.info(
    `\n=== TAXA DE ENTREGA: ${chegaram.length}/${N} ===\n` +
      (chegaram.length > 0 ? `  atraso quando chega: mín ${Math.min(...chegaram)}ms · máx ${pior}ms\n` : "") +
      (chegaram.length === N
        ? "  entrega determinística nesta janela — um zero isolado noutro aparato acusa o aparato."
        : chegaram.length === 0
          ? "  não entregou nenhuma vez — e aí o zero do navegador não distingue nada."
          : `  INTERMITENTE. Toda conclusão minha de hoje tirada de UMA rodada é sorteio: com esta\n` +
            `  taxa, ver um zero não é evidência de defeito, e ver um um não é evidência de saúde.`),
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ prova falhou:", err);
  process.exit(1);
});
