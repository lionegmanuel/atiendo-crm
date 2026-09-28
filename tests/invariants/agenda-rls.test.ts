import { execFileSync } from "node:child_process";

import { beforeAll, describe, expect, it } from "vitest";

/**
 * A AGENDA NÃO VAZA ENTRE ORGANIZAÇÕES — E O TOKEN DO GOOGLE NÃO VAZA DENTRO
 * DELA.
 *
 * ═══ Por que um arquivo próprio, e não uma linha em rls-isolation.test.ts ═══
 *
 * Duas razões, e a segunda é a que importa.
 *
 * A primeira é mecânica: `tests/invariants/**` é congelado por
 * `loop/hooks/freeze-invariants.sh` — arquivo NOVO (status `A`) passa, arquivo
 * MODIFICADO (`M`) é bloqueado. Acrescentar a linha das seis tabelas na lista
 * fixa daquele arquivo exigiria a env de escape, e a autorização para usá-la,
 * nos dois precedentes do repo, foi o próprio dono commitando. Não é minha
 * para tomar.
 *
 * A segunda é que aquele molde não sabe medir o caso desta feature. Ele semeia
 * um `agent` por organização e prova duas coisas por tabela: zero linhas do
 * vizinho e mais de zero linhas próprias. Numa tabela cuja policy é
 * dono-OU-manager, o controle positivo do `agent` falharia por acerto — e a
 * "correção" natural seria afrouxar a policy para caber no teste, que é o
 * defeito de trás para frente.
 *
 * ═══ O que este arquivo prova ═══
 *
 * 1. Controle positivo: quem é da organização lê a agenda dela. Sem isto, o
 *    jeito trivial de deixar o arquivo verde é quebrar a feature inteira.
 * 2. Isolamento: zero linhas do vizinho, nas tabelas da agenda.
 * 3. Gate de papel em `calendar_connections`: um `viewer` que não é dono da
 *    conexão lê ZERO, e o `manager` lê. É o caso que distingue esta tabela das
 *    outras cinco — ela guarda token OAuth, e o PostgREST serve a tabela com a
 *    anon key + o JWT do usuário, então a rota HTTP não é a única porta.
 * 4. E o dono lê a PRÓPRIA conexão mesmo sendo `agent` — senão o atendente não
 *    conseguiria ver o estado da agenda que ele mesmo conectou.
 *
 * Conectar como `postgres` mediria NADA (`rolbypassrls = t`). Aqui é
 * `set role authenticated` + `request.jwt.claims`, o mesmo caminho da produção.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error(
    "TEST_DB_CONTAINER not set — rode esta suíte via `pnpm test:db` (scripts/test-db.sh)",
  );
}
const containerName: string = container;

function sql(script: string): string {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      containerName,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-tA",
      "-f",
      "-",
    ],
    { input: script, encoding: "utf8" },
  ).trim();
}

function countAs(userId: string, countQuery: string): number {
  const out = sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
    ${countQuery}
  `);
  const lines = out.split("\n");
  const last = lines[lines.length - 1];
  if (last === undefined || !/^\d+$/.test(last)) {
    throw new Error(`saída inesperada do psql: ${out}`);
  }
  return Number(last);
}

// UUIDs próprios, para este arquivo e o rls-isolation não disputarem as mesmas
// linhas quando rodarem na mesma base.
const ORG_A = "ca1e0da2-0000-4000-8000-00000000000a";
const ORG_B = "ca1e0da2-0000-4000-8000-00000000000b";
const AGENT_A = "ca1e0da2-1111-4000-8000-00000000000a";
const VIEWER_A = "ca1e0da2-1111-4000-8000-00000000000c";
const MANAGER_A = "ca1e0da2-1111-4000-8000-00000000000d";
const AGENT_B = "ca1e0da2-1111-4000-8000-00000000000b";

/** As tabelas tenant-aware da agenda. */
const TABELAS_DA_AGENDA = [
  "calendar_event_types",
  "calendar_appointments",
  "calendar_availability_exceptions",
  "calendar_connections",
  "calendar_connection_calendars",
  "calendar_external_events",
  "calendar_locations",
] as const;

