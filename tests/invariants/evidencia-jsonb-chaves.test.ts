import { describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

/**
 * A chave que a CONSTRAINT guarda e a chave que o CÓDIGO lê são a mesma.
 *
 * Esta é a divergência que nem o compilador nem o invariante de vocabulário
 * pegam: o CHECK vive em SQL, o leitor vive em TypeScript, e um `jsonb` não tem
 * forma declarada em lugar nenhum. Os dois lados podem falar de chaves
 * diferentes e **ambos estarem certos** sobre a mesma linha — o banco dizendo
 * "tem evidência", a tela dizendo "sem evidência".
 *
 * Aconteceu de verdade (migration 0076): o CHECK do score guardava
 * `activity_ids|message_ids|checkpoint_ids` e o board lia `factors`. Interseção
 * VAZIA. O escritor da época acertava por coincidência de ter nascido no mesmo
 * commit — qualquer outro (backfill, script, worker futuro) satisfaria a
 * constraint produzindo score invisível.
 *
 * É o anti-pattern nº 6 do CLAUDE.md, que estava proibido POR ESCRITO e
 * aconteceu assim mesmo: proibição em texto não gera atrito no teclado.
 *
 * ⚠️ **Coluna `jsonb` nova cujo CHECK inspeciona chaves → uma linha aqui.** Sem
 * isso, a próxima divergência nasce muda como esta nasceu.
 */
interface ParDeChaves {
  tabela: string;
  coluna: string;
  constraint: string;
  /** As chaves que o CÓDIGO efetivamente lê ou escreve, com onde. */
  lidasPeloCodigo: string[];
  origem: string;
}

const PARES: ParDeChaves[] = [
  {
    tabela: "crm_lead_scores",
    coluna: "ai_probability_evidence",
    constraint: "crm_lead_scores_needs_reason",
    // `factors` é o que a UI renderiza (board/route.ts → ScoreSlot); as âncoras
    // são o destino do clique. A constraint exige as DUAS desde a 0076.
    // FONTE ÚNICA desde a 0077: a âncora mora dentro do fator, então há uma
    // chave só para o banco guardar e para a tela ler.
    lidasPeloCodigo: ["factors"],
    origem: "score-formula.ts (escreve) + board/route.ts (lê)",
  },
  {
    tabela: "crm_lead_activities",
    coluna: "evidence",
    constraint: "crm_lead_activities_ai_needs_evidence",
    // lib/leads/activity-emitter.ts confere exatamente estas três.
    lidasPeloCodigo: ["run_ids", "trace_ids", "llm_call_ids"],
    origem: "ActivityEvidence (lib/leads/activity-emitter.ts)",
  },
];

/** As chaves que o CHECK cita — lidas do banco, não da memória de quem escreveu. */
function chavesDoCheck(constraint: string): string[] {
  const def = sql(
    `select pg_get_constraintdef(oid) from pg_constraint where conname = '${constraint}'`,
  ).trim();
  // Duas formas de citar a chave, e o CHECK do score usa a segunda: `-> 'x'` e
  // o jsonpath `$.x[*]` de `@?`. Ler só a primeira faria o invariante dizer que
  // a constraint não guarda nada — instrumento cego para a forma nova é pior
  // que instrumento ausente, porque acusa o inocente.
  const porSeta = [...def.matchAll(/->\s*'([a-z_]+)'/g)].map((m) => m[1]!);
  const porJsonpath = [...def.matchAll(/\$\.([a-z_]+)/g)].map((m) => m[1]!);
  return [...new Set([...porSeta, ...porJsonpath])].sort();
}

describe("evidência jsonb: a chave da constraint × a chave do código", () => {
  it("a tabela de pares não pode vir vazia", () => {
    expect(PARES.length).toBeGreaterThan(0);
  });

  for (const par of PARES) {
    it(`${par.tabela}.${par.coluna}: o CHECK e ${par.origem} falam das mesmas chaves`, () => {
      const noBanco = chavesDoCheck(par.constraint);
      expect(
        noBanco.length,
        `${par.constraint} não cita chave nenhuma — o CHECK mudou de forma?`,
      ).toBeGreaterThan(0);

      // O que o código lê PRECISA estar guardado pela constraint. O contrário
      // não vale: a constraint pode guardar mais (âncoras alternativas), e isso
      // é liberdade legítima de quem escreve, não divergência.
      const orfas = par.lidasPeloCodigo.filter((k) => !noBanco.includes(k));
      expect(
        orfas,
        `o código lê ${orfas.join(", ")} em ${par.coluna}, e o CHECK ${par.constraint} ` +
          `não guarda essa(s) chave(s) — o banco aceitaria uma linha que a tela não sabe ler.\n` +
          `  CHECK guarda: ${noBanco.join(", ")}\n` +
          `  código usa:   ${par.lidasPeloCodigo.join(", ")}`,
      ).toEqual([]);
    });
  }
});
