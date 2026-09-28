import { describe, expect, it } from "vitest";

import { resolveBand, SCORE_BAND_LABELS, type ScoreBand } from "@/lib/kanban/score-band";

describe("faixa do score com histerese", () => {
  it("primeira leitura usa a régua crua — sem memória não há o que segurar", () => {
    expect(resolveBand(85, null)).toBe("quente");
    expect(resolveBand(55, null)).toBe("morno");
    expect(resolveBand(10, null)).toBe("frio");
  });

  it("O CASO OSCILANTE: o card não pisca em volta do limiar", () => {
    // É este o teste que justifica a histerese existir. Sem ela, esta série
    // produziria morno, quente, morno, quente, morno — cinco repinturas para um
    // lead que não mudou de vida nenhuma.
    const serie = [69, 71, 68, 72, 69, 70];
    let banda: ScoreBand | null = "morno";
    const historico: ScoreBand[] = [];
    for (const score of serie) {
      banda = resolveBand(score, banda);
      historico.push(banda);
    }
    expect(historico).toEqual(["morno", "morno", "morno", "morno", "morno", "morno"]);
  });

  it("mudança REAL atravessa a banda morta e é registrada", () => {
    // A histerese não pode virar teimosia: um lead que de fato esquentou
    // precisa mudar de faixa, senão o sinal para de informar.
    expect(resolveBand(76, "morno")).toBe("quente");
    expect(resolveBand(34, "morno")).toBe("frio");
  });

  it("a zona morta protege a faixa que já estava, nos dois sentidos", () => {
    // Assimetria seria pior que histerese nenhuma: favorecer subida deixaria
    // todo lead "quente" e o rótulo pararia de discriminar.
    expect(resolveBand(72, "morno")).toBe("morno"); // subindo, ainda na zona
    expect(resolveBand(67, "quente")).toBe("quente"); // descendo, ainda na zona
    expect(resolveBand(42, "frio")).toBe("frio");
    expect(resolveBand(37, "morno")).toBe("morno");
  });

  it("descer de quente a frio direto funciona quando o tombo é real", () => {
    expect(resolveBand(20, "quente")).toBe("frio");
  });

  it("os limites exatos não ficam num limbo — todo score tem faixa", () => {
    for (let score = 0; score <= 100; score++) {
      for (const anterior of [null, "frio", "morno", "quente"] as const) {
        const b = resolveBand(score, anterior);
        expect(["frio", "morno", "quente"]).toContain(b);
      }
    }
  });

  it("todo valor do tipo tem rótulo — o Record é fechado", () => {
    const todas: ScoreBand[] = ["frio", "morno", "quente"];
    for (const b of todas) {
      expect(SCORE_BAND_LABELS[b]).toBeTruthy();
      // Rótulo não pode ser o vocabulário de máquina na cara do usuário.
      expect(SCORE_BAND_LABELS[b]).not.toBe(b);
    }
    expect(Object.keys(SCORE_BAND_LABELS).sort()).toEqual(todas.sort());
  });
});

describe("o tombo de duas faixas (defeito achado pelo invariante de coerência)", () => {
  it("quente que despenca para a zona do frio NÃO fica quente", () => {
    // `resolveBand(36, "quente")` devolvia "quente": a regra testava a fronteira
    // da faixa CRUA (frio/morno) em vez da que estava sendo cruzada (a saída de
    // quente). Um lead com 36% marcado como quente — e o CHECK do banco
    // recusaria gravar, então o defeito só apareceria em produção.
    //
    // O destino é MORNO, não frio, e isso é a histerese funcionando: 36 confirma
    // a saída de quente (≤65) mas NÃO a saída de morno (≤35). Cada fronteira é
    // confirmada por si — pular direto para frio seria ignorar a zona morta da
    // segunda fronteira só porque a primeira foi atravessada.
    expect(resolveBand(36, "quente")).toBe("morno");
  });

  it("o tombo que confirma AS DUAS fronteiras vai até o fim", () => {
    expect(resolveBand(20, "quente")).toBe("frio");
  });

  it("subir dois degraus de uma vez para no degrau CONFIRMADO", () => {
    // `resolveBand(70, "frio")` devolvia "frio": não confirmava quente (precisa
    // 75) e, em vez de parar em morno — que ESTAVA confirmado (≥45) —, segurava
    // a faixa original. Um lead com 70% marcado como frio.
    expect(resolveBand(70, "frio")).toBe("morno");
    expect(resolveBand(80, "frio")).toBe("quente");
  });

  it("a saída de uma faixa é medida no limiar DELA, não no da faixa de destino", () => {
    // 66 ainda está dentro da zona morta da saída de quente (65) → segura.
    expect(resolveBand(66, "quente")).toBe("quente");
    // 64 passou → cai para onde o score está.
    expect(resolveBand(64, "quente")).toBe("morno");
    // 34 passou a saída de morno (35) → frio.
    expect(resolveBand(34, "morno")).toBe("frio");
    expect(resolveBand(36, "morno")).toBe("morno");
  });

  it("subir também respeita a fronteira da faixa NOVA", () => {
    expect(resolveBand(44, "frio")).toBe("frio"); // ainda não confirmou morno
    expect(resolveBand(45, "frio")).toBe("morno"); // confirmou
    expect(resolveBand(74, "morno")).toBe("morno"); // ainda não confirmou quente
    expect(resolveBand(75, "morno")).toBe("quente"); // confirmou
  });
});
