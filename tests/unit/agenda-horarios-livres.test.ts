/**
 * O MOTOR DE HORÁRIOS LIVRES — a peça que, errada, marca consulta às 3h.
 *
 * ─── O que este arquivo protege ────────────────────────────────────────────
 *
 * Que ninguém consiga marcar em cima de compromisso existente, fora do
 * expediente, no almoço, com antecedência menor que a exigida, ou longe demais
 * no futuro. Cada uma dessas frases é um `it` aqui embaixo — se algum sumir, a
 * frase deixou de ser verdade.
 *
 * ─── `agora` é INJETADO em todos os casos, e isso não é preciosismo ────────
 *
 * Esta base já foi mordida duas vezes por teste que lê o relógio: a janela
 * anti-banimento derruba o `test:db` depois das 22h, e o CI ficou vermelho de
 * madrugada sem ninguém ter mudado uma linha. Nenhum teste deste arquivo pode
 * mudar de resultado conforme a hora em que roda — nem conforme o fuso da
 * máquina, que é por isso que as asserções leem o slot NO FUSO DA JORNADA em
 * vez de usarem `toLocaleString` do processo.
 *
 * ─── As datas ──────────────────────────────────────────────────────────────
 *
 * 2026-03-09 é uma segunda-feira; 2026-03-14, um sábado. As datas de 2018 são o
 * horário de verão brasileiro, que existiu até 2019 e que o `Intl` deste
 * runtime conhece: São Paulo era GMT-3 em 03/11/2018 e GMT-2 em 05/11/2018.
 */
import { describe, expect, it } from "vitest";

import { partesNoFuso } from "@/lib/agenda/fuso";
import {
  horariosLivres,
  unirFaixas,
  type FaixaEmMinutos,
  type ExcecaoDeData,
  type JornadaDaAgenda,
  type Ocupado,
  type Slot,
  type TipoDeAgendamento,
} from "@/lib/agenda/horarios-livres";

const SP = "America/Sao_Paulo";

/** Jornada padrão: segunda a sexta, 9h-12h e 13h-18h (o almoço é a ausência de janela). */
const JORNADA_COMERCIAL: JornadaDaAgenda = {
  timezone: SP,
  windows: [1, 2, 3, 4, 5].flatMap((dow) => [
    { dow, start: "09:00", end: "12:00" },
    { dow, start: "13:00", end: "18:00" },
  ]),
};

const CONSULTA_DE_1H: TipoDeAgendamento = {
  duracaoMin: 60,
  bufferAntesMin: 0,
  bufferDepoisMin: 0,
  avisoMinimoMin: 0,
  janelaDias: 60,
};

/** Slots legíveis no fuso pedido — "09:00", "10:00"… É assim que o humano confere. */
function horas(slots: Slot[], fuso = SP): string[] {
  return slots.map((s) => {
    const p = partesNoFuso(s.inicio, fuso);
    return `${String(p.hora).padStart(2, "0")}:${String(p.minuto).padStart(2, "0")}`;
  });
}

/** Slots com o dia junto, para os casos que atravessam datas. */
function diasEHoras(slots: Slot[], fuso = SP): string[] {
  return slots.map((s) => {
    const p = partesNoFuso(s.inicio, fuso);
    const dois = (n: number) => String(n).padStart(2, "0");
    return `${p.ano}-${dois(p.mes)}-${dois(p.dia)} ${dois(p.hora)}:${dois(p.minuto)}`;
  });
}

/** O dia inteiro de uma data local, como intervalo de consulta. */
function oDiaDe(dataISO: string): { de: Date; ate: Date } {
  return { de: new Date(`${dataISO}T00:00:00Z`), ate: new Date(`${dataISO}T23:59:59Z`) };
}

describe("a jornada publicada é o que abre a agenda", () => {
  it("dia sem janela publicada é ZERO horário — e não 24/7", () => {
    // A MESMA coluna, lida com outra régua: no roteamento, `windows` vazio quer
    // dizer "aceita a qualquer hora"; aqui quer dizer "não publiquei nada".
    // Herdar o 24/7 do roteamento ofereceria consulta às 3 da manhã.
    const slots = horariosLivres({
      jornada: { timezone: SP, windows: [] },
      excecoes: [],
      ocupados: [],
      tipo: CONSULTA_DE_1H,
      ...oDiaDe("2026-03-09"),
      agora: new Date("2026-03-01T12:00:00Z"),
    });
    expect(slots).toEqual([]);
  });

  it("domingo não tem janela na jornada comercial, então não tem horário", () => {
    const slots = horariosLivres({
      jornada: JORNADA_COMERCIAL,
      excecoes: [],
      ocupados: [],
      tipo: CONSULTA_DE_1H,
      ...oDiaDe("2026-03-08"), // domingo
      agora: new Date("2026-03-01T12:00:00Z"),
    });
    expect(slots).toEqual([]);
  });

  it("o almoço parte o dia em duas janelas, e não sobra horário às 12h", () => {
    const slots = horariosLivres({
      jornada: JORNADA_COMERCIAL,
      excecoes: [],
      ocupados: [],
      tipo: CONSULTA_DE_1H,
      ...oDiaDe("2026-03-09"),
      agora: new Date("2026-03-01T12:00:00Z"),
    });
    expect(horas(slots)).toEqual([
      "09:00", "10:00", "11:00",
      "13:00", "14:00", "15:00", "16:00", "17:00",
    ]);
  });

  it("o último slot precisa CABER na janela: 50min de duração não gera um às 17:30", () => {
    const slots = horariosLivres({
      jornada: { timezone: SP, windows: [{ dow: 1, start: "09:00", end: "10:30" }] },
      excecoes: [],
      ocupados: [],
      tipo: { ...CONSULTA_DE_1H, duracaoMin: 50, intervaloMin: 30 },
      ...oDiaDe("2026-03-09"),
      agora: new Date("2026-03-01T12:00:00Z"),
    });
    // 09:00→09:50 e 09:30→10:20 cabem; 10:00→10:50 passaria das 10:30.
    expect(horas(slots)).toEqual(["09:00", "09:30"]);
  });

  it("o intervalo da grade é independente da duração", () => {
    const slots = horariosLivres({
      jornada: { timezone: SP, windows: [{ dow: 1, start: "09:00", end: "12:00" }] },
      excecoes: [],
      ocupados: [],
      tipo: { ...CONSULTA_DE_1H, duracaoMin: 60, intervaloMin: 30 },
      ...oDiaDe("2026-03-09"),
      agora: new Date("2026-03-01T12:00:00Z"),
    });
    expect(horas(slots)).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00"]);
  });
});

