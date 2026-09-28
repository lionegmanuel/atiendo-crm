/**
 * O CHIP E O PONTO DO FILTRO, na tela (issue #1271, fatia S6 da #852).
 *
 * ─── Por que montar com o provider de verdade ───────────────────────────────
 *
 * O chip não recebe a cor por prop: ele a busca no mapa da organização, lido uma
 * vez por tela (`components/tags/CoresDasEtiquetas.tsx`). Um teste que passasse a
 * cor na mão provaria só o CSS — e o que pode quebrar é a LIGAÇÃO: a rota errada,
 * a chave canônica errada, o mapa que não chega. Aqui o provider é montado com a
 * rota mockada, então o que se mede é o caminho inteiro.
 *
 * Fora do provider o chip sai CINZA (o contexto tem default vazio): é o estado
 * de antes da fatia, e é o que garante que um componente isolado — ou uma tela
 * que não é do produto — não quebre por causa de uma cor.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChipDeEtiqueta } from "@/components/tags/ChipDeEtiqueta";
import { PontoDaEtiqueta } from "@/components/tags/PontoDaEtiqueta";
import { ProvedorDeCoresDasEtiquetas } from "@/components/tags/CoresDasEtiquetas";

const get = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiClient: { get: (...args: unknown[]) => get(...args), post: vi.fn(), patch: vi.fn() },
}));
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({ activeOrg: { orgId: "org-1" } }),
}));

/** A cor serializada pode voltar como `rgb(...)` do jsdom. */
const pintado = (el: HTMLElement) => {
  const estilo = el.getAttribute("style") ?? "";
  return estilo.replace(/\s/g, "");
};

function montar(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProvedorDeCoresDasEtiquetas>{ui}</ProvedorDeCoresDasEtiquetas>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("ChipDeEtiqueta", () => {
  it("pinta a etiqueta quando o vocabulário tem cor para ela (caixa indiferente)", async () => {
    get.mockResolvedValue({ data: [{ tag: "vip", cor: "#0091ff" }] });
    montar(<ChipDeEtiqueta tag="VIP" />);

    // A rota é a da COR, não a do vocabulário pesado: trocar por
    // `/api/v1/conversation-tags` deixaria a suíte verde e o chip cinza em
    // produção (aquela rota devolve strings).
    await waitFor(() => expect(get).toHaveBeenCalledWith("/api/v1/tags/cores"));

    const chip = screen.getByText("VIP");
    await waitFor(() => expect(pintado(chip)).toContain("background-color"));
    // O texto sai da régua, não do gosto de quem escolheu: sobre #0091ff o preto
    // ganha (6,5 contra 3,0 do branco) — medido, e é por isso que este caso não
    // afirma "branco sobre azul" como o olho pediria.
    expect(pintado(chip)).toContain("color:rgb(0,0,0)");
  });

  it("o texto vira branco quando o fundo é escuro — a régua decide, não a lista", async () => {
    get.mockResolvedValue({ data: [{ tag: "vip", cor: "#3e63dd" }] });
    montar(<ChipDeEtiqueta tag="vip" />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    await waitFor(() => expect(pintado(screen.getByText("vip"))).toContain("background-color"));
    expect(pintado(screen.getByText("vip"))).toContain("color:rgb(255,255,255)");
  });

  it("etiqueta sem cor sai exatamente como saía antes: cinza, sem estilo inline", async () => {
    get.mockResolvedValue({ data: [{ tag: "vip", cor: "#0091ff" }] });
    montar(<ChipDeEtiqueta tag="obra" />);

    const chip = screen.getByText("obra");
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(chip.getAttribute("style")).toBeNull();
  });

  it("a cor por PROP vence o mapa — é o caso da lista da tela de Tags", async () => {
    // O painel leu o vocabulário do servidor: mostrar o que o cache do provider
    // diz seria a tela discordando de si mesma por alguns segundos.
    get.mockResolvedValue({ data: [] });
    montar(<ChipDeEtiqueta tag="obra" cor="#e54d2e" />);
    expect(pintado(screen.getByText("obra"))).toContain("background-color");
  });

  it("fora do provider o chip não quebra — só não tem cor", () => {
    render(<ChipDeEtiqueta tag="vip" />);
    expect(screen.getByText("vip").getAttribute("style")).toBeNull();
  });

  it("a falha da leitura não vira erro na tela: o chip fica cinza", async () => {
    get.mockRejectedValue(new Error("500"));
    montar(<ChipDeEtiqueta tag="vip" />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.getByText("vip").getAttribute("style")).toBeNull();
  });
});

describe("PontoDaEtiqueta (a opção do filtro)", () => {
  it("desenha o ponto na cor da etiqueta", async () => {
    get.mockResolvedValue({ data: [{ tag: "vip", cor: "#ffb224" }] });
    const { container } = montar(<PontoDaEtiqueta tag="vip" />);

    const ponto = await waitFor(() => {
      const el = container.querySelector("[data-ponto-da-etiqueta='vip']");
      if (!el) throw new Error("sem ponto ainda");
      return el as HTMLElement;
    });
    expect(pintado(ponto)).toContain("background-color");
  });

  it("sem cor, não desenha ponto nenhum — 'não escolhi' não vira 'escolhi cinza'", async () => {
    get.mockResolvedValue({ data: [] });
    const { container } = montar(<PontoDaEtiqueta tag="obra" />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(container.querySelector("[data-ponto-da-etiqueta]")).toBeNull();
  });
});
