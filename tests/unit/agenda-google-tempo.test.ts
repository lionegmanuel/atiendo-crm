/**
 * O dia inteiro do Google, e o fuso que ele não manda.
 *
 * Evento de dia inteiro chega como `{ "date": "2026-09-02" }` — sem hora e sem
 * fuso. Quem lê com `new Date("2026-09-02")` recebe meia-noite UTC, e em
 * São Paulo o dia 2 passa a ocupar das 21h do dia 1 às 21h do dia 2. Estes
 * casos são a régua dessa conversão.
 *
 * O caso de 2018 não é curiosidade: enquanto o Brasil teve horário de verão a
 * virada era à MEIA-NOITE, então existem dias cuja meia-noite nunca aconteceu.
 * Uma conversão ingênua devolve um instante da véspera e o dia inteiro escorrega
 * um dia para trás.
 */
import { describe, expect, it } from "vitest";

import { instanteDaParede, primeiroInstanteDoDia } from "@/lib/agenda/google/tempo";

/** Estreita `Date | null` falhando alto — cast em teste esconde justamente o nulo. */
function naoNulo(i: Date | null): Date {
  if (i === null) throw new Error("esperava um instante, veio nulo");
  return i;
}

/** A data/hora de parede que um instante tem naquele fuso — como a pessoa vê. */
function paredeEm(instante: Date, fuso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(instante)
    .replace(",", "");
}

describe("instanteDaParede", () => {
  it("converte hora de parede qualquer, não só a meia-noite", () => {
    expect(
      instanteDaParede({ ano: 2026, mes: 9, dia: 2, hora: 14, minuto: 0 }, "America/Sao_Paulo")?.toISOString(),
    ).toBe("2026-09-02T17:00:00.000Z");
    expect(
      instanteDaParede({ ano: 2026, mes: 9, dia: 2, hora: 9, minuto: 30 }, "America/Manaus")?.toISOString(),
    ).toBe("2026-09-02T13:30:00.000Z");
  });

  it("na hora que NÃO existiu, devolve o primeiro instante depois do salto", () => {
    // 2018-11-04 em São Paulo pulou de 23:59:59 (GMT-3) para 01:00 (GMT-2):
    // 00:30 daquele dia nunca aconteceu.
    const i = instanteDaParede({ ano: 2018, mes: 11, dia: 4, hora: 0, minuto: 30 }, "America/Sao_Paulo");
    expect(i?.toISOString()).toBe("2018-11-04T03:30:00.000Z");
    expect(paredeEm(naoNulo(i), "America/Sao_Paulo")).toBe("2018-11-04 01:30");
  });

  it("na hora que acontece DUAS vezes, devolve a primeira — e agora isso é medido", () => {
    // ⚠️ ESTE TESTE EXISTE PORQUE O CABEÇALHO MENTIA. Ele afirmava "devolve a
    // primeira (…) e por isso está escrito aqui e tem teste" — e teste não
    // havia. Promessa em comentário sem implementação atrás é a mesma família
    // do defeito que a revisão fria achou em `erros.ts`, onde o comentário
    // prometia ler um campo que o código não lia. Comentário não é gate.
    //
    // Na volta do horário de verão em Nova York, 2026-11-01 01:30 acontece em
    // DOIS instantes: 05:30Z (ainda no horário de verão) e 06:30Z (já fora).
    // Escolher é obrigatório — o que não pode é escolher em silêncio.
    expect(
      instanteDaParede({ ano: 2026, mes: 11, dia: 1, hora: 1, minuto: 30 }, "America/New_York")?.toISOString(),
    ).toBe("2026-11-01T05:30:00.000Z");

    // Lisboa, mesma classe, deslocamento de outro sinal.
    expect(
      instanteDaParede({ ano: 2026, mes: 10, dia: 25, hora: 0, minuto: 30 }, "Europe/Lisbon")?.toISOString(),
    ).toBe("2026-10-24T23:30:00.000Z");
  });

  it("na hora que NÃO existe fora das Américas, o dia continua certo", () => {
    // O sinal do deslocamento é o que separa esta classe: onde ele é POSITIVO,
    // devolver "o primeiro candidato" cai na VÉSPERA. Beirute vira o relógio à
    // meia-noite, então 00:00 de 2026-03-29 não existe — e o primeiro instante
    // daquele dia é 01:00 local.
    const i = instanteDaParede({ ano: 2026, mes: 3, dia: 29, hora: 0, minuto: 0 }, "Asia/Beirut");
    expect(i?.toISOString()).toBe("2026-03-28T22:00:00.000Z");
    expect(paredeEm(naoNulo(i), "Asia/Beirut")).toBe("2026-03-29 01:00");
  });

  it("recusa hora impossível e fuso desconhecido, em vez de chutar", () => {
    expect(instanteDaParede({ ano: 2026, mes: 2, dia: 31 }, "UTC")).toBeNull();
    expect(instanteDaParede({ ano: 2026, mes: 9, dia: 2, hora: 25 }, "UTC")).toBeNull();
    expect(instanteDaParede({ ano: 2026, mes: 9, dia: 2 }, "Marte/Olympus")).toBeNull();
  });
});

