/**
 * O CAMINHO INVERSO DO FUSO — "9h da manhã em São Paulo" vira QUAL instante?
 *
 * ─── Por que esta função existe ────────────────────────────────────────────
 *
 * O repo já sabia responder a metade da pergunta: `localMoment`
 * (lib/routing/eligibility) leva um instante e devolve a hora de parede num
 * fuso — é o que o roteamento usa para saber se AGORA cabe na janela do
 * atendente. A agenda precisa da direção contrária: a jornada de trabalho é
 * escrita em hora de parede ("segunda, 09:00 às 12:00"), e o motor de horários
 * livres tem que transformar isso em instantes para comparar com compromissos
 * que vivem em UTC.
 *
 * ─── Por que não é `parede - offset` ───────────────────────────────────────
 *
 * Porque o offset DEPENDE do instante, e o instante é justamente o que se quer
 * descobrir. No horário de verão o mesmo fuso vale -3 num dia e -2 no outro.
 * Resolver isso exige duas passadas: chutar com o offset de um palpite, e
 * recalcular o offset no instante encontrado.
 *
 * `date-fns-tz` resolveria — e NÃO entra: a decisão da entrega é fazer com
 * `Intl.DateTimeFormat`, que já está no runtime e já é o que o roteamento usa.
 *
 * ─── As datas deste teste não são inventadas ───────────────────────────────
 *
 * O Brasil teve horário de verão até 2019. `America/Sao_Paulo` valia GMT-3 em
 * 2018-11-03 e GMT-2 em 2018-11-05 — medido no runtime deste repo, não
 * lembrado. A virada foi na madrugada de 04/11/2018, quando 00:00 virou 01:00 e
 * a meia-noite e meia daquele dia SIMPLESMENTE NÃO EXISTIU. É o caso que quebra
 * conversão ingênua, e por isso está aqui.
 */
import { describe, expect, it } from "vitest";

import {
  diaDaSemanaLocal,
  diaLocalISO,
  instanteDe,
  offsetEmMinutos,
  partesNoFuso,
} from "@/lib/agenda/fuso";

describe("partesNoFuso — instante → hora de parede", () => {
  it("lê a hora local de um instante UTC", () => {
    const p = partesNoFuso(new Date("2026-03-10T12:00:00Z"), "America/Sao_Paulo");
    expect(p).toEqual({ ano: 2026, mes: 3, dia: 10, hora: 9, minuto: 0, segundo: 0 });
  });

  it("o mesmo instante tem hora de parede diferente em cada fuso", () => {
    const instante = new Date("2026-03-10T12:00:00Z");
    expect(partesNoFuso(instante, "America/Sao_Paulo").hora).toBe(9);
    expect(partesNoFuso(instante, "America/Manaus").hora).toBe(8);
    expect(partesNoFuso(instante, "UTC").hora).toBe(12);
  });

  it("atravessa a meia-noite para o dia anterior quando o fuso é negativo", () => {
    const p = partesNoFuso(new Date("2026-03-10T02:00:00Z"), "America/Sao_Paulo");
    expect(`${p.dia}/${p.mes} ${p.hora}h`).toBe("9/3 23h");
  });
});

describe("instanteDe — hora de parede → instante", () => {
  it("converte 9h de São Paulo no instante UTC correspondente", () => {
    const t = instanteDe({ ano: 2026, mes: 3, dia: 10, hora: 9, minuto: 0 }, "America/Sao_Paulo");
    expect(t.toISOString()).toBe("2026-03-10T12:00:00.000Z");
  });

  it("a mesma hora de parede em fusos diferentes dá instantes diferentes", () => {
    const parede = { ano: 2026, mes: 3, dia: 10, hora: 9, minuto: 0 };
    expect(instanteDe(parede, "America/Sao_Paulo").toISOString()).toBe("2026-03-10T12:00:00.000Z");
    expect(instanteDe(parede, "America/Manaus").toISOString()).toBe("2026-03-10T13:00:00.000Z");
    expect(instanteDe(parede, "UTC").toISOString()).toBe("2026-03-10T09:00:00.000Z");
  });

  it("ida e volta: converter e ler de volta devolve a mesma hora de parede", () => {
    for (const fuso of ["America/Sao_Paulo", "America/Manaus", "America/Santiago", "UTC"]) {
      const parede = { ano: 2026, mes: 7, dia: 15, hora: 14, minuto: 30 };
      const lida = partesNoFuso(instanteDe(parede, fuso), fuso);
      expect({ fuso, ...lida }).toEqual({ fuso, ...parede, segundo: 0 });
    }
  });
});

