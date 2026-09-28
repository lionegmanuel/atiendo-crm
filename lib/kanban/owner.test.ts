/**
 * 0070 — resolução do dono do negócio (humano | agente | ninguém).
 * Fonte única do card, do filtro e (waves 5-7) do dossiê e do radar.
 */
import { describe, it, expect } from "vitest";

import { resolveLeadOwner } from "./owner";

const humans = new Map<string, string | null>([["u-1", "Maria Silva"]]);

const lead = (over: Partial<Parameters<typeof resolveLeadOwner>[0]>) => ({
  owner_kind: null,
  owner_user_id: null,
  owner_agent_id: null,
  owner_agent: null,
  ...over,
});

describe("resolveLeadOwner", () => {
  it("dono humano", () => {
    expect(
      resolveLeadOwner(lead({ owner_kind: "user", owner_user_id: "u-1" }), humans),
    ).toEqual({ kind: "user", name: "Maria Silva", agentVersion: null });
  });

  it("dono agente traz a versão publicada de hoje", () => {
    expect(
      resolveLeadOwner(
        lead({
          owner_kind: "ai",
          owner_agent_id: "ag-1",
          owner_agent: { id: "ag-1", name: "Agente Beta", version_number: 3 },
        }),
        humans,
      ),
    ).toEqual({ kind: "ai", name: "Agente Beta", agentVersion: 3 });
  });

  it("agente sem versão publicada não inventa versão", () => {
    expect(
      resolveLeadOwner(
        lead({
          owner_kind: "ai",
          owner_agent_id: "ag-2",
          owner_agent: { id: "ag-2", name: "Agente Sem Versão", version_number: null },
        }),
        humans,
      ),
    ).toEqual({ kind: "ai", name: "Agente Sem Versão", agentVersion: null });
  });

  // Regressão: o board resolve o dono SEM filtrar is_active/archived_at. Se
  // alguém voltar a resolver o nome pela lista de agentes atribuíveis (o
  // picker), este caso quebra — que é exatamente o ponto.
  it("lead de agente DESATIVADO continua exibindo nome e não vira '? Agente'", () => {
    expect(
      resolveLeadOwner(
        lead({
          owner_kind: "ai",
          owner_agent_id: "ag-off",
          owner_agent: { id: "ag-off", name: "Bot Aposentado", version_number: 9 },
        }),
        humans,
      ),
    ).toEqual({ kind: "ai", name: "Bot Aposentado", agentVersion: 9 });
  });

  it("sem dono", () => {
    expect(resolveLeadOwner(lead({}), humans)).toEqual({
      kind: null,
      name: null,
      agentVersion: null,
    });
  });

  it("dono cujo nome ainda não chegou continua sendo dono (não vira órfão)", () => {
    expect(
      resolveLeadOwner(lead({ owner_kind: "ai", owner_agent_id: "ag-?" }), humans),
    ).toEqual({ kind: "ai", name: null, agentVersion: null });
    expect(
      resolveLeadOwner(lead({ owner_kind: "user", owner_user_id: "u-99" }), humans),
    ).toEqual({ kind: "user", name: null, agentVersion: null });
  });

  it("banco pré-0070: owner_user_id sem owner_kind ainda mostra o humano", () => {
    expect(resolveLeadOwner(lead({ owner_user_id: "u-1" }), humans)).toEqual({
      kind: "user",
      name: "Maria Silva",
      agentVersion: null,
    });
  });

  it("mapa de humanos ausente não quebra a resolução", () => {
    expect(resolveLeadOwner(lead({ owner_user_id: "u-1" }), undefined)).toEqual({
      kind: "user",
      name: null,
      agentVersion: null,
    });
  });
});