describe("o que já está marcado sai da grade — com os buffers em volta", () => {
  const ocupadoDas14: Ocupado[] = [
    { inicio: new Date("2026-03-09T17:00:00Z"), fim: new Date("2026-03-09T18:00:00Z") }, // 14h-15h em SP
  ];

  it("sem buffer, só o horário do compromisso some", () => {
    const slots = horariosLivres({
      jornada: JORNADA_COMERCIAL,
      excecoes: [],
      ocupados: ocupadoDas14,
      tipo: CONSULTA_DE_1H,
      ...oDiaDe("2026-03-09"),
      agora: new Date("2026-03-01T12:00:00Z"),
    });
    expect(horas(slots)).toEqual([
      "09:00", "10:00", "11:00",
      "13:00", "15:00", "16:00", "17:00",
    ]);
  });

  it("com 15min de buffer dos dois lados, o vizinho que ENCOSTA também sai", () => {
    // O compromisso é 14h-15h; com buffer o bloqueio vira 13:45-15:15.
    // 13:00→14:00 encosta no começo do buffer, e 15:00→16:00 no fim.
    const slots = horariosLivres({
      jornada: JORNADA_COMERCIAL,
      excecoes: [],
      ocupados: ocupadoDas14,
      tipo: { ...CONSULTA_DE_1H, bufferAntesMin: 15, bufferDepoisMin: 15 },
      ...oDiaDe("2026-03-09"),
      agora: new Date("2026-03-01T12:00:00Z"),
    });
    expect(horas(slots)).toEqual(["09:00", "10:00", "11:00", "16:00", "17:00"]);
  });

  it("compromisso que termina exatamente quando o slot começa NÃO bloqueia (sem buffer)", () => {
    const slots = horariosLivres({
      jornada: { timezone: SP, windows: [{ dow: 1, start: "09:00", end: "11:00" }] },
      excecoes: [],
      ocupados: [
        { inicio: new Date("2026-03-09T11:00:00Z"), fim: new Date("2026-03-09T12:00:00Z") }, // 08h-09h SP
      ],
      tipo: CONSULTA_DE_1H,
      ...oDiaDe("2026-03-09"),
      agora: new Date("2026-03-01T12:00:00Z"),
    });
    expect(horas(slots)).toEqual(["09:00", "10:00"]);
  });
});

describe("os dois cortes do tempo: aviso mínimo e janela de agendamento", () => {
  it("o aviso mínimo come o começo do dia", () => {
    const slots = horariosLivres({
      jornada: JORNADA_COMERCIAL,
      excecoes: [],
      ocupados: [],
      tipo: { ...CONSULTA_DE_1H, avisoMinimoMin: 120 },
      ...oDiaDe("2026-03-09"),
      agora: new Date("2026-03-09T12:00:00Z"), // 09:00 em SP
    });
    // 09:00 + 2h ⇒ nada antes das 11:00.
    expect(horas(slots)).toEqual(["11:00", "13:00", "14:00", "15:00", "16:00", "17:00"]);
  });

  it("a janela de agendamento corta o futuro distante", () => {
    const slots = horariosLivres({
      jornada: JORNADA_COMERCIAL,
      excecoes: [],
      ocupados: [],
      tipo: { ...CONSULTA_DE_1H, janelaDias: 2 },
      de: new Date("2026-03-09T00:00:00Z"),
      ate: new Date("2026-03-20T23:59:59Z"),
      agora: new Date("2026-03-09T12:00:00Z"),
    });
    // 2 dias a partir de 09/03 12:00Z ⇒ nada depois de 11/03 12:00Z (09:00 SP).
    const dias = new Set(diasEHoras(slots).map((s) => s.slice(0, 10)));
    expect([...dias].sort()).toEqual(["2026-03-09", "2026-03-10", "2026-03-11"]);
    expect(diasEHoras(slots).filter((s) => s.startsWith("2026-03-11"))).toEqual([
      "2026-03-11 09:00",
    ]);
  });

  it("horário que já passou não aparece, mesmo sem aviso mínimo", () => {
    const slots = horariosLivres({
      jornada: JORNADA_COMERCIAL,
      excecoes: [],
      ocupados: [],
      tipo: CONSULTA_DE_1H,
      ...oDiaDe("2026-03-09"),
      agora: new Date("2026-03-09T19:00:00Z"), // 16:00 em SP
    });
    expect(horas(slots)).toEqual(["16:00", "17:00"]);
  });
});

