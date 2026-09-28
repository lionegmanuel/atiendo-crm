/**
 * As duas chamadas de rede do OAuth, e as três coisas que elas não podem fazer.
 *
 * 1. LANÇAR — rede falha por motivos que não controlamos, e um `throw` aqui
 *    viraria 500 numa rota que precisa redirecionar o navegador, ou pararia o
 *    worker de renovação no primeiro timeout, deixando TODAS as outras agendas
 *    sem renovar junto.
 * 2. DESCARTAR O CORPO EM ERRO — é no corpo que vem `invalid_grant`, que é como
 *    o Google diz "o usuário revogou", com HTTP 400 e não 401.
 * 3. FUNDIR OU GRAVAR — a resposta da renovação vem sem `refresh_token`, e quem
 *    gravar direto o que chegou apaga a chave que acabou de renovar.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { trocarCodigoPorToken, renovarToken } from "@/lib/agenda/google/token";
import { fundirTokens } from "@/lib/agenda/google/oauth";
import type { AppDoGoogleConfigurado } from "@/lib/agenda/google/config";

const APP: AppDoGoogleConfigurado = {
  clientId: "123.apps.googleusercontent.com",
  clientSecret: "GOCSPX-segredo",
  redirectUri: "https://crm.exemplo/api/v1/agenda/google/callback",
};
const AGORA = new Date("2026-08-26T12:00:00.000Z");

function respostaDoGoogle(corpo: unknown, status = 200): Response {
  return { status, json: async () => corpo } as unknown as Response;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("trocarCodigoPorToken", () => {
  it("manda o MESMO redirect_uri do consentimento", async () => {
    // O Google compara os dois byte a byte; divergir dá `redirect_uri_mismatch`,
    // um erro que aponta para o Google e não para a divergência.
    vi.mocked(fetch).mockResolvedValue(
      respostaDoGoogle({ access_token: "ya29.x", expires_in: 3599, refresh_token: "1//r", token_type: "Bearer" }),
    );
    const r = await trocarCodigoPorToken(APP, "o-codigo", { agora: AGORA });

    expect(r.ok).toBe(true);
    const corpo = new URLSearchParams(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(corpo.get("redirect_uri")).toBe(APP.redirectUri);
    expect(corpo.get("grant_type")).toBe("authorization_code");
    expect(corpo.get("code")).toBe("o-codigo");
  });

  it("transforma o `expires_in` relativo em instante absoluto", async () => {
    vi.mocked(fetch).mockResolvedValue(
      respostaDoGoogle({ access_token: "ya29.x", expires_in: 3599, token_type: "Bearer" }),
    );
    const r = await trocarCodigoPorToken(APP, "c", { agora: AGORA });
    expect(r.ok && r.token.expira_em).toBe("2026-08-26T12:59:59.000Z");
  });

  it("LÊ o corpo mesmo em HTTP 400 — é lá que mora o `invalid_grant`", async () => {
    vi.mocked(fetch).mockResolvedValue(
      respostaDoGoogle({ error: "invalid_grant", error_description: "Bad Request" }, 400),
    );
    const r = await trocarCodigoPorToken(APP, "c", { agora: AGORA });
    expect(r).toMatchObject({ ok: false, motivo: "erro_do_google" });
    if (!r.ok) expect(r.detalhe).toContain("invalid_grant");
  });

  it("rede caída não lança — vira recusa legível", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("fetch failed"));
    const r = await trocarCodigoPorToken(APP, "c", { agora: AGORA });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detalhe).toContain("sem resposta do Google");
  });

  it("corpo que não é JSON também não lança", async () => {
    vi.mocked(fetch).mockResolvedValue({
      status: 502,
      json: async () => {
        throw new Error("Unexpected token < in JSON");
      },
    } as unknown as Response);
    const r = await trocarCodigoPorToken(APP, "c", { agora: AGORA });
    expect(r).toMatchObject({ ok: false, motivo: "resposta_invalida" });
    if (!r.ok) expect(r.detalhe).toContain("502");
  });

  it("desiste depois de um prazo, em vez de pendurar a requisição", async () => {
    vi.mocked(fetch).mockResolvedValue(respostaDoGoogle({ access_token: "ya29.x", expires_in: 60 }));
    await trocarCodigoPorToken(APP, "c", { agora: AGORA });
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("renovarToken", () => {
  it("usa grant_type de renovação e manda o refresh_token", async () => {
    vi.mocked(fetch).mockResolvedValue(respostaDoGoogle({ access_token: "ya29.novo", expires_in: 3600 }));
    await renovarToken(APP, "1//refresh-original", { agora: AGORA });
    const corpo = new URLSearchParams(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(corpo.get("grant_type")).toBe("refresh_token");
    expect(corpo.get("refresh_token")).toBe("1//refresh-original");
    // Renovação não manda redirect_uri: o Google recusa o parâmetro aqui.
    expect(corpo.get("redirect_uri")).toBeNull();
  });

  it("NÃO funde e NÃO inventa refresh_token — devolve o que veio", async () => {
    // Esta é a armadilha nº 1 de quem implementa isto do zero. A separação
    // existe justamente para obrigar quem persiste a passar por `fundirTokens`.
    vi.mocked(fetch).mockResolvedValue(respostaDoGoogle({ access_token: "ya29.novo", expires_in: 3600 }));
    const r = await renovarToken(APP, "1//refresh-original", { agora: AGORA });
    expect(r.ok && r.token.refresh_token).toBeNull();

    // E o caminho certo de quem grava, provado ao lado do errado:
    const antigo = {
      access_token: "ya29.velho",
      refresh_token: "1//refresh-original",
      scope: ["https://www.googleapis.com/auth/calendar.events"],
      token_type: "Bearer",
      expira_em: "2026-08-26T12:30:00.000Z",
    };
    expect(r.ok && fundirTokens(antigo, r.token).refresh_token).toBe("1//refresh-original");
  });

  it("`invalid_grant` na renovação é o sinal de que a pessoa revogou", async () => {
    vi.mocked(fetch).mockResolvedValue(respostaDoGoogle({ error: "invalid_grant" }, 400));
    const r = await renovarToken(APP, "1//morto", { agora: AGORA });
    expect(r).toMatchObject({ ok: false, motivo: "erro_do_google" });
  });
});
