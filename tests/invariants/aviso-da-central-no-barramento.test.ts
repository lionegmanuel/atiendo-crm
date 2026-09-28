/**
 * `trg_aviso_da_central_criado` (migration 0442): todo aviso da Central de uma
 * organização anuncia `central.aviso_criado`, para o push decidir o que vai ao
 * celular. Aviso de plataforma não anuncia, e a função não é RPC de ninguém.
 *
 * Contra o Postgres efêmero de `scripts/test-db.sh`, com o `baseline.sql`
 * aplicado — o que o kit self-host instala.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

const ORG = "d0439000-0000-4000-8000-000000000001";

beforeAll(() => {
  sql(`insert into organizations (id, slug, legal_name, display_name)
       values ('${ORG}', 'org-0442-avisos', 'Avisos LTDA', 'Avisos') on conflict (id) do nothing;`);
});

afterAll(() => {
  sql(`delete from organizations where id = '${ORG}';`);
});

describe("aviso da Central → barramento", () => {
  it("aviso da organização vira UM evento central.aviso_criado com kind e ref", () => {
    const linha = lastLine(
      sql(`with novo as (
             insert into agent_inbox_items (organization_id, kind, severity, title, ref_kind, ref_id)
             values ('${ORG}', 'handoff', 'critical', 'Passagem', 'conversation', gen_random_uuid())
             returning id
           )
           select id from novo;`),
    );
    expect(linha).toMatch(/^[0-9a-f-]{36}$/);
    const eventos = lastLine(
      sql(`select count(*)::text || '|' ||
                  coalesce(max(payload->>'item_id'), '') || '|' ||
                  coalesce(max(payload->>'kind'), '') || '|' ||
                  coalesce(max(payload->>'ref_kind'), '')
             from event_log
            where organization_id = '${ORG}'
              and event_type = 'central.aviso_criado'
              and entity_id = '${linha}';`),
    );
    expect(eventos).toBe(`1|${linha}|handoff|conversation`);
  });

  it("aviso de plataforma (organização nula) não anuncia", () => {
    const id = lastLine(
      sql(`with novo as (
             insert into agent_inbox_items (organization_id, kind, severity, title)
             values (null, 'other', 'warn', 'Plataforma') returning id
           )
           select id from novo;`),
    );
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const eventos = lastLine(
      sql(`select count(*) from event_log where event_type = 'central.aviso_criado' and entity_id = '${id}';`),
    );
    expect(eventos).toBe("0");
    sql(`delete from agent_inbox_items where id = '${id}';`);
  });

  it("a função do trigger não é executável por anon nem authenticated", () => {
    const privilegios = lastLine(
      sql(`select has_function_privilege('anon', 'public.fn_emit_aviso_da_central()', 'execute')::text || '|' ||
                  has_function_privilege('authenticated', 'public.fn_emit_aviso_da_central()', 'execute')::text;`),
    );
    expect(privilegios).toBe("false|false");
  });
});
