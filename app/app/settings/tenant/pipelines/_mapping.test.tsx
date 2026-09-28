/**
 * A tela do funil do agente — o que ela OFERECE e o que ela ENVIA.
 *
 * Estes testes cobrem as três decisões que só existem aqui, na tela: transformar
 * a recusa do banco em ausência de opção, mandar sempre os sete passos (com
 * `null` explícito), e reler o servidor depois de qualquer erro em vez de deixar
 * o usuário reenviar sobre um funil que mudou embaixo dele.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ApiError } from "@/lib/api/types";
import type { LeadStage } from "@/lib/agent-engine/agent/lead-state";
import type { EstadoDoMapeamento, EtapaDoFunil } from "@/hooks/pipelines/useAgentMapping";

vi.mock("@/lib/api/client", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import { apiClient } from "@/lib/api/client";
import { toast } from "sonner";
import {
  AgentMappingSection,
  conserteNasEtapas,
  opcoesDoPasso,
  motivoDaListaVazia,
  mensagemDeErro,
} from "./_mapping";

// Polyfills que o Radix Select exige e o jsdom não tem.
window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
window.HTMLElement.prototype.setPointerCapture = vi.fn();
window.HTMLElement.prototype.releasePointerCapture = vi.fn();
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const PIPE = "11111111-1111-4111-8111-111111111111";

const ETAPAS = [
  { id: "e1", name: "Carrinho abandonado", is_won: false, is_lost: false },
  { id: "e2", name: "Aguardando pagamento", is_won: false, is_lost: false },
  { id: "e3", name: "Pago", is_won: true, is_lost: false },
  { id: "e4", name: "Cancelado", is_won: false, is_lost: true },
];

const VAZIO = {
  new: null,
  contacted: null,
  qualifying: null,
  qualified: null,
  negotiating: null,
  won: null,
  lost: null,
};

function estado(over: Partial<EstadoDoMapeamento["mapeamento"]> = {}): EstadoDoMapeamento {
  return { etapas: ETAPAS, mapeamento: { ...VAZIO, ...over } };
}

function montar() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AgentMappingSection pipelineId={PIPE} ancoraEtapas={`etapas-${PIPE}`} />
    </QueryClientProvider>,
  );
}

/** Abre o seletor de um passo e devolve os textos das opções oferecidas. */
async function opcoesNaTela(user: ReturnType<typeof userEvent.setup>, passo: string) {
  await user.click(screen.getByTestId(`etapa-${passo}`));
  const lista = await screen.findByRole("listbox");
  return within(lista)
    .getAllByRole("option")
    .map((o) => o.textContent);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiClient.get).mockResolvedValue({ data: estado() });
});

