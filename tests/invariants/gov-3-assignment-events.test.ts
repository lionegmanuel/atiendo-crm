import { beforeAll, describe, expect, it } from "vitest";

import {
  GOV_AGENT_A,
  GOV_AGENT_B,
  GOV_MANAGER,
  GOV_ORG,
  GOV_SESSION,
  countAs,
  lastLine,
  seedGov,
  sql,
  writeCountAs,
} from "./gov-helpers";

/**
 * Eixo 3 — G3-01: conversation_assignment_events + fn_conversation_assign
 * (migration 0031, spec 13 §3.1 + spec 04 §9).
 *
 * Invariantes:
 *  - claim/transfer/release via fn_conversation_assign gravam o evento na
 *    MESMA transação da mudança de assigned_to_user_id;
 *  - claim duplicado perde o optimistic lock (0 rows → rota devolve 409) e NÃO
 *    gera evento duplicado;
 *  - transferência re-zera unread_count_for_assignee (acceptance 5);
 *  - a tabela é append-only (sem policy de UPDATE/DELETE — família
 *    api_audit_log).
 */

// Fixture própria (namespace dddddddd) — não toca nas conversas do gov-helpers
// (GOV_CONV_CLAIM é reivindicada por gov-3-transfer.test.ts via UPDATE cru).
const CAE_CONTACT = "dddddddd-3333-4000-8000-000000000001";
const CAE_CONV = "dddddddd-4444-4000-8000-000000000001";

/**
 * Quem LÊ importa desde a migration 0173: `cae_select` deixou de ser membership
 * de org pura e passou a herdar o escopo da conversa (molde do `messages_select`).
 * Antes disso, um agent que não enxergava a conversa lia 0 linhas dela em
 * `conversations` e 1 em `conversation_assignment_events` — furo alcançável pelo
 * PostgREST com a anon key + o JWT do usuário. Por isso o leitor é explícito
 * aqui: contar como quem perdeu a conversa devolveria 0 e o teste mentiria sobre
 * o que a função gravou.
 */
function eventCount(where: string, leitor: string = GOV_MANAGER): number {
  return countAs(
    leitor,
    `select count(*) from public.conversation_assignment_events
      where conversation_id = '${CAE_CONV}' and ${where}`,
  );
}

function assignAs(userId: string, args: string): number {
  return countAs(
    userId,
    `select count(*) from public.fn_conversation_assign(
       '${GOV_ORG}'::uuid, '${CAE_CONV}'::uuid, ${args})`,
  );
}

beforeAll(() => {
  seedGov();
  sql(`
    insert into public.contacts (id, organization_id, display_name)
      values ('${CAE_CONTACT}', '${GOV_ORG}', 'Gov Invariant Contact CAE')
      on conflict do nothing;
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status)
      values ('${CAE_CONV}', '${GOV_ORG}', '${CAE_CONTACT}', '${GOV_SESSION}', 'open')
      on conflict do nothing;
  `);
});

