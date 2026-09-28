import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

/**
 * TIPO SEMEADO GANHA DONO — e sem dono não há agenda.
 *
 * ═══ O defeito que este arquivo fecha ═══
 *
 * `fn_semear_tipos_de_agendamento` roda num trigger `after insert on
 * organizations`, e naquele instante `user_organizations` está VAZIA para a org:
 * não há dono a escolher. Os três tipos nasciam com `default_owner_user_id`
 * nulo, e `lib/agenda/consulta.ts` exige dono — `params.ownerUserId ??
 * tipo.default_owner_user_id`, e sem ele devolve `sem_responsavel`.
 *
 * Medido no caminho REAL do produto, pela spec de marcar pela tela: a rota
 * respondeu, três vezes,
 *
 *   422 "Atendimento" não tem responsável definido, e sem responsável não há
 *       agenda para consultar.
 *
 * Toda organização nova nascia com três tipos de agendamento decorativos. E não
 * dava para perceber, porque a tela tinha o defeito complementar: usava
 * `tiposIniciais[0]` e `page.tsx` ordena por NOME — sempre "Atendimento", um dos
 * três sem dono.
 *
 * A saída (migration 0195, do @Arquiteto) não é semear diferente: é ADOTAR
 * quando o primeiro membro ATIVO chega. A função não estava errada, estava CEDO.
 *
 * ═══ Por que este arquivo existe ═══
 *
 * A 0195 chegou com migration, apêndice e MANIFEST — e sem teste. O mecanismo
 * existia e nada o vigiava. Os casos abaixo são as CINCO previsões nominais que
 * o autor escreveu antes de rodar (e que pegaram um defeito no próprio trigger
 * antes do commit: a primeira versão contava todos os membros e adotava um
 * ex-membro), mais um SEXTO que ninguém tinha previsto — ver o caso 6.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}
const containerName: string = container;

function sql(query: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", containerName, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tA", "-f", "-"],
    { input: query, encoding: "utf8" },
  ).trim();
}

/**
 * A PRIMEIRA linha não-vazia da saída.
 *
 * ⚠️ `sql().trim()` não basta num `insert ... returning`: o `-t` do psql suprime
 * o cabeçalho e o rodapé do resultado, mas NÃO a etiqueta do comando. A saída é
 * `<uuid>\nINSERT 0 1`, e o `.trim()` entregava as duas linhas — o uuid chegava
 * com quebra dentro e o psql seguinte reclamava `invalid input syntax for type
 * uuid`.
 *
 * E a minha primeira correção pegou a ÚLTIMA linha, que é justamente a etiqueta:
 * o erro trocou de `uuid com quebra` para `uuid = "INSERT 0 1"`. Dois palpites
 * seguidos sobre a forma da saída, e o que resolveu foi LER a mensagem em vez de
 * supor de novo.
 *
 * Foi o CONTROLE de vacuidade que denunciou as duas vezes: os seis casos
 * falharam JUNTO com ele, e falha do controle é instrumento quebrado — nunca
 * produto errado.
 */
function primeiraLinha(saida: string): string {
  const primeira = saida.split("\n").map((l) => l.trim()).filter(Boolean)[0];
  if (primeira === undefined) throw new Error(`o comando não devolveu nada: ${saida}`);
  return primeira;
}

/** Cria uma org e devolve seu id. O trigger de semear dispara sozinho. */
function orgNova(marca: string): string {
  return primeiraLinha(sql(`
    insert into organizations (slug, legal_name, display_name)
    values ('${marca}', '${marca} LTDA', '${marca}')
    returning id;`));
}

let semente = 0;

/**
 * `user_organizations.user_id` tem FK para `auth.users` — descoberto pelo erro,
 * não pela leitura, e o molde é o dos invariantes irmãos
 * (`agenda-lgpd-alcanca`, `agenda-rbac`): a linha em `auth.users` primeiro.
 */
function membro(orgId: string, papel: string, revogado: boolean): string {
  semente += 1;
  const id = primeiraLinha(sql(`select gen_random_uuid();`));
  sql(`insert into auth.users (id, email)
       values ('${id}', 'tipo-dono-${semente}@invariant.test') on conflict (id) do nothing;`);
  return primeiraLinha(sql(`
    insert into user_organizations (user_id, organization_id, role, revoked_at)
    values ('${id}', '${orgId}', '${papel}', ${revogado ? "now()" : "null"})
    returning user_id;`));
}

