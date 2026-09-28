/**
 * Os casos que nomeiam o provider moram junto do arquivo que o nomeia — fora de
 * `lib/waha/`/`lib/channels/` o `lint:channels` reprova, e ele está certo: era
 * por aqui que o nome vazava para a camada agnóstica.
 */
import { describe, expect, it } from "vitest";

import { phoneToWhatsappId } from "@/lib/messaging/contact-card";
import { wahaContactPayload } from "@/lib/waha/contact-card";

describe("contact-card do transporte por QR", () => {
  it("wahaContactPayload inclui whatsappId só com dígitos", () => {
    const p = wahaContactPayload("Ana", "+55 11 99999-8888");
    expect(p.whatsappId).toBe(phoneToWhatsappId("+5511999998888"));
    expect(p.fullName).toBe("Ana");
  });
});
