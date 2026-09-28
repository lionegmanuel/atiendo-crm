/**
 * Contrato de `GET /api/v1/lead-captures` — o histórico de leads captados.
 *
 * Cursor keyset opaco sobre (received_at DESC, id DESC), no mesmo formato do
 * audit (`base64url("<data>|<id>")`). Os DOIS critérios são obrigatórios:
 * ordenar só por data faria duas captações no mesmo instante — que é o normal
 * quando uma ferramenta dispara um lote — pularem ou repetirem entre páginas.
 */
import { z } from "zod";

/** Espelha o CHECK de `webhook_lead_captures.outcome` (migration 0174). */
export const DESFECHOS_DA_CAPTACAO = ["criado", "duplicado", "recusado"] as const;

export const leadCapturesQuerySchema = z.object({
  source_id: z.string().uuid().optional(),
  outcome: z.enum(DESFECHOS_DA_CAPTACAO).optional(),
  /** Busca por nome, telefone ou e-mail do que foi captado. */
  q: z.string().min(1).max(120).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type LeadCapturesQuery = z.infer<typeof leadCapturesQuerySchema>;

export interface LeadCaptureCursor {
  received_at: string;
  id: string;
}

export function encodeLeadCaptureCursor(c: LeadCaptureCursor): string {
  return Buffer.from(`${c.received_at}|${c.id}`, "utf8").toString("base64url");
}

export function decodeLeadCaptureCursor(raw: string): LeadCaptureCursor | null {
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const [received_at, id] = decoded.split("|");
    if (!received_at || !id) return null;
    return { received_at, id };
  } catch {
    return null;
  }
}