beforeAll(() => {
  // A cifra de OAuth (`fn_encrypt_oauth`) LEVANTA quando a chave não está
  // semeada — `raise exception 'NUVEMSHOP_OAUTH_ENCRYPTION_KEY ausente'`. O
  // prelude do harness não a semeia, então sem este bloco o arquivo inteiro
  // morre no seed, antes da primeira asserção.
  //
  // ⚠️ O nome da chave é `nuvemshop_oauth_key` porque foi a integração da
  // Nuvemshop que estreou esta cifra. Ela não é da Nuvemshop: é a chave OAuth
  // DA INSTALAÇÃO, e a agenda do Google usa a mesma. Quem conectar o Google
  // numa instalação que nunca configurou Nuvemshop recebe, hoje, um erro que
  // nomeia um produto que ele não usa.
  sql(`
    insert into private.app_secrets (name, value)
    values ('nuvemshop_oauth_key', 'chave-sintetica-do-invariante-com-32-mais-chars')
    on conflict (name) do nothing;
  `);

  sql(`
    insert into auth.users (id, email) values
      ('${AGENT_A}',   'agenda-agent-a@invariant.test'),
      ('${VIEWER_A}',  'agenda-viewer-a@invariant.test'),
      ('${MANAGER_A}', 'agenda-mgr-a@invariant.test'),
      ('${AGENT_B}',   'agenda-agent-b@invariant.test')
      on conflict (id) do nothing;

    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'agenda-inv-a', 'Agenda Invariant A', 'Agenda A'),
      ('${ORG_B}', 'agenda-inv-b', 'Agenda Invariant B', 'Agenda B')
      on conflict (id) do nothing;

    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${AGENT_A}',   '${ORG_A}', 'agent',   now()),
      ('${VIEWER_A}',  '${ORG_A}', 'viewer',  now()),
      ('${MANAGER_A}', '${ORG_A}', 'manager', now()),
      ('${AGENT_B}',   '${ORG_B}', 'agent',   now())
      on conflict do nothing;

    -- Um tipo, um compromisso, uma exceção, uma conexão, um calendário e um
    -- evento externo — POR ORGANIZAÇÃO. O dono da conexão é o atendente de
    -- cada lado, de propósito: é o que prova que o dono lê a própria.
    insert into public.calendar_event_types (organization_id, name, slug, category, duration_minutes)
    select v.org, 'Consulta do invariante', 'consulta-invariante', 'consulta', 30
      from (values ('${ORG_A}'::uuid, '${AGENT_A}'::uuid), ('${ORG_B}'::uuid, '${AGENT_B}'::uuid)) as v(org, dono)
     where not exists (select 1 from public.calendar_event_types t where t.organization_id = v.org);

    insert into public.calendar_appointments
      (organization_id, title, starts_at, ends_at, owner_user_id, status)
    select v.org, 'Compromisso do invariante',
           now() + interval '2 days', now() + interval '2 days 30 minutes', v.dono, 'confirmed'
      from (values ('${ORG_A}'::uuid, '${AGENT_A}'::uuid), ('${ORG_B}'::uuid, '${AGENT_B}'::uuid)) as v(org, dono)
     where not exists (select 1 from public.calendar_appointments a where a.organization_id = v.org);

    insert into public.calendar_availability_exceptions
      (organization_id, user_id, exception_date, is_unavailable, reason)
    select v.org, v.dono, current_date + 3, true, 'feriado do invariante'
      from (values ('${ORG_A}'::uuid, '${AGENT_A}'::uuid), ('${ORG_B}'::uuid, '${AGENT_B}'::uuid)) as v(org, dono)
     where not exists (select 1 from public.calendar_availability_exceptions e where e.organization_id = v.org);

    insert into public.calendar_connections
      (organization_id, user_id, provider, account_email, status,
       oauth_access_token_encrypted, token_expires_at)
    select v.org, v.dono, 'google_calendar', 'agenda-' || v.org || '@invariant.test', 'healthy',
           public.fn_encrypt_oauth('token-sintetico-do-invariante'), now() + interval '1 hour'
      from (values ('${ORG_A}'::uuid, '${AGENT_A}'::uuid), ('${ORG_B}'::uuid, '${AGENT_B}'::uuid)) as v(org, dono)
     where not exists (select 1 from public.calendar_connections c where c.organization_id = v.org);

    insert into public.calendar_connection_calendars
      (organization_id, connection_id, external_calendar_id, name, is_primary, is_destination)
    select c.organization_id, c.id, 'primary', 'Agenda principal', true, true
      from public.calendar_connections c
     where c.organization_id in ('${ORG_A}', '${ORG_B}')
       and not exists (
         select 1 from public.calendar_connection_calendars k where k.connection_id = c.id
       );

    insert into public.calendar_external_events
      (organization_id, connection_id, external_calendar_id, external_event_id,
       title, starts_at, ends_at)
    select c.organization_id, c.id, 'primary', 'evt-invariante-' || c.organization_id,
           'Compromisso que veio de fora',
           now() + interval '3 days', now() + interval '3 days 1 hour'
      from public.calendar_connections c
     where c.organization_id in ('${ORG_A}', '${ORG_B}')
       and not exists (
         select 1 from public.calendar_external_events x where x.connection_id = c.id
       );

    insert into public.calendar_locations (organization_id, address)
    select v.org, 'Sala do invariante'
      from (values ('${ORG_A}'::uuid), ('${ORG_B}'::uuid)) as v(org)
     where not exists (select 1 from public.calendar_locations l where l.organization_id = v.org);
  `);
});

