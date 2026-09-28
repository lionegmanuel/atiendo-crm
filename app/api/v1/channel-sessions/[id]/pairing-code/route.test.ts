import type * as PairingModule from "@/lib/channels/pairing-code";
import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  role: vi.fn(),
  mfa: vi.fn(),
  support: vi.fn(),
  request: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: h.role }));
vi.mock("@/lib/auth/server", () => ({ mfaEmDivida: h.mfa }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: h.support }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/channels/pairing-code", async (original) => ({
  ...(await original<typeof PairingModule>()),
  requestChannelPairingCode: h.request,
}));
import { POST } from "./route";
import { PairingCodeError } from "@/lib/channels/pairing-code";
const id = "11111111-1111-4111-8111-111111111111";
const call = (body: unknown = { phone_number: "+55 (11) 99999-1234" }, channelId = id) =>
  POST(
    new Request("http://localhost/api/pairing", { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: channelId }) },
  );
beforeEach(() => {
  vi.clearAllMocks();
  h.role.mockResolvedValue({
    ok: true,
    org: { orgId: "trusted-org" },
    user: { id: "admin", idioma: "pt-BR" },
  });
  h.mfa.mockResolvedValue(false);
  h.support.mockResolvedValue(null);
  h.request.mockResolvedValue({ code: "ABCD-1234" });
});
it("requires admin, uses trusted org, returns no-store and audits without phone or code", async () => {
  const response = await call();
  expect(response.status).toBe(200);
  expect(h.role).toHaveBeenCalledWith("admin", expect.anything());
  expect(h.request).toHaveBeenCalledWith({}, "trusted-org", id, "5511999991234");
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(h.audit).toHaveBeenCalledWith(
    expect.objectContaining({ action: "channel.pairing_code_requested", resourceId: id }),
  );
  expect(JSON.stringify(h.audit.mock.calls)).not.toMatch(/99999|ABCD/);
});
it("does not call transport for unauthorized users or support read-only sessions", async () => {
  h.role.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
  expect((await call()).status).toBe(403);
  expect(h.request).not.toHaveBeenCalled();
  h.support.mockResolvedValue(new Response(null, { status: 403 }));
  expect((await call()).status).toBe(403);
  expect(h.request).not.toHaveBeenCalled();
});
it("requires MFA proof when enrolled", async () => {
  h.mfa.mockResolvedValue(true);
  expect((await call()).status).toBe(403);
  expect(h.request).not.toHaveBeenCalled();
});
it("rejects invalid path/body and injected org", async () => {
  expect((await call({ phone_number: "123" })).status).toBe(400);
  expect((await call(undefined, "bad-id")).status).toBe(400);
  expect((await call({ phone_number: "5511999991234", organization_id: "other" })).status).toBe(
    400,
  );
  expect(h.request).not.toHaveBeenCalled();
});
it("returns Retry-After on rate limit and does not audit a failed request", async () => {
  h.request.mockRejectedValue(new PairingCodeError("rate_limited", "Aguarde", 429));
  const response = await call();
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("30");
  expect(h.audit).not.toHaveBeenCalled();
});
