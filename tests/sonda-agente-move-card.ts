/**
 * Cenários 25 e 26 no banco real: o agente avança o funil DELE e o card anda no
 * funil do TENANT — em dois nichos com nomes completamente diferentes.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { mirrorLeadStageToCrm } from "@/lib/agent-engine/edge/crm/move-lead-stage";
import { sincronizaEstagioDoAgente } from "@/lib/leads/agent-stage-sync";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const env = carregarEnvLocal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const ORG = "6e567068-fd1c-4f94-ae1f-40e0334be190";
const CLINICA = "35bf4ac9-c5e0-4f7d-846a-99b1bcc92d69";
const PEDIDOS = "48c02b4a-0ca1-4bca-8ef0-206b6d240d23";

async function main(): Promise<void> {
  const estagios = async (pipe: string) => {
    const { data } = await admin
      .from("crm_stages").select("id, name, slug, agent_stage_hint").eq("pipeline_id", pipe).order("position");
    return (data ?? []) as Array<{ id: string; name: string; slug: string; agent_stage_hint: string | null }>;
  };

  // O tenant CONFIGURA o mapeamento — é decisão dele, não do sistema.
  const mapear = async (pipe: string, pares: Array<[string, string]>) => {
    for (const [slug, hint] of pares) {
      await admin.from("crm_stages").update({ agent_stage_hint: hint }).eq("pipeline_id", pipe).eq("slug", slug);
    }
  };
  await mapear(CLINICA, [["primeiro_contato", "contacted"], ["avaliacao", "qualifying"], ["proposta", "negotiating"]]);
  await mapear(PEDIDOS, [["aguardando_pagamento", "negotiating"]]);

  const rodar = async (pipe: string, nome: string, passo: string) => {
    const st = await estagios(pipe);
    const primeiro = st[0]!;
    const contactId = randomUUID();
    await admin.from("contacts").insert({
      id: contactId, organization_id: ORG, name: `sonda 25 ${nome}`, phone_number: null,
    });
    const leadId = randomUUID();
    await admin.from("crm_leads").insert({
      id: leadId, organization_id: ORG, pipeline_id: pipe, stage_id: primeiro.id,
      contact_id: contactId, title: `sonda 25 — ${nome}`, position_in_stage: 1,
    });

    const antes = st.find((s) => s.id === primeiro.id)!.name;
    const r = await sincronizaEstagioDoAgente(admin, { organizationId: ORG, contactId, passo });
    const { data: depois } = await admin
      .from("crm_leads").select("stage_id").eq("id", leadId).maybeSingle();
    const nomeDepois = st.find((s) => s.id === (depois as { stage_id: string }).stage_id)?.name;
    const { data: ativ } = await admin
      .from("crm_lead_activities").select("type, reason, actor_kind").eq("lead_id", leadId).maybeSingle();

    console.info(`${nome} · agente vai para "${passo}"`);
    console.info(`   card: ${antes} → ${nomeDepois} ${r.moveu ? "" : `(NÃO moveu: ${r.motivo})`}`);
    if (ativ) {
      const a = ativ as { type: string; reason: string; actor_kind: string };
      console.info(`   timeline: ${a.type} · ${a.reason} · ator=${a.actor_kind}`);
    }
    await admin.from("crm_leads").delete().eq("id", leadId);
    await admin.from("contacts").delete().eq("id", contactId);
  };

  console.info("=== 26: o MESMO passo, dois nichos ===");
  await rodar(CLINICA, "clínica", "negotiating");
  await rodar(PEDIDOS, "e-commerce", "negotiating");

  console.info("\n=== 25: passo sem mapeamento no pipeline ===");
  await rodar(PEDIDOS, "e-commerce", "qualifying");

  await pelaPonte();
}

/**
 * A PONTE que o turno de fato chama (`inbound-turn.ts` → mirrorLeadStageToCrm),
 * e não o motor por baixo dela.
 *
 * ⚠️ Este cenário existe porque os de cima passariam com a ponte desligada: eles
 * chamam `sincronizaEstagioDoAgente` direto. A propriedade mais cara da fusão —
 * `input.leadId` do engine É o `contact_id` do CRM — só é exercida aqui, contra
 * dado real. Trocá-la move o card errado, e nenhum mock notaria.
 */
async function pelaPonte(): Promise<void> {
  console.info("\n=== a PONTE (mirrorLeadStageToCrm), como o turno chama ===");
  const { data } = await admin
    .from("crm_stages").select("id, name").eq("pipeline_id", CLINICA).order("position");
  const st = (data ?? []) as Array<{ id: string; name: string }>;
  const primeiro = st[0]!;

  const contactId = randomUUID();
  await admin.from("contacts").insert({ id: contactId, organization_id: ORG, name: "sonda ponte" });
  const leadId = randomUUID();
  await admin.from("crm_leads").insert({
    id: leadId, organization_id: ORG, pipeline_id: CLINICA, stage_id: primeiro.id,
    contact_id: contactId, title: "sonda ponte", position_in_stage: 1,
  });

  const nomeDe = async () => {
    const { data: l } = await admin.from("crm_leads").select("stage_id").eq("id", leadId).maybeSingle();
    return st.find((s) => s.id === (l as { stage_id: string }).stage_id)?.name;
  };
  // `leadId` do engine = contact_id do CRM (o funil do agente é por contato).
  const mover = async (passo: "negotiating" | "qualified") => {
    const antes = await nomeDe();
    const r = await mirrorLeadStageToCrm({} as never, { supabase: admin }, {
      tenantId: ORG, leadId: contactId, toStage: passo,
    });
    console.info(`   passo "${passo}" → ${JSON.stringify(r)}`);
    console.info(`   card: ${antes} → ${await nomeDe()}`);
  };
  await mover("negotiating"); // pipeline declara destino → o card anda
  await mover("qualified"); // nenhum estágio declara este hint → not_configured

  await admin.from("crm_lead_activities").delete().eq("lead_id", leadId);
  await admin.from("crm_leads").delete().eq("id", leadId);
  await admin.from("contacts").delete().eq("id", contactId);
}
void main();