function semDono(orgId: string): number {
  return Number(
    primeiraLinha(sql(`select count(*) from calendar_event_types
          where organization_id = '${orgId}' and default_owner_user_id is null;`)),
  );
}

describe("tipo semeado ganha dono quando o primeiro membro ativo chega", () => {
  it("CONTROLE: org nova nasce COM tipos (senão todos os casos medem o vazio)", () => {
    // Sem isto, uma quebra no seed faria `semDono()` devolver 0 em toda parte e
    // os casos abaixo passariam medindo uma org sem tipo nenhum.
    const org = orgNova("ctrl-piso");
    const total = Number(sql(`select count(*) from calendar_event_types where organization_id='${org}';`));
    expect(total, "a org nova não recebeu tipo nenhum — o seed quebrou").toBeGreaterThan(0);
  });

  it("1. org nova, sem membro: os tipos ficam SEM dono", () => {
    // É o estado que a 0195 existe para curar, e ele precisa ser observável —
    // senão os casos seguintes não distinguem "adotou" de "nunca precisou".
    const org = orgNova("c1-sem-membro");
    expect(semDono(org)).toBeGreaterThan(0);
  });

  it("2. primeiro membro ATIVO adota todos os órfãos", () => {
    const org = orgNova("c2-primeiro");
    expect(semDono(org)).toBeGreaterThan(0);
    membro(org, "admin", false);
    expect(semDono(org), "o primeiro membro ativo não adotou os tipos").toBe(0);
  });

  it("3. segundo membro NÃO desfaz o que o operador zerou de propósito", () => {
    const org = orgNova("c3-segundo");
    membro(org, "admin", false);
    sql(`update calendar_event_types set default_owner_user_id = null
          where organization_id = '${org}';`);
    membro(org, "agent", false);
    expect(
      semDono(org),
      "o segundo membro readotou tipos que o operador zerou — a adoção não pode ser um laço",
    ).toBeGreaterThan(0);
  });

  it("4. membro REVOGADO não vira dono", () => {
    // Este é o caso que a predição nominal do autor pegou ANTES do commit: a
    // primeira versão do trigger contava todos os membros e adotava o ex-membro.
    const org = orgNova("c4-revogado");
    membro(org, "admin", true);
    expect(semDono(org), "um membro já revogado virou dono da agenda").toBeGreaterThan(0);
  });

  it("5. ativo que entra DEPOIS do revogado adota — a org não fica órfã", () => {
    // O furo simétrico do caso 4: contar TODOS em vez de só os ativos faria o
    // primeiro membro de verdade ver contagem 2 e nunca adotar. Órfã para sempre.
    const org = orgNova("c5-depois");
    membro(org, "viewer", true);
    membro(org, "admin", false);
    expect(semDono(org), "a org com um ex-membro nunca adota — órfã para sempre").toBe(0);
  });

  it("6. ⚠️ REATIVAR um membro NÃO adota — o gatilho é só de INSERT", () => {
    // ESTE CASO NÃO ESTAVA NA PREDIÇÃO DE NINGUÉM, e o caminho existe no produto:
    // `app/actions/team/acceptInvite.ts:63` reativa uma linha revogada com
    // `revoked_at: null` — isso é UPDATE, e o trigger é `after insert`.
    //
    // O teste ASSERTA o comportamento atual em vez de exigir o outro, e a razão
    // é escopo: para a org ficar órfã por este caminho, o PRIMEIRO membro de
    // todos precisa ter nascido revogado, o que o fluxo de convite não produz
    // (quem aceita nasce ativo). É buraco estreito, não alcançável hoje pelo
    // produto — e declarado aqui para que a próxima pessoa saiba que ele foi
    // MEDIDO e não esquecido.
    //
    // No dia em que alguém puser `after update of revoked_at` no trigger, esta
    // asserção fica vermelha e pede atualização — que é o comportamento certo
    // para uma dívida declarada.
    const org = orgNova("c6-reativado");
    const u = membro(org, "admin", true);
    expect(semDono(org)).toBeGreaterThan(0);
    sql(`update user_organizations set revoked_at = null
          where organization_id = '${org}' and user_id = '${u}';`);
    expect(
      semDono(org),
      "a reativação passou a adotar — se o trigger ganhou `after update`, atualize este caso",
    ).toBeGreaterThan(0);
  });
});
