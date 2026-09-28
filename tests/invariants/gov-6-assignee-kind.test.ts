import { beforeAll, describe, expect, it } from "vitest";

import {
  GOV_AGENT_A,
  GOV_ORG,
  GOV_SESSION,
  GOV_VIEWER,
  countAs,
  lastLine,
  seedGov,
  sql,
} from "./gov-helpers";

/**
 * Eixo 6 — G3-02: assignee_kind ('user'|'ai') + guard de membership na
 * fn_conversation_assign (migration 0032, spec 13 §3.2; forward-fix INB-06a).
 *
 * Invariantes:
 *  - CHECK de coerência: kind='user' exige dono humano; kind='ai' exige sem dono;
 *  - fn_conversation_assign mantém assignee_kind ('user' no claim/handoff,
 *    null no release) e grava evento reason='handoff';
 *  - INB-06a: rpc direto NÃO atribui a viewer nem a usuário de outra org
 *    (raise assignee_not_eligible_member DENTRO da função — probe H8);
 *  - fn_member_role_in_org NEGA anon (revoke explícito de EXECUTE — o default
 *    privilege do Supabase concede EXECUTE a anon em toda função nova de
 *    public, e o JWT anon também tem auth.uid() null; sem o revoke, a anon
 *    key pública enumeraria membership/role cross-org via RPC do PostgREST).
 */

// Fixture própria (namespace eeeeeeee) — não toca nas conversas dos outros arquivos.
const AK_CONTACT = "eeeeeeee-3333-4000-8000-000000000001";
const AK_CONV = "eeeeeeee-4444-4000-8000-000000000001";
// Usuário de OUTRA org (org B) para a probe cross-org do INB-06a.
const AK_ORG_B = "eeeeeeee-0000-4000-8000-000000000002";
const AK_USER_ORG_B = "eeeeeeee-1111-4000-8000-000000000002";

function assignAs(userId: string, args: string): number {
  return countAs(
    userId,
    `select count(*) from public.fn_conversation_assign(
       '${GOV_ORG}'::uuid, '${AK_CONV}'::uuid, ${args})`,
  );
}

/** Executa o assign esperando erro; devolve o stderr do psql (mensagem do raise). */
function assignRejected(userId: string, args: string): string {
  try {
    assignAs(userId, args);
    return "";
  } catch (err) {
    return (err as { stderr?: string }).stderr ?? "";
  }
}

function convState(): string {
  return lastLine(
    sql(
      `select coalesce(assignee_kind, 'null') || '|' || coalesce(assigned_to_user_id::text, 'null')
         from public.conversations where id = '${AK_CONV}';`,
    ),
  );
}

beforeAll(() => {
  seedGov();
  sql(`
    insert into auth.users (id, email)
      values ('${AK_USER_ORG_B}', 'gov-agent-org-b@invariant.test')
      on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${AK_ORG_B}', 'gov-inv-b', 'Gov Invariant Org B', 'Gov Inv B')
      on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${AK_USER_ORG_B}', '${AK_ORG_B}', 'agent', now())
      on conflict do nothing;
    insert into public.contacts (id, organization_id, display_name)
      values ('${AK_CONTACT}', '${GOV_ORG}', 'Gov Invariant Contact AK')
      on conflict do nothing;
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status, assignee_kind)
      values ('${AK_CONV}', '${GOV_ORG}', '${AK_CONTACT}', '${GOV_SESSION}', 'ai_handling', 'ai')
      on conflict do nothing;
  `);
});

