import { beforeEach, describe, expect, it, vi } from "vitest";
import { salvarLinkRastreavel } from "@/app/actions/settings/linksRastreaveis";
const m = vi.hoisted(() => ({
  user: vi.fn(),
  org: vi.fn(),
  mfa: vi.fn(),
  support: vi.fn(),
  admin: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: m.user,
  resolveActiveOrg: m.org,
  mfaEmDivida: m.mfa,
}));
vi.mock("@/lib/impersonate/support", () => ({ supportWriteError: m.support }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: m.admin }));
vi.mock("@/lib/audit", () => ({ audit: m.audit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const id = "12345678-1234-4123-8123-123456789012";
const input = {
  name: "Teste",
  whatsapp_e164: "+5511999999999",
  message_template: "Olá",
  use_case: "site" as const,
  utm: { utm_source: "google", email: "privado" },
  enabled: true,
};
const q = {
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn(),
};
beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue({ id: "user", is_platform_admin: false });
  m.org.mockResolvedValue({ orgId: "org-a", role: "admin" });
  m.mfa.mockResolvedValue(false);
  m.support.mockReturnValue(false);
  q.maybeSingle.mockResolvedValue({ data: { id }, error: null });
  m.admin.mockReturnValue({ from: () => q });
});
describe("gravação de links", () => {
  it("ignora organization_id vindo do cliente, filtra UTMs e audita", async () => {
    expect(await salvarLinkRastreavel({ ...input, ...{ organization_id: "org-b" } })).toEqual({
      ok: true,
      id,
    });
    expect(q.insert).toHaveBeenCalledWith(
      expect.objectContaining({ organization_id: "org-a", utm: { utm_source: "google" } }),
    );
    expect(m.audit).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-a", resourceId: id }),
    );
  });
  it("edição/desativação filtra id e tenant sem apagar histórico", async () => {
    await salvarLinkRastreavel({ ...input, id, enabled: false });
    expect(q.eq).toHaveBeenCalledWith("organization_id", "org-a");
    expect(q.eq).toHaveBeenCalledWith("id", id);
    expect(q.update).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(q.insert).not.toHaveBeenCalled();
  });
  it.each(["anon", "viewer", "mfa", "support", "support-platform"])(
    "barra %s antes da escrita",
    async (mode) => {
      if (mode === "anon") m.user.mockResolvedValue(null);
      if (mode === "viewer") m.org.mockResolvedValue({ orgId: "org-a", role: "viewer" });
      if (mode === "mfa") m.mfa.mockResolvedValue(true);
      if (mode === "support") m.support.mockReturnValue(true);
      if (mode === "support-platform") {
        m.user.mockResolvedValue({ id: "u", is_platform_admin: true, support: {} });
        m.org.mockResolvedValue({ orgId: "org-a", role: "viewer" });
      }
      expect((await salvarLinkRastreavel(input)).ok).toBe(false);
      expect(m.admin).not.toHaveBeenCalled();
      expect(m.audit).not.toHaveBeenCalled();
    },
  );
  it("nenhuma linha alterada é erro, não sucesso", async () => {
    q.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await salvarLinkRastreavel({ ...input, id })).ok).toBe(false);
    expect(m.audit).not.toHaveBeenCalled();
  });
});
