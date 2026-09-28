/**
 * 0070 — regra de posse do negócio, fonte única de create/patch/bulk/MCP.
 *
 * A matriz inteira vive aqui porque o CHECK do banco aceita `owner_kind = null`:
 * um escritor que esquece o kind NÃO estoura, ele grava drift silencioso. Este
 * teste é o que transforma "silencioso" em "vermelho".
 */
import { describe, it, expect } from "vitest";

import { resolveOwnerPatch } from "./owner-patch";

describe("resolveOwnerPatch", () => {
  it("dono humano: preenche user, zera agente, kind='user'", () => {
    expect(resolveOwnerPatch({ owner_user_id: "u-1" })).toEqual({
      ok: true,
      patch: { owner_user_id: "u-1", owner_agent_id: null, owner_kind: "user" },
    });
  });

  it("dono agente: preenche agente, zera user, kind='ai'", () => {
    expect(resolveOwnerPatch({ owner_agent_id: "ag-1" })).toEqual({
      ok: true,
      patch: { owner_user_id: null, owner_agent_id: "ag-1", owner_kind: "ai" },
    });
  });

  it("troca de agente para humano zera o agente (senão: 23514)", () => {
    expect(resolveOwnerPatch({ owner_user_id: "u-1", owner_agent_id: undefined })).toEqual({
      ok: true,
      patch: { owner_user_id: "u-1", owner_agent_id: null, owner_kind: "user" },
    });
  });

  it("tirar o dono limpa os TRÊS campos", () => {
    for (const input of [{ owner_user_id: null }, { owner_agent_id: null }]) {
      expect(resolveOwnerPatch(input)).toEqual({
        ok: true,
        patch: { owner_user_id: null, owner_agent_id: null, owner_kind: null },
      });
    }
  });

  it("dois donos: recusa (422 no chamador), não deixa o banco decidir", () => {
    expect(resolveOwnerPatch({ owner_user_id: "u-1", owner_agent_id: "ag-1" })).toEqual({
      ok: false,
      reason: "two_owners",
    });
  });

  it("dono não mencionado: patch null — não toca nas colunas", () => {
    expect(resolveOwnerPatch({})).toEqual({ ok: true, patch: null });
    expect(resolveOwnerPatch({ owner_user_id: undefined, owner_agent_id: undefined })).toEqual({
      ok: true,
      patch: null,
    });
  });

  it("nunca devolve patch com dono e sem kind (o drift silencioso)", () => {
    const casos: Array<Parameters<typeof resolveOwnerPatch>[0]> = [
      { owner_user_id: "u-1" },
      { owner_agent_id: "ag-1" },
      { owner_user_id: null },
      { owner_agent_id: null },
      { owner_user_id: "u-1", owner_agent_id: null },
      { owner_agent_id: "ag-1", owner_user_id: null },
    ];
    for (const caso of casos) {
      const r = resolveOwnerPatch(caso);
      expect(r.ok).toBe(true);
      if (!r.ok || !r.patch) continue;
      const temDono = r.patch.owner_user_id !== null || r.patch.owner_agent_id !== null;
      expect(temDono).toBe(r.patch.owner_kind !== null);
      // E nunca os dois donos ao mesmo tempo.
      expect(r.patch.owner_user_id !== null && r.patch.owner_agent_id !== null).toBe(false);
    }
  });
});
