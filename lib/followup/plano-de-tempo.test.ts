import { describe, expect, it } from "vitest";

import { descreveEspera, leituraDoPlano } from "./plano-de-tempo";
import { esperaPlanejadaDe } from "./timing-plan";

/** Um plano no formato que o MOTOR escreve (timing-plan.ts, migration 0144). */
function plano(over: Record<string, unknown> = {}) {
  return {
    decidido_em: "2026-08-10T10:00:00.000Z",
    modelo: "anthropic/claude-sonnet-4-6",
    esperas: {
      "wait-1": {
        escolhido_ms: 14_400_000,
        min_ms: 3_600_000,
        max_ms: 14_400_000,
        proposto_ms: 259_200_000,
        clampado: true,
        motivo: "o cliente pediu para retomar depois do almoço",
      },
    },
    ...over,
  };
}

describe("leituraDoPlano", () => {
  it("lê o plano que o motor escreve", () => {
    const p = leituraDoPlano(plano());
    expect(p?.esperas["wait-1"]?.clampado).toBe(true);
    expect(p?.modelo).toBe("anthropic/claude-sonnet-4-6");
  });

  it("sem plano NÃO inventa placeholder — fluxo v1 e espera fixa não mostram bloco", () => {
    expect(leituraDoPlano(null)).toBeNull();
    expect(leituraDoPlano(undefined)).toBeNull();
    expect(leituraDoPlano({})).toBeNull();
    expect(leituraDoPlano(plano({ esperas: {} }))).toBeNull();
  });

  /**
   * A propriedade que importa: TELA E MOTOR CONCORDAM.
   *
   * Se a tela aceitasse um plano que o motor descarta, ela mostraria "a IA
   * escolheu 4 horas" enquanto o follow-up espera o máximo — uma decisão que
   * não aconteceu, na frente de quem opera. O teste compara os DOIS lados sobre
   * a mesma entrada, em vez de afirmar o comportamento de um só.
   */
  it.each([
    ["espera sem proposto_ms", plano({ esperas: { "wait-1": { escolhido_ms: 1, min_ms: 0, max_ms: 2, clampado: false, motivo: "x" } } })],
    ["espera sem motivo", plano({ esperas: { "wait-1": { escolhido_ms: 1, min_ms: 0, max_ms: 2, proposto_ms: 1, clampado: false } } })],
    ["sem decidido_em", plano({ decidido_em: undefined })],
    ["esperas não é objeto", plano({ esperas: "torto" })],
    ["lixo completo", { qualquer: "coisa" }],
  ])("plano que o motor recusa, a tela também recusa: %s", (_rotulo, bruto) => {
    expect(esperaPlanejadaDe(bruto, "wait-1")).toBeNull();
    expect(leituraDoPlano(bruto)).toBeNull();
  });

  it("plano que o motor ACEITA, a tela também aceita — o outro lado da mesma moeda", () => {
    const bom = plano();
    expect(esperaPlanejadaDe(bom, "wait-1")).not.toBeNull();
    expect(leituraDoPlano(bom)).not.toBeNull();
  });
});

describe("descreveEspera", () => {
  it("diz o escolhido, o limite e o porquê — as três coisas que o operador pergunta", () => {
    const d = descreveEspera({
      escolhido_ms: 14_400_000,
      min_ms: 3_600_000,
      max_ms: 14_400_000,
      proposto_ms: 259_200_000,
      clampado: true,
      motivo: "o cliente pediu para retomar depois do almoço",
    });
    expect(d.escolhido).toBe("4 horas");
    expect(d.faixa).toBe("seu limite: de 1 hora a 4 horas");
    expect(d.motivo).toBe("o cliente pediu para retomar depois do almoço");
  });

  it("quando houve corte, mostra QUANTO a IA pediu — é o tamanho que decide se o operador mexe no nó", () => {
    const d = descreveEspera({
      escolhido_ms: 43_200_000,
      min_ms: 3_600_000,
      max_ms: 43_200_000,
      proposto_ms: 259_200_000,
      clampado: true,
      motivo: "cliente sumiu, vale esperar bastante",
    });
    expect(d.pedido).toBe("3 dias");
  });

  it("sem corte não há diferença a contar — e a linha não aparece", () => {
    const d = descreveEspera({
      escolhido_ms: 7_200_000,
      min_ms: 3_600_000,
      max_ms: 43_200_000,
      proposto_ms: 7_200_000,
      clampado: false,
      motivo: "duas horas bastam",
    });
    expect(d.pedido).toBeNull();
  });
});
