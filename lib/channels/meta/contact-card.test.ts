/**
 * Idem ao irmão do transporte por QR: caso que nomeia provider mora na pasta do
 * canal.
 */
import { describe, expect, it } from "vitest";

import { metaContactsPayload, parseMetaInboundContact } from "@/lib/channels/meta/contact-card";

describe("contact-card do canal oficial", () => {
  it("metaContactsPayload monta formatted_name e wa_id", () => {
    const [c] = metaContactsPayload("Maria Silva", "+5511999887766");
    expect(c?.name.formatted_name).toBe("Maria Silva");
    expect(c?.name.first_name).toBe("Maria");
    expect(c?.name.last_name).toBe("Silva");
    expect(c?.phones[0]?.wa_id).toBe("5511999887766");
  });

  it("parseMetaInboundContact lê payload da Meta", () => {
    const c = parseMetaInboundContact({
      contacts: [{
        name: { formatted_name: "João", first_name: "João" },
        phones: [{ phone: "+5511888777666", wa_id: "5511888777666", type: "CELL" }],
      }],
    });
    expect(c?.name).toBe("João");
    expect(c?.phone_number).toBe("+5511888777666");
  });
});