describe("eixo 3 — G3-01: eventos de atribuição", () => {
  it("claim via fn_conversation_assign atribui E grava evento reason='claim' na mesma transação", () => {
    const rows = assignAs(GOV_AGENT_A, `'${GOV_AGENT_A}'::uuid, 'claim', null::uuid, true`);
    expect(rows).toBe(1);

    expect(
      eventCount(
        `reason = 'claim' and from_user_id is null
         and to_user_id = '${GOV_AGENT_A}' and changed_by = '${GOV_AGENT_A}'`,
      ),
    ).toBe(1);
  });

  it("claim duplicado: optimistic lock perde (0 rows → rota 409) e ZERO evento duplicado", () => {
    const rows = assignAs(GOV_AGENT_B, `'${GOV_AGENT_B}'::uuid, 'claim', null::uuid, true`);
    expect(rows).toBe(0);

    // Nenhum evento novo: segue exatamente 1 claim registrado.
    expect(eventCount(`reason = 'claim'`)).toBe(1);
  });

  it("transfer é imediata (G1-06d), grava evento from→to e re-zera unread_count_for_assignee", () => {
    // Simula não-lidas acumuladas do dono atual antes da transferência.
    sql(`update public.conversations set unread_count_for_assignee = 5 where id = '${CAE_CONV}';`);

    const rows = assignAs(GOV_AGENT_A, `'${GOV_AGENT_B}'::uuid, 'transfer', null::uuid, false`);
    expect(rows).toBe(1);

    expect(
      eventCount(
        `reason = 'transfer' and from_user_id = '${GOV_AGENT_A}'
         and to_user_id = '${GOV_AGENT_B}' and changed_by = '${GOV_AGENT_A}'`,
      ),
    ).toBe(1);

    const state = lastLine(
      sql(
        `select unread_count_for_assignee || '|' || assigned_to_user_id
           from public.conversations where id = '${CAE_CONV}';`,
      ),
    );
    expect(state).toBe(`0|${GOV_AGENT_B}`);
  });

  it("release grava evento reason='release' e devolve a conversa à fila", () => {
    const rows = assignAs(GOV_AGENT_B, `null::uuid, 'release', '${GOV_AGENT_B}'::uuid, true`);
    expect(rows).toBe(1);

    expect(
      eventCount(`reason = 'release' and from_user_id = '${GOV_AGENT_B}' and to_user_id is null`),
    ).toBe(1);

    const state = lastLine(
      sql(
        `select status || '|' || coalesce(assigned_to_user_id::text, 'null')
           from public.conversations where id = '${CAE_CONV}';`,
      ),
    );
    expect(state).toBe("open|null");
  });

  it("o histórico herda o escopo da conversa: quem não a enxerga não lê a auditoria dela (0173)", () => {
    // Estado neste ponto da sequência: a conversa foi transferida para B e depois
    // LIBERADA por B (`release`), então está sem dono — e em
    // `own_and_unassigned`, que é o default, conversa sem dono é visível a todo
    // agent. Reivindicá-la para B é o que põe A fora do escopo.
    expect(assignAs(GOV_AGENT_B, `'${GOV_AGENT_B}'::uuid, 'claim', null::uuid, true`)).toBe(1);

    // O controle primeiro: a conversa mesma já era invisível para A antes desta
    // migration. Sem esta asserção, um 0 na linha seguinte não distinguiria
    // "policy nova funcionando" de "fixture vazia".
    expect(
      countAs(GOV_AGENT_A, `select count(*) from public.conversations where id = '${CAE_CONV}'`),
    ).toBe(0);
    expect(
      countAs(GOV_AGENT_B, `select count(*) from public.conversations where id = '${CAE_CONV}'`),
    ).toBe(1);

    // E as linhas EXISTEM — provado por quem tem escopo org-wide.
    const total = eventCount("true", GOV_MANAGER);
    expect(total).toBeGreaterThan(0);

    // O invariante: mesmas linhas, leitor sem escopo, zero.
    expect(eventCount("true", GOV_AGENT_A)).toBe(0);
    expect(eventCount("true", GOV_AGENT_B)).toBe(total);
  });

  /**
   * A escrita foi BARRADA — pelos dois caminhos que hoje a barram, nesta ordem.
   *
   * Até a migration 0279 só existia um: `authenticated` tinha o GRANT (do
   * `ALTER DEFAULT PRIVILEGES … ON TABLES` do baseline) e quem recusava era a
   * RLS, por não haver policy de UPDATE/DELETE — daí o `writeCountAs` traduzir
   * "barrado" em ZERO LINHAS. A 0279 tirou o grant, e o Postgres passa a parar o
   * comando ANTES da RLS, com `permission denied for table …`: a MESMA
   * propriedade (a tabela não recebe UPDATE nem DELETE por login de usuário),
   * recusada mais cedo e por uma guarda mais forte.
   *
   * Sem esta ponte o caso ficaria VERMELHO por ter sido reforçado, que é o
   * modo de falha em que alguém "conserta" devolvendo o grant. O nome da tabela
   * entra na sonda de propósito: um `permission denied` em OUTRA tabela é
   * defeito de verdade e continua estourando.
   */
  function escritaBarrada(dml: string): number {
    try {
      return writeCountAs(GOV_MANAGER, dml);
    } catch (err) {
      const motivo = `${err instanceof Error ? err.message : String(err)}${
        (err as { stderr?: unknown }).stderr ?? ""
      }`;
      if (motivo.includes("permission denied for table conversation_assignment_events")) return 0;
      throw err;
    }
  }

  it("append-only: UPDATE e DELETE em conversation_assignment_events são negados (privilégio desde a 0279; RLS antes dela)", () => {
    // O escritor é o MANAGER e não o agent A, de propósito: desde a 0173 o A não
    // enxerga esta conversa, então um `0` escrito por ele não distinguiria
    // "não existe policy de UPDATE" de "a linha está fora do escopo do leitor" —
    // a catraca ficaria satisfeita pelo motivo errado. O manager VÊ a conversa
    // (asserção abaixo), então o único motivo possível para o 0 é o que este
    // caso existe para provar.
    expect(
      countAs(GOV_MANAGER, `select count(*) from public.conversations where id = '${CAE_CONV}'`),
    ).toBe(1);

    const updated = escritaBarrada(
      `update public.conversation_assignment_events set reason = 'routing'
        where conversation_id = '${CAE_CONV}'`,
    );
    expect(updated).toBe(0);

    const deleted = escritaBarrada(
      `delete from public.conversation_assignment_events
        where conversation_id = '${CAE_CONV}'`,
    );
    expect(deleted).toBe(0);

    // Os eventos continuam lá (história intacta). São QUATRO: claim(A),
    // transfer(A→B), release(B) e o claim(B) do caso do escopo herdado — o claim
    // duplicado de B perdeu o lock e, de propósito, não gravou nada.
    expect(eventCount("true")).toBe(4);
  });
});
