import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useUpdateConversationTags } from "@/hooks/inbox/useConversationTags";

/**
 * O filtro por marcador do Inbox (`InboxFilters`) e as sugestões do editor da
 * conversa leem `["conversation-tag-vocabulary"]` com `staleTime` de 5 minutos.
 * Gravar uma tag na conversa MUDA esse vocabulário, então quem grava precisa
 * mandar relê-lo. Sem isto, o marcador recém-criado só aparecia no seletor do
 * filtro depois de recarregar a página. É o espelho do lado do contato
 * (`tags-do-contato-vocabulario-releitura.test.tsx`, #852), que já relia.
 */

const patch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", () => ({ apiClient: { patch } }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));

const CONVERSA = "conv-1";
let qc: QueryClient;
let invalidadas: unknown[][];

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  patch.mockReset();
  patch.mockResolvedValue({ data: { id: CONVERSA, tags: ["retorno"] } });
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  invalidadas = [];
  vi.spyOn(qc, "invalidateQueries").mockImplementation((filtro) => {
    invalidadas.push((filtro as { queryKey: unknown[] }).queryKey);
    return Promise.resolve();
  });
});

describe("useUpdateConversationTags", () => {
  it("manda reler o vocabulário de tags da conversa depois de gravar", async () => {
    const { result } = renderHook(() => useUpdateConversationTags(), { wrapper });

    await act(() => result.current.mutateAsync({ conversation_id: CONVERSA, tags: ["retorno"] }));

    // Prefixo, sem o orgId: a chave real é ["conversation-tag-vocabulary", orgId].
    expect(invalidadas).toContainEqual(["conversation-tag-vocabulary"]);
  });

  it("segue invalidando a lista e a conversa", async () => {
    const { result } = renderHook(() => useUpdateConversationTags(), { wrapper });

    await act(() => result.current.mutateAsync({ conversation_id: CONVERSA, tags: ["retorno"] }));

    expect(invalidadas).toContainEqual(["conversations"]);
    expect(invalidadas).toContainEqual(["conversation", CONVERSA]);
  });
});
