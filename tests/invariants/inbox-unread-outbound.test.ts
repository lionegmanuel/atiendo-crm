import { beforeAll, describe, expect, it } from "vitest";

import { GOV_ORG, GOV_SESSION, seedGov, sql } from "./gov-helpers";

/**
 * Badge da inbox: unread = mensagens do cliente desde a última resposta.
 *
 * Antes da 0161 o contador só subia em inbound e nunca caía no outbound —
 * acumulava mensagens já respondidas (6 no badge, 1 pendente na thread).
 */

const CONV = "cccccccc-4061-4000-8000-000000000001";
const CONTACT = "cccccccc-3061-4000-8000-000000000001";

function unreadOf(id: string): number {
  return Number(
    sql(`select unread_count_for_assignee from public.conversations where id = '${id}';`),
  );
}

beforeAll(() => {
  seedGov();
  sql(`
    insert into public.contacts (id, organization_id, display_name)
      values ('${CONTACT}', '${GOV_ORG}', 'Unread Outbound Contact')
      on conflict do nothing;

    insert into public.conversations
      (id, organization_id, contact_id, channel_session_id, status, unread_count_for_assignee)
      values ('${CONV}', '${GOV_ORG}', '${CONTACT}', '${GOV_SESSION}', 'open', 0)
      on conflict do nothing;
  `);
});

describe("fn_mark_conversation_message — unread reflete pendência real", () => {
  it("três inbound seguidos ⇒ unread = 3", () => {
    for (let i = 0; i < 3; i++) {
      sql(
        `select public.fn_mark_conversation_message('${CONV}', 'inbound', 'msg ${i}', now());`,
      );
    }
    expect(unreadOf(CONV)).toBe(3);
  });

  it("outbound zera o contador (resposta dada)", () => {
    sql(
      `select public.fn_mark_conversation_message('${CONV}', 'outbound', 'resposta', now());`,
    );
    expect(unreadOf(CONV)).toBe(0);
  });

  it("novo inbound após resposta ⇒ unread = 1 (não herda acumulado anterior)", () => {
    sql(
      `select public.fn_mark_conversation_message('${CONV}', 'inbound', 'obrigada', now());`,
    );
    expect(unreadOf(CONV)).toBe(1);
  });

  it("inbound carimba contacts.last_activity_at", () => {
    const antes = sql(
      `select last_activity_at from public.contacts where id = '${CONTACT}';`,
    );
    sql(
      `select public.fn_mark_conversation_message('${CONV}', 'inbound', 'ping', now());`,
    );
    const depois = sql(
      `select last_activity_at from public.contacts where id = '${CONTACT}';`,
    );
    expect(depois).not.toBe("");
    expect(depois).not.toBe(antes);
  });
});
