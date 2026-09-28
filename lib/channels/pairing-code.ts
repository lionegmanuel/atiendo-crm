import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getWahaClient } from "@/lib/waha/client";
import { ARCHIVED_AT, queryTolerantToMissingArchived } from "./archived";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";

export const pairingPhoneSchema = z
  .string()
  .trim()
  .max(32)
  .regex(/^\+?[\d\s()-]+$/)
  .transform((value) => value.replace(/\D/g, ""))
  .pipe(z.string().regex(/^[1-9]\d{7,14}$/));

export class PairingCodeError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Reuses the existing session. Never creates, logs out or restarts a number. */
export async function requestChannelPairingCode(
  db: SupabaseClient,
  organizationId: string,
  channelId: string,
  phoneNumber: string,
): Promise<{ code: string }> {
  const buscar = (columns: string) =>
    db
      .from("channel_sessions")
      .select(columns)
      .eq("organization_id", organizationId)
      .eq("id", channelId)
      .maybeSingle();
  const { data, error } = await queryTolerantToMissingArchived(
    () => buscar(`waha_session_name, ${ARCHIVED_AT}`),
    () => buscar("waha_session_name"),
  );
  if (error)
    throw new PairingCodeError(
      "pairing_lookup_failed",
      "Não foi possível consultar esta conexão. Tente novamente.",
      503,
    );
  const session = data as { waha_session_name: string | null; archived_at?: string | null } | null;
  if (!session) throw new PairingCodeError("not_found", "Canal não encontrado.", 404);
  if (session.archived_at)
    throw new PairingCodeError(
      "channel_archived",
      "Este canal foi excluído. Conecte um número para voltar a atender.",
      409,
    );
  if (!session.waha_session_name)
    throw new PairingCodeError(
      "pairing_not_supported",
      "Este canal não conecta por código de pareamento.",
      422,
    );
  const client = getWahaClient();
  if (!client)
    throw new PairingCodeError(
      "pairing_unavailable",
      "O serviço de conexão não está configurado.",
      503,
    );

  // Per-channel bucket prevents two operators from continuously invalidating codes.
  const limit = await checkRateLimit(`pairing-code:${organizationId}:${channelId}`, 1, 30);
  if (!limit.allowed)
    throw new PairingCodeError(
      "rate_limited",
      "Aguarde 30 segundos antes de pedir outro código.",
      429,
    );
  try {
    const remote = await client.getVerifiedSession(session.waha_session_name);
    if (remote?.status === "WORKING")
      throw new PairingCodeError(
        "channel_already_connected",
        "Este WhatsApp já está conectado.",
        409,
      );
    if (remote?.status !== "SCAN_QR_CODE")
      throw new PairingCodeError(
        "pairing_not_ready",
        "A conexão ainda não está pronta. Aguarde ou use Reconectar e tente novamente.",
        409,
      );
    const response = await fetch(
      `${process.env.WAHA_API_BASE_URL}/api/${encodeURIComponent(session.waha_session_name)}/auth/request-code`,
      {
        method: "POST",
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
        headers: { "Content-Type": "application/json", "X-Api-Key": process.env.WAHA_API_KEY! },
        body: JSON.stringify({ phoneNumber }),
      },
    );
    if (!response.ok)
      throw new PairingCodeError(
        "pairing_code_failed",
        "Não foi possível gerar o código. Confira o número e tente novamente, ou use o QR Code.",
        502,
      );
    const parsed = z
      .object({ code: z.string().regex(/^[A-Z0-9]{4}-?[A-Z0-9]{4}$/i) })
      .safeParse(await response.json());
    if (!parsed.success) throw new Error("invalid_pairing_response");
    return {
      code: parsed.data.code
        .toUpperCase()
        .replace(/-/, "")
        .replace(/^(.{4})(.{4})$/, "$1-$2"),
    };
  } catch (error) {
    if (error instanceof PairingCodeError) throw error;
    // Neither upstream bodies nor exceptions may expose a phone, code or credential.
    throw new PairingCodeError(
      "pairing_unavailable",
      "O serviço de conexão não respondeu. Tente novamente ou use o QR Code.",
      502,
    );
  }
}