/**
 * A EXCEÇÃO SUBTRAI (DECISÃO 11) — e "dia inteiro" deixou de ser caso especial.
 *
 * O schema guarda a faixa da exceção NOT NULL, com `(0, 1440)` para o dia
 * inteiro. O motivo é uma armadilha real do Postgres: numa UNIQUE, NULL não
 * colide com NULL, então dois "dia 12 bloqueado" da mesma pessoa passariam os
 * dois, em silêncio, e a tela mostraria a exceção duplicada.
 *
 * A consequência é que `is_unavailable = true` com `(600, 720)` virou
 * representável — "dia 12, das 10h às 12h, não atendo". A primeira versão deste
 * motor zerava o dia inteiro nesse caso: quem bloqueasse duas horas perderia o
 * dia. Agora a exceção indisponível SUBTRAI do que sobrou, e o dia inteiro é
 * apenas a subtração de `(0, 1440)`.
 *
 * Por que subtrair em vez de restringir: "das 12h às 14h não atendo" é o caso
 * comum — almoço estendido, reunião, compromisso pessoal. Com restrição, a
 * pessoa teria de cadastrar os pedaços que SOBRAM, e pensar ao contrário é o que
 * faz errar em tela de agenda.
 */
describe("exceções por data — o que a jornada semanal não sabe dizer", () => {
  it("exceção que bloqueia o dia inteiro zera aquele dia, e só aquele", () => {
    const excecoes: ExcecaoDeData[] = [
      { data: "2026-03-10", indisponivel: true, inicioMinuto: 0, fimMinuto: 1440 },
    ];
    const slots = horariosLivres({
      jornada: JORNADA_COMERCIAL,
      excecoes,
      ocupados: [],
      tipo: CONSULTA_DE_1H,
      de: new Date("2026-03-09T00:00:00Z"),
      ate: new Date("2026-03-11T23:59:59Z"),
      agora: new Date("2026-03-01T12:00:00Z"),
    });
    const dias = new Set(diasEHoras(slots).map((s) => s.slice(0, 10)));
    expect([...dias].sort()).toEqual(["2026-03-09", "2026-03-11"]);
  });

  it("exceção com horário ABRE um sábado que a jornada não tem", () => {
    const excecoes: ExcecaoDeData[] = [
      { data: "2026-03-14", indisponivel: false, inicioMinuto: 9 * 60, fimMinuto: 12 * 60 },
    ];
    const slots = horariosLivres({
      jornada: JORNADA_COMERCIAL,
      excecoes,
      ocupados: [],
      tipo: CONSULTA_DE_1H,
      ...oDiaDe("2026-03-14"), // sábado
      agora: new Date("2026-03-01T12:00:00Z"),
    });
    expect(horas(slots)).toEqual(["09:00", "10:00", "11:00"]);
  });

  it("exceção com horário SUBSTITUI a jornada do dia, não soma a ela", () => {
    const excecoes: ExcecaoDeData[] = [
      { data: "2026-03-09", indisponivel: false, inicioMinuto: 15 * 60, fimMinuto: 17 * 60 },
    ];
    const slots = horariosLivres({
      jornada: JORNADA_COMERCIAL,
      excecoes,
      ocupados: [],
      tipo: CONSULTA_DE_1H,
      ...oDiaDe("2026-03-09"),
      agora: new Date("2026-03-01T12:00:00Z"),
    });
    // A segunda tinha 9-12 e 13-18; a exceção diz "neste dia, só 15h-17h".
    expect(horas(slots)).toEqual(["15:00", "16:00"]);
  });

  it("indisponível NO MEIO do dia tira só aquelas horas — o resto do dia continua", () => {
    // O caso comum: almoço estendido, reunião interna, compromisso pessoal.
    // A versão anterior deste motor perdia o dia inteiro aqui.
    const excecoes: ExcecaoDeData[] = [
      { data: "2026-03-09", indisponivel: true, inicioMinuto: 12 * 60, fimMinuto: 14 * 60 },
    ];
    const slots = horariosLivres({
      jornada: { timezone: SP, windows: [{ dow: 1, start: "09:00", end: "18:00" }] },
      excecoes,
      ocupados: [],
      tipo: CONSULTA_DE_1H,
      ...oDiaDe("2026-03-09"),
      agora: new Date("2026-03-01T12:00:00Z"),
    });
    expect(horas(slots)).toEqual([
      "09:00", "10:00", "11:00",
      "14:00", "15:00", "16:00", "17:00",
    ]);
  });

  it("subtrair no meio parte a janela em DUAS, e a grade renasce em cada pedaço", () => {
    const excecoes: ExcecaoDeData[] = [
      { data: "2026-03-09", indisponivel: true, inicioMinuto: 10 * 60, fimMinuto: 11 * 60 },
    ];
    const slots = horariosLivres({
      jornada: { timezone: SP, windows: [{ dow: 1, start: "09:00", end: "13:00" }] },
      excecoes,
      ocupados: [],
      tipo: CONSULTA_DE_1H,
      ...oDiaDe("2026-03-09"),
      agora: new Date("2026-03-01T12:00:00Z"),
    });
    // 09:00-10:00 de um lado; 11:00-13:00 do outro. Nada às 10h.
    expect(horas(slots)).toEqual(["09:00", "11:00", "12:00"]);
  });

  it("disponível E indisponível no mesmo dia: a segunda subtrai o que a primeira abriu", () => {
    const excecoes: ExcecaoDeData[] = [
      { data: "2026-03-09", indisponivel: false, inicioMinuto: 9 * 60, fimMinuto: 12 * 60 },
      { data: "2026-03-09", indisponivel: true, inicioMinuto: 10 * 60, fimMinuto: 11 * 60 },
    ];
    const slots = horariosLivres({
      jornada: JORNADA_COMERCIAL,
      excecoes,
      ocupados: [],
      tipo: CONSULTA_DE_1H,
      ...oDiaDe("2026-03-09"),
      agora: new Date("2026-03-01T12:00:00Z"),
    });
    // Vale das 9h às 10h e das 11h às 12h.
    expect(horas(slots)).toEqual(["09:00", "11:00"]);
  });

  it("bloqueio de dia inteiro VENCE exceção disponível do mesmo dia — decidido, não acidental", () => {
    // Levantado pelo MaestroConexoes: as duas linhas coexistem (a UNIQUE é por
    // `start_minute`, e 0 ≠ 540), e quem as cadastrou provavelmente queria
    // "não atendo, MENOS das 9h às 12h". A regra faz outra coisa: o disponível
    // substitui a base, e o `(0, 1440)` subtrai tudo depois.
    //
    // Fica assim de propósito. Inverter a ordem consertaria este caso e
    // quebraria o "sábado excepcional substitui", que é o caso que motivou o
    // passo 2 — trocar um defeito por outro não é conserto. Quem tem de avisar
    // é a TELA, ao salvar a segunda linha.
    const excecoes: ExcecaoDeData[] = [
      { data: "2026-03-09", indisponivel: false, inicioMinuto: 9 * 60, fimMinuto: 12 * 60 },
      { data: "2026-03-09", indisponivel: true, inicioMinuto: 0, fimMinuto: 1440 },
    ];
    const slots = horariosLivres({
      jornada: JORNADA_COMERCIAL,
      excecoes,
      ocupados: [],
      tipo: CONSULTA_DE_1H,
      ...oDiaDe("2026-03-09"),
      agora: new Date("2026-03-01T12:00:00Z"),
    });
    expect(slots).toEqual([]);
  });

  it("ADJACÊNCIA NÃO É SOBREPOSIÇÃO: bloqueio que termina às 12h não come o slot das 12h", () => {
    // Levantado pelo QAVivo. É um `<=` contra `<`: trocar o sinal aqui come um
    // slot inteiro, e nenhum dos casos da decisão pegaria.
    const excecoes: ExcecaoDeData[] = [
      { data: "2026-03-09", indisponivel: true, inicioMinuto: 10 * 60, fimMinuto: 12 * 60 },
    ];
    const slots = horariosLivres({
      jornada: { timezone: SP, windows: [{ dow: 1, start: "12:00", end: "15:00" }] },
      excecoes,
      ocupados: [],
      tipo: CONSULTA_DE_1H,
      ...oDiaDe("2026-03-09"),
      agora: new Date("2026-03-01T12:00:00Z"),
    });
    // A janela começa exatamente onde o bloqueio termina: intacta.
    expect(horas(slots)).toEqual(["12:00", "13:00", "14:00"]);
  });

  it("bloqueio que encosta no FIM da janela também não a toca", () => {
    const excecoes: ExcecaoDeData[] = [
      { data: "2026-03-09", indisponivel: true, inicioMinuto: 12 * 60, fimMinuto: 14 * 60 },
    ];
    const slots = horariosLivres({
      jornada: { timezone: SP, windows: [{ dow: 1, start: "09:00", end: "12:00" }] },
      excecoes,
      ocupados: [],
      tipo: CONSULTA_DE_1H,
      ...oDiaDe("2026-03-09"),
      agora: new Date("2026-03-01T12:00:00Z"),
    });
    expect(horas(slots)).toEqual(["09:00", "10:00", "11:00"]);
  });

  it("dois bloqueios disjuntos no mesmo dia tiram os dois", () => {
    const excecoes: ExcecaoDeData[] = [
      { data: "2026-03-09", indisponivel: true, inicioMinuto: 15 * 60, fimMinuto: 16 * 60 },
      { data: "2026-03-09", indisponivel: true, inicioMinuto: 10 * 60, fimMinuto: 11 * 60 },
    ];
    const slots = horariosLivres({
      jornada: { timezone: SP, windows: [{ dow: 1, start: "09:00", end: "18:00" }] },
      excecoes,
      ocupados: [],
      tipo: CONSULTA_DE_1H,
      ...oDiaDe("2026-03-09"),
      agora: new Date("2026-03-01T12:00:00Z"),
    });
    expect(horas(slots)).toEqual([
      "09:00", "11:00", "12:00", "13:00", "14:00", "16:00", "17:00",
    ]);
  });

  it("bloqueios SOBREPOSTOS dão o mesmo resultado em qualquer ordem de cadastro", () => {
    // Este teste já existiu com cortes DISJUNTOS, e assim ele não podia falhar:
    // a ordem só tem como importar quando os cortes se SOBREPÕEM. Medido pelo
    // QAVivo, na análise de cobertura. Agora eles se sobrepõem — 10h-12h e
    // 11h-13h — e as duas ordens são comparadas uma com a outra.
    const comum = {
      jornada: { timezone: SP, windows: [{ dow: 1, start: "09:00", end: "18:00" }] },
      ocupados: [],
      tipo: CONSULTA_DE_1H,
      ...oDiaDe("2026-03-09"),
      agora: new Date("2026-03-01T12:00:00Z"),
    };
    const a: ExcecaoDeData = {
      data: "2026-03-09", indisponivel: true, inicioMinuto: 600, fimMinuto: 720,
    };
    const b: ExcecaoDeData = {
      data: "2026-03-09", indisponivel: true, inicioMinuto: 660, fimMinuto: 780,
    };
    const numaOrdem = horariosLivres({ ...comum, excecoes: [a, b] });
    const naOutra = horariosLivres({ ...comum, excecoes: [b, a] });

    expect(horas(numaOrdem)).toEqual(horas(naOutra));
    // E o buraco é a UNIÃO dos dois: 10h-13h fora, o resto fica.
    expect(horas(numaOrdem)).toEqual([
      "09:00", "13:00", "14:00", "15:00", "16:00", "17:00",
    ]);
  });
});

