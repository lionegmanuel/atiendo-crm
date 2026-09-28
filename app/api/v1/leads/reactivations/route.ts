/**
 * GET /api/v1/leads/reactivations — as propostas de retomada VIVAS da org.
 *
 * Rota própria, e não um campo no board, por duas razões que valem escrever:
 *
 *  1. o board devolve `crm_leads` e a proposta mora em outra tabela — embutir
 *     exigiria join na rota mais quente do produto para um dado que a maioria
 *     dos negócios não tem;
 *  2. é o MESMO desenho do radar de risco (`/leads/at-risk`), que o board já
 *     consome do mesmo jeito. Duas fontes com o mesmo formato é o que permite o
 *     card não saber de onde veio o quê.
 *
 * Só `pending`: proposta decidida ou vencida é histórico, e oferecer botão para
 * algo que acabou é a simulação de atenção que esta wave inteira combate.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export interface ReactivationLive {
  lead_id: string;
  proposal_id: string;
  expires_at: string;
}

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const guard = await requireRole("viewer", { requestId });
  if (!guard.ok) return guard.response;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crm_lead_reactivations")
    .select("id, lead_id, expires_at")
    .eq("organization_id", guard.org.orgId)
    .eq("status", "pending")
    .order("expires_at", { ascending: true });
  if (error) return fail("internal_error", error.message, 500, { requestId });

  const items: ReactivationLive[] = (
    (data ?? []) as Array<{ id: string; lead_id: string; expires_at: string }>
  ).map((r) => ({ lead_id: r.lead_id, proposal_id: r.id, expires_at: r.expires_at }));

  return ok({ items }, { requestId });
}
