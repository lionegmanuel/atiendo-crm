import { describe, expect, it } from "vitest";

import {
  buildVcard,
  parseDialablePhone,
  parseVcard,
  phoneToWhatsappId,
  resolveSharedContact,
  sharedContactFromMetadata,
} from "./contact-card";

describe("contact-card", () => {
  it("parseVcard extrai nome e telefone", () => {
    const vcard = buildVcard("Maria Silva", "+5511999887766");
    const parsed = parseVcard(vcard);
    expect(parsed?.name).toBe("Maria Silva");
    expect(parsed?.phone_number).toBe("+5511999887766");
  });

  it("sharedContactFromMetadata lê objeto gravado", () => {
    const c = sharedContactFromMetadata({
      shared_contact: { contact_id: "abc", name: "João", phone_number: "+5511888777666" },
    });
    expect(c?.contact_id).toBe("abc");
    expect(c?.name).toBe("João");
  });

  it("resolveSharedContact prioriza metadata", () => {
    const c = resolveSharedContact({
      type: "contact",
      body: "BEGIN:VCARD...",
      metadata: { shared_contact: { name: "CRM", phone_number: "+5511000000000" } },
    });
    expect(c?.name).toBe("CRM");
  });

  
  
  
  it("parseDialablePhone aceita E.164 com +", () => {
    expect(parseDialablePhone("+5532984793302")).toBe("+5532984793302");
  });

  it("parseDialablePhone rejeita curto demais", () => {
    expect(parseDialablePhone("123")).toBeNull();
  });
});