describe("primeiroInstanteDoDia", () => {
  it("converte pelo fuso do calendário, não por UTC", () => {
    const i = primeiroInstanteDoDia("2026-09-02", "America/Sao_Paulo");
    expect(i?.toISOString()).toBe("2026-09-02T03:00:00.000Z");
  });

  it("o dia continua sendo o dia — é o que a leitura ingênua perde", () => {
    // `new Date("2026-09-02")` daria 2026-09-02T00:00:00Z, que em São Paulo é
    // 21h do dia 1º. Esta asserção é a que reprova essa regressão.
    const i = primeiroInstanteDoDia("2026-09-02", "America/Sao_Paulo");
    expect(paredeEm(naoNulo(i), "America/Sao_Paulo")).toBe("2026-09-02 00:00");
    expect(new Date("2026-09-02").toISOString()).toBe("2026-09-02T00:00:00.000Z");
    expect(i?.toISOString()).not.toBe(new Date("2026-09-02").toISOString());
  });

  it("respeita o horário de verão do fuso, e não um deslocamento fixo", () => {
    // 2018-01-10 estava em horário de verão (GMT-2); 2018-09-02, não (GMT-3).
    expect(primeiroInstanteDoDia("2018-01-10", "America/Sao_Paulo")?.toISOString()).toBe(
      "2018-01-10T02:00:00.000Z",
    );
    expect(primeiroInstanteDoDia("2018-09-02", "America/Sao_Paulo")?.toISOString()).toBe(
      "2018-09-02T03:00:00.000Z",
    );
  });

  it("no dia em que a meia-noite NÃO existiu, devolve o primeiro instante que existiu", () => {
    // Em 2018-11-04 o relógio pulou de 2018-11-03 23:59:59 (GMT-3) para
    // 2018-11-04 01:00:00 (GMT-2).
    const i = primeiroInstanteDoDia("2018-11-04", "America/Sao_Paulo");
    expect(i?.toISOString()).toBe("2018-11-04T03:00:00.000Z");
    // O que importa é o DIA: cair na véspera é o defeito.
    expect(paredeEm(naoNulo(i), "America/Sao_Paulo")).toBe("2018-11-04 01:00");
  });

  it("atende fuso com deslocamento fracionário", () => {
    expect(primeiroInstanteDoDia("2026-09-02", "Asia/Kolkata")?.toISOString()).toBe(
      "2026-09-01T18:30:00.000Z",
    );
  });

  it("UTC é o caso trivial, e continua trivial", () => {
    expect(primeiroInstanteDoDia("2026-09-02", "UTC")?.toISOString()).toBe("2026-09-02T00:00:00.000Z");
  });

  it("recusa em vez de chutar: data malformada, dia que não existe e fuso desconhecido", () => {
    expect(primeiroInstanteDoDia("02/09/2026", "UTC")).toBeNull();
    expect(primeiroInstanteDoDia("2026-9-2", "UTC")).toBeNull();
    expect(primeiroInstanteDoDia("", "UTC")).toBeNull();
    // 31 de fevereiro: `Date.UTC` normalizaria para 3 de março em silêncio, e a
    // ocupação cairia num dia que ninguém marcou.
    expect(primeiroInstanteDoDia("2026-02-31", "UTC")).toBeNull();
    // Fuso com acento é o erro real de quem digita — e `Intl` lança nele.
    expect(primeiroInstanteDoDia("2026-09-02", "America/Asunción")).toBeNull();
    expect(primeiroInstanteDoDia("2026-09-02", "Marte/Olympus")).toBeNull();
  });
});
