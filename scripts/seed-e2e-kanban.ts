/**
 * Seed E2E kanban fixtures: 2 leads na pipeline default ("Pedidos") da org de
 * teste — um COM responsável (agent) e um SEM. Alimenta o e2e do filtro por
 * responsável (G3-03) e a evidência de UI (card com owner + card sem dono).
 *
 * Idempotente: upsert por (organization_id, title). Depende de
 * .e2e-creds.json já existir (rode scripts/seed-e2e-credentials.ts antes).
 * Grava o bloco `kanban` (pipeline_id, stage_id, lead ids) em .e2e-creds.json.
 *
 * Run: npx tsx scripts/seed-e2e-kanban.ts
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";
import { anunciarDestino, credenciaisSupabaseDeTeste } from "./lib/env-de-teste";

// `process.env` VENCE o `.env.local` (ver scripts/lib/env-de-teste.ts).
//
// A versão anterior lia `.env.local` DIRETO do disco, ignorando o ambiente — e
// por isso a suíte E2E semeava no banco de PRODUÇÃO mesmo com o `.env.e2e`
// injetado no webServer do Playwright: este script nunca olhava para lá.
const credenciais = credenciaisSupabaseDeTeste();
anunciarDestino("seed-e2e-kanban", credenciais);
const env = {
  NEXT_PUBLIC_SUPABASE_URL: credenciais.url,
  SUPABASE_SERVICE_ROLE_KEY: credenciais.serviceRole,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: credenciais.anonKey,
  NEXT_PUBLIC_APP_URL: credenciais.appUrl,
  SUPABASE_DB_URL: credenciais.dbUrl,
} as Record<string, string>;

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");

interface Creds {
  org_id: string;
  users: Record<string, { id: string }>;
  kanban?: unknown;
}

async function upsertLead(
  orgId: string,
  pipelineId: string,
  stageId: string,
  title: string,
  ownerUserId: string | null,
  position: number,
): Promise<string> {
  const { data: existing } = await admin
    .from("crm_leads")
    .select("id")
    .eq("organization_id", orgId)
    .eq("title", title)
    .maybeSingle();
  // 0070: `crm_leads_owner_kind_coherence` exige o trio coerente. Zerar só
  // `owner_user_id` é rejeitado com 23514 — e um UPDATE sem checagem de erro
  // falharia EM SILÊNCIO, deixando o fixture contaminado e o e2e vermelho sem
  // causa aparente. Foi exatamente o que aconteceu na linha de base da Wave 0.
  const owner = {
    owner_user_id: ownerUserId,
    owner_agent_id: null,
    owner_kind: ownerUserId === null ? null : "user",
  };

  if (existing) {
    const id = (existing as { id: string }).id;
    const { error: updateError } = await admin
      .from("crm_leads")
      .update({ ...owner, stage_id: stageId } as never)
      .eq("id", id);
    if (updateError) {
      throw new Error(`update lead "${title}": ${updateError.code} — ${updateError.message}`);
    }
    console.log(`[seed] lead existing "${title}": ${id}`);
    return id;
  }
  const { data, error } = await admin
    .from("crm_leads")
    .insert({
      organization_id: orgId,
      pipeline_id: pipelineId,
      stage_id: stageId,
      title,
      ...owner,
      position_in_stage: position,
      source: "manual",
    } as never)
    .select("id")
    .single();
  if (error || !data) throw new Error(`insert lead "${title}": ${error?.message}`);
  const id = (data as { id: string }).id;
  console.log(`[seed] lead created "${title}": ${id}`);
  return id;
}

async function main(): Promise<void> {
  const creds = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
  const orgId = creds.org_id;
  const agentId = creds.users.agent!.id;

  const { data: pipeline, error: pErr } = await admin
    .from("crm_pipelines")
    .select("id")
    .eq("organization_id", orgId)
    .eq("is_default", true)
    .maybeSingle();
  if (pErr || !pipeline) throw new Error(`default pipeline not found: ${pErr?.message}`);
  const pipelineId = (pipeline as { id: string }).id;

  const { data: stage, error: sErr } = await admin
    .from("crm_stages")
    .select("id")
    .eq("pipeline_id", pipelineId)
    .eq("is_archived", false)
    .order("position")
    .limit(1)
    .maybeSingle();
  if (sErr || !stage) throw new Error(`stage not found: ${sErr?.message}`);
  const stageId = (stage as { id: string }).id;

  const ownedId = await upsertLead(
    orgId,
    pipelineId,
    stageId,
    "Pedido E2E com responsavel",
    agentId,
    1000,
  );
  const unownedId = await upsertLead(
    orgId,
    pipelineId,
    stageId,
    "Pedido E2E sem responsavel",
    null,
    2000,
  );

  creds.kanban = {
    pipeline_id: pipelineId,
    stage_id: stageId,
    owned_lead_id: ownedId,
    unowned_lead_id: unownedId,
    owner_user_id: agentId,
  };
  fs.writeFileSync(CREDS_PATH, JSON.stringify(creds, null, 2));
  console.log(`\n✅ Kanban seed completo. pipeline=${pipelineId} stage=${stageId}`);
}

main().catch((err) => {
  console.error("❌ Kanban seed falhou:", err);
  process.exit(1);
});
