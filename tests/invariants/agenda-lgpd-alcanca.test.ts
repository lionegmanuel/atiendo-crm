import { execFileSync } from "node:child_process";

import { beforeAll, describe, expect, it } from "vitest";

/**
 * ANONIMIZAR UM CONTATO APAGA A AGENDA DELE — E PRESERVA O QUE É OPERAÇÃO.
 *
 * O defeito que este arquivo vigia não dava erro: `fn_lgpd_cascade_redact_contact`
 * percorre uma lista escrita à mão sem `calendar_appointments`, a rota reportava
 * sucesso e o SLA de D+15 era marcado como cumprido — com a queixa clínica
 * legível no banco, com hora e endereço.
 *
 * As duas metades importam igualmente. Um teste que só provasse que o texto some
 * ficaria verde com um trigger que apagasse a linha inteira, e aí a clínica
 * perderia a resposta a "quantos atendimentos houve em março" — que é registro
 * de operação, não dado pessoal.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db`");
const containerName: string = container;

function sql(script: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", containerName, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tA", "-f", "-"],
    { input: script, encoding: "utf8" },
  ).trim();
}

const ORG = "16bd0000-0000-4000-8000-00000000000a";
const DONO = "16bd0000-1111-4000-8000-000000000001";
const ALVO = "16bd0000-2222-4000-8000-000000000001";
const VIZINHO = "16bd0000-2222-4000-8000-000000000002";

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${DONO}', 'lgpd-agenda@invariant.test')
      on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG}', 'agenda-lgpd', 'Agenda LGPD', 'Agenda LGPD') on conflict (id) do nothing;
    insert into public.contacts (id, organization_id, name) values
      ('${ALVO}',    '${ORG}', 'Maria Silva'),
      ('${VIZINHO}', '${ORG}', 'Joao Pereira')
      on conflict (id) do nothing;
  `);

  for (const contato of [ALVO, VIZINHO]) {
    sql(`
      insert into public.calendar_appointments
        (organization_id, contact_id, owner_user_id, title, description, notes,
         location_details, starts_at, ends_at, status)
      select '${ORG}', '${contato}', '${DONO}',
             'Consulta — ' || c.name, 'primeira avaliacao',
             'queixa: dor lombar ha 3 meses', 'Rua das Flores, 100',
             '2026-03-10 14:00:00+00', '2026-03-10 15:00:00+00', 'completed'
        from public.contacts c
       where c.id = '${contato}'
         and not exists (
           select 1 from public.calendar_appointments a where a.contact_id = '${contato}'
         );
    `);
  }
});

function campo(contato: string, coluna: string): string {
  return sql(`select coalesce(${coluna}::text, '<null>') from public.calendar_appointments
               where contact_id = '${contato}' limit 1;`);
}

describe("a cascata de LGPD alcança a agenda", () => {
  it("ANTES: a queixa está legível (controle positivo)", () => {
    expect(campo(ALVO, "notes")).toContain("dor lombar");
    expect(campo(ALVO, "title")).toContain("Maria");
  });

  it("anonimizar o contato apaga o texto livre do compromisso", () => {
    // Chama a FUNÇÃO REAL da cascata, não um `update is_anonymized` à mão.
    //
    // A primeira versão deste teste fazia o atalho e foi barrada pelo banco:
    // `contacts_anonymized_locked` exige `anonymized_at` junto com a flag. Isso
    // foi sorte — o atalho teria provado que o trigger dispara num UPDATE que a
    // produção nunca faz. Chamando a RPC, o que se mede é o caminho por onde a
    // anonimização realmente passa, e o trigger dispara DENTRO da transação dela.
    sql(`select public.fn_lgpd_cascade_redact_contact('${ORG}', '${ALVO}', gen_random_uuid());`);
    expect(campo(ALVO, "notes")).toBe("<null>");
    expect(campo(ALVO, "description")).toBe("<null>");
    expect(campo(ALVO, "location_details")).toBe("<null>");
    expect(campo(ALVO, "title")).toBe("Compromisso anonimizado");
  });

  it("...e PRESERVA o que é operação: horário, estado e dono", () => {
    // Sem este caso, um trigger que apagasse a linha inteira ficaria verde — e a
    // clínica perderia a resposta a "quantos atendimentos houve em março".
    expect(campo(ALVO, "starts_at")).toContain("2026-03-10");
    expect(campo(ALVO, "status")).toBe("completed");
    expect(campo(ALVO, "owner_user_id")).toBe(DONO);
  });

  it("o compromisso de OUTRO contato não é tocado", () => {
    expect(campo(VIZINHO, "notes")).toContain("dor lombar");
    expect(campo(VIZINHO, "title")).toContain("Joao");
  });
});
