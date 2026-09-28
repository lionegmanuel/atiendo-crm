/**
 * O LAÇO DE RETORNO DO AVISO (invariante 7 do Sistema Vivo).
 *
 * O caso que este arquivo existe para travar é o do VIÉS: medir o grupo avisado
 * a partir de `enviado_em` e o grupo não-avisado a partir de `opened_at` faz o
 * aviso parecer melhor do que é, por construção, e nenhum teste de renderização
 * pegaria isso. Aqui a régua é a mesma nos dois lados, e há um caso que reprova
 * se ela deixar de ser.
 */
import { describe, expect, it } from "vitest";

import { medirLacoDoAviso, type CasoParaOLaco } from "@/lib/escalacao/laco-do-aviso";

const T = (minutos: number) => new Date(Date.UTC(2026, 8, 18, 12, 0, 0) + minutos * 60_000).toISOString();

function caso(patch: Partial<CasoParaOLaco> & { caseId: string }): CasoParaOLaco {
  return { abertoEm: T(0), avisoSaiuEm: null, primeiraAcaoHumanaEm: null, ...patch };
}

describe("a mediana", () => {
  it("separa os dois grupos e conta quantos ainda não tiveram ação humana", () => {
    const laco = medirLacoDoAviso([
      caso({ caseId: "a", avisoSaiuEm: T(1), primeiraAcaoHumanaEm: T(10) }),
      caso({ caseId: "b", avisoSaiuEm: T(1), primeiraAcaoHumanaEm: T(20) }),
      caso({ caseId: "c", avisoSaiuEm: T(1) }),
      caso({ caseId: "d", primeiraAcaoHumanaEm: T(120) }),
      caso({ caseId: "e", primeiraAcaoHumanaEm: T(240) }),
    ]);

    expect(laco.comAviso).toEqual({ casos: 3, respondidos: 2, medianaMinutos: 15 });
    expect(laco.semAviso).toEqual({ casos: 2, respondidos: 2, medianaMinutos: 180 });
  });

  it("é mediana e não média — um caso de fim de semana não decide o número", () => {
    const laco = medirLacoDoAviso([
      caso({ caseId: "a", avisoSaiuEm: T(0), primeiraAcaoHumanaEm: T(5) }),
      caso({ caseId: "b", avisoSaiuEm: T(0), primeiraAcaoHumanaEm: T(10) }),
      caso({ caseId: "c", avisoSaiuEm: T(0), primeiraAcaoHumanaEm: T(4320) }),
    ]);
    // Média daria 1445 minutos. A mediana descreve o caso típico.
    expect(laco.comAviso.medianaMinutos).toBe(10);
  });

  it("amostra vazia devolve `null`, nunca zero — zero afirmaria resposta instantânea", () => {
    const laco = medirLacoDoAviso([caso({ caseId: "a", avisoSaiuEm: T(1) })]);
    expect(laco.comAviso.medianaMinutos).toBeNull();
    expect(laco.semAviso).toEqual({ casos: 0, respondidos: 0, medianaMinutos: null });
    expect(medirLacoDoAviso([]).medianaAteOAvisoMinutos).toBeNull();
  });
});

describe("a régua é a MESMA nos dois grupos", () => {
  it("o grupo avisado conta de `opened_at`, não de `enviado_em`", () => {
    // O aviso demorou 30 min para sair e a pessoa agiu 10 min depois disso.
    // Medido de `enviado_em` daria 10; medido de `opened_at` dá 40 — e 40 é o
    // que o CLIENTE esperou, que é a pergunta.
    const laco = medirLacoDoAviso([
      caso({ caseId: "a", avisoSaiuEm: T(30), primeiraAcaoHumanaEm: T(40) }),
    ]);
    expect(laco.comAviso.medianaMinutos).toBe(40);
  });

  it("o atraso da entrega não some: ele vira um número PRÓPRIO", () => {
    const laco = medirLacoDoAviso([
      caso({ caseId: "a", avisoSaiuEm: T(30), primeiraAcaoHumanaEm: T(40) }),
      caso({ caseId: "b", avisoSaiuEm: T(10), primeiraAcaoHumanaEm: T(50) }),
    ]);
    expect(laco.medianaAteOAvisoMinutos).toBe(20);
  });
});

describe("dado torto fica FORA da amostra", () => {
  it("ação humana anterior à abertura do caso não entra", () => {
    const laco = medirLacoDoAviso([
      caso({ caseId: "a", abertoEm: T(60), primeiraAcaoHumanaEm: T(10) }),
      caso({ caseId: "b", abertoEm: T(0), primeiraAcaoHumanaEm: T(30) }),
    ]);
    expect(laco.semAviso).toEqual({ casos: 2, respondidos: 1, medianaMinutos: 30 });
  });

  it("carimbo ilegível não entra, e não derruba a conta", () => {
    const laco = medirLacoDoAviso([
      caso({ caseId: "a", primeiraAcaoHumanaEm: "nao-e-data" }),
      caso({ caseId: "b", primeiraAcaoHumanaEm: T(30) }),
    ]);
    expect(laco.semAviso.respondidos).toBe(1);
    expect(laco.semAviso.medianaMinutos).toBe(30);
  });
});
