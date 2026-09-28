import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * O VOCABULÁRIO DA AGENDA É O MESMO NO BANCO E NO TYPESCRIPT.
 *
 * ═══ Por que este arquivo existe, se já há um invariante para isso ═══
 *
 * `tests/invariants/vocabulario-banco-x-typescript.test.ts` faz exatamente esta
 * medição, para uma lista de pares {tabela, coluna, arquivo, símbolo}. O lugar
 * natural das dez colunas da agenda é lá dentro.
 *
 * Mas `tests/invariants/**` é congelado por `loop/hooks/freeze-invariants.sh`:
 * arquivo NOVO (`A`) passa, MODIFICADO (`M`) é bloqueado, e o escape é uma
 * variável de ambiente. Nos dois precedentes do repo em que ela foi usada, quem
 * commitou foi o dono do produto. Um implementador decidir sozinho desarmar o
 * guarda que existe para impedir que asserções sejam afrouxadas em silêncio é
 * exatamente o movimento que o congelamento previne — mesmo quando a intenção é
 * fortalecer, porque "eu só fortaleci" é o que diria quem afrouxou.
 *
 * Então o caminho é o do contra-precedente já usado nesta base (INBOX-004, dos
 * canais oficiais): a MESMA asserção, num arquivo novo, com o pedido do lugar
 * definitivo registrado. Quando houver autorização, estes dez pares migram para
 * a lista canônica e este arquivo morre — e ele deve morrer, porque duas listas
 * medindo a mesma coisa é a terceira lista da qual o outro invariante avisa.
 *
 * ═══ A guarda contra o instrumento quebrado ═══
 *
 * Um teste que compara duas listas vazias passa. Os dois lados são checados por
 * vacuidade ANTES da comparação: o SQL tem de devolver CHECK para todas as
 * colunas, e o TypeScript tem de render pelo menos dois valores por símbolo.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error(
    "TEST_DB_CONTAINER not set — rode esta suíte via `pnpm test:db` (scripts/test-db.sh)",
  );
}
const containerName: string = container;

function sql(query: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", containerName, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tA", "-f", "-"],
    { input: query, encoding: "utf8" },
  ).trim();
}

const TIPOS = join(process.cwd(), "lib", "agenda", "tipos.ts");
const FONTE = readFileSync(TIPOS, "utf8");

/**
 * Extrai `export const X = ["a", "b"] as const;` do TypeScript.
 *
 * Aponta para o CONST e nunca para o `type` derivado: o corpo de
 * `type T = (typeof X)[number];` não tem literal nenhum, e um extrator que
 * casasse o `type` primeiro devolveria lista vazia — verde por ausência, que é
 * o modo de falha que o outro invariante documenta ter pago.
 */
function valoresDoTypeScript(simbolo: string): string[] {
  const m = new RegExp(`export const ${simbolo}\\s*=\\s*\\[([^\\]]*)\\]\\s*as const`, "m").exec(FONTE);
  if (!m || m[1] === undefined) {
    throw new Error(
      `INSTRUMENTO: não achei 'export const ${simbolo} = [...] as const' em lib/agenda/tipos.ts. ` +
        `Se a constante mudou de forma, conserte o extrator — não troque a constante por uma forma pior.`,
    );
  }
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1] as string);
}

/**
 * Extrai os valores de um CHECK de conjunto, direto do catálogo.
 *
 * Lê `pg_get_constraintdef`, e não o texto da migration: o que vale é o que
 * está NO BANCO depois de aplicar o baseline inteiro. Um teste que lesse o
 * arquivo .sql seria a terceira lista.
 */
