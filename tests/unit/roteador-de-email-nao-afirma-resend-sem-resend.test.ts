/**
 * O roteador de e-mail não afirma "Resend" numa instalação sem Resend.
 *
 * Um defeito que NÃO existia em nenhum dos dois PRs sozinho — só no encontro:
 *
 *   - #1176 (SMTP) trouxe `transporteEmVigor()`, que pergunta
 *     `resendConfigurada()` e devolve "resend" ou "nenhum". Na main a pergunta é
 *     SÍNCRONA, e o código estava certo.
 *   - #1194 (painel) fez a chave da Resend vir do banco, e a pergunta virou
 *     ASSÍNCRONA. O roteador seguia testando o resultado sem `await` — ou seja,
 *     testava a PROMESSA, que é sempre verdadeira.
 *
 * Efeito em tela, na instalação recém-subida (sem SMTP e sem Resend): a tela de
 * e-mail afirmaria "O e-mail desta instalação já sai por um serviço externo",
 * quando o certo é "Nenhum caminho de e-mail configurado: os convites aparecem
 * como link para copiar". Quem lesse isso passaria horas procurando por que o
 * e-mail não sai, com a tela garantindo que estava tudo certo.
 *
 * O compilador pega (TS2801). Este teste existe porque o compilador prova que o
 * TIPO fecha, não que o VALOR é o certo — e porque ele pode ser sabotado aqui,
 * localmente, ao contrário da prova de tela, que é
 * `tests/e2e/email-da-instalacao-pela-tela.spec.ts` caso (1), no CI.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const estado = { smtp: false, resend: false };

vi.mock("@/lib/email/config", () => ({
  getSmtpConfig: async () => ({}),
}));
vi.mock("@/lib/email/smtp", () => ({
  isSmtpConfigured: () => estado.smtp,
  sendEmail: vi.fn(),
}));
vi.mock("@/lib/email/resend", () => ({
  // ASSÍNCRONA, como ficou no #1194 — é exatamente a mudança que expôs o defeito.
  isEmailConfigured: async () => estado.resend,
  sendEmail: vi.fn(),
}));

describe("transporteEmVigor — quem entrega DE FATO", () => {
  beforeEach(() => {
    estado.smtp = false;
    estado.resend = false;
  });

  it("instalação recém-subida, sem SMTP e sem Resend: 'nenhum', nunca 'resend'", async () => {
    // O CASO DO DEFEITO. Com a promessa testada no lugar do valor, isto dava
    // "resend" — e a tela mentia.
    const { transporteEmVigor } = await import("@/lib/email/roteador");
    expect(await transporteEmVigor()).toBe("nenhum");
  });

  it("sem SMTP e COM Resend: 'resend'", async () => {
    // Controle positivo: sem ele, um roteador que devolvesse sempre "nenhum"
    // passaria no caso acima e o teste não distinguiria nada.
    estado.resend = true;
    const { transporteEmVigor } = await import("@/lib/email/roteador");
    expect(await transporteEmVigor()).toBe("resend");
  });

  it("com SMTP: 'smtp', mesmo com Resend configurada", async () => {
    estado.smtp = true;
    estado.resend = true;
    const { transporteEmVigor } = await import("@/lib/email/roteador");
    expect(await transporteEmVigor()).toBe("smtp");
  });
});

describe("emailConfigurado — existe algum caminho?", () => {
  beforeEach(() => {
    estado.smtp = false;
    estado.resend = false;
  });

  it("sem nada configurado: false", async () => {
    const { emailConfigurado } = await import("@/lib/email/roteador");
    expect(await emailConfigurado()).toBe(false);
  });

  it("só com Resend: true", async () => {
    estado.resend = true;
    const { emailConfigurado } = await import("@/lib/email/roteador");
    expect(await emailConfigurado()).toBe(true);
  });
});
