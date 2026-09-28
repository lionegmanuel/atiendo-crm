/**
 * Wave 3 (2.4) — curadoria da timeline: diff, nunca snapshot.
 *
 * O teto do orquestrador é 12 atividades por lead por dia de simulação. Quem
 * garante isso não é a UI colapsando linhas: é este filtro recusando o que não
 * muda o que alguém faria a seguir.
 */
import { describe, it, expect } from "vitest";

import { diffCheckpoint, type CheckpointContent } from "./checkpoint-diff";

const vazio = (over: Partial<CheckpointContent> = {}): CheckpointContent => ({
  commitments: [],
  objections: [],
  next_action: null,
  rolling_summary: null,
  ...over,
});

describe("o que ENTRA na timeline", () => {
  it("objeção nova", () => {
    const r = diffCheckpoint(vazio(), vazio({ objections: ["preço acima do orçamento"] }));
    expect(r.emit).toBe(true);
    expect(r.addedObjections).toEqual(["preço acima do orçamento"]);
    expect(r.reason).toBe("Nova objeção: preço acima do orçamento");
  });

  it("compromisso novo", () => {
    const r = diffCheckpoint(vazio(), vazio({ commitments: ["retorna terça"] }));
    expect(r.emit).toBe(true);
    expect(r.reason).toBe("Novo compromisso: retorna terça");
  });

  it("próxima ação mudou", () => {
    const r = diffCheckpoint(
      vazio({ next_action: "aguardar resposta" }),
      vazio({ next_action: "enviar proposta" }),
    );
    expect(r.emit).toBe(true);
    expect(r.nextActionChanged).toBe(true);
    expect(r.reason).toBe("Próxima ação: enviar proposta");
  });

  it("vários fatos novos entram numa linha só, não em três", () => {
    const r = diffCheckpoint(
      vazio(),
      vazio({
        objections: ["prazo longo"],
        commitments: ["envia documento"],
        next_action: "ligar amanhã",
      }),
    );
    expect(r.reason).toBe(
      "Nova objeção: prazo longo · Novo compromisso: envia documento · Próxima ação: ligar amanhã",
    );
  });
});

describe("o que FICA DE FORA (o ponto do 2.4)", () => {
  it("só o resumo reescrito: a IA resumindo de novo não é fato novo", () => {
    const r = diffCheckpoint(
      vazio({ objections: ["preço"], rolling_summary: "cliente avaliando" }),
      vazio({ objections: ["preço"], rolling_summary: "cliente segue avaliando, citou concorrente" }),
    );
    expect(r.emit).toBe(false);
    expect(r.reason).toContain("só reescreveu o resumo");
  });

  it("repetir a MESMA objeção do turno anterior não entra", () => {
    const r = diffCheckpoint(
      vazio({ objections: ["preço acima do orçamento"] }),
      vazio({ objections: ["preço acima do orçamento"] }),
    );
    expect(r.emit).toBe(false);
  });

  it("mesma objeção com espaçamento/caixa diferentes continua sendo a mesma", () => {
    const r = diffCheckpoint(
      vazio({ objections: ["Preço acima do orçamento"] }),
      vazio({ objections: ["  preço   ACIMA do orçamento "] }),
    );
    expect(r.emit).toBe(false);
  });

  it("mesma próxima ação repetida não entra", () => {
    const r = diffCheckpoint(
      vazio({ next_action: "enviar proposta" }),
      vazio({ next_action: "enviar proposta" }),
    );
    expect(r.emit).toBe(false);
  });

  it("próxima ação esvaziada não vira atividade — sumir não é decidir", () => {
    const r = diffCheckpoint(vazio({ next_action: "enviar proposta" }), vazio({ next_action: null }));
    expect(r.emit).toBe(false);
  });

  it("checkpoint inteiro vazio (turno que não apurou nada) não entra", () => {
    expect(diffCheckpoint(null, vazio()).emit).toBe(false);
    expect(diffCheckpoint(vazio(), vazio()).emit).toBe(false);
  });

  it("item repetido DENTRO do mesmo checkpoint conta uma vez", () => {
    const r = diffCheckpoint(vazio(), vazio({ objections: ["preço", "Preço", " preço "] }));
    expect(r.addedObjections).toEqual(["preço"]);
  });

  it("string vazia não vira objeção", () => {
    const r = diffCheckpoint(vazio(), vazio({ objections: ["", "   "] }));
    expect(r.emit).toBe(false);
  });
});

describe("primeiro checkpoint", () => {
  it("com fato novo, entra", () => {
    expect(diffCheckpoint(null, vazio({ objections: ["quer desconto"] })).emit).toBe(true);
  });

  it("sem fato novo, não entra — 'a IA começou a pensar' não é evento", () => {
    const r = diffCheckpoint(null, vazio({ rolling_summary: "primeira conversa" }));
    expect(r.emit).toBe(false);
    expect(r.reason).toContain("primeiro checkpoint");
  });
});

/**
 * O teto de 12 atividades/lead/dia conta apenas `actor_kind` de MÁQUINA
 * (`ai`, `system`, `rule`). Humano e contato ficam fora.
 *
 * O teto existe para pegar patologia de máquina — "todo turno virou atividade".
 * Humano clicando não produz isso em escala, e o clique é o evento de MAIOR
 * sinal do sistema: é a única linha da timeline que contém uma DECISÃO em vez
 * de um relato. Contar decisão humana contra um teto criado para conter ruído
 * de robô faria o guarda ameaçar exatamente o que a Wave 4 produz.
 */
describe("curadoria sob volume (o teto de 12/dia, só para ator de máquina)", () => {
  it("40 turnos que só reescrevem o resumo produzem ZERO atividades", () => {
    let anterior: CheckpointContent = vazio({ objections: ["preço"], next_action: "aguardar" });
    let emitidas = 0;
    for (let i = 0; i < 40; i++) {
      const atual = vazio({
        objections: ["preço"],
        next_action: "aguardar",
        rolling_summary: `resumo versão ${i}`,
      });
      if (diffCheckpoint(anterior, atual).emit) emitidas++;
      anterior = atual;
    }
    expect(emitidas).toBe(0);
  });

  it("uma conversa real de 40 turnos com 3 fatos novos produz 3 linhas", () => {
    const fatos = [3, 17, 29];
    let anterior: CheckpointContent = vazio();
    let emitidas = 0;
    for (let i = 0; i < 40; i++) {
      const atual: CheckpointContent = fatos.includes(i)
        ? vazio({
            objections: [...anterior.objections, `objeção ${i}`],
            rolling_summary: `resumo ${i}`,
          })
        : vazio({ objections: anterior.objections, rolling_summary: `resumo ${i}` });
      if (diffCheckpoint(anterior, atual).emit) emitidas++;
      anterior = atual;
    }
    expect(emitidas).toBe(3);
  });
});
