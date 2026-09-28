import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { beforeEach, describe, expect, it } from "vitest";

import { apenasDeMembrosAtivos } from "@/lib/agenda/google/membros";

/**
 * A AGENDA PESSOAL DE QUEM SAIU DA EMPRESA.
 *
 * `calendar_connections` guarda a agenda PESSOAL de uma pessoa, autorizada por ela via
 * OAuth. Quando o vínculo dela com a organização é revogado, o token do Google continua
 * válido — ele não sabe nada de RH. `apenasDeMembrosAtivos` é a única peça que corta
 * essa leitura, e ela é chamada por três crons (`agenda-google-sync`,
 * `agenda-google-refresh`, `agenda-google-push`).
 *
 * O defeito que esta cerca fecha: até aqui a peça não tinha UMA linha de teste, medido
 * antes de escrever este arquivo —
 *
 *     grep -rl apenasDeMembrosAtivos tests/    # 1 (só o worker, que a MOCKA)
 *
 * — o único arquivo que a cita substitui a função por um dublê que devolve tudo. Ou
 * seja: nenhuma das quatro propriedades abaixo era exercitada, incluindo a que decide
 * se uma queda de rede vira vazamento de agenda pessoal.
 *
 * Roda com:  npx vitest run tests/unit/agenda-apenas-de-membros-ativos.test.ts
 *
 * As quatro propriedades:
 *   1. membro ativo passa / membro com `revoked_at` não passa (o PAR — sem a segunda
 *      metade, uma função que devolve a lista intacta fica verde);
 *   2. checagem que FALHA não deixa ninguém passar (falha fechada);
 *   3. lista vazia sai vazia sem tocar no banco;
 *   4. a chave é o PAR (organização, usuário) — o mesmo `user_id` ativo na org A e
 *      revogado na org B não pode entrar pela linha da B.
 *
 * ─── E o SEGUNDO defeito, medido depois (a parte de baixo do arquivo) ───────
 *
 * As quatro propriedades acima guardam a FUNÇÃO. Nenhuma delas guarda quem a
 * CHAMA — e o filtro só serve para alguma coisa se estiver no caminho do cron.
 * Medido anulando a chamada em cada uma das três rotas, uma de cada vez:
 *
 *     const doTime = calendarios;   // no lugar de: await apenasDeMembrosAtivos(...)
 *
 *   · `agenda-google-refresh` → 2 casos vermelhos em agenda-google-refresh-worker;
 *   · `agenda-google-push`    → vermelho em agenda-google-push-worker (ele finge
 *     que o filtro devolveu `[]` e cobra que nada seja publicado);
 *   · `agenda-google-sync`    → **30/30 VERDE**. Nada no repositório notava.
 *
 * Ou seja: dava para apagar a única linha que impede o cron mais quente de ler a
 * agenda pessoal de um ex-funcionário, e a suíte inteira aplaudia. Os casos de
 * baixo fecham isso pela CLASSE — varrem toda rota `app/api/v1/cron/agenda-google-*`,
 * inclusive a que ainda não existe — e não pela instância, porque o modo de falha
 * aqui é mudo: nada quebra, a agenda só continua sendo lida.
 */

const ORG_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const ORG_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const ANA = "11111111-0000-4000-8000-000000000011";
const BRUNO = "22222222-0000-4000-8000-000000000022";

type Vinculo = { organization_id: string; user_id: string; revoked_at: string | null };
type Resposta = { data: Vinculo[] | null; error: { message: string } | null };

/** Cada `select` que a função disparou, com as colunas e os `in` que ela pendurou. */
type ConsultaObservada = { tabela: string; colunas: string; filtros: Array<[string, string[]]> };

/** O que o banco vai responder à checagem de vínculo. */
let resposta: Resposta;
let consultas: ConsultaObservada[];

type ClienteAdmin = Parameters<typeof apenasDeMembrosAtivos>[0];

function admin(): ClienteAdmin {
  const cliente = {
    from(tabela: string) {
      return {
        select(colunas: string) {
          const observada: ConsultaObservada = { tabela, colunas, filtros: [] };
          consultas.push(observada);
          const cadeia = {
            in(coluna: string, valores: readonly string[]) {
              observada.filtros.push([coluna, [...valores]]);
              return cadeia;
            },
            then(resolver: (v: Resposta) => void) {
              resolver(resposta);
            },
          };
          return cadeia;
        },
      };
    },
  };
  return cliente as unknown as ClienteAdmin;
}

