import { describe, expect, it } from "vitest";

import { decidirSeRoda } from "@/lib/agent-engine/agent/operator-turn";
import type { DeclaracaoDoTurno } from "@/lib/agent-engine/agent/declaracao";

/**
 * A regra que decide se o Operador gasta uma chamada de modelo (spec 16 §3.2).
 *
 * É aqui que a distinção construída no passo 2 — "não declarou" ≠ "declarou que
 * não havia nada" — deixa de ser filosofia e vira dinheiro na conta do
 * self-hoster. Se os dois estados fossem um só, uma das duas coisas aconteceria:
 * o Operador rodaria em todo turno vazio (custo por nada), ou pularia todo turno
 * sem declaração (promessa órfã em silêncio). Nenhuma é aceitável.
 */
const COM_PROMESSA: DeclaracaoDoTurno = {
  intencoes: [],
  promessas: [{ o_que: "confirmo o horário até amanhã", prazo: null }],
  nada_a_declarar: false,
};

const VAZIA: DeclaracaoDoTurno = { intencoes: [], promessas: [], nada_a_declarar: true };

describe("o Operador decide se roda", () => {
  it("papel desligado: não roda, e o motivo fica registrado", () => {
    const d = decidirSeRoda({ papelLigado: false, declaracao: COM_PROMESSA });
    expect(d.roda).toBe(false);
    expect(d.roda === false && d.desfecho.porque).toBe("papel_desligado");
  });

  it("desligado vence tudo — nem promessa em aberto faz um papel desligado rodar", () => {
    // O contrário seria um papel que o humano desligou na tela gastando a chave
    // dele assim mesmo. "Desligado" precisa significar desligado.
    expect(decidirSeRoda({ papelLigado: false, declaracao: null }).roda).toBe(false);
  });

  it("declarou que não havia nada: NÃO roda — quem avaliou estava lá, com todo o contexto", () => {
    const d = decidirSeRoda({ papelLigado: true, declaracao: VAZIA });
    expect(d.roda).toBe(false);
    expect(d.roda === false && d.desfecho.tipo).toBe("nada_a_fazer");
  });

  it("NÃO declarou (ausente): RODA — ninguém avaliou, e é aí que ele mais importa", () => {
    // O caso que justifica a coluna nullable. Se `null` fosse tratado como
    // "nada a fazer", um fechamento incompleto viraria promessa órfã sem que
    // ninguém jamais soubesse.
    expect(decidirSeRoda({ papelLigado: true, declaracao: null }).roda).toBe(true);
  });

  it("os dois estados levam a decisões OPOSTAS — é a asserção que a distinção existe para sustentar", () => {
    const ausente = decidirSeRoda({ papelLigado: true, declaracao: null });
    const vazia = decidirSeRoda({ papelLigado: true, declaracao: VAZIA });
    expect(ausente.roda).not.toBe(vazia.roda);
  });

  it("declaração com conteúdo: roda", () => {
    expect(decidirSeRoda({ papelLigado: true, declaracao: COM_PROMESSA }).roda).toBe(true);
  });

  it("nada_a_declarar:false com listas vazias ainda RODA — o modelo não afirmou que não havia nada", () => {
    // Sutil e proposital: `nada_a_declarar` é uma AFIRMAÇÃO do modelo, não um
    // derivado de listas vazias. Inferir "vazio ⇒ nada a fazer" reintroduziria
    // pela porta dos fundos o colapso que o passo 2 evitou.
    const semAfirmar: DeclaracaoDoTurno = { intencoes: [], promessas: [], nada_a_declarar: false };
    expect(decidirSeRoda({ papelLigado: true, declaracao: semAfirmar }).roda).toBe(true);
  });
});
