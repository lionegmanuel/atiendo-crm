import { execFileSync } from "node:child_process";

import { beforeAll, describe, expect, it } from "vitest";

/**
 * NA AGENDA, O PAPEL DECIDE QUEM ESCREVE — E ISSO SE MEDE ESCREVENDO.
 *
 * ═══ Por que não basta o invariante que já existe ═══
 *
 * `rbac-config-ia-canais` tem a catraca "nenhuma tabela NOVA entra com policy
 * ALL só-tenancy", e ela pegou estas cinco tabelas quando nasceram. Mas aquele
 * teste é de CATÁLOGO: ele pergunta se o texto da policy contém
 * `role_at_least`. O aviso está escrito no próprio `rls-isolation.test.ts`:
 * uma policy que diga `organization_id in (...) or true` satisfaz a checagem de
 * catálogo e devolve a organização inteira. Presença de símbolo não é
 * comportamento.
 *
 * Aqui a pergunta é feita à porta que o usuário realmente tem: `set role
 * authenticated` + o JWT dele, que é como o PostgREST fala com o banco — e o
 * PostgREST é exposto ao browser por construção, URL e anon key vão no bundle.
 * `requireRole()` na rota Next não é a única porta.
 *
 * ═══ Cada caso vem em PAR ═══
 *
 * O papel de baixo é barrado E o papel de cima passa. Um arquivo só com a
 * metade negativa fica verde se a tabela sumir, se a policy negar todo mundo,
 * ou se a fixture não existir — três jeitos de "passar" sem proteger nada.
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
    ["exec", "-i", containerName, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tA", "-f", "-"],
    { input: script, encoding: "utf8" },
  ).trim();
}

/** Tenta escrever COMO o usuário. Devolve se o banco deixou. */
function escreveComo(userId: string, comando: string): boolean {
  try {
    sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
      ${comando}
    `);
    return true;
  } catch {
    return false;
  }
}

const ORG = "cab0c0da-0000-4000-8000-00000000000a";
const VIEWER = "cab0c0da-1111-4000-8000-000000000001";
const AGENT = "cab0c0da-1111-4000-8000-000000000002";
const OUTRO_AGENT = "cab0c0da-1111-4000-8000-000000000003";
const MANAGER = "cab0c0da-1111-4000-8000-000000000004";
const ADMIN = "cab0c0da-1111-4000-8000-000000000005";
/**
 * Uma conexão REAL, semeada pelo service_role.
 *
 * ⚠️ Ela existe por causa de um defeito que a sabotagem pegou neste próprio
 * arquivo. A primeira versão punha um uuid aleatório em `connection_id`, que é
 * FK para `calendar_connections`: o INSERT falhava por violação de chave
 * estrangeira (23503) e o caso ficava verde — pelo motivo errado. Provado
 * medindo, não deduzido: afrouxei a policy de `calendar_external_events` para
 * o admin poder escrever, e o caso NÃO vermelheceu, porque a FK barrava antes
 * de a RLS ser consultada. Com um id que existe, quem barra é a política.
 */
const CONEXAO = "cab0c0da-2222-4000-8000-000000000001";

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${VIEWER}',      'agenda-rbac-viewer@invariant.test'),
      ('${AGENT}',       'agenda-rbac-agent@invariant.test'),
      ('${OUTRO_AGENT}', 'agenda-rbac-agent2@invariant.test'),
      ('${MANAGER}',     'agenda-rbac-manager@invariant.test'),
      ('${ADMIN}',       'agenda-rbac-admin@invariant.test')
      on conflict (id) do nothing;

    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG}', 'agenda-rbac', 'Agenda RBAC', 'Agenda RBAC')
      on conflict (id) do nothing;

    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${VIEWER}',      '${ORG}', 'viewer',  now()),
      ('${AGENT}',       '${ORG}', 'agent',   now()),
      ('${OUTRO_AGENT}', '${ORG}', 'agent',   now()),
      ('${MANAGER}',     '${ORG}', 'manager', now()),
      ('${ADMIN}',       '${ORG}', 'admin',   now())
      on conflict do nothing;

    insert into public.calendar_connections (id, organization_id, user_id, account_email, status)
      values ('${CONEXAO}', '${ORG}', '${AGENT}', 'conexao@invariant.test', 'healthy')
      on conflict (id) do nothing;
  `);
});

function novoTipo(quem: string, slug: string): boolean {
  return escreveComo(
    quem,
    `insert into public.calendar_event_types (organization_id, name, slug, category, duration_minutes)
       values ('${ORG}', 'Tipo ${slug}', '${slug}', 'consulta', 30);`,
  );
}