describe("eixo 6 — G3-02: assignee_kind + guard INB-06a", () => {
  it("CHECK de coerência: kind='user' sem dono e kind='ai' com dono são rejeitados", () => {
    let err = "";
    try {
      sql(
        `update public.conversations set assignee_kind = 'user', assigned_to_user_id = null
          where id = '${AK_CONV}';`,
      );
    } catch (e) {
      err = (e as { stderr?: string }).stderr ?? "";
    }
    expect(err).toContain("conversations_assignee_kind_coherence");

    err = "";
    try {
      sql(
        `update public.conversations
            set assignee_kind = 'ai', assigned_to_user_id = '${GOV_AGENT_A}'
          where id = '${AK_CONV}';`,
      );
    } catch (e) {
      err = (e as { stderr?: string }).stderr ?? "";
    }
    expect(err).toContain("conversations_assignee_kind_coherence");
  });

  it("handoff via fn: kind ai→'user' + evento reason='handoff' na mesma transação", () => {
    // Garante o estado 'com a IA' (independe do teste anterior).
    sql(
      `update public.conversations
          set assignee_kind = 'ai', assigned_to_user_id = null, status = 'ai_handling'
        where id = '${AK_CONV}';`,
    );

    const rows = assignAs(GOV_AGENT_A, `'${GOV_AGENT_A}'::uuid, 'handoff', null::uuid, false`);
    expect(rows).toBe(1);
    expect(convState()).toBe(`user|${GOV_AGENT_A}`);

    const events = countAs(
      GOV_AGENT_A,
      `select count(*) from public.conversation_assignment_events
        where conversation_id = '${AK_CONV}' and reason = 'handoff'
          and to_user_id = '${GOV_AGENT_A}'`,
    );
    expect(events).toBe(1);
  });

  it("release via fn: kind volta a null junto com o dono", () => {
    const rows = assignAs(GOV_AGENT_A, `null::uuid, 'release', '${GOV_AGENT_A}'::uuid, true`);
    expect(rows).toBe(1);
    expect(convState()).toBe("null|null");
  });

  it("INB-06a: rpc direto NÃO atribui a viewer (raise dentro da função)", () => {
    const stderr = assignRejected(GOV_AGENT_A, `'${GOV_VIEWER}'::uuid, 'transfer', null::uuid, false`);
    expect(stderr).toContain("assignee_not_eligible_member");
    expect(convState()).toBe("null|null"); // nada mudou
  });

  it("INB-06a: rpc direto NÃO atribui a usuário de OUTRA org", () => {
    const stderr = assignRejected(
      GOV_AGENT_A,
      `'${AK_USER_ORG_B}'::uuid, 'transfer', null::uuid, false`,
    );
    expect(stderr).toContain("assignee_not_eligible_member");
    expect(convState()).toBe("null|null");
  });

  it("fn_member_role_in_org NEGA anon (permission denied) e segue servindo o service_role", () => {
    // Mesma simulação do PostgREST anônimo: role anon + JWT sem `sub`
    // (auth.uid() null — igual ao path do service_role, por isso o EXECUTE
    // precisa ser negado no grant, não no corpo da função).
    let stderr = "";
    try {
      sql(`
        set role anon;
        select set_config('request.jwt.claims', '{}', false);
        select public.fn_member_role_in_org('${GOV_AGENT_A}'::uuid, '${GOV_ORG}'::uuid);
      `);
    } catch (e) {
      stderr = (e as { stderr?: string }).stderr ?? "";
    }
    expect(stderr).toContain("permission denied");

    // O path legítimo do sistema (worker via service_role, uid null) continua
    // respondendo — é dele que o guard INB-06a depende no handoff.
    const roleAsSystem = lastLine(
      sql(`
        set role service_role;
        select set_config('request.jwt.claims', '{}', false);
        select public.fn_member_role_in_org('${GOV_AGENT_A}'::uuid, '${GOV_ORG}'::uuid);
      `),
    );
    expect(roleAsSystem).toBe("agent");
  });

  it("claim via fn segue válido para membro agent+ e marca kind='user'", () => {
    const rows = assignAs(GOV_AGENT_A, `'${GOV_AGENT_A}'::uuid, 'claim', null::uuid, true`);
    expect(rows).toBe(1);
    expect(convState()).toBe(`user|${GOV_AGENT_A}`);
  });
});
