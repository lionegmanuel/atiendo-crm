/**
 * Cartão de contato no formato da API oficial (`type: "contacts"`) — saída e
 * entrada.
 *
 * Mora aqui pelo mesmo motivo do irmão do transporte por QR: nomear o provider
 * é legítimo dentro de `lib/channels/`, e proibido fora.
 */
import type { SharedContact } from "@/lib/messaging/contact-card";
import { normalizePhoneForDisplay, phoneToWhatsappId } from "@/lib/messaging/contact-card";

/** Cartão de contato no formato da WhatsApp Cloud API (`type: "contacts"`). */
export function metaContactsPayload(name: string, phone: string) {
  const display = normalizePhoneForDisplay(phone);
  const waid = phoneToWhatsappId(display);
  const safeName = name.replace(/\n/g, " ").trim() || display;
  const sp = safeName.indexOf(" ");
  const firstName = sp > 0 ? safeName.slice(0, sp) : safeName;
  const lastName = sp > 0 ? safeName.slice(sp + 1).trim() : undefined;
  return [
    {
      name: {
        formatted_name: safeName,
        first_name: firstName,
        ...(lastName ? { last_name: lastName } : {}),
      },
      phones: [{ phone: display, type: "CELL", wa_id: waid }],
    },
  ];
}

/** Extrai o primeiro contato de um payload inbound da Meta (`type: "contacts"`). */
export function parseMetaInboundContact(raw: Record<string, unknown>): SharedContact | null {
  const arr = raw.contacts;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const first = arr[0];
  if (!first || typeof first !== "object") return null;
  const o = first as Record<string, unknown>;
  const nameObj = o.name;
  const formatted =
    nameObj && typeof nameObj === "object"
      ? (
          (nameObj as Record<string, unknown>).formatted_name ??
          (nameObj as Record<string, unknown>).first_name
        )
      : null;
  const safeName = typeof formatted === "string" ? formatted.trim() : "";
  const phones = Array.isArray(o.phones) ? o.phones : [];
  const phoneEntry = phones[0];
  let phone = "";
  if (phoneEntry && typeof phoneEntry === "object") {
    const p = phoneEntry as Record<string, unknown>;
    if (typeof p.phone === "string" && p.phone.trim()) {
      phone = normalizePhoneForDisplay(p.phone.trim());
    } else if (typeof p.wa_id === "string" && p.wa_id.trim()) {
      phone = normalizePhoneForDisplay(p.wa_id.trim());
    }
  }
  if (!safeName && !phone) return null;
  return { name: safeName || phone, phone_number: phone };
}
