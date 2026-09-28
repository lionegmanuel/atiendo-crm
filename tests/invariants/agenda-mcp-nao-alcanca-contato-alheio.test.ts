import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { marcarAgendamentoHandler } from "@/app/api/v1/agenda/agendamentos/_handler";
import type { HandlerCtx } from "@/lib/api/handlers/types";

import { pgComoSupabase } from "../pg-como-supabase";

/**
 * O AGENTE DA ORGANIZAÇÃO A NÃO MARCA CONSULTA PARA O CLIENTE DA B.
 *
 * ═══ O defeito que este arquivo fecha ═══
 *
 * `lib/mcp/tools/agendamento.ts:259` aceita `contact_id: z.string().uuid()` livre
 * do modelo, e o handler o gravava CRU. Ele roda com service role e filtra
 * `organization_id` em toda query — `contact_id` era o ÚNICO campo de entrada
 * que não era resolvido contra a organização.
 *
 * ═══ Por que não era "só" um bug de dado ═══
 *
 * Hoje não vaza PII (a tela lê contatos com a sessão do usuário, sob RLS) e não
 * permite enumerar (o par de respostas só confirma um uuid que quem chamou já
 * tem). O que preocupa é o depois: a migration 0177 diz que `contact_id` é
 * "quem recebe o LEMBRETE". No dia em que o worker de lembrete nascer, a linha
 * vira a organização A mandando WhatsApp para o cliente da B — e o
 * `on delete restrict` prende essa linha numa org que não a enxerga.
 *
 * ═══ Por que arquivo NOVO e não um caso em `mcp-nao-alcanca-outro-tenant` ═══
 *
 * Aquele arquivo é a casa natural desta classe e tem os dois tenants montados.
 * Mas `tests/invariants/**` é congelado pelo catraca: modificar invariante
 * existente é bloqueado, ADICIONAR é permitido — e está escrito no cabeçalho do
 * `loop/hooks/freeze-invariants.sh`. Acrescentar aqui é o gesto que o catraca
 * existe para permitir.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  host: "127.0.0.1",
  port: PORT,
  user: "postgres",
  password: "postgres",
  database: "postgres",
});
const db = pgComoSupabase(pool);

const ORG_A = "ca1e0da0-0000-4000-8000-00000000000a";
const ORG_B = "ca1e0da0-0000-4000-8000-00000000000b";
const DONO_A = "ca1e0da0-1111-4000-8000-00000000000a";

let contatoDaVitima = "";
let contatoProprio = "";
let tipoDeA = "";

function ctxDoAgenteDeA(): HandlerCtx {
  return {
    organization_id: ORG_A,
    actor: { type: "ai_agent", id: "run-de-a", role: "agent" },
    requestId: "req-agenda-cross-tenant",
  };
}

/** Uma quarta-feira às 10h, dentro da jornada semeada abaixo. */
function proximaQuarta(): string {
  const d = new Date("2026-09-02T13:00:00.000Z");
  return d.toISOString();
}

beforeAll(async () => {
  for (const [id, slug] of [
    [ORG_A, "agenda-cross-a"],
    [ORG_B, "agenda-cross-b"],
  ] as const) {
    await pool.query(
      `insert into organizations (id, slug, legal_name, display_name)
       values ($1, $2, 'Cross Agenda LTDA', 'Cross Agenda') on conflict (id) do nothing`,
      [id, slug],
    );
  }

  await pool.query(
    `insert into auth.users (id, email) values ($1, 'dono-a@invariant.test')
     on conflict (id) do nothing`,
    [DONO_A],
  );
  await pool.query(
    `insert into user_organizations (user_id, organization_id, role)
     values ($1, $2, 'admin') on conflict do nothing`,
    [DONO_A, ORG_A],
  );
  await pool.query(
    `insert into attendant_availability (organization_id, user_id, schedule)
     values ($1, $2, $3::jsonb) on conflict (organization_id, user_id) do update set schedule = excluded.schedule`,
    [
      ORG_A,
      DONO_A,
      JSON.stringify({
        timezone: "America/Sao_Paulo",
        windows: [1, 2, 3, 4, 5].map((dow) => ({ dow, start: "09:00", end: "18:00" })),
      }),
    ],
  );

  const tipo = await pool.query<{ id: string }>(
    `insert into calendar_event_types
       (organization_id, slug, name, duration_minutes, default_owner_user_id, is_active)
     values ($1, 'cross-consulta', 'Consulta Cross', 30, $2, true) returning id`,
    [ORG_A, DONO_A],
  );
  tipoDeA = tipo.rows[0]!.id;

  const vitima = await pool.query<{ id: string }>(
    `insert into contacts (organization_id, name) values ($1, 'Cliente da B') returning id`,
    [ORG_B],
  );
  contatoDaVitima = vitima.rows[0]!.id;

  const proprio = await pool.query<{ id: string }>(
    `insert into contacts (organization_id, name) values ($1, 'Cliente da A') returning id`,
    [ORG_A],
  );
  contatoProprio = proprio.rows[0]!.id;
});