describe("fuso horário — onde a agenda ingênua quebra", () => {
  it("a virada do horário de verão não desloca a hora de parede da jornada", () => {
    // 04/11/2018: São Paulo entrou no horário de verão (00:00 virou 01:00).
    // O expediente continua começando às 9h de PAREDE nos dois dias — o que
    // muda é o instante no mundo.
    const jornada: JornadaDaAgenda = {
      timezone: SP,
      windows: [
        { dow: 6, start: "09:00", end: "11:00" }, // sábado 03/11
        { dow: 1, start: "09:00", end: "11:00" }, // segunda 05/11
      ],
    };
    const slots = horariosLivres({
      jornada,
      excecoes: [],
      ocupados: [],
      tipo: CONSULTA_DE_1H,
      de: new Date("2018-11-03T00:00:00Z"),
      ate: new Date("2018-11-06T00:00:00Z"),
      agora: new Date("2018-10-01T12:00:00Z"),
    });

    expect(horas(slots)).toEqual(["09:00", "10:00", "09:00", "10:00"]);
    // E os instantes provam a virada: 9h de sábado é 12:00Z (GMT-3); 9h de
    // segunda é 11:00Z (GMT-2). Um motor que somasse 24h por dia erraria.
    expect(slots.map((s) => s.inicio.toISOString())).toEqual([
      "2018-11-03T12:00:00.000Z",
      "2018-11-03T13:00:00.000Z",
      "2018-11-05T11:00:00.000Z",
      "2018-11-05T12:00:00.000Z",
    ]);
  });

  it("atendente e consultante em fusos diferentes veem o MESMO instante", () => {
    const slots = horariosLivres({
      jornada: { timezone: SP, windows: [{ dow: 1, start: "09:00", end: "11:00" }] },
      excecoes: [],
      ocupados: [],
      tipo: CONSULTA_DE_1H,
      ...oDiaDe("2026-03-09"),
      agora: new Date("2026-03-01T12:00:00Z"),
    });

    // A regra vale no fuso da jornada: o atendente de São Paulo atende 9h e 10h.
    expect(horas(slots, SP)).toEqual(["09:00", "10:00"]);
    // Quem consulta de Manaus vê os mesmos compromissos uma hora mais cedo no
    // relógio DELE. O motor devolve instante; o fuso é escolha de quem exibe.
    expect(horas(slots, "America/Manaus")).toEqual(["08:00", "09:00"]);
    expect(horas(slots, "UTC")).toEqual(["12:00", "13:00"]);
  });

  it("a jornada de um fuso, o compromisso em UTC: o conflito é resolvido no instante", () => {
    const slots = horariosLivres({
      jornada: { timezone: "America/Manaus", windows: [{ dow: 1, start: "09:00", end: "12:00" }] },
      excecoes: [],
      ocupados: [
        // 10h em Manaus = 14:00Z. Quem comparasse "10:00" com "10:00" sem fuso
        // bloquearia o slot errado.
        { inicio: new Date("2026-03-09T14:00:00Z"), fim: new Date("2026-03-09T15:00:00Z") },
      ],
      tipo: CONSULTA_DE_1H,
      ...oDiaDe("2026-03-09"),
      agora: new Date("2026-03-01T12:00:00Z"),
    });
    expect(horas(slots, "America/Manaus")).toEqual(["09:00", "11:00"]);
  });
});

