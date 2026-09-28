/**
 * O que a TELA precisa saber sobre a conexão do Google Ads — nada além.
 *
 * Irmão de `lib/conversoes/estado-da-conexao.ts`, separado porque a forma da
 * credencial é outra (refresh token + três identificadores, não token +
 * dataset id — ver o cabeçalho de `CredencialDeConversao` em `../types.ts`).
 * O refresh token, como o token da Meta, NUNCA sai daqui — só um booleano.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface EstadoDaConexaoGoogle {
  qualificationStageId?: string | null;
  qualificationActionId?: string | null;
  api?: "google_ads" | "data_manager";
  temRefreshToken: boolean;
  habilitada: boolean;
  customerId: string | null;
  loginCustomerId: string | null;
  conversionActionId: string | null;
  /** Negócio ganho sem valor (0436). Ausente = `obrigatorio`. */
  modoDeValorDaVenda?: "obrigatorio" | "quando_houver" | "nunca";
  categoriaDaVenda?: string;
  enviarTelefone?: boolean;
}

export async function lerEstadoDaConexaoGoogle(
  admin: SupabaseClient,
  organizationId: string,
): Promise<EstadoDaConexaoGoogle> {
  const { data } = await admin
    .from("ad_platform_connections")
    .select(
      "google_refresh_token_encrypted, google_customer_id, google_login_customer_id, google_conversion_action_id, enabled, google_api, google_qualification_stage_id, google_qualification_action_id, google_purchase_value_mode, google_purchase_category, google_send_hashed_phone",
    )
    .eq("organization_id", organizationId)
    .eq("platform", "google_ads")
    .maybeSingle();

  const linha = data as {
    google_refresh_token_encrypted: string | null;
    google_customer_id: string | null;
    google_login_customer_id: string | null;
    google_conversion_action_id: string | null;
    enabled: boolean;
    google_qualification_stage_id: string | null;
    google_qualification_action_id: string | null;
    google_api: "google_ads" | "data_manager";
    google_purchase_value_mode?: "obrigatorio" | "quando_houver" | "nunca" | null;
    google_purchase_category?: string | null;
    google_send_hashed_phone?: boolean | null;
  } | null;

  return {
    qualificationStageId: linha?.google_qualification_stage_id ?? null,
    qualificationActionId: linha?.google_qualification_action_id ?? null,
    api: linha?.google_api ?? "data_manager",
    temRefreshToken: Boolean(linha?.google_refresh_token_encrypted),
    habilitada: linha?.enabled ?? false,
    customerId: linha?.google_customer_id ?? null,
    loginCustomerId: linha?.google_login_customer_id ?? null,
    conversionActionId: linha?.google_conversion_action_id ?? null,
    modoDeValorDaVenda: linha?.google_purchase_value_mode ?? "obrigatorio",
    categoriaDaVenda: linha?.google_purchase_category ?? "PURCHASE",
    enviarTelefone: linha?.google_send_hashed_phone === true,
  };
}
