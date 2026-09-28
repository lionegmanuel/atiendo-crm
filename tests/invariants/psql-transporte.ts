/**
 * Um segundo caminho até o mesmo psql — para invariante novo, sem tocar no
 * harness congelado.
 *
 * `gov-helpers.ts` fala com o Postgres exclusivamente por `docker exec` no
 * container do `scripts/test-db.sh`. É o caminho do CI e continua sendo. O
 * problema aparece na máquina de quem desenvolve: com o Docker fora do ar, a
 * suíte de invariantes inteira fica sem como rodar, e o que acontece na prática
 * não é "conserto o Docker" — é "provo depois". Foi assim que mudança de schema
 * já chegou ao self-hoster sem prova.
 *
 * Este módulo aceita as duas formas e escolhe por variável de ambiente:
 *
 *   TEST_DB_CONTAINER=<nome>   → docker exec (default, igual ao gov-helpers)
 *   TEST_DB_PSQL=<bin>         → psql local falando com TEST_DB_CONN
 *
 * A saída é idêntica nos dois (`-tA`, uma sessão por script), então o teste não
 * sabe qual está em uso.
 *
 * ## Por que um arquivo novo em vez de estender o gov-helpers
 *
 * `tests/invariants/**` é congelado por hook de pre-commit: invariante que
 * incomoda é sinal de que ou o código está errado, ou o invariante está
 * mal-escrito — e o segundo caso vai para a inbox de governança, não para o
 * Edit. A catraca não distingue "afrouxar uma asserção" de "acrescentar um
 * transporte", e driblá-la com a variável de escape seria decidir sozinho uma
 * questão que é do dono do repo. Então o gov-helpers fica intocado e a
 * duplicação — uma função de dez linhas — é o preço, registrada como dívida no
 * handoff desta frente para o Rafael decidir se as duas viram uma.
 */
import { execFileSync } from "node:child_process";

const container = process.env.TEST_DB_CONTAINER;
const psqlLocal = process.env.TEST_DB_PSQL;

if (!container && !psqlLocal) {
  throw new Error(
    "nem TEST_DB_CONTAINER nem TEST_DB_PSQL definidos — rode via `pnpm test:db` (scripts/test-db.sh), " +
      "ou aponte TEST_DB_PSQL para um binário psql e TEST_DB_CONN para um Postgres 17 com o baseline aplicado",
  );
}

const ARGS_PSQL = ["-v", "ON_ERROR_STOP=1", "-tA", "-f", "-"] as const;

/** Roda um script SQL em UMA sessão psql; devolve o stdout (tuples-only). */
export function sql(script: string): string {
  const bin = psqlLocal ?? "docker";
  const args = psqlLocal
    ? [process.env.TEST_DB_CONN ?? "postgres://postgres@localhost/postgres", ...ARGS_PSQL]
    : ["exec", "-i", container as string, "psql", "-U", "postgres", "-d", "postgres", ...ARGS_PSQL];

  return execFileSync(bin, args, { input: script, encoding: "utf8" }).trim();
}

/**
 * Mensagem de erro do psql, juntando `message` e `stderr`.
 *
 * O `execFileSync` põe o texto do Postgres em `stderr`, não em `message` — e um
 * teste que só olhasse `message` afirmaria "falhou como esperado" sem nunca ter
 * lido POR QUE falhou. Como estes invariantes distinguem "barrado pela RLS" de
 * "barrado por uma FK qualquer", a distinção mora justamente aí.
 */
export function motivoDoErro(err: unknown): string {
  const base = err instanceof Error ? err.message : String(err);
  const stderr = (err as { stderr?: unknown }).stderr;
  return `${base}${typeof stderr === "string" ? stderr : ""}`;
}
