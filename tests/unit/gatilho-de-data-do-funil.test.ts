/**
 * O gatilho "N dias até uma data do funil" (issue #989).
 *
 * O caso que manda é o ateliê: 240 dias antes do casamento para começar o
 * vestido e 60 dias depois dele para confirmar a entrega. Os dois são a mesma
 * regra com `dias` de sinais opostos, e é isso que este arquivo prova — sem
 * banco, sem cron e sem esperar 240 dias.
 */
import { describe, expect, it } from "vitest";

import { diaLocal, eHoraDaVarredura } from "@/lib/automation/cron-de-data";
import {
  casaNaData,
  chaveDeDisparo,
  configDoGatilhoDeData,
  diaAlvo,
  naoDisparados,
  somarDias,
  DIAS_MAX,
  DIAS_MIN,
  GATILHO_DE_DATA_DO_FUNIL,
} from "@/lib/automation/gatilho-de-data-do-funil";

describe("o gatilho de data do funil", () => {
  it("é o nome que o resto do produto procura", () => {
    expect(GATILHO_DE_DATA_DO_FUNIL).toBe("lead.date_field_due");
  });

  it("soma e subtrai dias no calendário, sem fuso no meio", () => {
    // Valor conferido fora do código: 10/10/2026 menos 240 dias é 12/02/2026.
    expect(somarDias("2026-10-10", -240)).toBe("2026-02-12");
    expect(somarDias("2026-02-12", 240)).toBe("2026-10-10");
    expect(somarDias("2026-10-10", 60)).toBe("2026-12-09");
    expect(somarDias("2026-03-01", -1)).toBe("2026-02-28");
    expect(somarDias("2026-01-01", 0)).toBe("2026-01-01");
  });
});

describe("o caso do ateliê", () => {
  const casamento = "2026-10-10";

  it("240 dias antes avisa, e só nesse dia", () => {
    // `dias` conta quanto FALTA até a data: o ateliê pede 240, não -240.
    const diaDoAviso = "2026-02-12";
    expect(casaNaData(casamento, diaDoAviso, 240)).toBe(true);
    // O dia anterior e o seguinte não valem: a regra é de UM dia, não de uma faixa.
    expect(casaNaData(casamento, "2026-02-11", 240)).toBe(false);
    expect(casaNaData(casamento, "2026-02-13", 240)).toBe(false);
  });

  it("60 dias antes é outra regra, no MESMO par data/lead", () => {
    const diaDoAviso = "2026-08-11";
    expect(casaNaData(casamento, diaDoAviso, 60)).toBe(true);
    // A regra de 240 não dispara de novo aqui — quem separa as duas é o `dias`.
    expect(casaNaData(casamento, diaDoAviso, 240)).toBe(false);
  });

  it("a confirmação depois do casamento é o mesmo `dias`, com sinal trocado", () => {
    expect(casaNaData(casamento, "2026-12-09", -60)).toBe(true);
    expect(casaNaData(casamento, "2026-12-09", 60)).toBe(false);
  });

  it("o dia de hoje + N é o dia que o cron persegue", () => {
    expect(diaAlvo("2026-02-12", 240)).toBe(casamento);
    expect(diaAlvo("2026-10-10", 0)).toBe(casamento);
    // Regra de -60 (sessenta dias DEPOIS): o alvo é a data 60 dias antes de hoje.
    expect(diaAlvo("2026-10-10", -60)).toBe("2026-08-11");
    expect(diaAlvo("2026-12-09", -60)).toBe(casamento);
  });

  it("o zero é o próprio dia da data", () => {
    expect(casaNaData(casamento, casamento, 0)).toBe(true);
    expect(casaNaData(casamento, "2026-10-11", 0)).toBe(false);
  });
});

describe("o que a data do lead pode ser", () => {
  it("aceita o ISO que o formulário grava, o timestamp e o dd/mm/aaaa", () => {
    expect(casaNaData("2026-10-10", "2026-10-10", 0)).toBe(true);
    expect(casaNaData("2026-10-10T00:00:00.000Z", "2026-10-10", 0)).toBe(true);
    // Regra de importação/CSV: a mesma data escrita à brasileira.
    expect(casaNaData("10/10/2026", "2026-10-10", 0)).toBe(true);
  });

  it("campo vazio, nulo ou lixo não casa com nada", () => {
    for (const valor of ["", "   ", null, undefined, "sem data", "2026-13-45", "10/2026"]) {
      expect(casaNaData(valor, "2026-10-10", 0)).toBe(false);
    }
  });
});

