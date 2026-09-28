import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pairingPhoneSchema, requestChannelPairingCode } from "./pairing-code";
const h = vi.hoisted(() => ({
  getSession: vi.fn(),
  limit: vi.fn(),
  fetch: vi.fn(),
  configured: true,
}));
vi.mock("@/lib/waha/client", () => ({
  getWahaClient: () => (h.configured ? { getVerifiedSession: h.getSession } : null),
}));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: h.limit }));
function database(data: unknown, error: unknown = null) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
  const db = { from: vi.fn().mockReturnValue(query) };
  return { db: db as unknown as SupabaseClient, query };
}
beforeEach(() => {
  vi.clearAllMocks();
  h.configured = true;
  h.getSession.mockResolvedValue({ status: "SCAN_QR_CODE" });
  h.limit.mockResolvedValue({ allowed: true });
  h.fetch.mockResolvedValue(new Response(JSON.stringify({ code: "abcd1234" }), { status: 200 }));
  vi.stubGlobal("fetch", h.fetch);
  vi.stubEnv("WAHA_API_BASE_URL", "http://transport.internal:3000");
  vi.stubEnv("WAHA_API_KEY", "test-key");
});
describe("pairing code boundary", () => {
  it("normalizes international phone and rejects non-phone input", () => {
    expect(pairingPhoneSchema.parse("+55 (11) 99999-1234")).toBe("5511999991234");
    for (const phone of ["abc5511999991234", "123", "01234567890", "1234567890123456"])
      expect(pairingPhoneSchema.safeParse(phone).success).toBe(false);
  });
  it("scopes lookup by tenant and session, sends only normalized phone, returns validated code", async () => {
    const { db, query } = database({ waha_session_name: "session/a" });
    expect(await requestChannelPairingCode(db, "org-a", "channel-a", "5511999991234")).toEqual({
      code: "ABCD-1234",
    });
    expect(query.eq.mock.calls).toEqual([
      ["organization_id", "org-a"],
      ["id", "channel-a"],
    ]);
    expect(h.fetch).toHaveBeenCalledWith(
      "http://transport.internal:3000/api/session%2Fa/auth/request-code",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        body: JSON.stringify({ phoneNumber: "5511999991234" }),
        headers: { "Content-Type": "application/json", "X-Api-Key": "test-key" },
      }),
    );
  });
  it.each([
    [null, "not_found"],
    [{ waha_session_name: "session", archived_at: "2026-09-15" }, "channel_archived"],
    [{ waha_session_name: null }, "pairing_not_supported"],
  ])("refuses missing, archived and incompatible channels before transport", async (data, code) => {
    await expect(
      requestChannelPairingCode(database(data).db, "org-b", "channel-a", "5511999991234"),
    ).rejects.toMatchObject({ code });
    expect(h.getSession).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it.each(["WORKING", "STARTING", "FAILED", "STOPPED"])(
    "does not pair or restart a session in %s",
    async (status) => {
      h.getSession.mockResolvedValue({ status });
      await expect(
        requestChannelPairingCode(
          database({ waha_session_name: "session" }).db,
          "org-a",
          "channel",
          "5511999991234",
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(h.fetch).not.toHaveBeenCalled();
    },
  );
  it("limits repeated generation before contacting the provider", async () => {
    h.limit.mockResolvedValue({ allowed: false });
    await expect(
      requestChannelPairingCode(
        database({ waha_session_name: "session" }).db,
        "org",
        "channel",
        "5511999991234",
      ),
    ).rejects.toMatchObject({ status: 429 });
    expect(h.getSession).not.toHaveBeenCalled();
  });
  it.each([
    new Response("secret phone code", { status: 500 }),
    new Response('{"code":"secret phone code"}', { status: 200 }),
  ])("never exposes arbitrary provider content", async (response) => {
    h.fetch.mockResolvedValue(response);
    await expect(
      requestChannelPairingCode(
        database({ waha_session_name: "session" }).db,
        "org",
        "channel",
        "5511999991234",
      ),
    ).rejects.not.toThrow("secret");
  });
  it("returns an actionable error on transport timeout", async () => {
    h.fetch.mockRejectedValue(new DOMException("secret", "TimeoutError"));
    await expect(
      requestChannelPairingCode(
        database({ waha_session_name: "session" }).db,
        "org",
        "channel",
        "5511999991234",
      ),
    ).rejects.toMatchObject({ code: "pairing_unavailable", status: 502 });
  });
});