/** Linha de calendário como os crons a montam: mais campos do que o filtro olha. */
function calendario(organization_id: string, user_id: string, id: string) {
  return { id, organization_id, user_id, access_token_encrypted: "\\xCIFRADO" };
}

beforeEach(() => {
  consultas = [];
  resposta = { data: [], error: null };
});

describe("apenasDeMembrosAtivos", () => {
  it("CONTROLE DE VACUIDADE: a checagem é mesmo disparada, contra `user_organizations` e pelo PAR", async () => {
    // Sem este caso, tudo o que afirma "ninguém passa" ficaria verde por vacuidade:
    // uma função que devolvesse `[]` sem nunca perguntar nada ao banco passaria em
    // todas as asserções negativas deste arquivo.
    resposta = { data: [{ organization_id: ORG_A, user_id: ANA, revoked_at: null }], error: null };

    const passaram = await apenasDeMembrosAtivos(admin(), [calendario(ORG_A, ANA, "cal-1")]);

    expect(consultas.length, "a função não consultou o banco — o filtro estaria decidindo no escuro").toBe(1);
    expect(consultas[0]?.tabela).toBe("user_organizations");
    expect(consultas[0]?.colunas).toContain("revoked_at");
    expect(
      consultas[0]?.filtros.map(([coluna]) => coluna).sort(),
      "a checagem precisa perguntar pelas DUAS colunas; perguntar só por `user_id` deixa passar quem foi revogado numa org e segue ativo em outra",
    ).toEqual(["organization_id", "user_id"]);
    expect(passaram.length, "o dublê respondeu 'ativa' e mesmo assim ninguém passou — a sonda está morta").toBe(1);
  });

  it("membro ATIVO passa, e passa a linha ORIGINAL (o cron ainda precisa do token dela)", async () => {
    resposta = { data: [{ organization_id: ORG_A, user_id: ANA, revoked_at: null }], error: null };
    const linha = calendario(ORG_A, ANA, "cal-1");

    const passaram = await apenasDeMembrosAtivos(admin(), [linha]);

    expect(passaram, "a agenda de quem TRABALHA aqui parou de sincronizar: os compromissos somem da grade e a pessoa é marcada em cima de horário ocupado").toEqual([linha]);
    expect(passaram[0], "a linha voltou reconstruída em vez de repassada — o cron perde o token cifrado e a chamada ao Google morre sem credencial").toBe(linha);
  });

  it("membro REVOGADO não passa", async () => {
    resposta = {
      data: [{ organization_id: ORG_A, user_id: ANA, revoked_at: "2026-08-01T12:00:00.000Z" }],
      error: null,
    };

    const passaram = await apenasDeMembrosAtivos(admin(), [calendario(ORG_A, ANA, "cal-1")]);

    expect(passaram, "a empresa continua lendo a agenda pessoal de quem saiu dela, indefinidamente — o token do Google não expira só porque o RH desligou a pessoa").toEqual([]);
  });

  it("⚠️ checagem que FALHA não libera ninguém — falha FECHADA", async () => {
    resposta = { data: null, error: { message: "connection terminated unexpectedly" } };

    const passaram = await apenasDeMembrosAtivos(admin(), [
      calendario(ORG_A, ANA, "cal-1"),
      calendario(ORG_B, BRUNO, "cal-2"),
    ]);

    expect(passaram, "um soluço de rede na checagem de vínculo virou vazamento: sem saber quem ainda é membro, o cron sincronizou a agenda pessoal de TODO mundo, ex-funcionário incluído").toEqual([]);
  });

  it("⚠️ resposta sem erro e sem linhas também não libera ninguém", async () => {
    // `error` nulo com `data` nulo é a resposta que mais engana: parece sucesso.
    resposta = { data: null, error: null };

    const passaram = await apenasDeMembrosAtivos(admin(), [calendario(ORG_A, ANA, "cal-1")]);

    expect(passaram, "resposta vazia lida como 'sucesso, pode seguir' libera exatamente quem a checagem não conseguiu confirmar").toEqual([]);
  });

  it("lista vazia sai vazia SEM consultar o banco", async () => {
    const passaram = await apenasDeMembrosAtivos(admin(), []);

    expect(passaram).toEqual([]);
    expect(
      consultas.length,
      "o cron faz uma ida ao banco por rodada mesmo sem ter nada para sincronizar — e com `in()` de lista vazia, que no PostgREST não é uma consulta inocente",
    ).toBe(0);
  });

  it("⚠️ a chave é o PAR (organização, usuário): revogado na org B não entra pela linha da B", async () => {
    // O caso que separa um filtro correto de um que só olha `user_id`. A mesma pessoa
    // atende em duas clínicas; saiu de uma, continua na outra.
    resposta = {
      data: [
        { organization_id: ORG_A, user_id: ANA, revoked_at: null },
        { organization_id: ORG_B, user_id: ANA, revoked_at: "2026-08-01T12:00:00.000Z" },
      ],
      error: null,
    };
    const naOrgA = calendario(ORG_A, ANA, "cal-a");
    const naOrgB = calendario(ORG_B, ANA, "cal-b");

    const passaram = await apenasDeMembrosAtivos(admin(), [naOrgA, naOrgB]);

    expect(passaram, "a clínica da qual a pessoa SAIU segue lendo a agenda dela — porque ela continua ativa na outra clínica, e o filtro conferiu só o `user_id`").toEqual([naOrgA]);
  });

  it("⚠️ e o inverso: ATIVO na org B não entra pela linha da org A, onde foi revogado", async () => {
    // O par do caso acima. Sem ele, um filtro que aceita a linha quando existe
    // QUALQUER vínculo ativo do usuário passaria numa direção e falharia na outra.
    resposta = {
      data: [
        { organization_id: ORG_A, user_id: ANA, revoked_at: "2026-08-01T12:00:00.000Z" },
        { organization_id: ORG_B, user_id: ANA, revoked_at: null },
      ],
      error: null,
    };
    const naOrgA = calendario(ORG_A, ANA, "cal-a");
    const naOrgB = calendario(ORG_B, ANA, "cal-b");

    const passaram = await apenasDeMembrosAtivos(admin(), [naOrgA, naOrgB]);

    expect(passaram, "a org da qual a pessoa saiu voltou a ler a agenda dela por carona no vínculo ativo da outra org").toEqual([naOrgB]);
  });

  it("vínculo AUSENTE na resposta não passa — nunca foi membro é o mesmo que não é membro", async () => {
    resposta = { data: [{ organization_id: ORG_A, user_id: ANA, revoked_at: null }], error: null };

    const passaram = await apenasDeMembrosAtivos(admin(), [
      calendario(ORG_A, ANA, "cal-1"),
      calendario(ORG_A, BRUNO, "cal-2"),
    ]);

    expect(passaram.map((l) => l.id), "linha sem vínculo correspondente passou por omissão: uma conexão órfã (usuário apagado, org trocada) volta a ser sincronizada").toEqual(["cal-1"]);
  });
});


