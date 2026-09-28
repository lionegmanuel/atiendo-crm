/**
 * De quem é a agenda que acabou de ser autorizada, e em que fuso ela vive.
 *
 * As duas respostas saem da MESMA chamada, e as duas são obrigatórias por razões
 * diferentes: o e-mail é parte da chave única de `calendar_connections` (sem ele
 * não há como distinguir "reconectou a mesma conta" de "plugou uma segunda"), e
 * o fuso é o que a leitura de evento de dia inteiro exige, porque esse tipo de
 * evento chega do Google sem fuso nenhum.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { contaDaAgendaPrimaria } from "@/lib/agenda/google/calendarios";
import { classificarErroDoGoogle } from "@/lib/agenda/google/erros";

function resposta(corpo: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => corpo } as unknown as Response;
}

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("contaDaAgendaPrimaria", () => {
  it("tira o e-mail e o fuso do calendário primário, numa chamada só", async () => {
    // O id do calendário primário É o e-mail da conta — é por isso que não
    // pedimos os escopos de `userinfo`.
    vi.mocked(fetch).mockResolvedValue(
      resposta({ id: "ana@clinica.com.br", summary: "Ana", timeZone: "America/Sao_Paulo" }),
    );
    const r = await contaDaAgendaPrimaria("ya29.token");
    expect(r).toEqual({ ok: true, conta: { email: "ana@clinica.com.br", fuso: "America/Sao_Paulo" } });
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: "Bearer ya29.token",
    });
  });

  it("fuso ausente vira `null` em vez de string vazia", async () => {
    // `null` é "não sei"; string vazia passaria pelo `Intl` como fuso inválido e
    // levantaria RangeError na primeira leitura de dia inteiro.
    vi.mocked(fetch).mockResolvedValue(resposta({ id: "a@b.com" }));
    const r = await contaDaAgendaPrimaria("t");
    expect(r).toEqual({ ok: true, conta: { email: "a@b.com", fuso: null } });
  });

  it("sem `id` RECUSA — gravar com e-mail vazio faria duas contas colidirem", async () => {
    vi.mocked(fetch).mockResolvedValue(resposta({ summary: "sem id" }));
    const r = await contaDaAgendaPrimaria("t");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detalhe).toContain("sem `id`");
  });

  it("erro do Google volta CRU, para quem classifica poder lê-lo", async () => {
    // O corpo cru (`{ error: { code, errors[] } }`) é exatamente a forma que o
    // classificador aprendeu a ler depois da revisão fria. Passar só o status
    // perderia o motivo.
    const corpoCru = {
      error: { code: 403, message: "insufficient", errors: [{ reason: "insufficientPermissions" }] },
    };
    vi.mocked(fetch).mockResolvedValue(resposta(corpoCru, 403));
    const r = await contaDaAgendaPrimaria("t");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(classificarErroDoGoogle(r.erro, "listar").desfecho).toBe("sem_permissao");
  });

  it("401 volta classificável como reconexão", async () => {
    vi.mocked(fetch).mockResolvedValue(resposta({ error: { code: 401, errors: [] } }, 401));
    const r = await contaDaAgendaPrimaria("t");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(classificarErroDoGoogle(r.erro, "listar").desfecho).toBe("reautenticar");
  });

  it("rede caída e corpo ilegível não lançam", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("fetch failed"));
    await expect(contaDaAgendaPrimaria("t")).resolves.toMatchObject({ ok: false });

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("nao e json");
      },
    } as unknown as Response);
    const r = await contaDaAgendaPrimaria("t");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detalhe).toContain("502");
  });
});
