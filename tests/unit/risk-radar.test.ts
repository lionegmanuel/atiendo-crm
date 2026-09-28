import { describe, it, expect } from "vitest";

import {
  classifyRisk,
  compareRisk,
  resolveStageWindow,
  RISK_COLD_HOURS,
  RISK_CRITICAL_HOURS,
} from "@/lib/leads/risk-radar";

const now = new Date("2026-07-24T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
// Janela global explícita: `window` é obrigatório justamente para que "usei o
// padrão" seja uma escolha visível na chamada, não um esquecimento.
const GLOBAL = resolveStageWindow(null);

describe("classifyRisk", () => {
  it("demanda fresca fica fora do radar", () => {
    const r = classifyRisk({ lastActivityAt: hoursAgo(2), now, inFlight: false, window: GLOBAL });
    expect(r.bucket).toBe("em_dia");
    expect(r.onRadar).toBe(false);
  });

  it("fria sem follow-up entre 24h e 72h é em_risco", () => {
    const r = classifyRisk({ lastActivityAt: hoursAgo(30), now, inFlight: false, window: GLOBAL });
    expect(r.bucket).toBe("em_risco");
    expect(r.onRadar).toBe(true);
  });

  it("muito fria sem follow-up é crítico", () => {
    const r = classifyRisk({ lastActivityAt: hoursAgo(100), now, inFlight: false, window: GLOBAL });
    expect(r.bucket).toBe("critico");
  });

  it("fria mas com follow-up agendado é em_voo (sistema mantém viva)", () => {
    const r = classifyRisk({ lastActivityAt: hoursAgo(100), now, inFlight: true, window: GLOBAL });
    expect(r.bucket).toBe("em_voo");
    expect(r.onRadar).toBe(true);
  });

  it("bordas das janelas", () => {
    expect(classifyRisk({ lastActivityAt: hoursAgo(RISK_COLD_HOURS), now, inFlight: false, window: GLOBAL }).bucket).toBe("em_risco");
    expect(classifyRisk({ lastActivityAt: hoursAgo(RISK_COLD_HOURS - 0.1), now, inFlight: false, window: GLOBAL }).bucket).toBe("em_dia");
    expect(classifyRisk({ lastActivityAt: hoursAgo(RISK_CRITICAL_HOURS), now, inFlight: false, window: GLOBAL }).bucket).toBe("critico");
  });
});

describe("compareRisk", () => {
  it("crítico vem antes de em_risco antes de em_voo; dentro, mais frio primeiro", () => {
    const rows = [
      { bucket: "em_voo" as const, hoursSinceActivity: 200 },
      { bucket: "em_risco" as const, hoursSinceActivity: 25 },
      { bucket: "critico" as const, hoursSinceActivity: 80 },
      { bucket: "critico" as const, hoursSinceActivity: 500 },
    ];
    const sorted = [...rows].sort(compareRisk).map((r) => `${r.bucket}:${r.hoursSinceActivity}`);
    expect(sorted).toEqual(["critico:500", "critico:80", "em_risco:25", "em_voo:200"]);
  });
});

describe("resolveStageWindow", () => {
  it("sem estágio configurado cai nas janelas globais", () => {
    expect(resolveStageWindow(null)).toEqual({
      coldHours: RISK_COLD_HOURS,
      criticalHours: RISK_CRITICAL_HOURS,
    });
    expect(resolveStageWindow({ expected_duration_hours: null })).toEqual({
      coldHours: RISK_COLD_HOURS,
      criticalHours: RISK_CRITICAL_HOURS,
    });
  });

  it("a janela sai do estágio, mantendo a razão crítico/frio de 3×", () => {
    expect(resolveStageWindow({ expected_duration_hours: 4 })).toEqual({
      coldHours: 4,
      criticalHours: 12,
    });
  });

  it("duração inválida não vira janela zerada (tudo viraria crítico)", () => {
    expect(resolveStageWindow({ expected_duration_hours: 0 }).coldHours).toBe(RISK_COLD_HOURS);
    expect(resolveStageWindow({ expected_duration_hours: -5 }).coldHours).toBe(RISK_COLD_HOURS);
  });

  it("mesma demanda, estágios diferentes, veredito diferente", () => {
    const parado = { lastActivityAt: hoursAgo(6), now, inFlight: false };
    // Agendamento de consulta: 4h já é abandono.
    expect(classifyRisk({ ...parado, window: resolveStageWindow({ expected_duration_hours: 4 }) }).bucket)
      .toBe("em_risco");
    // Negociação de contrato: 6h não é nada.
    expect(classifyRisk({ ...parado, window: resolveStageWindow({ expected_duration_hours: 72 }) }).bucket)
      .toBe("em_dia");
  });
});