const DIR_CRON = join(__dirname, "..", "..", "app", "api", "v1", "cron");

function cronsDaAgendaDoGoogle(): string[] {
  return readdirSync(DIR_CRON, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("agenda-google-"))
    .map((e) => e.name)
    .sort();
}

function fonteDoCron(nome: string): string {
  return readFileSync(join(DIR_CRON, nome, "route.ts"), "utf8");
}

/**
 * O filtro está no CAMINHO deste cron — chamado, e com o resultado consumido?
 *
 * Ancorado no AST e não em regex de propósito: as três rotas citam
 * `apenasDeMembrosAtivos` em comentário, e um regex ficaria verde lendo a prosa
 * que descreve a regra exatamente no arquivo de onde a regra sumiu. `consumido`
 * existe pelo mesmo motivo: `await apenasDeMembrosAtivos(...)` com o retorno
 * jogado fora é indistinguível de não chamar, e é o que sobra de um refactor
 * que troca a variável filtrada pela crua.
 */
export function filtroNoCaminho(fonte: string, nomeDoArquivo: string): { chamado: boolean; consumido: boolean } {
  const arquivo = ts.createSourceFile(nomeDoArquivo, fonte, ts.ScriptTarget.Latest, true);
  let chamado = false;
  const recebedores: string[] = [];

  const visitar = (no: ts.Node): void => {
    if (ts.isCallExpression(no) && ts.isIdentifier(no.expression) && no.expression.text === "apenasDeMembrosAtivos") {
      chamado = true;
      const espera = ts.isAwaitExpression(no.parent) ? no.parent : null;
      const declaracao = espera && ts.isVariableDeclaration(espera.parent) ? espera.parent : null;
      if (declaracao && ts.isIdentifier(declaracao.name)) recebedores.push(declaracao.name.text);
    }
    ts.forEachChild(no, visitar);
  };
  visitar(arquivo);

  const usosDepoisDeDeclarado = (alvo: string): number => {
    let n = 0;
    const contar = (no: ts.Node): void => {
      // O `SourceFile` não tem pai; `ts.isVariableDeclaration(undefined)` lança.
      const pai = no.parent as ts.Node | undefined;
      const ehOProprioNomeDeclarado = pai !== undefined && ts.isVariableDeclaration(pai) && pai.name === no;
      if (ts.isIdentifier(no) && no.text === alvo && !ehOProprioNomeDeclarado) n += 1;
      ts.forEachChild(no, contar);
    };
    contar(arquivo);
    return n;
  };

  return { chamado, consumido: recebedores.some((r) => usosDepoisDeDeclarado(r) > 0) };
}

