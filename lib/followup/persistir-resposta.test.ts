import { describe, expect, it } from "vitest";

import { interpolarDestino, recorteDaResposta } from "./persistir-resposta";

describe("recorteDaResposta", () => {
  it("trims and keeps short text", () => {
    expect(recorteDaResposta("  Ana  ")).toBe("Ana");
  });
});

describe("interpolarDestino", () => {
  it("substitui {{volta}} pela última volta do repeat", () => {
    const out = interpolarDestino(
      { kind: "lead_custom", key: "filho_{{volta}}_nome" },
      [{ node_id: "rp", idempotency_key: "rp:0", payload: { repeat_index: 2, repeat_total: 3 } }],
    );
    expect(out).toEqual({ kind: "lead_custom", key: "filho_2_nome" });
  });

  it("nome do contato não muda", () => {
    expect(interpolarDestino({ kind: "contact_name" }, [])).toEqual({ kind: "contact_name" });
  });
});