describe("agenda — isolamento entre organizações", () => {
  // O controle positivo vem PRIMEIRO de propósito: sem ele, quebrar a feature
  // inteira deixaria as asserções de isolamento verdes por ausência de dado.
  it.each(["calendar_event_types", "calendar_appointments", "calendar_availability_exceptions", "calendar_connection_calendars", "calendar_external_events", "calendar_locations"])(
    "o agent da org A lê a própria org em %s (controle positivo)",
    (tabela) => {
      const proprias = countAs(
        AGENT_A,
        `select count(*) from public.${tabela} where organization_id = '${ORG_A}';`,
      );
      expect(proprias).toBeGreaterThan(0);
    },
  );

  it.each(TABELAS_DA_AGENDA)("o agent da org A lê ZERO linhas da org B em %s", (tabela) => {
    const vizinha = countAs(
      AGENT_A,
      `select count(*) from public.${tabela} where organization_id = '${ORG_B}';`,
    );
    expect(vizinha).toBe(0);
  });

  it.each(TABELAS_DA_AGENDA)("o agent da org B lê ZERO linhas da org A em %s", (tabela) => {
    const vizinha = countAs(
      AGENT_B,
      `select count(*) from public.${tabela} where organization_id = '${ORG_A}';`,
    );
    expect(vizinha).toBe(0);
  });
});

describe("calendar_connections — o gate de papel que as outras cinco não têm", () => {
  it("o DONO da conexão lê a própria, mesmo sendo `agent`", () => {
    const minhas = countAs(
      AGENT_A,
      `select count(*) from public.calendar_connections
        where organization_id = '${ORG_A}' and user_id = '${AGENT_A}';`,
    );
    expect(minhas).toBeGreaterThan(0);
  });

  it("o manager da org A lê a conexão de OUTRA pessoa da org", () => {
    const doColega = countAs(
      MANAGER_A,
      `select count(*) from public.calendar_connections
        where organization_id = '${ORG_A}' and user_id = '${AGENT_A}';`,
    );
    expect(doColega).toBeGreaterThan(0);
  });

  it("o viewer da org A NÃO lê a conexão de outra pessoa — nem o e-mail da conta", () => {
    const doColega = countAs(
      VIEWER_A,
      `select count(*) from public.calendar_connections
        where organization_id = '${ORG_A}' and user_id = '${AGENT_A}';`,
    );
    expect(doColega).toBe(0);
  });

  it("o viewer LÊ o resto da agenda da própria org — o gate é só da conexão", () => {
    // Sem este caso, uma policy que barrasse o viewer em TUDO passaria no caso
    // de cima e quebraria o produto: quem tem acesso de leitura precisa ver a
    // agenda, só não o token.
    const agenda = countAs(
      VIEWER_A,
      `select count(*) from public.calendar_appointments where organization_id = '${ORG_A}';`,
    );
    expect(agenda).toBeGreaterThan(0);
  });
});

describe("agenda — o token nunca fica em claro", () => {
  it("o access_token gravado NÃO contém o texto original", () => {
    const emClaro = sql(`
      select count(*) from public.calendar_connections
       where organization_id = '${ORG_A}'
         and position('token-sintetico-do-invariante' in encode(oauth_access_token_encrypted, 'escape')) > 0;
    `);
    expect(Number(emClaro)).toBe(0);
  });

  it("e ainda assim decifra de volta, com a chave (senão a cifra não serve)", () => {
    const devolta = sql(`
      select public.fn_decrypt_oauth(oauth_access_token_encrypted)
        from public.calendar_connections
       where organization_id = '${ORG_A}' limit 1;
    `);
    expect(devolta).toBe("token-sintetico-do-invariante");
  });
});
