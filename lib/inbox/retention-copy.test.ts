import { describe, expect, it } from "vitest";
import { retentionCopy, type RetentionContext } from "./retention-copy";

const ctx: RetentionContext = {
  window_start_hour: 8,
  window_end_hour: 21,
  allow_sunday: false,
  timezone: "America/Sao_Paulo",
};

describe("retentionCopy — tradução leiga dos vetos before_send", () => {
  it("classifica pacing/spinning como proteção e interpola a janela", () => {
    const r = retentionCopy("outside_window", ctx);
    expect(r.kind).toBe("protection");
    expect(r.description).toContain("8h–21h");
    expect(r.description).toContain("sem domingo");
    expect(retentionCopy("mass_identical", ctx).kind).toBe("protection");
  });

  it("classifica stop/LGPD como conformidade", () => {
    expect(retentionCopy("contato_bloqueado", ctx).kind).toBe("compliance");
    expect(retentionCopy("lgpd_anonymized", ctx).kind).toBe("compliance");
    expect(retentionCopy("lgpd_missing_legal_basis", ctx).kind).toBe("compliance");
  });

  it("classifica promise/disclosure como qualidade", () => {
    expect(retentionCopy("promise_out_of_table", ctx).kind).toBe("quality");
    expect(retentionCopy("promise_semantic", ctx).kind).toBe("quality");
    expect(retentionCopy("disclosure_required", ctx).kind).toBe("quality");
  });

  it("código desconhecido ou null cai no fallback de proteção sem quebrar", () => {
    expect(retentionCopy(null, ctx).kind).toBe("protection");
    const unknown = retentionCopy("gate_novo_do_engine", ctx);
    expect(unknown.kind).toBe("protection");
    expect(unknown.description).toContain("gate_novo_do_engine");
  });

  it("respeita allow_sunday=true na copy da janela", () => {
    const r = retentionCopy("outside_window", { ...ctx, allow_sunday: true });
    expect(r.description).not.toContain("sem domingo");
  });
});
