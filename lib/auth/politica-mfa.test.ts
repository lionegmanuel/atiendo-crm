/**
 * A política de MFA — a decisão que passou de "sempre" para "quem escolher".
 *
 * Cada caso aqui é uma frase da decisão do dono do produto, e dois deles são o
 * que impede a mudança de virar um buraco: o platform admin cuja plataforma
 * exige NÃO é liberado pela preferência de um tenant, e "ausente" significa
 * "não exige" (senão o campo novo não mudaria nada).
 */
import { describe, expect, it } from "vitest";

import { empresaExigeMfa, exigeCadastroDeMfa, type PoliticaDeMfa } from "@/lib/auth/politica-mfa";

const BASE: PoliticaDeMfa = {
  role: "admin",
  isPlatformAdmin: false,
  plataformaExige: null,
  empresaExige: false,
};

describe("exigeCadastroDeMfa", () => {
  it("o padrão é NÃO exigir — inclusive de admin", () => {
    // A mudança inteira está nesta linha. Antes, `role === "admin"` bastava, e
    // o dono de toda instalação self-host batia num bloqueador de tela cheia
    // logo depois de terminar o onboarding.
    expect(exigeCadastroDeMfa(BASE)).toBe(false);
  });

  it("a empresa pode exigir dos administradores dela", () => {
    expect(exigeCadastroDeMfa({ ...BASE, empresaExige: true })).toBe(true);
  });

  it("mas só dos ADMINISTRADORES — quem não administra nada não é cobrado", () => {
    for (const role of ["manager", "agent", "viewer"] as const) {
      expect(exigeCadastroDeMfa({ ...BASE, role, empresaExige: true }), role).toBe(false);
    }
  });

  it("a plataforma exige do platform admin, e o tenant NÃO o libera", () => {
    // A superfície do platform admin alcança todos os tenants; não é a
    // preferência de um deles que a solta. As duas origens SOMAM.
    expect(
      exigeCadastroDeMfa({
        ...BASE,
        role: "viewer",
        isPlatformAdmin: true,
        plataformaExige: true,
        empresaExige: false,
      }),
    ).toBe(true);
  });

  it("platform admin com a exigência desligada na plataforma não é cobrado", () => {
    // `platform_admins.mfa_required` existia e NUNCA era lido — a tela de admin
    // mostrava o badge e desmarcá-lo não mudava nada. Agora decide.
    expect(
      exigeCadastroDeMfa({
        ...BASE,
        role: "viewer",
        isPlatformAdmin: true,
        plataformaExige: false,
      }),
    ).toBe(false);
  });

  it("mas continua obrigado se a EMPRESA dele exige e ele administra", () => {
    expect(
      exigeCadastroDeMfa({
        ...BASE,
        role: "admin",
        isPlatformAdmin: true,
        plataformaExige: false,
        empresaExige: true,
      }),
    ).toBe(true);
  });

  it("sem papel resolvido, não cobra por papel", () => {
    expect(exigeCadastroDeMfa({ ...BASE, role: undefined, empresaExige: true })).toBe(false);
  });
});

describe("empresaExigeMfa", () => {
  it("organização sem a chave não exige — é o estado de TODAS as que já existem", () => {
    // Se o default fosse `true`, o campo novo não mudaria nada: toda linha do
    // banco chega aqui sem `security`.
    expect(empresaExigeMfa(null)).toBe(false);
    expect(empresaExigeMfa({})).toBe(false);
    expect(empresaExigeMfa({ llm: { provider: "anthropic" } })).toBe(false);
    expect(empresaExigeMfa({ security: {} })).toBe(false);
  });

  it("só o booleano `true` exige — string não conta", () => {
    // `settings` é jsonb livre: nada impede uma escrita antiga ter posto "true".
    // Aceitar a string faria a leitura divergir do que a tela grava.
    expect(empresaExigeMfa({ security: { mfa_required: true } })).toBe(true);
    expect(empresaExigeMfa({ security: { mfa_required: "true" } })).toBe(false);
    expect(empresaExigeMfa({ security: { mfa_required: false } })).toBe(false);
  });

  it("aguenta lixo sem explodir", () => {
    expect(empresaExigeMfa("nada")).toBe(false);
    expect(empresaExigeMfa(42)).toBe(false);
    expect(empresaExigeMfa({ security: "sim" })).toBe(false);
  });
});