describe("o intervalo consultado", () => {
  it("slots vêm em ordem cronológica", () => {
    const slots = horariosLivres({
      jornada: JORNADA_COMERCIAL,
      excecoes: [],
      ocupados: [],
      tipo: CONSULTA_DE_1H,
      de: new Date("2026-03-09T00:00:00Z"),
      ate: new Date("2026-03-11T23:59:59Z"),
      agora: new Date("2026-03-01T12:00:00Z"),
    });
    const instantes = slots.map((s) => s.inicio.getTime());
    expect(instantes).toEqual([...instantes].sort((a, b) => a - b));
    expect(instantes.length).toBeGreaterThan(0);
  });

  it("`de` e `ate` recortam: meio dia consultado devolve meio dia de horários", () => {
    const slots = horariosLivres({
      jornada: JORNADA_COMERCIAL,
      excecoes: [],
      ocupados: [],
      tipo: CONSULTA_DE_1H,
      de: new Date("2026-03-09T16:00:00Z"), // 13:00 em SP
      ate: new Date("2026-03-09T21:00:00Z"), // 18:00 em SP
      agora: new Date("2026-03-01T12:00:00Z"),
    });
    expect(horas(slots)).toEqual(["13:00", "14:00", "15:00", "16:00", "17:00"]);
  });
});

