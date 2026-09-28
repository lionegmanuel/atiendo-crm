/**
 * A PROMESSA AO CLIENTE NASCE DO ESTADO REAL DA EQUIPE (ACH-03).
 *
 * O defeito que este arquivo prende foi medido num turno REAL, não deduzido: o
 * agente abriu o chamado e disse ao cliente *"vou providenciar para que alguém
 * da equipe entre em contato"* — sem prazo, sem saber se havia alguém. A
 * capacidade de consultar (`crm_list_available_attendants`) existia, estava
 * ligada e foi montada no turno (o log lista as 8 tools pelo nome). O modelo
 * simplesmente não a escolheu.
 *
 * A conclusão não foi "melhorar a descrição da tool": capacidade que depende de
 * o modelo LEMBRAR não existe metade das vezes. O caminho de escalação passou a
 * consultar sozinho e a devolver a expectativa junto com a confirmação.
 *
 * O teste é sobre a FRASE, porque é ela que decide o que o cliente ouve.
 */
import { describe, expect, it } from "vitest";

import {
  fraseDeExpectativa,
  quemPodeAssumirAgora,
  expectativaDeAtendimento,
} from "@/lib/escalacao/disponibilidade";

describe("a frase que o agente recebe ao escalar", () => {
  it("com gente disponível, autoriza dizer que alguém continua em seguida", () => {
    const f = fraseDeExpectativa({ disponiveis: 2, total: 4 });
    expect(f).toContain("2 pessoas");
    expect(f).toMatch(/pode dizer ao cliente/i);
    expect(f).not.toMatch(/NÃO prometa/);
  });

  it("uma pessoa só não vira '1 pessoas'", () => {
    expect(fraseDeExpectativa({ disponiveis: 1, total: 3 })).toContain("1 pessoa da equipe");
  });

  it("equipe existe mas ninguém online: proíbe prometer contato imediato", () => {
    const f = fraseDeExpectativa({ disponiveis: 0, total: 4 });
    expect(f).toMatch(/NÃO prometa contato/i);
    expect(f).toMatch(/registrado/i);
    // A diferença entre "ninguém agora" e "ninguém nunca" importa para o texto
    // que o cliente lê — a primeira ainda promete retorno.
    expect(f).toMatch(/retorna assim que possível/i);
  });

  it("conta sem ninguém configurado: o caso da VPS recém-instalada", () => {
    // Numa instalação fresca NINGUÉM está em attendant_availability. Sem este
    // ramo, a primeira conversa de um cliente real terminaria com o agente
    // prometendo contato para o vazio.
    const f = fraseDeExpectativa({ disponiveis: 0, total: 0 });
    expect(f).toMatch(/ninguém configurado/i);
    expect(f).toMatch(/NÃO prometa/i);
  });

  it("as três situações produzem frases DIFERENTES", () => {
    const frases = new Set([
      fraseDeExpectativa({ disponiveis: 2, total: 4 }),
      fraseDeExpectativa({ disponiveis: 0, total: 4 }),
      fraseDeExpectativa({ disponiveis: 0, total: 0 }),
    ]);
    expect(frases.size).toBe(3);
  });
});

describe("quem pode assumir agora", () => {
  const AGORA = new Date("2026-08-05T15:00:00.000Z");

  function dublePg(linhas: Array<Record<string, unknown>>) {
    return { query: () => Promise.resolve({ rows: linhas, rowCount: linhas.length }) } as never;
  }

  it("conta só quem está online, com folga e é atendente", async () => {
    const q = await quemPodeAssumirAgora(
      dublePg([
        { user_id: "a", role: "agent", capacity: 5, schedule: {}, carga: "2" }, // livre
        { user_id: "b", role: "manager", capacity: 3, schedule: {}, carga: "3" }, // lotado
        { user_id: "c", role: "agent", capacity: null, schedule: null, carga: "0" }, // offline/não configurado
        { user_id: "d", role: "viewer", capacity: 9, schedule: {}, carga: "0" }, // não é atendente
      ]),
      "org",
      AGORA,
    );
    expect(q).toEqual({ disponiveis: 1, total: 3 });
  });

  it("quem nunca configurou disponibilidade NÃO é contado como disponível", async () => {
    // O worker de roteamento também não o escolhe — contá-lo aqui prometeria o
    // que o roteamento nunca entregaria.
    const q = await quemPodeAssumirAgora(
      dublePg([{ user_id: "a", role: "agent", capacity: null, schedule: null, carga: "0" }]),
      "org",
      AGORA,
    );
    expect(q).toEqual({ disponiveis: 0, total: 1 });
  });

  it("fora da janela de horário não conta, mesmo online e com folga", async () => {
    // 15:00Z = 12:00 em São Paulo; a janela abaixo é 18:00–19:00 local.
    const q = await quemPodeAssumirAgora(
      dublePg([
        {
          user_id: "a",
          role: "agent",
          capacity: 5,
          schedule: { timezone: "America/Sao_Paulo", windows: [{ dow: 3, start: "18:00", end: "19:00" }] },
          carga: "0",
        },
      ]),
      "org",
      AGORA,
    );
    expect(q.disponiveis).toBe(0);
  });

  it("leitura que falha vira instrução conservadora, nunca silêncio otimista", async () => {
    const r = await expectativaDeAtendimento(
      { query: () => Promise.reject(new Error("banco fora do ar")) } as never,
      "org",
      AGORA,
    );
    expect(r.quem).toBeNull();
    expect(r.frase).toMatch(/NÃO prometa contato/i);
  });
});
