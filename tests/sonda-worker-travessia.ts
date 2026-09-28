/**
 * Sonda da PEÇA 5 — o observador da travessia.
 *
 * O gatilho é HONESTO: o negócio esfria porque o RELÓGIO andou, e o worker roda
 * SEM ninguém tocar na linha do lead. É isso que tira a circularidade — se para
 * provar "esfriou" eu precisasse escrever no lead, estaria provando que sei
 * escrever no lead.
 *
 * O ANTES E O DEPOIS são medidos com hash de (id, updated_at) de TODOS os leads
 * da org: o worker não pode tocar `crm_leads` nem pelo trigger, senão invalida a
 * trava otimista do arrasto em voo — o 409 fantasma da 0075.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { observaTravessias } from "@/lib/leads/risk-worker";
import { apagaExatamenteUm } from "./qa-helpers";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const e = carregarEnvLocal();
const admin = createClient(e.NEXT_PUBLIC_SUPABASE_URL!, e.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const ORG = "6e567068-fd1c-4f94-ae1f-40e0334be190";

async function hashDosLeads(): Promise<string> {
  const { data } = await admin
    .from("crm_leads")
    .select("id, updated_at")
    .eq("organization_id", ORG)
    .order("id");
  return JSON.stringify(data);
}

/** A cobaia que esta rodada criou — lida pelo `finally` lá embaixo. */
let leadCriado: string | null = null;

async function main(): Promise<void> {
  // ── um negócio NOVO, quente, criado agora ────────────────────────────────
  const { data: base } = await admin
    .from("crm_leads")
    .select("pipeline_id, stage_id")
    .eq("organization_id", ORG)
    .limit(1)
    .maybeSingle();
  const b = base as { pipeline_id: string; stage_id: string };

  const leadId = randomUUID();
  leadCriado = leadId;
  await admin.from("crm_leads").insert({
    id: leadId,
    organization_id: ORG,
    pipeline_id: b.pipeline_id,
    stage_id: b.stage_id,
    title: `sonda travessia ${new Date().toISOString().slice(11, 19)}`,
    last_activity_at: new Date().toISOString(),
    position_in_stage: 1,
  });

  const estado = async (): Promise<string> => {
    const { data } = await admin
      .from("crm_lead_risk_states")
      .select("bucket")
      .eq("lead_id", leadId)
      .maybeSingle();
    return (data as { bucket: string } | null)?.bucket ?? "(sem estado)";
  };
  const linhas = async (): Promise<string[]> => {
    const { data } = await admin
      .from("crm_lead_activities")
      .select("type, reason")
      .eq("lead_id", leadId)
      .order("performed_at");
    return ((data ?? []) as Array<{ type: string; reason: string | null }>).map(
      (a) => `${a.type}${a.reason ? ` — ${a.reason}` : ""}`,
    );
  };

  const r1 = await observaTravessias(admin, ORG);
  console.info(`1. negócio novo · estado=${await estado()} · linhas=${(await linhas()).length}`);
  console.info(`   worker: ${r1.travessias} travessias, ${r1.esfriaram} esfriaram`);

  // ── O GATILHO: o RELÓGIO anda. Ninguém toca o lead. ──────────────────────
  // O `update` abaixo É tocar o lead, então ele acontece ANTES da medição do
  // hash: o experimento é sobre o WORKER não tocar, não sobre a preparação.
  await admin
    .from("crm_leads")
    .update({ last_activity_at: new Date(Date.now() - 100 * 3_600_000).toISOString() })
    .eq("id", leadId);

  const hashAntes = await hashDosLeads();
  const r2 = await observaTravessias(admin, ORG);
  const hashDepois = await hashDosLeads();

  console.info(`2. depois de 100h de silêncio · estado=${await estado()}`);
  console.info(`   worker: ${r2.travessias} travessias, ${r2.esfriaram} esfriaram, ${r2.falhasDeAtividade} falhas`);
  console.info(`   timeline: ${JSON.stringify(await linhas())}`);
  console.info(`   o worker tocou algum lead? ${hashAntes === hashDepois ? "NÃO (hash idêntico)" : "SIM ← defeito"}`);

  // ── rodar de novo NÃO pode produzir nada: não houve travessia nova ───────
  const r3 = await observaTravessias(admin, ORG);
  console.info(`3. segunda passada · ${r3.travessias} travessias (tem que ser 0) · linhas=${(await linhas()).length}`);

  // ── e a volta: o negócio recebe interação REAL e reativa ─────────────────
  // ⚠️ SEM `performed_at`: o banco preenche com `now()`, que é o relógio que
  // TODO emissor de produção usa. A primeira versão desta sonda passava o
  // relógio do CLIENTE e a timeline saiu FORA DE ORDEM — a `note`, criada
  // depois, aparecia antes do `lead_cooled`. Medido: o banco está 2s à frente
  // desta máquina. Nenhum código de produção escreve `performed_at` (conferido),
  // então era artefato da sonda; mas o dia em que alguém passar o relógio do
  // cliente, a linha do tempo inverte para eventos próximos — que é exatamente
  // o caso interessante: ação humana seguida da reação do sistema.
  await admin.from("crm_lead_activities").insert({
    organization_id: ORG,
    lead_id: leadId,
    type: "note",
    source_module: "crm",
    source_id: leadId,
    actor_kind: "system",
    reason: "alguém trabalhou no negócio",
  });
  const r4 = await observaTravessias(admin, ORG);
  console.info(`4. após interação real · estado=${await estado()} · ${r4.reativaram} reativações`);
  console.info(`   timeline: ${JSON.stringify(await linhas())}`);

}

/**
 * A LIMPEZA RODA MESMO QUANDO A SONDA MORRE NO MEIO.
 *
 * Estava no fim do caminho feliz, e sonda morre no meio o tempo todo. Cada
 * morte dessas deixava uma cobaia no board do CRM Vivo contando como negócio de
 * verdade — duas tinham ficado, e só apareceram porque entraram por acaso na
 * screenshot de uma prova sobre outro assunto.
 *
 * A necessidade da limpeza e a chance de o caminho feliz completar são
 * INVERSAMENTE proporcionais: finalização vai onde roda sempre.
 */
void main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (!leadCriado) return;
    // `catch` aqui e só aqui: se a sonda já está morrendo, a falha da limpeza
    // não pode substituir a causa original no log.
    await apagaExatamenteUm(admin, "crm_leads", leadCriado)
      .then(() => console.info("· cobaia removida"))
      .catch((e: unknown) =>
        console.error(`[limpeza] a cobaia ${leadCriado} ficou no banco: ${String(e)}`),
      );
  });
