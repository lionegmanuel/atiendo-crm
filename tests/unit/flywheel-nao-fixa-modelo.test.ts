import { describe, expect, it, vi } from "vitest";

/**
 * Os dois pontos do flywheel (`flywheel_judge` e `flywheel_distiller`) não podem
 * fixar id de modelo, e o veredito grava o provedor/modelo que a chamada
 * REALMENTE usou.
 *
 * Fixavam `claude-haiku-4-5`, e id de modelo só vale no vocabulário do provedor
 * que a instalação usa: numa VPS com a org apontada para OpenRouter o provedor
 * devolvia 400 `claude-haiku-4-5 is not a valid model ID` e a rodada agendada
 * morria a cada disparo — medido em produção em 2026-09-05 por @maugarciasa
 * (PR #595). Sem `model`, o ponto resolve pela cadeia normal: painel de
 * provedores, senão `organizations.settings.llm.default_model` — que a migration
 * 0096 garante existir em toda organização, por backfill e por trigger.
 *
 * ## Por que este teste exercita a função em vez de ler o fonte
 *
 * A primeira versão desta guarda lia `live.ts` com `readFileSync` e afirmava que
 * não havia linha `model:`. Presença de símbolo não é comportamento: aquela
 * versão fica verde se alguém passar o modelo por outro nome, por uma variável,
 * ou por um wrapper — e fica VERMELHA por um `model:` inofensivo em qualquer
 * outro ponto do arquivo. Aqui a chamada é observada de verdade.
 */

const chamadas: Array<Record<string, unknown>> = [];

vi.mock("../../lib/agent-engine/edge/llm/run-model-call", () => ({
  runModelCall: vi.fn(async (_pool: unknown, _cfg: unknown, input: Record<string, unknown>) => {
    chamadas.push(input);
    const ehJuiz = input.purpose === "flywheel_judge";
    return {
      // O que o provedor de VERDADE devolveu — nem sempre é o que se pediu, e é
      // justamente por isso que o veredito tem de gravar ESTES, não uma constante.
      provider: "openrouter",
      model: "anthropic/claude-haiku-4.5",
      result: {
        text: ehJuiz
          ? '{"verdict":"no","missing_facts":["o lead tem CNPJ"]}'
          : '{"content":"Nunca apague fato de outro assunto ao consolidar.","scope":"agent"}',
      },
    };
  }),
}));

const TURNO = {
  job_id: "0000000a-0000-4000-8000-000000000001",
  organization_id: "org-1",
  contact_id: "contato-1",
};

/** Responde por PADRÃO do SQL, não por ordem — ordem quebra a cada refactor. */
function poolFalso() {
  const inserts: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("from job_queue")) return { rows: [TURNO], rowCount: 1 };
    if (sql.includes("from messages")) {
      return { rows: [{ direction: "inbound", body: "meu CNPJ é 00.000.000/0001-00" }], rowCount: 1 };
    }
    if (sql.includes("from lead_notes")) return { rows: [], rowCount: 0 };
    if (sql.includes("from lead_checkpoints")) return { rows: [], rowCount: 0 };
    if (sql.includes("insert into flywheel_judge_verdicts")) {
      inserts.push({ sql, params });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("insert into flywheel_distiller_proposals")) {
      inserts.push({ sql, params });
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  return { pool: { query } as never, inserts };
}

const LOG = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

describe("flywheel vivo", () => {
  it("não pede modelo nenhum: deixa a instalação resolver, nos DOIS pontos", async () => {
    chamadas.length = 0;
    const { pool } = poolFalso();
    const { runFlywheelOnce } = await import("../../lib/agent-engine/flywheel/live");

    await runFlywheelOnce(pool, {} as never, { limit: 1, log: LOG });

    // Controle positivo: se os dois pontos não foram exercitados, a asserção de
    // ausência abaixo seria satisfeita por um array vazio — que é o modo clássico
    // desta guarda morrer sem avisar.
    expect(chamadas.map((c) => c.purpose)).toEqual(["flywheel_judge", "flywheel_distiller"]);
    for (const c of chamadas) {
      expect(c.model, `o ponto ${String(c.purpose)} fixou modelo`).toBeUndefined();
    }
  });

  it("grava no veredito o provedor e o modelo que a chamada realmente usou", async () => {
    chamadas.length = 0;
    const { pool, inserts } = poolFalso();
    const { runFlywheelOnce } = await import("../../lib/agent-engine/flywheel/live");

    await runFlywheelOnce(pool, {} as never, { limit: 1, log: LOG });

    const veredito = inserts.find((i) => i.sql.includes("flywheel_judge_verdicts"));
    expect(veredito, "nenhum veredito foi gravado").toBeDefined();
    // `judge_family` e `model` são o 7º e o 8º parâmetros do INSERT. O 'anthropic'
    // que estava fixo ali mentia sobre a instalação inteira que não usa Anthropic.
    expect(veredito?.params[6]).toBe("openrouter");
    expect(veredito?.params[7]).toBe("anthropic/claude-haiku-4.5");
  });
});
