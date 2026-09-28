import { execFileSync } from "node:child_process";

import { beforeAll, describe, expect, it } from "vitest";

/**
 * INSTALAÇÃO FRESCA TEM O QUE MARCAR — E O QUE O DONO EDITOU NÃO É SOBRESCRITO.
 *
 * O defeito não dava erro: sem nenhum `calendar_event_types`, a Agenda abre numa
 * semana em branco e não há o que clicar. Grade vazia é indistinguível de
 * "ninguém marcou hoje", e é assim que um P0 passa por comportamento normal.
 *
 * As três metades importam, e a terceira é a que quase ninguém escreve:
 *
 *  1. organização NOVA nasce com o piso — é o trigger;
 *  2. organização que JÁ existia recebe o piso — é o backfill, e sem ele todo
 *     clone instalado continuaria vazio;
 *  3. o que o dono EDITOU sobrevive à re-aplicação. O `update.sh` roda o
 *     `baseline.sql` inteiro a cada atualização; um `on conflict do update`
 *     sobrescreveria o tipo renomeado a cada versão do produto, em silêncio.
 *     Sem este caso, trocar `do nothing` por `do update` passa despercebido.
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

const ORG_NOVA = "5eed0000-0000-4000-8000-00000000000a";

function tipos(org: string): string[] {
  return sql(`select slug from public.calendar_event_types
               where organization_id = '${org}' order by position;`)
    .split("\n").map((s) => s.trim()).filter(Boolean);
}

beforeAll(() => {
  sql(`insert into public.organizations (id, slug, legal_name, display_name)
       values ('${ORG_NOVA}', 'agenda-seed', 'Agenda Seed', 'Agenda Seed')
       on conflict (id) do nothing;`);
});

describe("a agenda nasce com o que marcar", () => {
  it("organização NOVA nasce com o piso — é o trigger", () => {
    expect(tipos(ORG_NOVA)).toEqual(["consulta", "reuniao", "atendimento"]);
  });

  it("os tipos semeados são VÁLIDOS contra o CHECK de categoria", () => {
    // Um seed com literal fora dos 10 valores daria 23514 no install do clone.
    //
    // ⚠️ A primeira versão deste caso contava só as INVÁLIDAS, e passou verde na
    // sabotagem — porque sem seed nenhum não há linha nenhuma, e "zero
    // inválidas" sobre zero linhas é verdade vazia. Previ 5 vermelhos e vieram
    // 4; a divergência para MENOS foi o que denunciou. Agora conta as VÁLIDAS e
    // exige as três: o vácuo deixa de ser resposta aceitável.
    const validas = sql(`select count(*) from public.calendar_event_types
                          where organization_id = '${ORG_NOVA}'
                            and category in ('consulta','procedimento','retorno','visita',
                                             'vistoria','reuniao','call','orcamento',
                                             'demonstracao','outro');`);
    expect(Number(validas)).toBe(3);
  });

  it("TODA organização do banco tem pelo menos um tipo — é o backfill", () => {
    // Sem o backfill, o trigger cobriria só as futuras e todo clone já instalado
    // continuaria sem nada. Este caso mede as duas metades de uma vez.
    const vazias = sql(`select count(*) from public.organizations o
                         where not exists (
                           select 1 from public.calendar_event_types t
                            where t.organization_id = o.id
                         );`);
    expect(Number(vazias)).toBe(0);
  });

  it("o que o dono EDITOU sobrevive a re-semear", () => {
    sql(`update public.calendar_event_types
            set name = 'Consulta de avaliação', duration_minutes = 50
          where organization_id = '${ORG_NOVA}' and slug = 'consulta';`);
    sql(`select public.fn_semear_tipos_de_agendamento('${ORG_NOVA}');`);
    const nome = sql(`select name from public.calendar_event_types
                       where organization_id = '${ORG_NOVA}' and slug = 'consulta';`);
    const duracao = sql(`select duration_minutes from public.calendar_event_types
                          where organization_id = '${ORG_NOVA}' and slug = 'consulta';`);
    expect(nome).toBe("Consulta de avaliação");
    expect(duracao).toBe("50");
  });

  it("...e re-semear não duplica", () => {
    expect(tipos(ORG_NOVA).length).toBe(3);
  });
});
