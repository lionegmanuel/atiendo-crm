import { addDays, endOfMonth, startOfMonth } from "date-fns";
import { describe, expect, it } from "vitest";

import { janelaDoMesVisivel } from "./janela-do-mes-visivel";

/** 17 de setembro de 2026 — o "hoje" do relato: daqui a 2 meses é novembro. */
const AGORA = new Date("2026-09-17T15:00:00.000Z");

describe("janelaDoMesVisivel", () => {
  it("mês corrente começa em agora, não no dia 1", () => {
    const { de, ate } = janelaDoMesVisivel(AGORA, AGORA);
    expect(de).toEqual(AGORA);
    expect(ate).toEqual(addDays(endOfMonth(AGORA), 1));
  });

  it("mês futuro — inclusive daqui a 2 meses — pede o mês inteiro", () => {
    const novembro = new Date("2026-11-10T12:00:00.000Z");
    const { de, ate } = janelaDoMesVisivel(novembro, AGORA);
    expect(de).toEqual(startOfMonth(novembro));
    expect(ate).toEqual(addDays(endOfMonth(novembro), 1));
  });

  it("mês já encerrado pede o próprio mês, sem inverter de/ate", () => {
    const agosto = new Date("2026-08-10T12:00:00.000Z");
    const { de, ate } = janelaDoMesVisivel(agosto, AGORA);
    expect(de).toEqual(startOfMonth(agosto));
    expect(ate.getTime()).toBeGreaterThan(de.getTime());
    expect(ate.getTime()).toBeLessThanOrEqual(AGORA.getTime());
  });
});
