import { describe, expect, it, vi } from "vitest";

import { webPushInboundHandler } from "./push.handler";

vi.mock("@/lib/notifications/vapid", () => ({
  vapidPronto: () => false,
}));

describe("webPushInboundHandler", () => {
  it("pula quando VAPID não está configurado", async () => {
    const result = await webPushInboundHandler.handle({
      id: "e1",
      organization_id: "org",
      event_type: "message.received",
      entity_kind: "message",
      entity_id: "m1",
      payload: { conversation_id: "c1", body_preview: "oi", type: "text" },
      metadata: {},
      consumed_by: [],
      attempts: 0,
    });
    expect(result.status).toBe("skipped");
    expect(result.detail).toBe("vapid_ausente");
  });
});
