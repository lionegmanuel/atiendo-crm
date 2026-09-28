/**
 * O FLUXO DA COR NO PAINEL — montado, não lido (issue #1271, fatia S6 da #852).
 *
 * ─── O que este arquivo mede, e o que ele NÃO mede ──────────────────────────
 *
 * Mede o caminho do CLIQUE: abrir a cor de uma etiqueta, escolher um tom (ou
 * "sem cor"), confirmar, e o corpo que sai no POST. O que sai daqui é o contrato
 * com a rota: `acao: "definir_cor"` com `cor` normalizada e SEM `destino` — e o
 * schema recusa as duas trocas (`cor` fora da ação de cor, `destino` dentro
 * dela), então inverter isso reprova em dois lugares.
 *
 * Não mede o banco: isso é `tests/invariants/tags-cor-de-etiqueta.test.ts`, que
 * precisa de Postgres.
 *
 * ─── Por que o teste monta com QueryClientProvider ──────────────────────────
 *
 * O painel invalida o cache das cores depois de salvar (`useQueryClient`): é o
 * que faz o chip da lista de conversas repintar sem F5. Sem o provider, o hook
 * lança — o que é correto — e a tela de Tags é uma tela do app, onde ele existe.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LinhaDeVocabulario } from "@/lib/schemas/tags";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { PainelDeTags } from "@/app/app/settings/tags/_painel";

const VIP: LinhaDeVocabulario = {
  tag: "vip",
  uso_em_contatos: 3,
  uso_em_leads: 2,
  uso_em_conversas: 1,
  em_regras: 2,
  cor: null,
  descricao: null,
  no_vocabulario: true,
};
const OBRA: LinhaDeVocabulario = { ...VIP, tag: "obra", cor: "#0091ff", em_regras: 0 };

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PainelDeTags tags={[VIP, OBRA]} idioma="pt-BR" />
    </QueryClientProvider>,
  );
}

/** O corpo que o painel mandou no último POST. */
function corpoEnviado(): Record<string, unknown> {
  const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  const [, init] = fetchMock.mock.calls.at(-1) as [string, { body: string }];
  return JSON.parse(init.body) as Record<string, unknown>;
}

const pintado = (el: HTMLElement) => (el.getAttribute("style") ?? "").replace(/\s/g, "");

beforeEach(() => {
  toast.success.mockReset();
  toast.error.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ data: { alterou: true } }), { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("painel de Tags — a cor (issue #1271)", () => {
  it("⭐ escolher um tom manda `definir_cor` com a cor, sem destino", async () => {
    montar();

    // A fileira abre na etiqueta clicada — a PRIMEIRA linha é a sem cor.
    fireEvent.click(screen.getAllByRole("button", { name: "Cor" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Âmbar" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Cor da etiqueta atualizada."));
    expect(corpoEnviado()).toEqual({
      acao: "definir_cor",
      tag: "vip",
      destino: null,
      cor: "#ffb224",
    });
  });

  it("'Sem cor' manda `cor: null` — limpar é um pedido, não um campo esquecido", async () => {
    montar();

    // A segunda linha JÁ tem cor: abrir precisa marcar a cor atual, senão
    // confirmar sem escolher apagaria o que estava lá.
    fireEvent.click(screen.getAllByRole("button", { name: "Cor" })[1]!);
    expect(screen.getByRole("button", { name: "Azul" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Sem cor" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Cor da etiqueta atualizada."));
    expect(corpoEnviado()).toEqual({ acao: "definir_cor", tag: "obra", destino: null, cor: null });
  });

  it("a lista mostra a cor que veio do SERVIDOR e a prévia mostra o tom escolhido", async () => {
    montar();

    // A linha de "obra" chega com `cor` do servidor: pinta sem esperar nenhuma
    // leitura de cache (é a tela concordando com o dado que ela acabou de ler).
    const chipDaLista = screen.getAllByText("obra")[0]!;
    expect(pintado(chipDaLista)).toContain("background-color");

    fireEvent.click(screen.getAllByRole("button", { name: "Cor" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Roxo" }));

    // A prévia é o chip do próprio "vip" com o tom ESCOLHIDO: escolher por
    // paleta sem ver o resultado seria adivinhação.
    const previa = screen.getAllByText("vip").at(-1)!;
    await waitFor(() => expect(pintado(previa)).toContain("background-color"));
  });

  it("a recusa do servidor sai como erro em português, e não fecha o diálogo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { code: "validation_failed" } }), { status: 422 })),
    );
    montar();

    fireEvent.click(screen.getAllByRole("button", { name: "Cor" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Âmbar" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Confira a etiqueta, o novo nome e a cor."),
    );
    expect(toast.success).not.toHaveBeenCalled();
    // O diálogo continua aberto para tentar de novo.
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeTruthy();
  });
});