describe("opcoesDoPasso — a recusa do banco vira ausência de opção", () => {
  it("etapa já escolhida por outro passo some das demais listas", () => {
    const mapa = { ...VAZIO, contacted: "e1" };
    expect(opcoesDoPasso("qualifying", ETAPAS, mapa).map((e) => e.id)).toEqual(["e2"]);
    // …e continua na lista do passo que a escolheu, senão o seletor ficaria sem
    // rótulo para o próprio valor.
    expect(opcoesDoPasso("contacted", ETAPAS, mapa).map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("desfazer a escolha devolve a etapa às outras listas", () => {
    expect(opcoesDoPasso("qualifying", ETAPAS, { ...VAZIO, contacted: "e1" }).map((e) => e.id))
      .toEqual(["e2"]);
    expect(opcoesDoPasso("qualifying", ETAPAS, VAZIO).map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("«Ganho» só oferece etapa de fechamento; «Perdido» só a de perda", () => {
    expect(opcoesDoPasso("won", ETAPAS, VAZIO).map((e) => e.id)).toEqual(["e3"]);
    expect(opcoesDoPasso("lost", ETAPAS, VAZIO).map((e) => e.id)).toEqual(["e4"]);
  });

  it("os outros cinco passos NUNCA oferecem a etapa de ganho nem a de perda", () => {
    // O CHECK da 0084 vale nos dois sentidos: etapa de ganho só representa
    // «Ganho». Oferecê-la aqui deixaria o usuário escolher para receber um 422.
    for (const passo of ["new", "contacted", "qualifying", "qualified", "negotiating"] as const) {
      expect(opcoesDoPasso(passo, ETAPAS, VAZIO).map((e) => e.id)).toEqual(["e1", "e2"]);
    }
  });

  it("mantém a ordem do funil que o servidor mandou, sem reordenar", () => {
    const embaralhado = [ETAPAS[2]!, ETAPAS[1]!, ETAPAS[0]!, ETAPAS[3]!];
    expect(opcoesDoPasso("new", embaralhado, VAZIO).map((e) => e.id)).toEqual(["e2", "e1"]);
  });
});

describe("motivoDaListaVazia — lista vazia sempre explica por quê", () => {
  it("funil sem etapa de fechamento explica o fato, sem prometer tela que não existe", () => {
    const t = motivoDaListaVazia("won", [ETAPAS[0]!, ETAPAS[3]!]);
    expect(t).toContain("nenhuma etapa marcada como fechamento");
    expect(t).not.toContain("já estão sendo usadas");
  });

  it("etapas todas em uso diz que dá para liberar uma — sem apontar direção", () => {
    const t = motivoDaListaVazia("qualifying", ETAPAS);
    expect(t).toContain("já estão sendo usadas");
    // O passo que segura a etapa pode estar em qualquer linha, inclusive abaixo.
    expect(t).not.toContain("acima");
  });

  it("funil só com ganho e perda NÃO manda liberar uma etapa que não existe", () => {
    // A assimetria que já estava resolvida para won/lost: "já estão em uso" é
    // afirmação, e aqui não há nenhuma etapa comum para estar em uso.
    const t = motivoDaListaVazia("qualifying", [ETAPAS[2]!, ETAPAS[3]!]);
    expect(t).not.toContain("já estão sendo usadas");
    expect(t).toContain("só tem etapas de fechamento e de perda");
  });

  /**
   * ⭐ O LINK PRECISA CONCORDAR COM O TEXTO. `conserteNasEtapas` decide se a tela
   * mostra «Ir para as etapas do funil»; se ela divergir do primeiro ramo de
   * `motivoDaListaVazia`, o usuário lê "libere uma etapa aqui" e recebe um link
   * para outra seção — ou lê "não existe etapa de fechamento" e não recebe link
   * nenhum. As duas nascem do mesmo `serveParaOPasso` de propósito; isto é o
   * alarme se alguém separá-las.
   */
  it("o link para as etapas aparece exatamente quando o conserto NÃO é aqui", () => {
    const casos: Array<[LeadStage, EtapaDoFunil[]]> = [
      ["won", [ETAPAS[0]!, ETAPAS[3]!]],
      ["lost", [ETAPAS[0]!, ETAPAS[2]!]],
      ["qualifying", ETAPAS],
      ["qualifying", [ETAPAS[2]!, ETAPAS[3]!]],
      ["won", ETAPAS],
    ];
    for (const [passo, etapas] of casos) {
      const ehOcupacao = motivoDaListaVazia(passo, etapas).includes("já estão sendo usadas");
      expect(conserteNasEtapas(passo, etapas)).toBe(!ehOcupacao);
    }
  });
});

describe("mensagemDeErro — nem toda frase do servidor é texto de tela", () => {
  it("recusa de regra (409/422) chega inteira ao usuário", () => {
    const m = mensagemDeErro(
      new ApiError(409, "state_conflict", undefined, "r", "A etapa «Pago» mudou de papel."),
    );
    expect(m).toBe("A etapa «Pago» mudou de papel.");
  });

  it("500 NÃO vaza texto do Postgres em inglês", () => {
    const cru = 'new row for relation "crm_stages" violates check constraint';
    const m = mensagemDeErro(new ApiError(500, "internal_error", undefined, "r", cru));
    expect(m).not.toContain("violates");
    expect(m).not.toContain("crm_stages");
    expect(m).toContain("Não deu para salvar");
  });

  it("403 NÃO mostra a palavra «role» ao dono da clínica", () => {
    const m = mensagemDeErro(
      new ApiError(403, "forbidden_role", undefined, "r", "Permissão insuficiente. Requer role >= manager."),
    );
    expect(m).not.toContain("role");
    expect(m).toContain("permissão");
  });

  it("401 explica a sessão em vez de repetir «Auth required.»", () => {
    const m = mensagemDeErro(new ApiError(401, "auth_required", undefined, "r", "Auth required."));
    expect(m).not.toContain("Auth required");
    expect(m).toContain("sessão");
  });
});

describe("AgentMappingSection — o que a tela oferece e envia", () => {
  it("«não mover» é a escolha inicial e não é apresentado como erro", async () => {
    montar();
    expect(await screen.findByTestId("etapa-new")).toHaveTextContent("Não mover o card");
    expect(screen.getByText(/Deixar em «não mover» é uma escolha válida/)).toBeInTheDocument();
    expect(screen.queryByTestId("mapeamento-erro")).not.toBeInTheDocument();
    // Nada a salvar enquanto o usuário não mexeu.
    expect(screen.getByTestId("salvar-mapeamento")).toBeDisabled();
  });

  it("etapa escolhida some das outras listas e volta quando desfeita", async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByTestId("etapa-new");

    expect(await opcoesNaTela(user, "qualifying")).toEqual([
      "Não mover o card",
      "Carrinho abandonado",
      "Aguardando pagamento",
    ]);
    await user.keyboard("{Escape}");

    await user.click(screen.getByTestId("etapa-new"));
    await user.click(await screen.findByRole("option", { name: "Carrinho abandonado" }));

    expect(await opcoesNaTela(user, "qualifying")).toEqual([
      "Não mover o card",
      "Aguardando pagamento",
    ]);
    await user.keyboard("{Escape}");

    await user.click(screen.getByTestId("etapa-new"));
    await user.click(await screen.findByRole("option", { name: "Não mover o card" }));

    expect(await opcoesNaTela(user, "qualifying")).toEqual([
      "Não mover o card",
      "Carrinho abandonado",
      "Aguardando pagamento",
    ]);
  });

  it("«Ganho» não oferece etapa comum — só a de fechamento", async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByTestId("etapa-won");
    expect(await opcoesNaTela(user, "won")).toEqual(["Não mover o card", "Pago"]);
  });

  it("salva os SETE passos, com null explícito no que ficou sem etapa", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.put).mockResolvedValue({ data: estado({ new: "e1" }) });
    montar();
    await screen.findByTestId("etapa-new");

    await user.click(screen.getByTestId("etapa-new"));
    await user.click(await screen.findByRole("option", { name: "Carrinho abandonado" }));
    await user.click(screen.getByTestId("salvar-mapeamento"));

    await waitFor(() => expect(apiClient.put).toHaveBeenCalledTimes(1));
    const [rota, corpo] = vi.mocked(apiClient.put).mock.calls[0]!;
    expect(rota).toBe(`/api/v1/pipelines/${PIPE}/agent-mapping`);
    expect(corpo).toEqual({
      mapeamento: {
        new: "e1",
        contacted: null,
        qualifying: null,
        qualified: null,
        negotiating: null,
        won: null,
        lost: null,
      },
    });
    // Confirmação no mesmo canal do resto da tela (o editor de vocabulário, a
    // 200px daqui, também usa toast) — não em texto cinza só desta seção.
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Escolhas salvas."));
  });

  it("erro 500 não vira toast de sucesso nem texto cru do Postgres na tela", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.put).mockRejectedValue(
      new ApiError(500, "internal_error", undefined, "r", 'violates check constraint "crm_stages_hint"'),
    );
    montar();
    await screen.findByTestId("etapa-new");
    await user.click(screen.getByTestId("etapa-new"));
    await user.click(await screen.findByRole("option", { name: "Carrinho abandonado" }));
    await user.click(screen.getByTestId("salvar-mapeamento"));

    const aviso = await screen.findByTestId("mapeamento-erro");
    expect(aviso).not.toHaveTextContent("violates");
    expect(aviso).toHaveTextContent("Não deu para salvar");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("depois de um erro, RELÊ o servidor e o rascunho vira o que está gravado", async () => {
    const user = userEvent.setup();
    // Enquanto o usuário editava, outra pessoa mapeou «Novo lead» para outra
    // etapa. Se a tela mantivesse o rascunho, o segundo envio gravaria por cima.
    vi.mocked(apiClient.put).mockRejectedValue(
      new ApiError(409, "state_conflict", undefined, "req-1", "A etapa «Pago» mudou de papel."),
    );
    montar();
    await screen.findByTestId("etapa-new");

    await user.click(screen.getByTestId("etapa-new"));
    await user.click(await screen.findByRole("option", { name: "Carrinho abandonado" }));
    expect(screen.getByTestId("etapa-new")).toHaveTextContent("Carrinho abandonado");

    vi.mocked(apiClient.get).mockResolvedValue({ data: estado({ new: "e2" }) });
    await user.click(screen.getByTestId("salvar-mapeamento"));

    // A mensagem do servidor chega inteira ao usuário (é ela que ensina o quê fazer).
    expect(await screen.findByTestId("mapeamento-erro")).toHaveTextContent(
      "A etapa «Pago» mudou de papel.",
    );
    await waitFor(() =>
      expect(screen.getByTestId("etapa-new")).toHaveTextContent("Aguardando pagamento"),
    );
    expect(apiClient.get).toHaveBeenCalledTimes(2);
    // E não dá para reenviar às cegas: o rascunho é igual ao servidor de novo.
    expect(screen.getByTestId("salvar-mapeamento")).toBeDisabled();
  });
});
