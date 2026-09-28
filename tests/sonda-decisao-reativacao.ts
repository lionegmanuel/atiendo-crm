/**
 * A DECISÃO humana sobre a proposta — pela rota real, com sessão real.
 *
 * O caso que a rota existe para fechar é a CORRIDA: entre o render e o clique, o
 * watcher pode vencer a proposta. Aceitar uma vencida executaria, em nome de
 * quem clicou, uma decisão que o sistema já registrou como não tomada.
 */
import { randomUUID } from "node:crypto";

import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { BASE, login } from "./qa-helpers";
import { propoeReativacao, venceReativacoes } from "@/lib/leads/reactivation";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const env = carregarEnvLocal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const ORG = "6e567068-fd1c-4f94-ae1f-40e0334be190";

async function main(): Promise<void> {
  const { data: base } = await admin
    .from("crm_leads").select("pipeline_id, stage_id").eq("organization_id", ORG).limit(1).maybeSingle();
  const b = base as { pipeline_id: string; stage_id: string };

  // O lead da sonda precisa de CONTATO: sem ele não há proposta (não há para
  // quem retomar) nem envio (`cron_jobs` é por contato).
  const { data: algumContato } = await admin
    .from("contacts").select("id").eq("organization_id", ORG).limit(1).maybeSingle();
  const contactId = (algumContato as { id: string }).id;

  const criaLead = async (): Promise<string> => {
    const id = randomUUID();
    await admin.from("crm_leads").insert({
      id, organization_id: ORG, pipeline_id: b.pipeline_id, stage_id: b.stage_id, contact_id: contactId,
      title: `sonda decisao ${new Date().toISOString().slice(11, 19)}`,
      last_activity_at: new Date(Date.now() - 100 * 3_600_000).toISOString(), position_in_stage: 1,
    });
    return id;
  };

  const browser = await chromium.launch();
  const page = await browser.newContext().then((c) => c.newPage());
  await login(page, "manager");

  const decidir = async (leadId: string, proposalId: string, decision: string) =>
    page.evaluate(
      async ([id, pid, d]) => {
        const r = await fetch(`/api/v1/leads/${id}/reactivation`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision: d, proposal_id: pid }),
        });
        return { http: r.status, corpo: await r.text() };
      },
      [leadId, proposalId, decision],
    );

  const linhas = async (leadId: string) => {
    const { data } = await admin.from("crm_lead_activities").select("type").eq("lead_id", leadId);
    return ((data ?? []) as Array<{ type: string }>).map((a) => a.type);
  };

  // ── 1. ACEITAR ───────────────────────────────────────────────────────────
  const l1 = await criaLead();
  const p1 = await propoeReativacao(admin, { organizationId: ORG, leadId: l1, coldHours: 24 });
  // limpa follow-up pendente do contato: a guarda anti-bombardeio é legítima e
  // faria o envio não ser agendado por um motivo que não é o que se mede aqui.
  await admin.from("cron_jobs").update({ enabled: false })
    .eq("contact_id", contactId).eq("job_kind", "followup_turn").eq("enabled", true);
  const r1 = await decidir(l1, p1!.id, "accept");
  const { data: e1 } = await admin
    .from("crm_lead_reactivations").select("status, decided_by_user_id").eq("id", p1!.id).maybeSingle();
  const corpo1 = (() => { try { return JSON.parse(r1.corpo).data; } catch { return {}; } })();
  const { count: jobs } = await admin
    .from("cron_jobs").select("*", { count: "exact", head: true })
    .eq("contact_id", contactId).eq("job_kind", "followup_turn").eq("enabled", true);
  console.info(`1. ACEITAR → http ${r1.http} · status=${(e1 as { status: string }).status} · decisor gravado: ${(e1 as { decided_by_user_id: string | null }).decided_by_user_id ? "SIM" : "NÃO"}`);
  console.info(`   envio_agendado no corpo: ${corpo1.envio_agendado} · followup_turn na fila: ${jobs} (o campo tem que BATER com a fila)`);
  console.info(`   timeline: ${JSON.stringify(await linhas(l1))}`);

  // ── 2. RECUSAR — recusa é sinal, não ausência de sinal ───────────────────
  const l2 = await criaLead();
  const p2 = await propoeReativacao(admin, { organizationId: ORG, leadId: l2, coldHours: 24 });
  const r2 = await decidir(l2, p2!.id, "dismiss");
  console.info(`2. RECUSAR → http ${r2.http} · timeline: ${JSON.stringify(await linhas(l2))}`);

  // ── 3. A CORRIDA: a proposta vence ANTES do clique ───────────────────────
  const l3 = await criaLead();
  const p3 = await propoeReativacao(admin, { organizationId: ORG, leadId: l3, coldHours: 24 });
  await admin.from("crm_lead_reactivations").update({
    proposed_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    expires_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  }).eq("id", p3!.id);
  await venceReativacoes(admin, ORG);
  const r3 = await decidir(l3, p3!.id, "accept");
  const codigo = (() => { try { return JSON.parse(r3.corpo).error?.code; } catch { return "?"; } })();
  console.info(`3. CORRIDA (venceu antes do clique) → http ${r3.http} · code=${codigo}`);
  console.info(`   a mensagem explica? ${JSON.parse(r3.corpo).error?.message ?? "?"}`);
  console.info(`   timeline: ${JSON.stringify(await linhas(l3))}`);

  // ── 4. dois cliques na mesma proposta ────────────────────────────────────
  const l4 = await criaLead();
  const p4 = await propoeReativacao(admin, { organizationId: ORG, leadId: l4, coldHours: 24 });
  await decidir(l4, p4!.id, "accept");
  const r4b = await decidir(l4, p4!.id, "accept");
  console.info(`4. SEGUNDO CLIQUE → http ${r4b.http} (tem que ser 409) · linhas: ${(await linhas(l4)).length} (tem que ser 1)`);

  for (const id of [l1, l2, l3, l4]) await admin.from("crm_leads").delete().eq("id", id);
  await browser.close();
}
void main();