afterAll(async () => {
  await pool.end();
});

describe("o contato da outra organização", () => {
  it("o cenário está montado — sem isto, os casos abaixo medem o vazio", () => {
    // Guarda de vacuidade: se o seed falhasse, `contatoDaVitima` seria "" e o
    // handler recusaria por uuid inválido — vermelho pela razão errada, ou verde
    // pela razão errada, conforme o caso.
    expect(contatoDaVitima).not.toBe("");
    expect(contatoProprio).not.toBe("");
    expect(tipoDeA).not.toBe("");
    expect(contatoDaVitima).not.toBe(contatoProprio);
  });

  it("CONTROLE: o contato de A PASSA pela verificação — a recusa é por ORG, não por tudo", async () => {
    // ⚠️ ESTE CONTROLE MUDOU DE FORMA, e a razão vale mais que ele.
    //
    // A primeira versão marcava de verdade para o contato de A. Ela estourou —
    // e não no caso principal, no CONTROLE: `pgComoSupabase` não entende o embed
    // do PostgREST (`calendar_connections!inner(...)`) que a checagem de horário
    // usa. Se o adaptador devolvesse vazio em vez de estourar, o caso principal
    // teria passado por o handler não marcar NADA — gate de isolamento virando
    // decoração.
    //
    // A verificação do contato roda ANTES da checagem de horário. Então o que
    // este controle precisa provar não é "marcar funciona": é que a recusa
    // DISCRIMINA por organização. Contato de A passa pela verificação e falha
    // MAIS TARDE, com outro código; contato de B para ali, com `not_found`.
    //
    // É um controle mais fraco em cobertura e mais forte em precisão: ele prende
    // exatamente a propriedade que o gate existe para vigiar.
    const erro = (await marcarAgendamentoHandler(db, ctxDoAgenteDeA(), {
      event_type_id: tipoDeA,
      starts_at: proximaQuarta(),
      contact_id: contatoProprio,
    } as never).then(
      () => null,
      (e: unknown) => e,
    )) as { code?: string } | null;

    // Pode falhar adiante (o adaptador não faz embed) — o que NÃO pode é falhar
    // dizendo que o contato da própria organização não existe.
    if (erro) {
      expect(
        erro.code,
        "o contato da PRÓPRIA organização foi recusado como inexistente — a " +
          "verificação está filtrando por algo que não é a organização",
      ).not.toBe("not_found");
    }
  });

  it("NÃO marca para o contato de B — e a recusa é `not_found`", async () => {
    const antes = await pool.query<{ n: string }>(
      `select count(*) as n from calendar_appointments where contact_id = $1`,
      [contatoDaVitima],
    );

    const erro = (await marcarAgendamentoHandler(db, ctxDoAgenteDeA(), {
      event_type_id: tipoDeA,
      starts_at: proximaQuarta(),
      contact_id: contatoDaVitima,
    } as never).then(
      () => null,
      (e: unknown) => e,
    )) as { code?: string } | null;

    expect(erro, "o agente de A marcou consulta para o cliente da B").not.toBeNull();
    expect(
      erro?.code,
      "recusou, mas por outro motivo — e o par com o controle acima é o que prova " +
        "que a recusa é pela ORGANIZAÇÃO do contato",
    ).toBe("not_found");

    const depois = await pool.query<{ n: string }>(
      `select count(*) as n from calendar_appointments where contact_id = $1`,
      [contatoDaVitima],
    );
    expect(
      depois.rows[0]!.n,
      "o handler recusou e a linha nasceu mesmo assim — a recusa veio DEPOIS do INSERT",
    ).toBe(antes.rows[0]!.n);
  });
});