describe("N é assinado", () => {
  it("negativo olha para DEPOIS da data", () => {
    expect(casaNaData("2026-05-04", "2026-05-07", -3)).toBe(true);
    expect(casaNaData("2026-05-04", "2026-05-04", -3)).toBe(false);
    expect(casaNaData("2026-05-04", "2026-05-01", -3)).toBe(false);
  });

  it("o limite de dez anos para cada lado barra o absurdo", () => {
    expect(configDoGatilhoDeData({ pipeline_id: "p", campo: "c", dias: DIAS_MIN })).not.toBeNull();
    expect(configDoGatilhoDeData({ pipeline_id: "p", campo: "c", dias: DIAS_MAX })).not.toBeNull();
    expect(configDoGatilhoDeData({ pipeline_id: "p", campo: "c", dias: DIAS_MIN - 1 })).toBeNull();
    expect(configDoGatilhoDeData({ pipeline_id: "p", campo: "c", dias: DIAS_MAX + 1 })).toBeNull();
  });
});

describe("o fuso é o da organização", () => {
  const instante = new Date("2026-05-04T12:00:00Z"); // 09:00 em São Paulo

  it("o dia local é o da organização, não o do servidor", () => {
    expect(diaLocal(instante, "America/Sao_Paulo")).toBe("2026-05-04");
    expect(diaLocal(instante, "Asia/Tokyo")).toBe("2026-05-04");
    // 02:00Z do dia 5 ainda é dia 4 em São Paulo — a madrugada é do dia anterior.
    expect(diaLocal(new Date("2026-05-05T02:00:00Z"), "America/Sao_Paulo")).toBe("2026-05-04");
    expect(diaLocal(new Date("2026-05-05T02:00:00Z"), "Asia/Tokyo")).toBe("2026-05-05");
  });

  it("a varredura só age às 9h de quem manda o evento", () => {
    expect(eHoraDaVarredura(instante, "America/Sao_Paulo")).toBe(true);
    expect(eHoraDaVarredura(new Date("2026-05-04T13:00:00Z"), "America/Sao_Paulo")).toBe(false);
    // A mesma hora UTC é outra hora em Tóquio: quem decide é o fuso da organização.
    expect(eHoraDaVarredura(instante, "Asia/Tokyo")).toBe(false);
  });
});

describe("uma vez por lead, por regra", () => {
  it("a chave separa a regra do lead", () => {
    expect(chaveDeDisparo("r1", "l1")).toBe("r1:l1");
    expect(chaveDeDisparo("r1", "l1")).not.toBe(chaveDeDisparo("r2", "l1"));
    expect(chaveDeDisparo("r1", "l1")).not.toBe(chaveDeDisparo("r1", "l2"));
  });

  it("no dia seguinte não repete — a data alvo mudou", () => {
    const casamento = "2026-10-10";
    const diaDoAviso = "2026-02-12";
    expect(casaNaData(casamento, diaDoAviso, 240)).toBe(true);
    expect(casaNaData(casamento, somarDias(diaDoAviso, 1), 240)).toBe(false);
  });

  it("nem na mesma rodada, se o cron rodar de novo", () => {
    const jaEmitido = new Set([chaveDeDisparo("r1", "l1")]);
    // l1 e l3 são do MESMO par regra+lead e ficam de fora; l2 é outro lead.
    expect(naoDisparados(["l1", "l2", "l3"], jaEmitido, "r1")).toEqual(["l2", "l3"]);
    expect(naoDisparados(["l1"], new Set([chaveDeDisparo("r1", "l1")]), "r1")).toEqual([]);
  });

  it("outra regra não bloqueia o mesmo lead", () => {
    const jaEmitido = new Set([chaveDeDisparo("r2", "l1")]);
    expect(naoDisparados(["l1"], jaEmitido, "r1")).toEqual(["l1"]);
  });
});

describe("a configuração que a regra guarda", () => {
  const valida = { pipeline_id: "funil-1", campo: "data_do_casamento", dias: -240 };

  it("exige o funil E o campo — o campo pertence a um funil", () => {
    expect(configDoGatilhoDeData(valida)).toEqual(valida);
    expect(configDoGatilhoDeData({ campo: "data_do_casamento", dias: -240 })).toBeNull();
    expect(configDoGatilhoDeData({ pipeline_id: "funil-1", dias: -240 })).toBeNull();
    expect(configDoGatilhoDeData({ pipeline_id: "funil-1", campo: "  ", dias: -240 })).toBeNull();
    expect(configDoGatilhoDeData({})).toBeNull();
    expect(configDoGatilhoDeData(null)).toBeNull();
    expect(configDoGatilhoDeData("{}")).toBeNull();
  });

  it("`dias` é número inteiro — string de formulário não passa por acidente", () => {
    expect(configDoGatilhoDeData({ ...valida, dias: "-240" })).toBeNull();
    expect(configDoGatilhoDeData({ ...valida, dias: 1.5 })).toBeNull();
    expect(configDoGatilhoDeData({ ...valida, dias: Number.NaN })).toBeNull();
  });
});