function novoCompromisso(quem: string, titulo: string): boolean {
  return escreveComo(
    quem,
    `insert into public.calendar_appointments (organization_id, title, starts_at, ends_at)
       values ('${ORG}', '${titulo}', now() + interval '1 day', now() + interval '1 day 30 minutes');`,
  );
}

function novaExcecao(quem: string, dono: string, dia: number): boolean {
  return escreveComo(
    quem,
    `insert into public.calendar_availability_exceptions (organization_id, user_id, exception_date, reason)
       values ('${ORG}', '${dono}', current_date + ${dia}, 'exceção do invariante');`,
  );
}

describe("tipos de agendamento — configuração do negócio, escreve manager+", () => {
  it("o agent NÃO cria um tipo de agendamento", () => {
    expect(novoTipo(AGENT, "tipo-do-agent")).toBe(false);
  });

  it("...e o manager cria (senão a proteção seria a feature quebrada)", () => {
    expect(novoTipo(MANAGER, "tipo-do-manager")).toBe(true);
  });
});

describe("compromissos — a operação do dia, escreve agent+", () => {
  it("o viewer NÃO marca um compromisso", () => {
    expect(novoCompromisso(VIEWER, "marcado pelo viewer")).toBe(false);
  });

  it("...e o agent marca — é o trabalho dele", () => {
    expect(novoCompromisso(AGENT, "marcado pelo agent")).toBe(true);
  });

  it("mas o viewer LÊ a agenda: o gate é de escrita, não de acesso", () => {
    const quantos = sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${VIEWER}"}', false);
      select count(*) from public.calendar_appointments where organization_id = '${ORG}';
    `);
    const linhas = quantos.split("\n");
    expect(Number(linhas[linhas.length - 1])).toBeGreaterThan(0);
  });
});

describe("exceções de agenda — a de cada um é de cada um", () => {
  it("o agent escreve a PRÓPRIA exceção, sem depender de ninguém", () => {
    expect(novaExcecao(AGENT, AGENT, 10)).toBe(true);
  });

  it("o agent NÃO escreve a exceção de OUTRA pessoa", () => {
    // O caso que distingue esta tabela das outras: aqui não basta o papel, tem
    // de ser o dono. Um atendente bloqueando a agenda do colega é o defeito.
    expect(novaExcecao(OUTRO_AGENT, AGENT, 11)).toBe(false);
  });

  it("...e o manager escreve a de qualquer um — escala é trabalho de quem coordena", () => {
    expect(novaExcecao(MANAGER, AGENT, 12)).toBe(true);
  });
});

describe("o espelho do Google — escrita de ninguém, nem do admin", () => {
  it("nem o admin da organização escreve em calendar_external_events", () => {
    // Não é excesso de zelo: esta tabela é a fonte de conflito do motor de
    // slots. Quem conseguisse escrever aqui faria a agenda marcar em cima de
    // compromisso real, e o sintoma apareceria no cliente, não na tela.
    const conseguiu = escreveComo(
      ADMIN,
      `insert into public.calendar_external_events
         (organization_id, connection_id, external_calendar_id, external_event_id, starts_at, ends_at)
       values ('${ORG}', '${CONEXAO}', 'primary', 'forjado',
               now() + interval '5 days', now() + interval '5 days 1 hour');`,
    );
    expect(conseguiu).toBe(false);
  });

  it("nem o admin escreve em calendar_connection_calendars", () => {
    const conseguiu = escreveComo(
      ADMIN,
      `insert into public.calendar_connection_calendars
         (organization_id, connection_id, external_calendar_id, name)
       values ('${ORG}', '${CONEXAO}', 'forjado', 'Agenda forjada');`,
    );
    expect(conseguiu).toBe(false);
  });

  it("CONTROLE: o service_role escreve nas duas — senão o sync não teria como existir", () => {
    // Sem este caso, o jeito trivial de deixar os dois de cima verdes é uma
    // policy que negue todo mundo, inclusive quem precisa escrever.
    const antes = Number(
      sql(`select count(*) from public.calendar_external_events where organization_id = '${ORG}';`),
    );
    sql(`
      insert into public.calendar_external_events
        (organization_id, connection_id, external_calendar_id, external_event_id, starts_at, ends_at)
      values ('${ORG}', '${CONEXAO}', 'primary', 'do-sync',
              now() + interval '6 days', now() + interval '6 days 1 hour');
    `);
    const depois = Number(
      sql(`select count(*) from public.calendar_external_events where organization_id = '${ORG}';`),
    );
    expect(depois).toBe(antes + 1);
  });
});
