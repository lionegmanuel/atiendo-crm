import type { SupabaseClient } from "@supabase/supabase-js";

import type { ReplySaveTo } from "./graph-schema";
import { latestRepeatIndex, type EnrollmentEventRef } from "./node-handlers";

const MAX_CHARS = 2_000;

export function recorteDaResposta(body: string): string {
  const t = body.trim();
  return t.length <= MAX_CHARS ? t : t.slice(0, MAX_CHARS);
}

export function interpolarDestino(saveTo: ReplySaveTo, events: EnrollmentEventRef[]): ReplySaveTo {
  if (saveTo.kind !== "lead_custom") return saveTo;
  const volta = latestRepeatIndex(events);
  if (!volta) return saveTo;
  return {
    kind: "lead_custom",
    key: saveTo.key.replaceAll("{{volta}}", String(volta.index)),
  };
}

export type PersistirRespostaInput = {
  organization_id: string;
  contact_id: string;
  save_to: ReplySaveTo;
  value: string;
};

export async function persistirRespostaFollowupSupabase(
  admin: SupabaseClient,
  input: PersistirRespostaInput,
): Promise<void> {
  const value = recorteDaResposta(input.value);
  if (value.length === 0) return;

  if (input.save_to.kind === "contact_name") {
    const { error } = await admin
      .from("contacts")
      .update({ name: value, updated_at: new Date().toISOString() })
      .eq("organization_id", input.organization_id)
      .eq("id", input.contact_id);
    if (error) throw new Error(error.message);
    return;
  }

  const { data: lead, error: selErr } = await admin
    .from("crm_leads")
    .select("id, custom_fields")
    .eq("organization_id", input.organization_id)
    .eq("contact_id", input.contact_id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (selErr) throw new Error(selErr.message);
  if (!lead) return;

  const prev =
    lead.custom_fields && typeof lead.custom_fields === "object" && !Array.isArray(lead.custom_fields)
      ? (lead.custom_fields as Record<string, unknown>)
      : {};
  const { error } = await admin
    .from("crm_leads")
    .update({
      custom_fields: { ...prev, [input.save_to.key]: value },
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", input.organization_id)
    .eq("id", lead.id);
  if (error) throw new Error(error.message);
}

export async function persistirRespostaFollowupPg(
  query: (sql: string, params: unknown[]) => Promise<unknown>,
  input: PersistirRespostaInput,
): Promise<void> {
  const value = recorteDaResposta(input.value);
  if (value.length === 0) return;

  if (input.save_to.kind === "contact_name") {
    await query(
      `update contacts set name = $3, updated_at = now()
       where organization_id = $1 and id = $2`,
      [input.organization_id, input.contact_id, value],
    );
    return;
  }

  await query(
    `update crm_leads
        set custom_fields = coalesce(custom_fields, '{}'::jsonb) || jsonb_build_object($3::text, to_jsonb($4::text)),
            updated_at = now()
      where id = (
        select id from crm_leads
         where organization_id = $1 and contact_id = $2
         order by updated_at desc
         limit 1
      )`,
    [input.organization_id, input.contact_id, input.save_to.key, value],
  );
}
