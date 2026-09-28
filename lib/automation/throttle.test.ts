/**
 * A janela de horário SAIU daqui. Os casos que exercitavam `withinSendWindow()`
 * e `nextWindowStart()` foram removidos com as próprias funções — e a cobertura
 * não encolheu: ela vive agora em `lib/automation/janela-do-canal.test.ts`,
 * contra a régua única que lê `channel_knobs` no fuso do tenant.
 *
 * Vale registrar por que aqueles casos não serviam. Eles escreviam
 * `new Date("2026-07-17T10:00:00")` — sem `Z`, portanto lido no fuso do
 * processo — contra uma função que também decidia por `getHours()`, no fuso do
 * processo. Dois erros que se cancelavam: a suíte ficava verde enquanto a
 * janela de produção, num contêiner em UTC, era 4h–19h de Brasília.
 */
import { describe, it, expect } from "vitest";
import { jitterMs } from "@/lib/automation/throttle";

describe("jitterMs", () => {
  it("sempre em [0, 800]", () => {
    for (let i = 0; i < 50; i++) {
      const j = jitterMs();
      expect(j).toBeGreaterThanOrEqual(0);
      expect(j).toBeLessThanOrEqual(800);
    }
  });
});
