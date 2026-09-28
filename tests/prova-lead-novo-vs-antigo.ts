/**
 * O CONTROLE ZEROU — e um controle que zera acusa o experimento, não o produto.
 *
 * No aparato da wave 6, o assinante de SERVIÇO (que ignora RLS) não recebeu a
 * atividade do lead construído. O mesmo assinante, em `prova-canal-timeline.ts`,
 * recebe a atividade de um lead que já existia. Duas execuções, dois leads, dois
 * resultados: exatamente o formato de teste confundido que me pegou hoje de
 * manhã — a diferença pode ser o LEAD ou pode ser qualquer coisa que mudou entre
 * as duas execuções (número de canais, tempo de espera, ordem).
 *
 * Aqui os dois leads entram na MESMA FOTO: um processo, uma janela, o mesmo
 * cliente, o mesmo tempo de espera, um INSERT em cada. Se um recebe e o outro
 * não, sobrou uma variável só e ela é o lead.
 *
 * Run: npx tsx tests/prova-lead-novo-vs-antigo.ts
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
const MARCA = `${RUN} novo-vs-antigo`;

async function main(): Promise<void> {
  carimbar(["tests/prova-lead-novo-vs-antigo.ts"]);

  const { data: antigos } = await admin
    .from("crm_leads")
    .select("id,title,created_at")
    .eq("organization_id", ORG)
    .eq("status", "open")
    // ORDENAÇÃO IGUAL À DO SCRIPT QUE RECEBE. Era a última diferença entre os
    // dois: quantidade de canais e canal sem filtro já caíram na escada. Trocar
    // só isto é o que transforma "os dois scripts diferem" em "o lead difere".
    .order("id")
    .limit(1);
  const antigo = (antigos ?? [])[0] as { id: string; title: string; created_at: string } | undefined;
  if (!antigo) throw new Error("sem lead antigo para comparar");

  const { data: criado, error: erroCriar } = await admin
    .from("crm_leads")
    .insert({
      organization_id: ORG,
      pipeline_id: PIPELINE,
      stage_id: STAGE,
      title: `QA-DELTA ${RUN}`,
      owner_user_id: DONO,
      status: "open",
      position_in_stage: 1000,
    } as never)
    .select("id")
    .single();
  if (erroCriar || !criado) throw new Error(`criar lead: ${erroCriar?.message}`);
  const novo = criado as { id: string };

  console.info(`[antigo] ${antigo.id.slice(0, 8)} — "${antigo.title.slice(0, 30)}" (${antigo.created_at.slice(0, 10)})`);
  console.info(`[novo]   ${novo.id.slice(0, 8)} — criado agora`);

  const contagem = { antigo: 0, novo: 0, semFiltro: 0 };
  const assinar = (nome: string, filtro: string | undefined, onda: () => void): Promise<string> => {
    const canal = admin.channel(`delta-${nome}-${RUN}`).on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "crm_lead_activities",
        ...(filtro ? { filter: filtro } : {}),
      },
      onda,
    );
    return new Promise((r) => canal.subscribe((s) => r(s)));
  };

  // O TERCEIRO ASSINANTE NÃO TEM FILTRO, e é ele que separa "a linha não foi
  // publicada" de "a linha foi publicada e o filtro não casou". Com dois
  // assinantes filtrados eu teria dois zeros e nenhuma forma de saber qual.
  // BISSECÇÃO: o mesmo lead que o script vizinho RECEBE dá zero aqui, então a
  // diferença está neste script e não no produto. `CANAIS` liga um assinante de
  // cada vez — se o primeiro sozinho recebe e cai ao ligar o segundo, o achado é
  // a companhia; se nem sozinho recebe, é o que este script faz ANTES de assinar.
  const quantos = Number(process.env.CANAIS ?? "3");
  const st: Record<string, string> = {
    antigo: await assinar("antigo", `lead_id=eq.${antigo.id}`, () => contagem.antigo++),
  };
  if (quantos >= 2) st.novo = await assinar("novo", `lead_id=eq.${novo.id}`, () => contagem.novo++);
  if (quantos >= 3) st.semFiltro = await assinar("todos", undefined, () => contagem.semFiltro++);
  console.info(`[assinaturas] antigo=${st.antigo} novo=${st.novo} sem-filtro=${st.semFiltro}`);
  await new Promise((r) => setTimeout(r, 3000));

  for (const [rotulo, leadId] of [
    ["antigo", antigo.id],
    ["novo", novo.id],
  ] as const) {
    const { error } = await admin.from("crm_lead_activities").insert({
      organization_id: ORG,
      lead_id: leadId,
      source_module: "qa",
      type: "note",
      actor_kind: "system",
      reason: `${MARCA} ${rotulo}`,
      evidence: {},
      performed_at: new Date().toISOString(),
    } as never);
    if (error) throw new Error(`insert no lead ${rotulo}: ${error.code} ${error.message}`);
  }
  console.info("[gatilho] uma atividade em cada lead, no mesmo instante");

  await new Promise((r) => setTimeout(r, 9000));

  console.info(
    `\n=== assinante de SERVIÇO (ignora RLS), mesma janela ===\n` +
      `  lead ANTIGO (filtrado) ....... ${contagem.antigo}\n` +
      `  lead NOVO   (filtrado) ....... ${contagem.novo}\n` +
      `  SEM filtro (os dois) ......... ${contagem.semFiltro} (esperado 2 se ambos foram publicados)`,
  );
  console.info(
    contagem.semFiltro >= 2 && contagem.novo === 0
      ? "==> as DUAS linhas foram publicadas e o filtro do lead NOVO não casou. A publicação\n" +
        "    está inocente e o suspeito é o FILTRO — e como o filtro é o mesmo texto nos dois,\n" +
        "    a diferença está no que o Realtime enxerga do lead novo."
      : contagem.semFiltro < 2
        ? "==> nem sem filtro chegaram as duas. Alguma das linhas não foi publicada — e aí o\n" +
          "    zero do lead novo não é sobre filtro nenhum."
        : "==> os dois leads recebem. A diferença que eu procurava não é o lead, e o zero do\n" +
          "    aparato da wave 6 vem do que MUDA entre ele e este script.",
  );

  await admin.from("crm_lead_activities").delete().like("reason", `${MARCA}%`);
  await admin.from("crm_leads").delete().eq("id", novo.id);
  await admin.removeAllChannels();
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ prova falhou:", err);
  process.exit(1);
});
