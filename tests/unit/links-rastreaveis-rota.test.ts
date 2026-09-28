import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ admin: vi.fn(), rate: vi.fn(), dest: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: m.admin }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: m.rate }));
vi.mock("@/lib/plataformas-de-anuncio/rastreio/links", () => ({ destinoDoLink: m.dest }));
import { GET } from "@/app/api/v1/rastreio/[id]/route";
const id = "12345678-1234-4123-8123-123456789012";
const q = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn() };
const request = (key = id) =>
  new NextRequest(
    `https://crm.test/api/v1/rastreio/${key}?organization_id=org-b&to=https://evil.test`,
    { headers: { "x-forwarded-for": "192.0.2.1" } },
  );
beforeEach(() => {
  vi.clearAllMocks();
  m.admin.mockReturnValue({ from: () => q });
  m.rate.mockResolvedValue({ allowed: true });
  m.dest.mockResolvedValue("https://wa.me/5511999999999?text=teste");
  q.maybeSingle.mockResolvedValue({
    data: { id, organization_id: "org-a", enabled: true },
    error: null,
  });
});
describe("rota pública do link", () => {
  it("usa a organização persistida e responde sem cache", async () => {
    const r = await GET(request(), { params: Promise.resolve({ id }) });
    expect(r.status).toBe(302);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("location")).toContain("https://wa.me/");
    expect(q.eq).toHaveBeenCalledWith("id", id);
    expect(q.eq).toHaveBeenCalledWith("enabled", true);
    expect(m.dest.mock.calls[0]![1].organization_id).toBe("org-a");
  });
  it("link inexistente/desativado não cria clique", async () => {
    q.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await GET(request(), { params: Promise.resolve({ id }) })).status).toBe(404);
    expect(m.dest).not.toHaveBeenCalled();
  });
  it("UUID inválido não consulta o banco", async () => {
    expect((await GET(request("bad"), { params: Promise.resolve({ id: "bad" }) })).status).toBe(
      404,
    );
    expect(m.admin).not.toHaveBeenCalled();
  });
  it("limite bloqueia antes da consulta", async () => {
    m.rate.mockResolvedValue({ allowed: false });
    const r = await GET(request(), { params: Promise.resolve({ id }) });
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("60");
    expect(m.admin).not.toHaveBeenCalled();
  });
});