/**
 * OS QUATRO DEFEITOS QUE O QAVivo MEDIU — e a razão de terem passado.
 *
 * Os casos de teste que a DECISÃO 11 lista usam só múltiplos de 60 (720, 840,
 * 0, 1440, 540, 600, 660). Três dos quatro defeitos abaixo são INVISÍVEIS para
 * números assim: o deslocamento da grade não aparece quando o corte já cai
 * num ponto dela. Não foi azar — foi um conjunto de exemplos que não
 * interrogava a régua.
 */
describe("a grade se ancora na JORNADA, não no pedaço que sobrou", () => {
  const DIA_INTEIRO: JornadaDaAgenda = {
    timezone: SP,
    windows: [{ dow: 1, start: "09:00", end: "18:00" }],
  };

  it("bloqueio fora da grade não desloca os horários da tarde inteira", () => {
    // Reunião das 10:30 às 11:30. A versão anterior devolvia 09:00, 11:30,
    // 12:30… — do meio-dia em diante NENHUM horário coincidia com o que a
    // clínica publica, e o dono nunca ligaria uma coisa à outra.
    const slots = horariosLivres({
      jornada: DIA_INTEIRO,
      excecoes: [
        { data: "2026-03-09", indisponivel: true, inicioMinuto: 630, fimMinuto: 690 },
      ],
      ocupados: [],
      tipo: CONSULTA_DE_1H,
      ...oDiaDe("2026-03-09"),
      agora: new Date("2026-03-01T12:00:00Z"),
    });
    expect(horas(slots)).toEqual([
      "09:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00",
    ]);
  });

  it("o slot livre do fim do dia continua sendo oferecido", () => {
    // Consequência do mesmo defeito: re-ancorada em 11:30, a grade terminava em
    // 16:30 e deixava 17:00-18:00 — inteiramente livre — de fora.
    const slots = horariosLivres({
      jornada: DIA_INTEIRO,
      excecoes: [
        { data: "2026-03-09", indisponivel: true, inicioMinuto: 630, fimMinuto: 690 },
      ],
      ocupados: [],
      tipo: CONSULTA_DE_1H,
      ...oDiaDe("2026-03-09"),
      agora: new Date("2026-03-01T12:00:00Z"),
    });
    expect(horas(slots)).toContain("17:00");
  });

  it("a MESMA reunião como bloqueio ou como compromisso devolve os MESMOS horários", () => {
    // Duas telas, uma intenção. Se divergirem, o dono conclui que o sistema é
    // imprevisível — e está certo.
    const comum = {
      jornada: DIA_INTEIRO,
      tipo: CONSULTA_DE_1H,
      ...oDiaDe("2026-03-09"),
      agora: new Date("2026-03-01T12:00:00Z"),
    };
    const comoBloqueio = horariosLivres({
      ...comum,
      excecoes: [
        { data: "2026-03-09", indisponivel: true, inicioMinuto: 735, fimMinuto: 795 },
      ],
      ocupados: [],
    });
    const comoCompromisso = horariosLivres({
      ...comum,
      excecoes: [],
      ocupados: [
        {
          inicio: new Date("2026-03-09T15:15:00Z"), // 12:15 em SP
          fim: new Date("2026-03-09T16:15:00Z"), // 13:15 em SP
        },
      ],
    });
    expect(horas(comoBloqueio)).toEqual(horas(comoCompromisso));
  });
});