describe("o filtro está no caminho dos crons que leem a agenda do Google", () => {
  it("CONTROLE DE VACUIDADE: a varredura acha as rotas de hoje, e com fonte de verdade", () => {
    const crons = cronsDaAgendaDoGoogle();

    expect(
      crons,
      "a varredura não achou rota nenhuma — daqui para a frente ela aprova o repositório inteiro sem ler uma linha",
    ).toEqual(["agenda-google-push", "agenda-google-refresh", "agenda-google-sync"]);
    for (const cron of crons) {
      expect(fonteDoCron(cron).length, `o fonte de ${cron} veio vazio — a varredura estaria medindo o nada`).toBeGreaterThan(500);
    }
  });

  it("CONTROLE DE VACUIDADE: o detector acusa os dois jeitos de o filtro sair do caminho", () => {
    // Sem este caso, um detector que devolvesse `{ chamado: true, consumido: true }`
    // cravado aprovaria todas as rotas, inclusive uma sem filtro nenhum.
    const semChamada = "const doTime = calendarios;\nvoid apenasDeMembrosAtivos;\n";
    const comResultadoDescartado =
      "async function f() { await apenasDeMembrosAtivos(admin, calendarios); return calendarios; }\n";

    expect(filtroNoCaminho(semChamada, "sem.ts").chamado, "o detector não viu a ausência da chamada").toBe(false);
    const descartado = filtroNoCaminho(comResultadoDescartado, "descartado.ts");
    expect(descartado.chamado).toBe(true);
    expect(
      descartado.consumido,
      "chamar o filtro e seguir com a lista crua passa pelo detector — ele estaria vigiando a menção, não o corte",
    ).toBe(false);

    const correto = "async function f() { const doTime = await apenasDeMembrosAtivos(admin, calendarios); return doTime; }\n";
    expect(filtroNoCaminho(correto, "ok.ts"), "o detector reprova o código CERTO — reprovaria a rota que faz tudo direito").toEqual({
      chamado: true,
      consumido: true,
    });
  });

  it.each(cronsDaAgendaDoGoogle())(
    "%s passa as conexões pelo filtro antes de usar o token do Google",
    (cron) => {
      const { chamado, consumido } = filtroNoCaminho(fonteDoCron(cron), `${cron}/route.ts`);

      expect(
        chamado,
        `${cron} usa o token do Google sem perguntar quem ainda é do time: a agenda PESSOAL de quem saiu da empresa volta a ser lida para dentro dela, e o token não expira porque o RH desligou a pessoa`,
      ).toBe(true);
      expect(
        consumido,
        `${cron} chama o filtro e segue com a lista crua — o corte virou enfeite, e o ex-funcionário continua sincronizando`,
      ).toBe(true);
    },
  );
});
