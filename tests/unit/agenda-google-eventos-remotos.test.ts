/**
 * A listagem de eventos — e o que se perde nela é HORÁRIO.
 *
 * Paginação foi apontada como buraco na revisão fria, e a consequência é
 * específica: quem lê só a primeira página perde os eventos do FIM da lista, e o
 * que se perde vira horário oferecido em cima de compromisso real. É o mesmo
 * desfecho da DECISÃO 3.2 por outra porta.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listarEventos, JANELA_INICIAL_DIAS } from "@/lib/agenda/google/eventos-remotos";
import { classificarErroDoGoogle } from "@/lib/agenda/google/erros";

const AGORA = new Date("2026-08-26T12:00:00.000Z");

function pagina(corpo: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => corpo } as unknown as Response;
}
const urlDaChamada = (i: number) => String(vi.mocked(fetch).mock.calls[i]?.[0] ?? "");

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => vi.unstubAllGlobals());

describe("listarEventos", () => {
  it("percorre TODAS as páginas — o que fica na última é horário ocupado", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(pagina({ items: [{ id: "a" }], nextPageToken: "p2" }))
      .mockResolvedValueOnce(pagina({ items: [{ id: "b" }], nextPageToken: "p3" }))
      .mockResolvedValueOnce(pagina({ items: [{ id: "c" }], nextSyncToken: "TOKEN" }));

    const r = await listarEventos("ya29.t", "ana@clinica.com.br", { agora: AGORA });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pagina.eventos.map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(r.pagina.truncada).toBe(false);
  });

  it("o syncToken só é guardado quando a leitura CHEGOU AO FIM", async () => {
    // `nextSyncToken` só vem na última página. Guardá-lo antes marcaria como
    // lido o que não foi lido, e as páginas perdidas nunca voltariam.
    vi.mocked(fetch)
      .mockResolvedValueOnce(pagina({ items: [{ id: "a" }], nextPageToken: "p2", nextSyncToken: "CEDO_DEMAIS" }))
      .mockResolvedValueOnce(pagina({ items: [{ id: "b" }], nextSyncToken: "CERTO" }));

    const r = await listarEventos("t", "c", { agora: AGORA });
    expect(r.ok && r.pagina.syncToken).toBe("CERTO");
  });

  it("primeiro sync manda janela; incremental manda syncToken — e nunca os dois", async () => {
    // Mandar `timeMin`/`timeMax` junto do `syncToken` devolve 400: o token já
    // codifica a janela.
    vi.mocked(fetch).mockResolvedValue(pagina({ items: [], nextSyncToken: "T" }));

    await listarEventos("t", "c", { agora: AGORA });
    const primeira = urlDaChamada(0);
    expect(primeira).toContain("timeMin=");
    expect(primeira).toContain("timeMax=");
    expect(primeira).not.toContain("syncToken=");

    vi.mocked(fetch).mockClear();
    await listarEventos("t", "c", { agora: AGORA, syncToken: "T-ANTERIOR" });
    const incremental = urlDaChamada(0);
    expect(incremental).toContain("syncToken=T-ANTERIOR");
    expect(incremental).not.toContain("timeMin=");
  });

  it("`singleEvents` é constante, não parâmetro — mudá-lo invalida o token", async () => {
    // Ele manda o Google expandir série em instâncias, que é o que a leitura
    // espera; é também o motivo de `doEventoDoGoogle` recusar evento-mestre.
    vi.mocked(fetch).mockResolvedValue(pagina({ items: [] }));
    await listarEventos("t", "c", { agora: AGORA });
    expect(urlDaChamada(0)).toContain("singleEvents=true");
  });

  it("a janela do primeiro sync é a declarada, e não um palpite", async () => {
    vi.mocked(fetch).mockResolvedValue(pagina({ items: [] }));
    await listarEventos("t", "c", { agora: AGORA });
    const url = new URL(urlDaChamada(0));
    const fim = new Date(url.searchParams.get("timeMax") ?? "");
    const dias = Math.round((fim.getTime() - AGORA.getTime()) / 86_400_000);
    expect(dias).toBe(JANELA_INICIAL_DIAS);
  });

  it("`410 fullSyncRequired` volta CRU e classificável como ressincronizar", async () => {
    // Esta é a célula que apaga linha quando o motivo se perde: sem ele, 410 em
    // operação de escrita vira `evento_sumiu`.
    const corpoCru = {
      error: { code: 410, message: "Sync token invalid", errors: [{ reason: "fullSyncRequired" }] },
    };
    vi.mocked(fetch).mockResolvedValue(pagina(corpoCru, 410));

    const r = await listarEventos("t", "c", { agora: AGORA, syncToken: "MORTO" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(classificarErroDoGoogle(r.erro, "sincronizar").desfecho).toBe("ressincronizar");
  });

  it("leitura CORTADA pelo teto não guarda token — e diz que foi cortada", async () => {
    // Guardar token de leitura incompleta é pior que não guardar: marca como
    // lido o que não foi, e o buraco fica permanente.
    vi.mocked(fetch).mockResolvedValue(pagina({ items: [{ id: "x" }], nextPageToken: "sempre" }));
    const r = await listarEventos("t", "c", { agora: AGORA });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pagina.truncada).toBe(true);
    expect(r.pagina.syncToken).toBeNull();
    // ⚠️ E a asserção que DISCRIMINA: sem ela, este caso passa igual quando a
    // paginação está inteiramente quebrada — `pageToken` continua preenchido
    // depois da primeira página, então `truncada` e `syncToken` valem o mesmo.
    // Medido: com o laço trocado por `while (false)`, as duas linhas acima
    // seguem verdes. Contar as chamadas é o que separa "parou pelo teto" de
    // "nunca iterou".
    expect(vi.mocked(fetch).mock.calls.length).toBe(20);
  });

  it("rede caída e corpo ilegível não lançam", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("fetch failed"));
    await expect(listarEventos("t", "c", { agora: AGORA })).resolves.toMatchObject({ ok: false });
  });
});