describe("o buffer vale contra o BLOQUEIO, não só contra o compromisso", () => {
  it("o slot que encosta no bloqueio pelo buffer não é oferecido", () => {
    // A dentista põe 15min entre pacientes e bloqueia 12h-14h para o almoço. Um
    // paciente às 11h a faz esterilizar até 12h15, dentro do almoço dela. Ela
    // vai concluir que o campo de intervalo não funciona.
    const slots = horariosLivres({
      jornada: { timezone: SP, windows: [{ dow: 1, start: "09:00", end: "18:00" }] },
      excecoes: [
        { data: "2026-03-09", indisponivel: true, inicioMinuto: 720, fimMinuto: 840 },
      ],
      ocupados: [],
      tipo: { ...CONSULTA_DE_1H, bufferAntesMin: 15, bufferDepoisMin: 15 },
      ...oDiaDe("2026-03-09"),
      agora: new Date("2026-03-01T12:00:00Z"),
    });
    expect(horas(slots)).toEqual(["09:00", "10:00", "15:00", "16:00", "17:00"]);
  });

  it("bloqueio e compromisso com o mesmo buffer devolvem os mesmos horários", () => {
    const comum = {
      jornada: { timezone: SP, windows: [{ dow: 1, start: "09:00", end: "18:00" }] },
      tipo: { ...CONSULTA_DE_1H, bufferAntesMin: 15, bufferDepoisMin: 15 },
      ...oDiaDe("2026-03-09"),
      agora: new Date("2026-03-01T12:00:00Z"),
    };
    const porBloqueio = horariosLivres({
      ...comum,
      excecoes: [
        { data: "2026-03-09", indisponivel: true, inicioMinuto: 720, fimMinuto: 840 },
      ],
      ocupados: [],
    });
    const porCompromisso = horariosLivres({
      ...comum,
      excecoes: [],
      ocupados: [
        {
          inicio: new Date("2026-03-09T15:00:00Z"), // 12:00 SP
          fim: new Date("2026-03-09T17:00:00Z"), // 14:00 SP
        },
      ],
    });
    expect(horas(porBloqueio)).toEqual(horas(porCompromisso));
  });

  it("buffer assimétrico protege o lado certo de cada slot", () => {
    // Com bufferAntes ≠ bufferDepois, inflar o COMPROMISSO e inflar o SLOT
    // deixam de ser a mesma conta. O que o campo promete é folga ANTES do meu
    // atendimento e DEPOIS dele — então quem infla é o slot.
    const slots = horariosLivres({
      jornada: { timezone: SP, windows: [{ dow: 1, start: "09:00", end: "18:00" }] },
      excecoes: [],
      ocupados: [
        {
          inicio: new Date("2026-03-09T15:00:00Z"), // 12:00 SP
          fim: new Date("2026-03-09T16:00:00Z"), // 13:00 SP
        },
      ],
      tipo: { ...CONSULTA_DE_1H, bufferAntesMin: 60, bufferDepoisMin: 0 },
      ...oDiaDe("2026-03-09"),
      agora: new Date("2026-03-01T12:00:00Z"),
    });
    // 11:00-12:00 encosta no compromisso e é permitido (nada é exigido DEPOIS).
    // 13:00-14:00 exigiria a hora anterior livre, e ela é o compromisso.
    expect(horas(slots)).toEqual(["09:00", "10:00", "11:00", "14:00", "15:00", "16:00", "17:00"]);
  });
});

describe("faixas sobrepostas não podem gerar o mesmo horário duas vezes", () => {
  it("duas janelas da jornada que se sobrepõem contam como uma", () => {
    // Ninguém impede a sobreposição: o Zod valida `start < end` DENTRO de cada
    // janela, e a tela acrescenta sem checar. Sobreposição é inofensiva para
    // quem TESTA pertinência (o roteamento usa `.some()`, e um OR responde uma
    // vez) e venenosa para quem GERA. A agenda é a primeira peça que gera.
    const slots = horariosLivres({
      jornada: {
        timezone: SP,
        windows: [
          { dow: 1, start: "09:00", end: "12:00" },
          { dow: 1, start: "10:00", end: "13:00" },
        ],
      },
      excecoes: [],
      ocupados: [],
      tipo: CONSULTA_DE_1H,
      ...oDiaDe("2026-03-09"),
      agora: new Date("2026-03-01T12:00:00Z"),
    });
    expect(horas(slots)).toEqual(["09:00", "10:00", "11:00", "12:00"]);
  });

  it("duas exceções disponíveis que se sobrepõem contam como uma", () => {
    // O gesto natural de quem não tem botão de editar: cadastrar "sábado 9h-12h"
    // e depois ACRESCENTAR "10h-13h". As duas entram — a UNIQUE é por
    // `start_minute`, e 540 ≠ 600.
    const slots = horariosLivres({
      jornada: JORNADA_COMERCIAL,
      excecoes: [
        { data: "2026-03-14", indisponivel: false, inicioMinuto: 540, fimMinuto: 720 },
        { data: "2026-03-14", indisponivel: false, inicioMinuto: 600, fimMinuto: 780 },
      ],
      ocupados: [],
      tipo: CONSULTA_DE_1H,
      ...oDiaDe("2026-03-14"),
      agora: new Date("2026-03-01T12:00:00Z"),
    });
    expect(horas(slots)).toEqual(["09:00", "10:00", "11:00", "12:00"]);
  });

  it("a subtração NÃO conserta a sobreposição por acidente", () => {
    // Sem a união, isto devolvia 09:00 11:00 11:00 12:00 — o 10:00 sumia nas
    // DUAS cópias e o 11:00 seguia em dobro. Verde aqui sem a união seria verde
    // pelo motivo errado.
    const slots = horariosLivres({
      jornada: {
        timezone: SP,
        windows: [
          { dow: 1, start: "09:00", end: "12:00" },
          { dow: 1, start: "10:00", end: "13:00" },
        ],
      },
      excecoes: [
        { data: "2026-03-09", indisponivel: true, inicioMinuto: 600, fimMinuto: 660 },
      ],
      ocupados: [],
      tipo: CONSULTA_DE_1H,
      ...oDiaDe("2026-03-09"),
      agora: new Date("2026-03-01T12:00:00Z"),
    });
    expect(horas(slots)).toEqual(["09:00", "11:00", "12:00"]);
  });
});

