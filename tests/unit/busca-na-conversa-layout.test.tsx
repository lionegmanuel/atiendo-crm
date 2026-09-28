import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RefObject } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O CAMPO DA BUSCA NA CONVERSA (extraída do PR #1793): quem abre, quem fecha e
 * para onde o foco volta.
 *
 * O cabeçalho e o fio são SONDAS: o cabeçalho expõe o botão com o ref que o
 * layout lhe dá, e o fio publica o termo que recebeu. O que se mede é o layout:
 * o campo tem rótulo, o termo chega ao fio, Esc fecha e devolve o foco ao botão,
 * e trocar de conversa — por clique OU pelo voltar do navegador — fecha a busca.
 */

const { ORG, CONV_A, CONV_B, linha } = vi.hoisted(() => {
  const ORG = "00000000-0000-4000-8000-0000000005aa";
  const CONV_A = "00000000-0000-4000-8000-0000000005a1";
  const CONV_B = "00000000-0000-4000-8000-0000000005b1";
  const linha = (id: string) => ({
    id,
    organization_id: ORG,
    contact_id: `${id.slice(0, -2)}c1`,
    status: "open",
    tags: [],
    contacts: { id: `${id.slice(0, -2)}c1`, display_name: id, name: null, phone_number: "+5511900000000", tags: [] },
  });
  return { ORG, CONV_A, CONV_B, linha };
});

const get = vi.fn(async (bruta?: string): Promise<unknown> => {
  const url = bruta ?? "";
  if (url.startsWith("/api/v1/conversations?")) return new Promise(() => {});
  if (url === `/api/v1/conversations/${CONV_A}`) return { data: linha(CONV_A) };
  if (url === `/api/v1/conversations/${CONV_B}`) return { data: linha(CONV_B) };
  if (url === "/api/v1/ai/automatico-ativo") return { data: { ativo: false } };
  return { data: [] };
});

vi.mock("@/lib/api/client", () => ({ apiClient: { get: (url: string) => get(url) } }));
const LISTA = { data: { pages: [{ data: [linha(CONV_A), linha(CONV_B)] }] }, realtimeStatus: "ok" };
vi.mock("@/hooks/inbox/useConversationsRealtime", () => ({ useConversationsRealtime: () => LISTA }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));
vi.mock("@/lib/supabase/browser", () => ({
  prepareRealtimeAuthentication: vi.fn().mockResolvedValue(undefined),
  createClient: () => ({
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: () => {},
  }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/app/inbox",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: "admin" }, activeOrg: { orgId: ORG } }),
  usePermission: () => true,
}));
vi.mock("@/hooks/inbox/useMarkAsRead", () => ({ useMarkAsRead: () => undefined }));
vi.mock("@/hooks/inbox/useClaimConversation", () => ({
  useClaimConversation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/inbox/useCloseConversation", () => ({
  useCloseConversation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/components/inbox/CRMSidePanel", () => ({ CRMSidePanel: () => null }));
vi.mock("@/components/inbox/ConversationList", () => ({
  ConversationList: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <>
      <button onClick={() => onSelect(CONV_A)}>Abrir A</button>
      <button onClick={() => onSelect(CONV_B)}>Abrir B</button>
    </>
  ),
}));
vi.mock("@/components/inbox/InboxFilters", () => ({ InboxFilters: () => null }));
vi.mock("@/components/inbox/ChatThread", () => ({
  ChatThread: ({ conversationId, searchTerm = "" }: { conversationId: string; searchTerm?: string }) => (
    <div data-testid="fio" data-conversa={conversationId} data-termo={searchTerm} />
  ),
}));
vi.mock("@/components/inbox/Composer", () => ({ Composer: () => null }));
vi.mock("@/components/inbox/ConversationHeader", () => ({
  ConversationHeader: ({
    onBuscar,
    buscaAberta,
    botaoBuscaRef,
  }: {
    onBuscar?: () => void;
    buscaAberta?: boolean;
    botaoBuscaRef?: RefObject<HTMLButtonElement | null>;
  }) => (
    <button ref={botaoBuscaRef} onClick={onBuscar} aria-expanded={buscaAberta}>
      Buscar nesta conversa
    </button>
  ),
}));
vi.mock("@/components/inbox/RetentionNotice", () => ({ RetentionNotice: () => null }));
vi.mock("@/components/inbox/InboxKeyboardShortcuts", () => ({ InboxKeyboardShortcuts: () => null }));
vi.mock("@/components/inbox/ShortcutsHelpDialog", () => ({ ShortcutsHelpDialog: () => null }));
vi.mock("@/components/inbox/JanelaFechadaAviso", () => ({ JanelaFechadaAviso: () => null }));

import { InboxLayout } from "@/components/inbox/InboxLayout";

const CAMPO = "Buscar nas mensagens carregadas";

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const arvore = () => (
    <QueryClientProvider client={qc}>
      <InboxLayout initialSelectedId={CONV_A} />
    </QueryClientProvider>
  );
  const r = render(arvore());
  // O `useSearchParams` da sonda lê a URL a cada render: re-renderizar depois de
  // mudar a URL é o que o Next faz no voltar do navegador.
  return { renderDeNovo: () => r.rerender(arvore()) };
}

async function abrirBusca() {
  const botao = await screen.findByRole("button", { name: "Buscar nesta conversa" });
  fireEvent.click(botao);
  return { botao, campo: screen.getByRole("searchbox", { name: CAMPO }) };
}

describe("busca dentro da conversa: o campo", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", `/app/inbox?id=${CONV_A}`);
  });

  it("abre com rótulo e foco, o termo chega ao fio, e Esc fecha devolvendo o foco ao botão", async () => {
    montar();
    expect(screen.queryByRole("searchbox")).toBeNull();

    const { botao, campo } = await abrirBusca();
    expect(botao).toHaveAttribute("aria-expanded", "true");
    expect(campo).toHaveFocus();

    fireEvent.change(campo, { target: { value: "boleto" } });
    expect(screen.getByTestId("fio")).toHaveAttribute("data-termo", "boleto");

    fireEvent.keyDown(campo, { key: "Escape" });
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.getByTestId("fio")).toHaveAttribute("data-termo", "");
    expect(botao).toHaveAttribute("aria-expanded", "false");
    expect(botao).toHaveFocus();
  });

  it("o botão de fechar limpa o termo; reabrir começa vazio", async () => {
    montar();
    const { campo } = await abrirBusca();
    fireEvent.change(campo, { target: { value: "pix" } });
    fireEvent.click(screen.getByRole("button", { name: "Fechar busca" }));
    expect(screen.getByTestId("fio")).toHaveAttribute("data-termo", "");

    const { campo: denovo } = await abrirBusca();
    expect(denovo).toHaveValue("");
  });

  it("trocar de conversa por clique fecha a busca", async () => {
    montar();
    const { campo } = await abrirBusca();
    fireEvent.change(campo, { target: { value: "boleto" } });

    fireEvent.click(screen.getByRole("button", { name: "Abrir B" }));
    await waitFor(() => expect(screen.getByTestId("fio")).toHaveAttribute("data-conversa", CONV_B));
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.getByTestId("fio")).toHaveAttribute("data-termo", "");
  });

  it("trocar de conversa pelo voltar do navegador também fecha a busca", async () => {
    const { renderDeNovo } = montar();
    fireEvent.click(await screen.findByRole("button", { name: "Abrir B" }));
    await waitFor(() => expect(screen.getByTestId("fio")).toHaveAttribute("data-conversa", CONV_B));
    const { campo } = await abrirBusca();
    fireEvent.change(campo, { target: { value: "boleto" } });

    act(() => {
      window.history.replaceState(null, "", `/app/inbox?id=${CONV_A}`);
      renderDeNovo();
    });
    await waitFor(() => expect(screen.getByTestId("fio")).toHaveAttribute("data-conversa", CONV_A));
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.getByTestId("fio")).toHaveAttribute("data-termo", "");
  });
});
