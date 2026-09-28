/**
 * ARQUIVAR TEM DE ARQUIVAR — inclusive o agente legado.
 *
 * ─── O defeito ─────────────────────────────────────────────────────────────
 *
 * `archiveAgentAction` gravava `archived_at` e limpava `published_version_id`
 * só para `mcp_agent`. Para o `rag_bot` legado ela fazia apenas
 * `is_active = false`. As três consequências, todas medidas na fonte:
 *
 *   1. `archived_at` continua NULL, e a lista da tela filtra exatamente por ele
 *      (`app/api/v1/ai/agents/route.ts`): o agente "arquivado" não sai da lista;
 *   2. `deriveAgentStatus` cai no ramo `is_active ? "published" : "paused"` e
 *      mostra **Pausado** — a tela nomeia um estado que ninguém pediu;
 *   3. `published_version_id` fica de pé, e o dispatcher
 *      (`lib/ai/dispatcher/index.ts`) seleciona por `archived_at is null` +
 *      `published_version_id not null`, sem olhar `is_active` nem `kind`. Um
 *      agente com versão publicada segue recebendo conversas depois de
 *      "arquivado".
 *
 * E a auditoria registra `ai_agent.archived` nos dois casos — um registro que
 * afirma um arquivamento que não aconteceu.
 *
 * `is_active = false` continua sendo gravado para o legado, e não é redundante:
 * é o que o worker antigo consulta (`workers/ai-response-worker.ts`, filtro
 * `.eq("is_active", true)`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: vi.fn(async () => ({ id: "user-1", email: "u@example.com" })),
  resolveActiveOrg: vi.fn(async () => ({ orgId: ORG, name: "Org", role: "admin" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

const ORG = "22222222-2222-4222-8222-222222222222";
const AGENTE = "11111111-1111-4111-8111-111111111111";

let updatePayload: Record<string, unknown> | null = null;

function adminStub(agente: { kind: string; is_default: boolean; archived_at: string | null }) {
  const chainUpdate = {
    eq: () => chainUpdate,
    then: (r: (v: { error: null }) => unknown) => r({ error: null }),
  };
  const chainSelect: Record<string, unknown> = {
    eq: () => chainSelect,
    maybeSingle: async () => ({ data: { id: AGENTE, ...agente }, error: null }),
  };
  return {
    from: () => ({
      // Encadeável SEM LIMITE, como o dublê do UPDATE logo abaixo — e não é
      // estilo. Um dublê que fixa a QUANTIDADE de `.eq()` quebra no dia em que a
      // consulta ganhar um filtro novo, com "maybeSingle is not a function":
      // um erro que não fala nada do comportamento que este arquivo vigia.
      // Já mordeu três vezes nesta casa nesta mesma rodada de triagem.
      select: () => chainSelect,
      update: (payload: Record<string, unknown>) => {
        updatePayload = payload;
        return chainUpdate;
      },
    }),
  };
}

describe("archiveAgentAction", () => {
  beforeEach(() => {
    updatePayload = null;
    vi.clearAllMocks();
  });

  it("arquiva o rag_bot legado de verdade: carimba a data e tira do ar", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      adminStub({ kind: "rag_bot", is_default: false, archived_at: null }) as never,
    );
    const { archiveAgentAction } = await import("@/app/app/ai/agents/_actions");
    const res = await archiveAgentAction(AGENTE);

    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(updatePayload, "nada foi gravado").not.toBeNull();
    expect(
      updatePayload?.archived_at,
      "sem archived_at o agente não sai da lista e a tela diz 'Pausado'",
    ).toEqual(expect.any(String));
    expect(
      updatePayload,
      "com published_version_id de pé o dispatcher continua entregando conversas a ele",
    ).toHaveProperty("published_version_id", null);
    expect(
      updatePayload,
      "o worker legado filtra is_active=true — sem isso ele continua respondendo",
    ).toHaveProperty("is_active", false);
  });

  it("arquiva o mcp_agent como antes", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      adminStub({ kind: "mcp_agent", is_default: false, archived_at: null }) as never,
    );
    const { archiveAgentAction } = await import("@/app/app/ai/agents/_actions");
    await archiveAgentAction(AGENTE);

    expect(updatePayload?.archived_at).toEqual(expect.any(String));
    expect(updatePayload).toHaveProperty("published_version_id", null);
  });

  it("recusa arquivar o agente padrão, em qualquer kind", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      adminStub({ kind: "rag_bot", is_default: true, archived_at: null }) as never,
    );
    const { archiveAgentAction } = await import("@/app/app/ai/agents/_actions");
    const res = await archiveAgentAction(AGENTE);
    expect(res.ok).toBe(false);
    expect(updatePayload, "gravou mesmo recusando").toBeNull();
  });
});
