/**
 * Sonda do cenário 23 — a proposta de reativação nasce, vence e tem destino.
 *
 * O que ela cobra é o BLOCO OBRIGATÓRIO: proposta sem prazo vira card parado com
 * botão em cima, que simula atenção e adia a intervenção humana. Aqui o prazo
 * chega ao fim e a demanda NÃO morre em silêncio — sai do card, entra na
 * timeline e vira item de caixa com ação nomeada.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { venceReativacoes } from "@/lib/leads/reactivation";
import { observaTravessias } from "@/lib/leads/risk-worker";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const e = carregarEnvLocal();
const admin = createClient(e.NEXT_PUBLIC_SUPABASE_URL!, e.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const ORG = "6e567068-fd1c-4f94-ae1f-40e0334be190";

async function main(): Promise<void> {
  const { data: base } = await admin
    .from("crm_leads")
    .select("pipeline_id, stage_id")
    .eq("organization_id", ORG)
    .limit(1)
    .maybeSingle();
  const b = base as { pipeline_id: string; stage_id: string };

  const leadId = randomUUID();
  await admin.from("crm_leads").insert({
    id: leadId,
    organization_id: ORG,
    pipeline_id: b.pipeline_id,
    stage_id: b.stage_id,
    title: `sonda reativacao ${new Date().toISOString().slice(11, 19)}`,
    last_activity_at: new Date(Date.now() - 100 * 3_600_000).toISOString(),
    position_in_stage: 1,
  });

  const proposta = async () => {
    const { data } = await admin
      .from("crm_lead_reactivations")
      .select("status, expires_at, draft")
      .eq("lead_id", leadId)
      .order("proposed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data as { status: string; expires_at: string; draft: string | null } | null;
  };
  const linhas = async () => {
    const { data } = await admin
      .from("crm_lead_activities")
      .select("type")
      .eq("lead_id", leadId)
      .order("performed_at");
    return ((data ?? []) as Array<{ type: string }>).map((a) => a.type);
  };

  // ── 1. o negócio esfria e a proposta nasce junto ─────────────────────────
  const r1 = await observaTravessias(admin, ORG);
  const p1 = await proposta();
  const prazoHoras = p1 ? (new Date(p1.expires_at).getTime() - Date.now()) / 3_600_000 : 0;
  console.info(`1. esfriou · propostas nesta passada: ${r1.propostas}`);
  console.info(`   proposta: ${p1?.status} · prazo de ${prazoHoras.toFixed(1)}h · rascunho: ${p1?.draft ?? "(vazio — o agente preenche depois)"}`);
  console.info(`   timeline: ${JSON.stringify(await linhas())}`);

  // ── 2. rodar de novo NÃO cria segunda proposta ───────────────────────────
  const r2 = await observaTravessias(admin, ORG);
  const { count } = await admin
    .from("crm_lead_reactivations")
    .select("*", { count: "exact", head: true })
    .eq("lead_id", leadId);
  console.info(`2. segunda passada · propostas criadas: ${r2.propostas} · total no negócio: ${count} (tem que ser 1)`);

  // ── 3. o PRAZO vence ─────────────────────────────────────────────────────
  // Puxa a proposta INTEIRA para o passado — o experimento é sobre o que
  // acontece NO vencimento, não sobre esperar o relógio.
  //
  // ⚠️ AS DUAS DATAS ANDAM JUNTAS, e a primeira versão desta sonda mexeu só na
  // `expires_at`: o CHECK `expires_at > proposed_at` REJEITOU o update, o
  // supabase-js devolveu o erro sem lançar, eu não olhei — e a sonda reportou
  // "0 vencidas, proposta ainda pendente" como se fosse defeito do worker.
  // Instrumento que não checa o erro da PREPARAÇÃO produz laudo sobre o alvo
  // errado; aqui a constraint estava certa e quem estava errado era o teste.
  const { error: prepErr } = await admin
    .from("crm_lead_reactivations")
    .update({
      proposed_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      expires_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    })
    .eq("lead_id", leadId)
    .eq("status", "pending");
  if (prepErr) throw new Error(`preparação do vencimento falhou: ${prepErr.message}`);

  const antesDoItem = (
    await admin
      .from("agent_inbox_items")
      .select("*", { count: "exact", head: true })
      .eq("kind", "reactivation_expired")
      .eq("status", "open")
  ).count;

  const v = await venceReativacoes(admin, ORG);
  const p3 = await proposta();
  const { data: item } = await admin
    .from("agent_inbox_items")
    .select("title")
    .eq("kind", "reactivation_expired")
    .eq("status", "open")
    .maybeSingle();

  console.info(`3. venceu · ${v.vencidas} vencida(s) · proposta agora: ${p3?.status}`);
  console.info(`   saiu do card? ${p3?.status !== "pending" ? "SIM" : "NÃO ← defeito"}`);
  console.info(`   timeline: ${JSON.stringify(await linhas())}`);
  console.info(`   item de caixa (${antesDoItem} → ${v.itensDeCaixa ? "criado" : "reusado/existente"}): ${item?.title ?? "NENHUM ← defeito"}`);

  // ── 4. vencer de novo não repete ─────────────────────────────────────────
  const v2 = await venceReativacoes(admin, ORG);
  console.info(`4. segunda passada de vencimento: ${v2.vencidas} (tem que ser 0)`);

  await admin.from("crm_leads").delete().eq("id", leadId);
  console.info("· cobaia removida");
}

void main();