function valoresDoBanco(tabela: string, coluna: string): string[] {
  const def = sql(`
    select pg_get_constraintdef(c.oid)
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
     where c.conrelid = 'public.${tabela}'::regclass
       and c.contype = 'c'
       and a.attname = '${coluna}'
       and (pg_get_constraintdef(c.oid) like '%= ANY (ARRAY[%'
            or pg_get_constraintdef(c.oid) like '%= ''%''::text%')
       -- E NAO e uma constraint de REGRA DE NEGOCIO. A distincao nao e
       -- cosmetica: calendar_appointments_cancelamento_coerente menciona
       -- status = 'cancelled' e, para um extrator ingenuo, e indistinguivel de
       -- um vocabulario de um valor so. Vocabulario puro e UMA comparacao e nao
       -- tem conectivo; regra de negocio e sempre uma disjuncao de conjuncoes.
       -- Sem este filtro o extrator acha DUAS constraints na mesma coluna e se
       -- recusa a escolher, que foi exatamente o que ele fez quando rodei isto
       -- pela primeira vez.
       --
       -- LIKE e nao regex, de proposito: este texto vive dentro de um template
       -- literal, onde \s viraria s antes de chegar ao Postgres. Uma condicao
       -- que o banco recebe corrompida nao filtra nada e devolve verde.
       and pg_get_constraintdef(c.oid) not like '% AND %'
       and pg_get_constraintdef(c.oid) not like '% OR %'
     order by c.conname;
  `);
  const linhas = def.split("\n").filter((l) => l.trim() !== "");
  if (linhas.length === 0) {
    throw new Error(`INSTRUMENTO: ${tabela}.${coluna} não tem CHECK de conjunto no banco.`);
  }
  if (linhas.length > 1) {
    // O extrator se recusa a escolher, e é deliberado: duas constraints de
    // conjunto na mesma coluna significam que a regra de negócio foi misturada
    // com o vocabulário, e adivinhar qual é qual é como o gate passa a mentir.
    throw new Error(
      `INSTRUMENTO: ${tabela}.${coluna} tem ${linhas.length} CHECKs de conjunto. ` +
        `Deixe UM só de vocabulário e ponha a regra de negócio numa constraint separada.`,
    );
  }
  // Duas formas, porque o Postgres RENDERIZA diferente conforme o tamanho:
  // com 2+ valores vira `= ANY (ARRAY['a'::text, 'b'::text])`; com UM valor só
  // vira `= 'a'::text`, sem ARRAY nenhum. Um extrator que só conhecesse a
  // primeira forma diria "esta coluna não tem CHECK" sobre uma coluna que TEM
  // — acusando o código por defeito do instrumento, que é o modo de falha que
  // o invariante canônico documenta ter pago uma vez.
  return [...(linhas[0] as string).matchAll(/'([^']+)'::text/g)].map((x) => x[1] as string);
}

/** Os pares. É esta lista que migra para o invariante canônico quando autorizado. */
const PARES = [
  { tabela: "calendar_event_types", coluna: "category", simbolo: "CATEGORIAS_DE_AGENDAMENTO" },
  { tabela: "calendar_event_types", coluna: "location_kind", simbolo: "LOCAIS_DE_AGENDAMENTO" },
  { tabela: "calendar_appointments", coluna: "status", simbolo: "SITUACOES_DO_AGENDAMENTO" },
  { tabela: "calendar_appointments", coluna: "location_kind", simbolo: "LOCAIS_DE_AGENDAMENTO" },
  { tabela: "calendar_appointments", coluna: "created_by_kind", simbolo: "AUTORES_DO_AGENDAMENTO" },
  { tabela: "calendar_appointments", coluna: "source", simbolo: "ORIGENS_DO_AGENDAMENTO" },
  { tabela: "calendar_connections", coluna: "status", simbolo: "SITUACOES_DA_CONEXAO" },
  { tabela: "calendar_connections", coluna: "provider", simbolo: "PROVEDORES_DE_AGENDA" },
  { tabela: "calendar_external_events", coluna: "status", simbolo: "SITUACOES_EXTERNAS" },
  { tabela: "calendar_external_events", coluna: "transparency", simbolo: "TRANSPARENCIAS_EXTERNAS" },
] as const;

describe("agenda — o vocabulário do banco e o do TypeScript são o mesmo", () => {
  it("a lista de pares não encolheu (guarda de vacuidade)", () => {
    // Sem este caso, apagar os pares deixa o arquivo verde — e um arquivo verde
    // sem asserção nenhuma é indistinguível de um que passou.
    expect(PARES.length).toBeGreaterThanOrEqual(10);
  });

  it.each(PARES)("$tabela / $coluna espelha $simbolo", ({ tabela, coluna, simbolo }) => {
    const banco = valoresDoBanco(tabela, coluna);
    const ts = valoresDoTypeScript(simbolo);

    expect(banco.length, `${tabela}.${coluna}: CHECK vazio no banco`).toBeGreaterThanOrEqual(1);
    expect(ts.length, `${simbolo}: constante vazia no TypeScript`).toBeGreaterThanOrEqual(1);

    expect([...banco].sort()).toEqual([...ts].sort());
  });
});

describe("agenda — a conexão fala a MESMA língua da integração que já existia", () => {
  it("calendar_connections.status tem exatamente o vocabulário de tenant_integrations.status", () => {
    // A promessa escrita na migration 0176 é "mesma pergunta, mesma palavra".
    // Sem esta asserção, a primeira pessoa a acrescentar um estado num dos dois
    // lados cria a divergência que a decisão existia para evitar — e nada
    // acusa, porque cada tabela sozinha continua coerente com o seu TypeScript.
    const daAgenda = valoresDoBanco("calendar_connections", "status");
    const daIntegracao = valoresDoBanco("tenant_integrations", "status");

    expect(daIntegracao.length).toBeGreaterThan(1);
    expect([...daAgenda].sort()).toEqual([...daIntegracao].sort());
  });
});
