import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/app/ai/agents/new",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

import { buildState } from "@/app/app/ai/agents/[id]/_components/AgentForm";
import { AgentForm } from "@/app/app/ai/agents/[id]/_components/AgentForm";

function renderizarEditorNovo() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AgentForm
        mode="create"
        credentials={[] as never}
        channelSessions={[] as never}
      />
    </QueryClientProvider>,
  );
}

describe("configuração de callbacks do editor de agentes", () => {
  it("abre versões legadas como habilitadas sem mexer nos fluxos normais", () => {
    const state = buildState({
      version: {
        followup: { enabled: true, flow_pointer_ids: ["flow-1"] },
      } as never,
      t: (text) => text,
    });

    expect(state.followup.callback_enabled).toBe(true);
    expect(state.followup.enabled).toBe(true);
    expect(state.followup.flow_pointer_ids).toEqual(["flow-1"]);
  });

  it("carrega callback_enabled=false sem desligar os fluxos normais", () => {
    const state = buildState({
      version: {
        followup: {
          enabled: true,
          flow_pointer_ids: ["flow-1"],
          callback_enabled: false,
        },
      } as never,
      t: (text) => text,
    });

    expect(state.followup.callback_enabled).toBe(false);
    expect(state.followup.enabled).toBe(true);
    expect(state.followup.flow_pointer_ids).toEqual(["flow-1"]);
  });

  it("expõe controles separados na tela de configuração", () => {
    renderizarEditorNovo();

    expect(
      screen.getByRole("switch", {
        name: "Permitir que o agente marque novos retornos por conta própria",
      }),
    ).toBeChecked();
    expect(
      screen.getByRole("switch", { name: "Habilitar gatilhos automáticos de follow-up" }),
    ).not.toBeChecked();
  });
});
