import { describe, expect, it } from "vitest";

import { eixoDoDossie } from "@/lib/leads/timeline-query";

/**
 * O EIXO da timeline do dossiê.
 *
 * Este arquivo existe por um motivo específico e declarado: o segundo lado da
 * união casa ZERO linhas hoje, então ele parece redundante e some no primeiro
 * refactor bem-intencionado. Comentário pede; teste obriga.
 *
 * As asserções são sobre PROPRIEDADES, não sobre a string literal — trocar
 * espaçamento ou ordem não deve reprovar, mas REMOVER um lado sim.
 */
const LEAD = "11111111-1111-4111-8111-111111111111";
const IRMAO = "22222222-2222-4222-8222-222222222222";
const CONTATO = "33333333-3333-4333-8333-333333333333";

describe("eixoDoDossie", () => {
  it("sem contato, não há segundo lado — quem chama usa igualdade simples", () => {
    // O `null` NÃO é ausência de resposta: é a resposta. Era este o caso que
    // não tinha porta nenhuma (25% dos leads, 64% das atividades).
    expect(eixoDoDossie(LEAD, null)).toBeNull();
  });

  it("ancora no lead — a porta que o negócio sem contato não tinha", () => {
    expect(eixoDoDossie(LEAD, CONTATO)).toContain(`lead_id.eq.${LEAD}`);
  });

  it("preserva a atividade da CONVERSA: contato do lead E lead_id nulo, juntos", () => {
    const eixo = eixoDoDossie(LEAD, CONTATO)!;
    // Os dois pedaços têm de estar na MESMA conjunção. Separados, o filtro
    // pegaria toda atividade do contato — inclusive a do negócio irmão, que é
    // justamente o defeito do eixo antigo.
    expect(eixo).toMatch(/and\([^)]*contact_id\.eq\.33333333-3333-4333-8333-333333333333[^)]*\)/);
    expect(eixo).toMatch(/and\([^)]*lead_id\.is\.null[^)]*\)/);
  });

  it("o negócio IRMÃO fica de fora: nenhum lado o nomeia", () => {
    expect(eixoDoDossie(LEAD, CONTATO)).not.toContain(IRMAO);
  });

  it("o lado do contato NUNCA aparece sem a restrição de lead nulo", () => {
    // A regressão que este arquivo existe para pegar: alguém "simplifica" para
    // `contact_id.eq.X` achando que `lead_id.is.null` é ruído, e o dossiê de A
    // volta a mostrar a história de B.
    const eixo = eixoDoDossie(LEAD, CONTATO)!;
    const semARestricao = eixo.replace(/and\([^)]*\)/g, "");
    expect(semARestricao).not.toContain("contact_id");
  });
});
