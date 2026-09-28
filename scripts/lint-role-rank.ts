/**
 * Invariante do `lib/auth/require-role.ts`: "nenhuma rota deve reimplementar a
 * checagem [de papel] na mão" (comparação com `ROLE_RANK` direto numa rota é o
 * anti-pattern "matriz advisória"). Rodado pelo `gov:verify`.
 *
 * Por que ROTA importa: o gate de MFA (`mfaEmDivida`) só existe DENTRO de
 * `requireRole()`. Uma comparação manual de `ROLE_RANK` decide 403 sem nunca
 * passar por ali — e uma sessão `aal1` de admin com TOTP cadastrado atravessa
 * uma rota "protegida" sem nunca provar o segundo fator nesta sessão. Foi
 * exatamente esse buraco que motivou `requireRole()` existir.
 *
 * ─── Por que o escopo é `app/api`, não o repo inteiro ───────────────────────
 *
 * O docstring de `require-role.ts` fala em "rotas /api/v1" (spec 13 §4 —
 * G2-01), não em toda leitura de papel do sistema. Fora de `app/api` o
 * `ROLE_RANK` tem usos legítimos e não relacionados a decidir 401/403 de uma
 * rota — ex.: `.tsx` de `app/app/**` escondendo item de menu (a segurança real
 * é a RLS + esta mesma rota), `lib/mcp/auth.ts` (outro mecanismo de auth
 * inteiro, bearer token sem `cookies()`, onde `requireRole()` não se aplica) e
 * `lib/escalacao/*.ts` (elegibilidade de roteamento, não autorização). Variar
 * o escopo pra cobrir esses casos trocaria um allowlist "pequeno e explícito"
 * por uma lista de dezenas de arquivos que nada tem a ver com o incidente.
 *
 * Arquivo `*.test.ts(x)` fica de fora pelo mesmo motivo: teste que referencia
 * `ROLE_RANK` (a constante exportada, fonte única) pra montar um fixture não é
 * uma rota decidindo 403 na mão — é leitura do mesmo valor que o produto usa.
 *
 * ─── Sem allowlist ────────────────────────────────────────────────────────
 *
 * Ao migrar as rotas encontradas com este padrão (2026-08), os dois casos que
 * pareciam precisar de exceção — `contacts/_handler.ts` (handler
 * compartilhado com MCP tools, onde `requireRole()` não se aplica porque não
 * há `cookies()` fora de uma rota Next) e `marca/logo/route.ts` (gate de duas
 * camadas que `requireRole()` não modela: platform admin SEM org nenhuma) —
 * não precisaram de raw `ROLE_RANK[`: os dois usam `roleAtLeast()` (fonte
 * única do rank, `lib/auth/types.ts`) para a leitura que sobra depois da
 * decisão de acesso. Se surgir um caso legítimo que só dê pra resolver com
 * `ROLE_RANK[` cru, documente-o aqui como um allowlist explícito — pelo
 * mesmo padrão de `KNOWN_DEBT` em `lint-channels.ts` — em vez de calar o
 * lint.
 *
 * ─── Por que não é `fs.globSync` ─────────────────────────────────────────────
 *
 * Walk recursivo manual, como `lint-channels.ts`: `globSync` só existe em
 * node 22+, e walk custa 8 linhas e nenhuma dependência.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "app/api";

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : walk(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const arquivos = walk(ROOT)
  .map((f) => f.replace(/\\/g, "/"))
  .filter((f) => !/\.test\.tsx?$/.test(f));

const offenders = arquivos
  .filter((f) => readFileSync(f, "utf8").includes("ROLE_RANK["))
  .sort();

if (offenders.length) {
  console.error(
    "ROLE_RANK[ comparado na mão fora de lib/auth/ (require-role.ts, invariante G2-01):",
  );
  for (const f of offenders) console.error(`  ${f}`);
  console.error(
    "\nUse requireRole(min, { requestId, resource }) — é o único lugar que aplica o\n" +
      "gate de MFA. Para uma leitura de rank que NÃO decide 401/403 sozinha (ex.:\n" +
      "campo informativo, regra de escopo sobre um role já resolvido), use\n" +
      "roleAtLeast(role, min) de lib/auth/types.ts. Se nenhum dos dois servir,\n" +
      "documente a exceção aqui como um allowlist explícito, com a razão escrita.",
  );
  process.exit(1);
}

console.info("lint-role-rank: ok (nenhum ROLE_RANK[ fora de lib/auth/ em app/api)");