describe("virada de horário de verão", () => {
  it("a MESMA hora de parede cai em instantes diferentes antes e depois da virada", () => {
    const antes = instanteDe({ ano: 2018, mes: 11, dia: 3, hora: 12, minuto: 0 }, "America/Sao_Paulo");
    const depois = instanteDe({ ano: 2018, mes: 11, dia: 5, hora: 12, minuto: 0 }, "America/Sao_Paulo");

    // 12h de parede nos dois dias, mas o relógio do mundo andou uma hora a menos
    expect(antes.toISOString()).toBe("2018-11-03T15:00:00.000Z");
    expect(depois.toISOString()).toBe("2018-11-05T14:00:00.000Z");

    // 48h de parede, 47h de mundo — é ISTO que a conversão ingênua erra
    expect((depois.getTime() - antes.getTime()) / 3_600_000).toBe(47);
  });

  it("o offset muda com a data, e não é constante por fuso", () => {
    expect(offsetEmMinutos(new Date("2018-11-03T15:00:00Z"), "America/Sao_Paulo")).toBe(-180);
    expect(offsetEmMinutos(new Date("2018-11-05T14:00:00Z"), "America/Sao_Paulo")).toBe(-120);
    expect(offsetEmMinutos(new Date("2026-03-10T12:00:00Z"), "America/Sao_Paulo")).toBe(-180);
  });

  it("hora que NÃO EXISTE (o relógio pulou) não lança: cai no instante seguinte à virada", () => {
    // 2018-11-04, 00:30 em São Paulo nunca aconteceu — 00:00 virou 01:00.
    const t = instanteDe({ ano: 2018, mes: 11, dia: 4, hora: 0, minuto: 30 }, "America/Sao_Paulo");
    expect(Number.isNaN(t.getTime())).toBe(false);
    // Lido de volta, o relógio local mostra 01:30: o horário pedido não existe,
    // e o motor prefere devolver um instante real a devolver `Invalid Date`.
    expect(partesNoFuso(t, "America/Sao_Paulo").hora).toBe(1);
  });

  it("OFFSET POSITIVO: a meia-noite que não existiu não pode cair na véspera", () => {
    // Asia/Beirut, 2018-03-25: o relógio pulou de 23:59 do dia 24 direto para
    // 01:00 do dia 25 — aquele dia COMEÇOU à 01:00.
    //
    // Este é o caso que "fica o primeiro candidato" errava, e errava só aqui:
    // o sinal do offset decide qual candidato é o mais tarde. Nas Américas
    // (offset negativo) o primeiro já é o maior e a regra antiga acertava por
    // acidente; em Beirute a ordem se inverte e ela devolvia o DIA ANTERIOR.
    const t = instanteDe({ ano: 2018, mes: 3, dia: 25, hora: 0, minuto: 0 }, "Asia/Beirut");
    expect(t.toISOString()).toBe("2018-03-24T22:00:00.000Z");

    const lido = partesNoFuso(t, "Asia/Beirut");
    expect(`${lido.dia}/${lido.mes} ${lido.hora}h`).toBe("25/3 1h");
  });

  it("e nas Américas o resultado NÃO mudou — a correção é da borda, não do caso geral", () => {
    // Se a troca de "primeiro" para "maior" mexesse nestes, seria mudança de
    // comportamento disfarçada de conserto.
    expect(
      instanteDe({ ano: 2018, mes: 11, dia: 4, hora: 0, minuto: 30 }, "America/Sao_Paulo").toISOString(),
    ).toBe("2018-11-04T03:30:00.000Z");
    expect(
      instanteDe({ ano: 2018, mes: 3, dia: 11, hora: 0, minuto: 0 }, "America/Havana").toISOString(),
    ).toBe("2018-03-11T05:00:00.000Z");
    expect(
      instanteDe({ ano: 2026, mes: 9, dia: 6, hora: 0, minuto: 0 }, "America/Santiago").toISOString(),
    ).toBe("2026-09-06T04:00:00.000Z");
  });

  it("hora AMBÍGUA (o relógio repetiu) resolve para uma das duas, sem lançar", () => {
    // 2019-02-17: o Brasil saiu do horário de verão, 00:00 voltou para 23:00.
    const t = instanteDe({ ano: 2019, mes: 2, dia: 16, hora: 23, minuto: 30 }, "America/Sao_Paulo");
    expect(Number.isNaN(t.getTime())).toBe(false);
    expect(partesNoFuso(t, "America/Sao_Paulo").hora).toBe(23);
  });
});

describe("diaLocalISO e diaDaSemanaLocal — a régua que casa com a exceção por data", () => {
  it("o dia local não é o dia UTC quando o fuso é negativo", () => {
    const instante = new Date("2026-03-11T02:00:00Z"); // 23h do dia 10 em SP
    expect(diaLocalISO(instante, "UTC")).toBe("2026-03-11");
    expect(diaLocalISO(instante, "America/Sao_Paulo")).toBe("2026-03-10");
  });

  it("o dia da semana segue o fuso, com domingo em 0", () => {
    // 2026-03-08 é um domingo.
    expect(diaDaSemanaLocal(new Date("2026-03-08T15:00:00Z"), "America/Sao_Paulo")).toBe(0);
    expect(diaDaSemanaLocal(new Date("2026-03-09T15:00:00Z"), "America/Sao_Paulo")).toBe(1);
    // 02:00Z de segunda ainda é domingo em São Paulo — a régua é o fuso, não o UTC.
    expect(diaDaSemanaLocal(new Date("2026-03-09T02:00:00Z"), "America/Sao_Paulo")).toBe(0);
  });
});
