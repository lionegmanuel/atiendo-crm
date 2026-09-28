import { describe, expect, it } from "vitest";

import {
  isWindowOpen,
  windowRemainingMs,
  WINDOW_MS,
} from "@/lib/agent-engine/guardrails/messaging-window";

const T0 = new Date("2026-07-28T12:00:00Z");
const h = (n: number) => new Date(T0.getTime() + n * 3_600_000);

describe("janela de 24h — derivada de last_inbound_at, nunca guardada", () => {
  it("aberta logo após o inbound", () => {
    expect(isWindowOpen(h(1), T0)).toBe(true);
  });

  it("aberta em 23h59m59s", () => {
    expect(isWindowOpen(new Date(T0.getTime() + WINDOW_MS - 1_000), T0)).toBe(true);
  });

  it("FECHADA exatamente em 24h — a borda é exclusiva", () => {
    expect(isWindowOpen(h(24), T0)).toBe(false);
  });

  it("fechada em 25h", () => {
    expect(isWindowOpen(h(25), T0)).toBe(false);
  });

  it("SEM inbound nenhum = FECHADA, não aberta", () => {
    // Fail-closed. Tratar `null` como aberta faria TODA prospecção fria passar
    // como se fosse resposta a uma mensagem do contato — que é exatamente o que
    // a janela existe para impedir.
    expect(isWindowOpen(h(1), null)).toBe(false);
    expect(windowRemainingMs(h(1), null)).toBe(0);
  });

  it("inbound no FUTURO não estende a janela além de 24h", () => {
    // Relógio torto num webhook não pode virar licença de envio. O restante é
    // limitado pela largura da janela, não pela distância até o carimbo.
    expect(windowRemainingMs(T0, h(5))).toBeLessThanOrEqual(WINDOW_MS);
  });

  it("o tempo restante é 0 quando fechada, nunca negativo", () => {
    expect(windowRemainingMs(h(30), T0)).toBe(0);
  });

  it("o tempo restante encolhe conforme a janela corre", () => {
    expect(windowRemainingMs(h(1), T0)).toBe(WINDOW_MS - 3_600_000);
    expect(windowRemainingMs(h(23), T0)).toBe(3_600_000);
  });

  it("aberta ⟺ restante > 0 — as duas funções não podem discordar", () => {
    // Duas respostas para a mesma pergunta divergem com o tempo se não forem a
    // mesma conta. É a lição do contrato de parâmetros, num eixo menor.
    for (const n of [0, 1, 12, 23.5, 24, 25, 100]) {
      expect(isWindowOpen(h(n), T0)).toBe(windowRemainingMs(h(n), T0) > 0);
    }
  });
});
