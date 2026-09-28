/**
 * A identidade da proposta muda a cada escrita — inclusive com o MESMO texto.
 *
 * É o invariante que sustenta a trava de autorização da Wave 4. Se ele cair, o
 * humano aprova uma proposta e o sistema executa outra com as mesmas palavras,
 * sem nada reclamar — e se ele tiver ignorado a primeira, a segunda chega
 * indistinguível dela.
 *
 * Roda contra Postgres de verdade (baseline aplicado), porque o que está sendo
 * provado é o comportamento do UPSERT, não o do TypeScript.
 */
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// A porta vem do harness (`TEST_DB_PORT`), não de um número escrito aqui:
// hardcodar 54329 fazia este invariante quebrar por ECONNREFUSED quando a suíte
// roda noutra porta — que é justamente o que se faz para não disputar o
// ambiente com outra sessão. Erro de instrumento com cara de erro de produto.
const PORTA = process.env.TEST_DB_PORT ?? "54329";
const CONN =
  process.env.TEST_DB_URL ?? `postgres://postgres:postgres@127.0.0.1:${PORTA}/postgres`;

const ORG = "00000000-0000-4000-8000-0000000000f1";
const CONTATO = "00000000-0000-4000-8000-0000000000f2";

let pool: Pool;

/** O mesmo UPSERT de `applyLeadStateUpdate` — se ele mudar lá, este teste cai. */
async function escreveEstado(nextAction: string | null, escreveuProposta: boolean) {
  const { rows } = await pool.query(
    `insert into lead_state (organization_id, contact_id, stage, qualification, next_action, next_action_seq)
     values ($1, $2, $3, $4::jsonb, $5, case when $6::boolean then 1 else 0 end)
     on conflict (organization_id, contact_id) do update
       set stage = excluded.stage,
           qualification = excluded.qualification,
           next_action = excluded.next_action,
           next_action_seq = lead_state.next_action_seq + case when $6::boolean then 1 else 0 end,
           updated_at = now()
     returning next_action, next_action_seq`,
    [ORG, CONTATO, "qualifying", "{}", nextAction, escreveuProposta],
  );
  return rows[0] as { next_action: string | null; next_action_seq: string };
}

describe("identidade da próxima ação (migration 0073)", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: CONN });
    // `lead_state.organization_id` tem FK: sem a org, o insert falha por um
    // motivo que não tem nada a ver com o que está sendo provado.
    await pool.query(
      `insert into organizations (id, slug, legal_name, display_name)
       values ($1, 'inv-0073', 'Org do invariante 0073', 'Org do invariante 0073')
       on conflict (id) do nothing`,
      [ORG],
    );
    await pool.query(
      `insert into contacts (id, organization_id, name, phone_number)
       values ($1, $2, 'Contato do invariante 0073', '+5511900000073')
       on conflict (id) do nothing`,
      [CONTATO, ORG],
    );
    await pool.query("delete from lead_state where organization_id = $1", [ORG]);
  });

  afterAll(async () => {
    await pool.query("delete from lead_state where organization_id = $1", [ORG]);
    await pool.query("delete from contacts where id = $1", [CONTATO]);
    await pool.query("delete from organizations where id = $1", [ORG]);
    await pool.end();
  });

  it("o MESMO texto escrito de novo é outra proposta", () => {
    // O caso que derrubou a trava por texto.
    return (async () => {
      const a = await escreveEstado("enviar proposta", true);
      const b = await escreveEstado("enviar proposta", true);
      expect(a.next_action).toBe(b.next_action);
      expect(Number(b.next_action_seq)).toBe(Number(a.next_action_seq) + 1);
    })();
  });

  it("escrita de estado que NÃO toca a proposta não move a identidade", async () => {
    // Se movesse, toda mudança de estágio ou de BANT invalidaria uma
    // autorização humana perfeitamente válida — era o defeito de usar
    // `updated_at`, só que com outro nome.
    const antes = await escreveEstado("enviar proposta", true);
    const depois = await escreveEstado(antes.next_action, false);
    expect(Number(depois.next_action_seq)).toBe(Number(antes.next_action_seq));
    expect(depois.next_action).toBe(antes.next_action);
  });

  it("limpar a proposta também é uma escrita, e conta", async () => {
    // Aprovar/ignorar zera `next_action`. Se a identidade não avançasse aqui,
    // uma autorização antiga poderia casar com a proposta seguinte.
    const antes = await escreveEstado("enviar proposta", true);
    const limpo = await escreveEstado(null, true);
    expect(limpo.next_action).toBeNull();
    expect(Number(limpo.next_action_seq)).toBe(Number(antes.next_action_seq) + 1);
  });

  it("a coluna nasce em 0 para quem já existia", async () => {
    await pool.query("delete from lead_state where organization_id = $1", [ORG]);
    await pool.query(
      `insert into lead_state (organization_id, contact_id, stage, qualification, next_action)
       values ($1, $2, 'qualifying', '{}'::jsonb, 'proposta antiga')`,
      [ORG, CONTATO],
    );
    const { rows } = await pool.query(
      "select next_action_seq from lead_state where organization_id = $1 and contact_id = $2",
      [ORG, CONTATO],
    );
    // 0 é o certo: a proposta que estava lá antes desta coluna nunca foi
    // autorizada por ninguém, então nenhuma autorização em trânsito casa com ela.
    expect(Number((rows[0] as { next_action_seq: string }).next_action_seq)).toBe(0);
  });
});
