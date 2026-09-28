import { beforeAll, describe, expect, it } from "vitest";

import { GOV_ORG, GOV_SESSION, columnExists, seedGov, sql } from "./gov-helpers";

/**
 * G-0202 — `assigned_to_user_name` é escrita por `fn_conversation_assign` no
 * MESMO update que grava `assigned_to_user_id`, e zerada junto no release.
 *
 * Prova no Postgres descartável (spec da migration 0202 — o conserto do custo
 * medido em `lib/users/nome-do-atendente.ts`: 1 requisição HTTP ao GoTrue Admin
 * API por atendente único da página do Inbox). A coluna some se a migration
 * não aplicou — usamos `columnExists` para falhar com uma mensagem clara em vez
 * de um erro de SQL genérico.
 *
 * Usuário próprio (fora de `ROLE_USERS` do helper) porque nenhum dos seeds de
 * `seedGov()` tem `raw_user_meta_data.full_name` — só e-mail sintético.
 *
 * Namespace 4060/3060 (não colide com 4040/3040 do gov-4b, 4050/3050 do
 * gov-5d, nem 4444/3333 do helper).
 */

const ATENDENTE_COM_NOME = "cccccccc-1160-4000-8000-000000000001";
const NOME_ESPERADO = "Ana Invariante da Silva";
const CONTACT = "cccccccc-3060-4000-8000-000000000001";
const CONV = "cccccccc-4060-4000-8000-000000000001";

function nomeDoAtendenteNaConversa(id: string): string | null {
  const out = sql(
    `select assigned_to_user_name from public.conversations where id = '${id}';`,
  );
  return out === "" ? null : out;
}

beforeAll(() => {
  seedGov();
  sql(`
    insert into auth.users (id, email, raw_user_meta_data)
      values ('${ATENDENTE_COM_NOME}', 'gov-atendente-com-nome@invariant.test',
              '{"full_name": "${NOME_ESPERADO}"}'::jsonb)
      on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${ATENDENTE_COM_NOME}', '${GOV_ORG}', 'agent', now())
      on conflict do nothing;
    insert into public.contacts (id, organization_id, display_name)
      values ('${CONTACT}', '${GOV_ORG}', 'Gov Assigned Name Contact')
      on conflict do nothing;
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status)
      values ('${CONV}', '${GOV_ORG}', '${CONTACT}', '${GOV_SESSION}', 'open')
      on conflict do nothing;
  `);
});

describe("G-0202 — coluna existe (a migration aplicou)", () => {
  it("public.conversations.assigned_to_user_name existe", () => {
    expect(columnExists("conversations", "assigned_to_user_name")).toBe(true);
  });
});

describe("G-0202 — fn_conversation_assign grava o nome junto com o id (claim)", () => {
  it("antes do assign: nenhum dono, nenhum nome", () => {
    expect(nomeDoAtendenteNaConversa(CONV)).toBeNull();
  });

  it("após fn_conversation_assign(...): assigned_to_user_name = full_name do atendente", () => {
    sql(
      `select 1 from public.fn_conversation_assign('${GOV_ORG}', '${CONV}', '${ATENDENTE_COM_NOME}', 'claim', null, false);`,
    );
    expect(nomeDoAtendenteNaConversa(CONV)).toBe(NOME_ESPERADO);
  });
});

describe("G-0202 — fn_conversation_assign zera o nome junto com o id (release)", () => {
  it("após release (p_to_user_id = null): assigned_to_user_name volta a NULL", () => {
    sql(
      `select 1 from public.fn_conversation_assign('${GOV_ORG}', '${CONV}', null, 'release', '${ATENDENTE_COM_NOME}', true);`,
    );
    const assignee = sql(
      `select assigned_to_user_id is null from public.conversations where id = '${CONV}';`,
    );
    expect(assignee).toBe("t");
    expect(nomeDoAtendenteNaConversa(CONV)).toBeNull();
  });
});