describe("no salto do horário de verão, dois horários não podem ser o mesmo instante", () => {
  it("a hora que não existe não vira um slot duplicado", () => {
    // Nova York, 2026-03-08: o relógio pula 02:00 → 03:00. `instanteDe` desliza
    // a hora inexistente pelo salto (decisão de `fuso.ts`), e o slot das 02:00
    // aterrissa no MESMO instante do das 03:00. Dois pacientes escolheriam "o
    // seu" 03:00 e cairiam no mesmo `timestamptz`, sem erro em lugar nenhum.
    //
    // O Brasil não tem mais horário de verão — mas o onboarding oferece
    // Santiago e Assunção, que têm.
    const slots = horariosLivres({
      jornada: {
        timezone: "America/New_York",
        windows: [{ dow: 0, start: "01:00", end: "05:00" }],
      },
      excecoes: [],
      ocupados: [],
      tipo: CONSULTA_DE_1H,
      de: new Date("2026-03-08T00:00:00Z"),
      ate: new Date("2026-03-09T12:00:00Z"),
      agora: new Date("2026-03-01T12:00:00Z"),
    });
    const instantes = slots.map((s) => s.inicio.toISOString());
    expect(new Set(instantes).size).toBe(instantes.length);
    expect(instantes).toEqual([
      "2026-03-08T06:00:00.000Z",
      "2026-03-08T07:00:00.000Z",
      "2026-03-08T08:00:00.000Z",
    ]);
  });
});

/**
 * `unirFaixas` MERECE TESTE PRÓPRIO — e a razão é uma medição, não estética.
 *
 * Os três casos de sobreposição que passam pelo motor **não vigiam esta
 * função**: sabotei a união sozinha e os 36 continuaram verdes, porque o dedupe
 * por instante, lá no fim, remove as duplicatas que ela deixou passar. Só
 * sabotando as DUAS ao mesmo tempo é que vermelharam. Ou seja: quem removesse
 * `unirFaixas` amanhã não veria nada acontecer.
 *
 * A rede que pega tudo é útil e fica. Mas correção-na-origem e rede-no-fim
 * precisam de testes SEPARADOS, senão uma esconde a ausência da outra. Isto é o
 * teste da origem; o do salto do horário de verão, lá em cima, é o da rede — e
 * ele é o único caso que a união não teria como consertar, porque ali as horas
 * de parede são distintas e só o INSTANTE colide.
 *
 * A função é exportada pelo pedido do QAVivo: a agenda é a primeira peça deste
 * produto que GERA horários a partir de `schedule.windows`, e quem gerar amanhã
 * herda o buraco se reimplementar inline.
 */
describe("unirFaixas — a correção na origem, medida sem passar pelo motor", () => {
  const f = (inicio: number, fim: number): FaixaEmMinutos => ({ inicio, fim });

  it("funde faixas que se sobrepõem", () => {
    expect(unirFaixas([f(540, 720), f(600, 780)])).toEqual([f(540, 780)]);
  });

  it("funde faixas contíguas: 09:00-12:00 e 12:00-18:00 são um bloco só", () => {
    // A grade tem de fluir através da emenda, senão o meio-dia vira uma âncora
    // nova e a tarde inteira anda.
    expect(unirFaixas([f(540, 720), f(720, 1080)])).toEqual([f(540, 1080)]);
  });

  it("NÃO funde faixas separadas — o almoço continua partindo o dia", () => {
    expect(unirFaixas([f(540, 720), f(780, 1080)])).toEqual([f(540, 720), f(780, 1080)]);
  });

  it("engole a faixa inteiramente contida em outra", () => {
    expect(unirFaixas([f(540, 1080), f(600, 660)])).toEqual([f(540, 1080)]);
  });

  it("ordena, então a ordem de cadastro não muda o resultado", () => {
    expect(unirFaixas([f(780, 1080), f(540, 720)])).toEqual(unirFaixas([f(540, 720), f(780, 1080)]));
  });

  it("descarta faixa degenerada em vez de emitir horário impossível", () => {
    expect(unirFaixas([f(600, 600), f(720, 700)])).toEqual([]);
  });

  it("três faixas em cadeia viram uma", () => {
    expect(unirFaixas([f(540, 660), f(600, 780), f(760, 900)])).toEqual([f(540, 900)]);
  });
});
