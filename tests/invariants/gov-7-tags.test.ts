import { beforeAll, describe, expect, it } from "vitest";

import {
  columnExists,
  indexExists,
  seedGov,
  sql,
  GOV_ORG,
  GOV_CONV_UNASSIGNED,
  GOV_CONV_AGENT_B,
} from "./gov-helpers";

/**
 * Eixo 7 — Tags (spec 13 §1; fase que fecha: G3).
 * docs/specs/13-spec-governanca-atendimento.md — dor: "origem/categoria/
 * etiquetas ausentes ou não-filtráveis". Padrão do repo: tags text[] + GIN
 * (CLAUDE.md §Modelagem); alvo conversations.tags na spec 13 §3.
 */

beforeAll(() => {
  seedGov();
});

describe("eixo 7 — tags", () => {
  it("contacts.tags e crm_leads.tags existem com índice GIN (padrão filtrável)", () => {
    expect(columnExists("contacts", "tags")).toBe(true);
    expect(columnExists("crm_leads", "tags")).toBe(true);
    expect(indexExists("idx_contacts_tags_gin")).toBe(true);
    expect(indexExists("idx_crm_leads_tags_gin")).toBe(true);
  });

  // G3-05: conversas etiquetáveis — conversations.tags text[] + GIN
  // (spec 13 §3.3, mesmo padrão de contacts/leads).
  it("conversations.tags text[] existe (spec 13 §3)", () => {
    expect(columnExists("conversations", "tags")).toBe(true);
    expect(indexExists("idx_conversations_tags_gin")).toBe(true);
  });

  // G3-05 acceptance 4: filtro por tag é org-scoped — `tags && array[...]`
  // devolve só as marcadas da org, sem vazar de outra org com a MESMA tag.
  it("filtro por tag é org-scoped — tags && array[...] não vaza entre orgs", () => {
    const ORG2 = "cccccccc-0000-4000-8000-000000000002";
    const S2 = "cccccccc-2222-4000-8000-000000000002";
    const C2 = "cccccccc-3333-4000-8000-000000000005";
    const CONV2 = "cccccccc-4444-4000-8000-000000000005";

    sql(`
      -- org 1: marca UMA conversa; a outra (GOV_CONV_AGENT_B) fica sem tag ('{}').
      update public.conversations set tags = array['reclamacao']
        where id = '${GOV_CONV_UNASSIGNED}';
      -- org 2 com a MESMA tag (prova de não-vazamento).
      insert into public.organizations (id, slug, legal_name, display_name)
        values ('${ORG2}', 'gov-inv-2', 'Gov Invariant Org 2', 'Gov Inv 2')
        on conflict do nothing;
      do $g$ begin
        insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
          values ('${S2}', '${ORG2}', 'gov-inv-2', '\\x00'::bytea);
      exception when unique_violation then null; end $g$;
      insert into public.contacts (id, organization_id, display_name)
        values ('${C2}', '${ORG2}', 'Gov Invariant Contact Org2') on conflict do nothing;
      insert into public.conversations (id, organization_id, contact_id, channel_session_id, status, tags)
        values ('${CONV2}', '${ORG2}', '${C2}', '${S2}', 'open', array['reclamacao'])
        on conflict (id) do update set tags = excluded.tags;
    `);

    const count = (q: string) => Number(sql(q).trim());

    // org-scoped: só a marcada da org 1.
    expect(
      count(`select count(*) from public.conversations
        where organization_id = '${GOV_ORG}' and tags && array['reclamacao'];`),
    ).toBe(1);

    // a conversa sem tag da org 1 NÃO entra no filtro.
    expect(
      count(`select count(*) from public.conversations
        where organization_id = '${GOV_ORG}' and tags && array['reclamacao']
          and id = '${GOV_CONV_AGENT_B}';`),
    ).toBe(0);

    // a MESMA tag existe em 2+ orgs — sem org-scope o filtro vazaria.
    expect(
      count(`select count(*) from public.conversations where tags && array['reclamacao'];`),
    ).toBeGreaterThanOrEqual(2);

    // a query org-scoped da org 2 devolve só a dela.
    expect(
      count(`select count(*) from public.conversations
        where organization_id = '${ORG2}' and tags && array['reclamacao'];`),
    ).toBe(1);
  });
});
