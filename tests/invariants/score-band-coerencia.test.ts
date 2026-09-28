import { describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";
import { FAIXA_LIMITES, resolveBand, type ScoreBand } from "../../lib/kanban/score-band";

/**
 * O CHECK de coerência do banco e os cortes do TypeScript são o MESMO número.
 *
 * A faixa é persistida porque histerese precisa de memória, e valor persistido
 * que parece derivado pode divergir da fonte. O banco impede a divergência de
 * ser GRAVADA; este invariante impede que os dois lados da regra se afastem —
 * que é a divergência de um nível acima, a que nenhum CHECK pega.
 *
 * Sem isto, `FAIXA_LIMITES` e o SQL seriam duas listas à mão com os mesmos
 * números hoje e números diferentes daqui a um mês, exatamente o defeito que
 * esta entrega já pagou quatro vezes (actor_kind, owner_kind, InboxKind, e o
 * extrator que lia a constraint errada).
 */
function defDaConstraint(nome: string): string {
  return sql(
    `select pg_get_constraintdef(k.oid)
       from pg_constraint k
       join pg_class c on c.oid = k.conrelid
      where k.contype = 'c' and c.relname = 'crm_lead_scores' and k.conname = '${nome}'`,
  ).trim();
}

describe("coerência faixa × score (migration 0074)", () => {
  it("o CHECK do banco usa exatamente os cortes de FAIXA_LIMITES", () => {
    const def = defDaConstraint("crm_lead_scores_band_coherence");
    expect(def, "constraint de coerência não existe — a faixa poderia divergir do score").not.toBe(
      "",
    );

    // Cada faixa aparece no CHECK com os seus limites; o teste lê o que está
    // gravado em vez de confiar em que alguém copiou certo.
    for (const [faixa, lim] of Object.entries(FAIXA_LIMITES) as Array<
      [ScoreBand, { min: number; max: number }]
    >) {
      const trecho = new RegExp(`'${faixa}'::text\\)[^)]*?\\)`, "s").test(def);
      expect(trecho, `o CHECK não menciona a faixa '${faixa}'`).toBe(true);
      if (lim.min > 0) {
        expect(def, `o piso de '${faixa}' no banco não é ${lim.min}`).toContain(
          `>= (${lim.min})`,
        );
      }
      if (lim.max < 100) {
        expect(def, `o teto de '${faixa}' no banco não é ${lim.max}`).toContain(
          `<= (${lim.max})`,
        );
      }
    }
  });

  it("toda faixa que a regra do TypeScript produz é GRAVÁVEL no banco", () => {
    // A prova que interessa: não basta os números baterem, a regra tem de caber
    // dentro do CHECK. Se `resolveBand` pudesse devolver 'quente' com score 50,
    // o worker gravaria e o banco recusaria — erro em produção, num caminho que
    // só aparece quando o lead oscila.
    const anteriores: Array<ScoreBand | null> = [null, "frio", "morno", "quente"];
    for (let score = 0; score <= 100; score++) {
      for (const anterior of anteriores) {
        const faixa = resolveBand(score, anterior);
        const lim = FAIXA_LIMITES[faixa];
        expect(
          score >= lim.min && score <= lim.max,
          `resolveBand(${score}, ${anterior}) devolveu '${faixa}', que o CHECK recusaria ` +
            `(permitido ${lim.min}..${lim.max})`,
        ).toBe(true);
      }
    }
  });
});
