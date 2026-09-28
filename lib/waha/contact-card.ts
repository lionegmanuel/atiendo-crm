/**
 * Payload de cartão de contato do transporte por QR.
 *
 * Mora aqui porque nomeia o provider — `lib/waha/` é allowlist do
 * `lint:channels` por ser o próprio canal. O vCard e a normalização de telefone,
 * que são formato e não provider, ficam em `lib/messaging/contact-card.ts`.
 */
import { buildVcard, normalizePhoneForDisplay, phoneToWhatsappId } from "@/lib/messaging/contact-card";

/** Payload de um contato para POST /api/sendContactVcard. */
export function wahaContactPayload(name: string, phone: string, whatsappId?: string) {
  const waid = whatsappId ?? phoneToWhatsappId(normalizePhoneForDisplay(phone));
  const telDisplay = whatsappId ? `+${waid}` : normalizePhoneForDisplay(phone);
  const safeName = name.replace(/\n/g, " ").trim() || telDisplay;
  return {
    fullName: safeName,
    phoneNumber: telDisplay,
    whatsappId: waid,
    vcard: buildVcard(safeName, telDisplay, waid),
  };
}
