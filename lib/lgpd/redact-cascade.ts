/**
 * LGPD redact cascade — invokes the SECURITY DEFINER RPC
 * `fn_lgpd_cascade_redact_contact` that performs the full anonymisation in
 * a single Postgres transaction.
 *
 * The RPC:
 *   - Short-circuits when contact is already anonymised (returns
 *     `already_anonymized: true`).
 *   - Mutates contacts (irreversible), conversations, messages,
 *     crm_lead_activities, crm_leads.
 *   - Strips personal fields from orders.payload but PRESERVES values.
 *   - Enqueues media paths into `storage_redaction_queue` for async deletion.
 *   - Inserts a dense `lgpd.redact_executed` audit row inside the TX.
 *
 * All tenant filtering is enforced at the RPC level (programmatic
 * organization_id check). The admin client bypasses RLS.
 */

import { createAdminClient } from "@/lib/supabase/admin";

export interface CascadeResult {
  alreadyAnonymized: boolean;
  counts: Record<string, number>;
  mediaPaths: string[];
}

interface RpcResult {
  already_anonymized: boolean;
  counts?: Record<string, number>;
  media_paths?: string[];
}

export interface CascadeArgs {
  organizationId: string;
  contactId: string;
  requestId: string;
}

export async function cascadeRedactContact(args: CascadeArgs): Promise<CascadeResult> {
  const admin = createAdminClient();

  // FOTO DE PERFIL — enfileirada ANTES da cascata, e a ordem importa.
  //
  // A RPC zera os campos do contato. Se o avatar fosse limpo junto sem passar
  // por aqui, o caminho do arquivo se perderia e a imagem ficaria ÓRFÃ no
  // bucket: a pessoa "anonimizada" continuaria com o rosto guardado. Numa
  // auditoria LGPD isso é o mesmo que não ter anonimizado.
  //
  // Fica no app, e não dentro da função SQL, de propósito: aquela função tem
  // ~200 linhas e um `create or replace` exigiria copiá-la inteira só para
  // acrescentar uma coluna — risco de divergir do original sem necessidade.
  // Aqui o efeito é o mesmo e a mudança é auditável.
  //
  // A fila é idempotente (`unique (bucket, object_path)`), então re-executar
  // uma anonimização não duplica nada.
  const { data: contatoAvatar } = await admin
    .from("contacts")
    .select("avatar_storage_path")
    .eq("id", args.contactId)
    .eq("organization_id", args.organizationId)
    .maybeSingle();

  const avatarPath = (contatoAvatar as { avatar_storage_path?: string | null } | null)
    ?.avatar_storage_path;

  if (avatarPath) {
    // `upsert` que REABRE a linha, e não `insert` cru. A mídia de mensagem tem
    // caminho único por arquivo, então lá um conflito nunca acontece; o avatar
    // inverte essa premissa — o caminho é `{org}/avatars/{id}.jpg`, estável por
    // contato e reaproveitado a cada refresh do cron. Um pedido anterior para o
    // mesmo contato deixa na fila uma linha terminal, que nada purga, e um
    // `insert` bateria em `unique (bucket, object_path)`.
    //
    // Reabrir é o certo, não ignorar o conflito: se o cron rebaixou a foto
    // depois daquele pedido, existe um arquivo NOVO naquele mesmo caminho
    // esperando remoção, e uma linha em estado terminal nunca seria drenada.
    const { error: filaErro } = await admin.from("storage_redaction_queue").upsert(
      {
        organization_id: args.organizationId,
        request_id: args.requestId,
        bucket: "whatsapp-media",
        object_path: avatarPath,
        status: "pending",
        attempts: 0,
        processed_at: null,
        error_message: null,
      },
      { onConflict: "bucket,object_path" },
    );

    // Falha FECHADA: sem linha na fila, zerar o ponteiro abaixo tornaria o
    // arquivo inalcançável — contato anonimizado, auditoria afirmando que a
    // redação ocorreu, e o rosto ainda no bucket sem ninguém capaz de achá-lo.
    // Melhor abortar a cascata e reprocessar do que anonimizar pela metade.
    if (filaErro) {
      throw new Error(`[lgpd-redact-cascade] avatar não enfileirado: ${filaErro.message}`);
    }

    await admin
      .from("contacts")
      .update({ avatar_storage_path: null, avatar_updated_at: new Date().toISOString() })
      .eq("id", args.contactId)
      .eq("organization_id", args.organizationId);
  }

  const { data, error } = await admin.rpc("fn_lgpd_cascade_redact_contact" as never, {
    p_organization_id: args.organizationId,
    p_contact_id: args.contactId,
    p_request_id: args.requestId,
  } as never);

  if (error) {
    throw new Error(`[lgpd-redact-cascade] rpc failed: ${error.message}`);
  }

  const result = (data ?? {}) as RpcResult;
  return {
    alreadyAnonymized: result.already_anonymized === true,
    counts: result.counts ?? {},
    mediaPaths: result.media_paths ?? [],
  };
}
