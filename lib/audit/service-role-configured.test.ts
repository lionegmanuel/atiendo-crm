import { describe, expect, it, vi } from "vitest";

import { env } from "@/lib/env";
import { isServiceRoleConfigured } from "./index";

vi.mock("@/lib/env", () => ({
  env: { SUPABASE_SERVICE_ROLE_KEY: "" },
}));

/**
 * O Supabase emite service role key em dois formatos reais: o JWT legado
 * (200+ caracteres, `eyJ...`) e a chave curta nova `sb_secret_...` (~41
 * caracteres). `isServiceRoleConfigured()` já teve uma versão que media
 * `key.length > 50` — media o formato ANTIGO, não a presença da chave — e
 * uma `sb_secret_...` real e válida virava "não configurada". O efeito real:
 * recuperação de MFA devolvia `service_unavailable` pro usuário que perdeu o
 * autenticador, lista de equipe vinha com nome/email nulos, atribuição em
 * massa devolvia 422 — tudo com a chave certa no `.env`.
 *
 * Estes testes travam a regra certa: presença de verdade (não vazio, não
 * placeholder), nunca o comprimento.
 */
describe("isServiceRoleConfigured — presença de chave, não comprimento", () => {
  it("chave sb_secret_ (~41 chars, formato novo do Supabase) → true", () => {
    env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_abcdefghijklmnopqrstuvwxyz012345";
    expect(env.SUPABASE_SERVICE_ROLE_KEY.length).toBeLessThan(50);
    expect(isServiceRoleConfigured()).toBe(true);
  });

  it("JWT longo (formato legado do Supabase) → true", () => {
    env.SUPABASE_SERVICE_ROLE_KEY =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNzAwMDAwMDAwfQ.abcdefghijklmnopqrstuvwxyz0123456789ABCDEF";
    expect(isServiceRoleConfigured()).toBe(true);
  });

  it("string vazia → false (ausência de verdade)", () => {
    env.SUPABASE_SERVICE_ROLE_KEY = "";
    expect(isServiceRoleConfigured()).toBe(false);
  });

  it("marcador de placeholder → false", () => {
    env.SUPABASE_SERVICE_ROLE_KEY = "PLACEHOLDER_SUPABASE_SERVICE_ROLE_KEY";
    expect(isServiceRoleConfigured()).toBe(false);
  });
});
