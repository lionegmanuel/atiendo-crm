import { execFileSync } from "node:child_process";

import { beforeAll, describe, expect, it } from "vitest";

/**
 * DOIS CLIQUES NÃO MARCAM DUAS VEZES — E O ENCAIXE CONTINUA PERMITIDO.
 *
 * ═══ As duas metades, e a segunda é a que quase ninguém escreve ═══
 *
 * O índice `calendar_appointments_sem_duplicata_idx` fecha a janela entre a
 * validação do motor de slots e o INSERT. É fácil provar que ele BARRA o
 * duplicado; o que este arquivo também prova é o que ele NÃO barra.
 *
 * A migration 0177 recusou `exclude using gist` por dois motivos, e um deles é
 * de produto: proibir SOBREPOSIÇÃO mataria o encaixe que uma recepção faz todo
 * dia — 14h-15h e 14h30-15h30 para o mesmo atendente. Se alguém "fortalecer"
 * esta guarda para pegar sobreposição, os testes de barrar continuariam verdes
 * e o produto ficaria rígido onde a clínica é flexível, sem nada acusar.
 *
 * Por isso o caso do encaixe é asserção e não comentário: ele é a única coisa
 * que reprova quem trocar a régua.
 *
 * ═══ E um caso que documenta o ALCANCE, não uma proteção ═══
 *
 * Dois agendamentos SEM dono no mesmo instante entram os dois — e isso é o
 * comportamento declarado, não um descuido. Medido antes de escrever: com a
 * condição `owner_user_id is not null` e sem ela, o resultado é idêntico,
 * porque `NULL` nunca colide com `NULL` numa UNIQUE. Sem este caso escrito,
 * alguém "consertaria" o que está certo.
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

/** Tenta gravar como service_role (a RLS não é o assunto aqui). Devolve se entrou. */
function marca(campos: string): boolean {
  try {
    sql(`insert into public.calendar_appointments ${campos};`);
    return true;
  } catch {
    return false;
  }
}

const ORG = "dd000000-0000-4000-8000-00000000000a";
const DONO = "dd000000-1111-4000-8000-000000000001";
const OUTRO_DONO = "dd000000-1111-4000-8000-000000000002";
const QUANDO = "2026-11-10 14:00:00+00";

function base(dono: string | null, inicio: string, fim: string, status = "confirmed"): string {
  const d = dono === null ? "null" : `'${dono}'`;
  return `(organization_id, owner_user_id, title, starts_at, ends_at, status)
          values ('${ORG}', ${d}, 'compromisso', '${inicio}', '${fim}', '${status}')`;
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${DONO}', 'dup-dono@invariant.test'),
      ('${OUTRO_DONO}', 'dup-outro@invariant.test')
      on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG}', 'agenda-dup', 'Agenda Dup', 'Agenda Dup')
      on conflict (id) do nothing;
    delete from public.calendar_appointments where organization_id = '${ORG}';
  `);
});

describe("a guarda barra o duplo clique", () => {
  it("o primeiro compromisso entra (controle positivo)", () => {
    expect(marca(base(DONO, QUANDO, "2026-11-10 15:00:00+00"))).toBe(true);
  });

  it("o segundo, mesmo dono e MESMO INSTANTE, é recusado", () => {
    expect(marca(base(DONO, QUANDO, "2026-11-10 15:00:00+00"))).toBe(false);
  });

  it("mas cancelar o primeiro LIBERA o instante — a guarda é só sobre o que está de pé", () => {
    sql(`
      update public.calendar_appointments
         set status = 'cancelled', cancelled_at = now()
       where organization_id = '${ORG}' and owner_user_id = '${DONO}';
    `);
    expect(marca(base(DONO, QUANDO, "2026-11-10 15:00:00+00"))).toBe(true);
  });
});

describe("o que a guarda NÃO barra — e é aqui que ela se distingue da que foi recusada", () => {
  it("o ENCAIXE por sobreposição continua permitido: 14h-15h e 14h30-15h30, mesmo dono", () => {
    // Se alguém trocar este índice por `exclude using gist`, os testes de barrar
    // acima continuam verdes e SÓ este fica vermelho. Ele é a régua.
    expect(
      marca(base(DONO, "2026-11-10 14:30:00+00", "2026-11-10 15:30:00+00")),
    ).toBe(true);
  });

  it("dois atendentes DIFERENTES no mesmo instante: os dois entram", () => {
    expect(marca(base(OUTRO_DONO, QUANDO, "2026-11-10 15:00:00+00"))).toBe(true);
  });

  it("o mesmo dono em instante diferente: entra", () => {
    expect(marca(base(DONO, "2026-11-10 16:00:00+00", "2026-11-10 17:00:00+00"))).toBe(true);
  });

  it("dois SEM dono no mesmo instante entram os dois — alcance declarado, não descuido", () => {
    // `NULL` nunca colide com `NULL` numa UNIQUE, com ou sem a condição
    // `owner_user_id is not null`. Medido lado a lado antes de escrever. Este
    // caso existe para ninguém "consertar" o que está certo.
    expect(marca(base(null, "2026-11-10 18:00:00+00", "2026-11-10 19:00:00+00"))).toBe(true);
    expect(marca(base(null, "2026-11-10 18:00:00+00", "2026-11-10 19:00:00+00"))).toBe(true);
  });
});
