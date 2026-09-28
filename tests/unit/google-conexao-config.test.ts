import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateGoogleAdsConnection } from "@/app/actions/settings/updateGoogleAdsConnection";

const mock = vi.hoisted(() => ({
  user: vi.fn(),
  org: vi.fn(),
  mfa: vi.fn(),
  support: vi.fn(),
  admin: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: mock.user,
  resolveActiveOrg: mock.org,
  mfaEmDivida: mock.mfa,
}));
vi.mock("@/lib/impersonate/support", () => ({ supportWriteError: mock.support }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mock.admin }));
vi.mock("@/lib/audit", () => ({ audit: mock.audit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const input = {
  customer_id: "123-456-7890",
  conversion_action_id: "11",
  enabled: true,
  purchase_value_mode: "quando_houver" as const,
  purchase_category: "PURCHASE" as const,
  send_hashed_phone: true,
};
let patches: Record<string, unknown>[];
let filtros: Array<[string, unknown]>;
let linhas: Array<{ id: string }>;
beforeEach(() => {
  vi.clearAllMocks();
  patches = [];
  filtros = [];
  linhas = [{ id: "conexao" }];
  mock.user.mockResolvedValue({ id: "u", is_platform_admin: false });
  mock.org.mockResolvedValue({ orgId: "org-autenticada", role: "admin" });
  mock.support.mockReturnValue(false);
  mock.mfa.mockResolvedValue(false);
  mock.admin.mockReturnValue({
    from: () => {
      const q = {
        update: (v: Record<string, unknown>) => {
          patches.push(v);
          return q;
        },
        eq: (k: string, v: unknown) => {
          filtros.push([k, v]);
          return q;
        },
        select: () => Promise.resolve({ data: linhas, error: null }),
      };
      return q;
    },
  });
});

describe("conexão do Google Ads", () => {
  it("grava a conta, a venda, o modo de valor e o telefone na organização autenticada", async () => {
    expect(await updateGoogleAdsConnection(input)).toEqual({ ok: true });
    expect(filtros).toContainEqual(["organization_id", "org-autenticada"]);
    expect(filtros).toContainEqual(["platform", "google_ads"]);
    expect(patches[0]).toMatchObject({
      google_customer_id: "1234567890",
      google_conversion_action_id: "11",
      google_purchase_value_mode: "quando_houver",
      google_purchase_category: "PURCHASE",
      google_send_hashed_phone: true,
    });
    expect(mock.audit).toHaveBeenCalledOnce();
  });
  it("aceita conexão só de etapas, sem ação de venda", async () => {
    expect(await updateGoogleAdsConnection({ ...input, conversion_action_id: "" })).toEqual({
      ok: true,
    });
    expect(patches[0]).toMatchObject({ google_conversion_action_id: null });
  });
  it("recusa categoria e modo de valor fora do vocabulário", async () => {
    expect(
      await updateGoogleAdsConnection({ ...input, purchase_category: "VENDA" as never }),
    ).toMatchObject({ error: "validation_failed" });
    expect(
      await updateGoogleAdsConnection({ ...input, purchase_value_mode: "zero" as never }),
    ).toMatchObject({ error: "validation_failed" });
    expect(patches).toHaveLength(0);
  });
  it("cliente antigo que não manda os campos novos não os sobrescreve", async () => {
    const {
      purchase_value_mode: _m,
      purchase_category: _c,
      send_hashed_phone: _t,
      ...antigo
    } = input;
    expect(await updateGoogleAdsConnection(antigo)).toEqual({ ok: true });
    expect(patches[0]).not.toHaveProperty("google_purchase_value_mode");
    expect(patches[0]).not.toHaveProperty("google_send_hashed_phone");
  });
  it("sem autorização do Google a linha não existe e a tela diz o que fazer", async () => {
    linhas = [];
    expect(await updateGoogleAdsConnection(input)).toMatchObject({
      error: "erro_ao_gravar",
      details: "conecte com o Google primeiro",
    });
  });
  it.each(["agent", "viewer", "manager"])("papel %s não altera a conexão", async (role) => {
    mock.org.mockResolvedValue({ orgId: "org-autenticada", role });
    expect(await updateGoogleAdsConnection(input)).toMatchObject({ error: "forbidden_role" });
    expect(mock.admin).not.toHaveBeenCalled();
  });
  it("suporte somente leitura e MFA pendente bloqueiam a escrita", async () => {
    mock.support.mockReturnValue(true);
    expect(await updateGoogleAdsConnection(input)).toMatchObject({ error: "forbidden_role" });
    mock.support.mockReturnValue(false);
    mock.mfa.mockResolvedValue(true);
    expect(await updateGoogleAdsConnection(input)).toMatchObject({ error: "mfa_required" });
    expect(patches).toHaveLength(0);
  });
});
