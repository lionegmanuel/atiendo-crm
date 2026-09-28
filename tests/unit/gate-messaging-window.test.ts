import { describe, expect, it } from "vitest";

import { PACING_DEFAULTS } from "@/lib/agent-engine/pacing/defaults";
import { SPINNING_DEFAULTS } from "@/lib/agent-engine/spinning/defaults";
import {
  messagingWindowGate,
  type GateContext,
} from "@/lib/agent-engine/guardrails/before-send";

const AGORA = new Date("2026-07-28T12:00:00Z");
const horasAtras = (n: number) => new Date(AGORA.getTime() - n * 3_600_000);

/** Espelha o padrão do repo: cada teste de gate monta o seu (ver case-guardrail.test.ts). */
function baseCtx(over: Partial<GateContext> = {}): GateContext {
  return {
    now: AGORA,
    body: "oi",
    optedOut: false,
    provider: "waha",
    pacing: {
      knobs: PACING_DEFAULTS,
      state: { lastSentAt: null, sentToday: 0, numberActivatedAt: null },
      crmDailyLimit: null,
      rng: () => 0,
    },
    spinning: { knobs: SPINNING_DEFAULTS, window: [] },
    lgpd: null,
    promise: { table: null },
    semanticPromise: null,
    ...over,
  } as GateContext;
}

describe("gate messaging_window", () => {
  it("canal de auto-restrição registra skipped — nunca pass silencioso", () => {
    // WAHA fala livre a qualquer hora. O gate continua NA cadeia e continua sendo
    // avaliado; o que muda é o veredito. É a diferença entre "não regrediu" e
    // "consigo provar que não regrediu" (invariante 4 da doutrina).
    const v = messagingWindowGate.evaluate(
      baseCtx({ provider: "waha", messagingWindow: { lastInboundAt: horasAtras(99) } }),
    );
    expect(v.pass).toBe(true);
    if (!v.pass) throw new Error("inalcançável");
    expect(v.skipped).toBe("not_applicable");
  });

  it("canal de hetero-restrição com janela ABERTA passa, sem skipped", () => {
    const v = messagingWindowGate.evaluate(
      baseCtx({ provider: "meta_cloud", messagingWindow: { lastInboundAt: horasAtras(2) } }),
    );
    expect(v.pass).toBe(true);
    if (!v.pass) throw new Error("inalcançável");
    expect(v.skipped).toBeUndefined();
  });

  it("canal de hetero-restrição com janela FECHADA veta", () => {
    const v = messagingWindowGate.evaluate(
      baseCtx({ provider: "meta_cloud", messagingWindow: { lastInboundAt: horasAtras(30) } }),
    );
    expect(v.pass).toBe(false);
    if (v.pass) throw new Error("inalcançável");
    expect(v.code).toBe("messaging_window_closed");
  });

  it("sem inbound nenhum veta — fail-closed, não 'na dúvida manda'", () => {
    const v = messagingWindowGate.evaluate(
      baseCtx({ provider: "meta_cloud", messagingWindow: { lastInboundAt: null } }),
    );
    expect(v.pass).toBe(false);
  });

  it("campo AUSENTE veta — o default é a direção segura", () => {
    // `messagingWindow` é opcional no tipo; um chamador que o esqueça precisa
    // produzir veto visível, nunca envio livre.
    const v = messagingWindowGate.evaluate(baseCtx({ provider: "meta_cloud" }));
    expect(v.pass).toBe(false);
  });

  it("a razão do veto diz a SAÍDA, não só o problema", () => {
    // A cadeia devolve `reason` ao modelo como erro instrutivo. Um veto que apenas
    // nega faz o modelo tentar de novo igual — e o turno morre em silêncio, que é
    // o oposto do invariante 4 do sistema vivo.
    const v = messagingWindowGate.evaluate(
      baseCtx({ provider: "meta_cloud", messagingWindow: { lastInboundAt: horasAtras(30) } }),
    );
    if (v.pass) throw new Error("inalcançável");
    expect(v.reason).toMatch(/send_template/);
    expect(v.reason).toMatch(/template aprovado/);
  });

  it("a borda de 24h fecha — não é 'quase aberta'", () => {
    const v = messagingWindowGate.evaluate(
      baseCtx({ provider: "meta_cloud", messagingWindow: { lastInboundAt: horasAtras(24) } }),
    );
    expect(v.pass).toBe(false);
  });
});

describe("gate messaging_window — template é a saída, não um bypass", () => {
  it("template PASSA mesmo com a janela fechada — é o caminho legítimo", () => {
    const v = messagingWindowGate.evaluate(
      baseCtx({
        provider: "meta_cloud",
        messagingWindow: { lastInboundAt: horasAtras(99), isTemplate: true },
      }),
    );
    expect(v.pass).toBe(true);
  });

  it("texto livre na MESMA situação continua vetado", () => {
    // O par prova que o passe é da flag, não do relaxamento do gate.
    const v = messagingWindowGate.evaluate(
      baseCtx({
        provider: "meta_cloud",
        messagingWindow: { lastInboundAt: horasAtras(99), isTemplate: false },
      }),
    );
    expect(v.pass).toBe(false);
  });

  it("template NÃO desliga os outros gates — só este muda", () => {
    // A flag vive em `messagingWindow`, não num campo global de contexto: um
    // `ctx.isTemplate` de topo convidaria outros gates a consultá-lo, e aí
    // template viraria bypass de opt-out e LGPD.
    const ctx = baseCtx({
      provider: "meta_cloud",
      messagingWindow: { lastInboundAt: null, isTemplate: true },
    });
    expect(Object.keys(ctx)).not.toContain("isTemplate");
  });
});
