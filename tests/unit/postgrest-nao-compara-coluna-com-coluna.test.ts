import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * VARREDURA: filtro do PostgREST não compara coluna com COLUNA.
 *
 * ─── O defeito que gerou este arquivo ────────────────────────────────────────
 * `app/api/v1/cron/agenda-google-push/route.ts` pedia os pendentes assim:
 *
 *   .or("google_synced_at.is.null,updated_at.gt.google_synced_at")
 *
 * O lado DIREITO de um operador do PostgREST é sempre VALOR LITERAL. Ele tentou
 * converter a string "google_synced_at" em `timestamptz`, não conseguiu, e
 * recusou a consulta INTEIRA:
 *
 *   invalid input syntax for type timestamp with time zone: "google_synced_at"
 *
 * Em produção isso era um `warn` a cada 5 minutos desde o deploy da v1.7.0, com
 * ZERO compromissos empurrados. A ida ao Google nunca aconteceu.
 *
 * ─── Por que uma varredura, e não só o conserto ──────────────────────────────
 * O erro não é de digitação: é de MODELO MENTAL. Quem escreveu leu o filtro como
 * SQL, onde `updated_at > google_synced_at` é a coisa mais natural do mundo. O
 * mesmo engano cabe em qualquer tabela com duas colunas comparáveis — `sent_at`
 * vs `read_at`, `expires_at` vs `created_at` —, e nada no tipo do cliente avisa.
 *
 * ─── Por que a lista de colunas vem do schema ────────────────────────────────
 * A sonda não procura "coisa que parece nome de coluna": ela pergunta ao
 * `baseline.sql` quais colunas a TABELA DAQUELA CONSULTA tem. É o que separa
 * `.gt("starts_at", "2030-01-01")` — literal legítimo — de
 * `.gt("updated_at", "google_synced_at")`, que é o defeito. Sem esse recorte, a
 * varredura acusaria toda data em string e ninguém a manteria.
 */
const RAIZ = process.cwd();

/** Colunas por tabela, lidas do schema que o self-hoster realmente aplica. */
function colunasPorTabela(): Map<string, Set<string>> {
  const sql = fs.readFileSync(path.join(RAIZ, "supabase/baseline.sql"), "utf8");
  const mapa = new Map<string, Set<string>>();
  // O dump escreve `CREATE TABLE IF NOT EXISTS "public"."x" (`; o apêndice
  // idempotente escreve `create table if not exists public.x (`. As duas formas.
  const criacao = /create table\s+(?:if not exists\s+)?(?:"?public"?\.)?"?([a-z_]+)"?\s*\(([\s\S]*?)\n\);/gi;
  for (const m of sql.matchAll(criacao)) {
    const tabela = m[1] as string;
    const corpo = m[2] ?? "";
    const cols = mapa.get(tabela) ?? new Set<string>();
    for (const linha of corpo.split("\n")) {
      const c = /^\s*"?([a-z][a-z0-9_]*)"?\s+/.exec(linha);
      // `constraint`/`check`/`unique`/`primary` abrem linha e não são coluna.
      if (c && !/^(constraint|check|unique|primary|foreign|exclude|like)$/.test(c[1] as string)) {
        cols.add(c[1] as string);
      }
    }
    mapa.set(tabela, cols);
  }
  // Colunas acrescentadas pelo apêndice, que não estão no corpo do create.
  const adicao =
    /alter table\s+(?:if exists\s+)?(?:"?public"?\.)?"?([a-z_]+)"?\s+add column if not exists\s+"?([a-z][a-z0-9_]*)"?/gi;
  for (const m of sql.matchAll(adicao)) {
    const cols = mapa.get(m[1] as string) ?? new Set<string>();
    cols.add(m[2] as string);
    mapa.set(m[1] as string, cols);
  }
  return mapa;
}

const COLUNAS = colunasPorTabela();

const OPERADORES = "eq|neq|gt|gte|lt|lte|like|ilike";

function arquivosTs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : arquivosTs(p);
    return e.isFile() && (p.endsWith(".ts") || p.endsWith(".tsx")) ? [p] : [];
  });
}

/**
 * Apaga o CONTEÚDO das linhas de comentário, preservando as quebras.
 *
 * ⚠️ Isto não é higiene: sem ele, o gate reprova quem DOCUMENTA o defeito. O
 * conserto do worker deixou escrito `⚠️ NÃO volte a .or("…gt.google_synced_at")`
 * logo acima do filtro novo, e a primeira versão desta varredura acusou esse
 * comentário como se fosse a consulta. Um gate que proíbe explicar o erro que
 * ele previne ensina a apagar a explicação.
 *
 * Só linha INTEIRA de comentário, e o conteúdo vira espaço em vez de sumir: a
 * numeração de linha do achado tem de continuar apontando para o lugar certo.
 * Comentário no fim de uma linha de código fica — arrancá-lo exigiria distinguir
 * `//` de dentro de uma string (`"https://…"`), e o remédio seria pior.
 */
function semComentarios(fonte: string): string {
  return fonte
    .split("\n")
    .map((linha) => (/^\s*(\/\/|\/\*|\*)/.test(linha) ? "" : linha))
    .join("\n");
}

interface Achado {
  onde: string;
  tabela: string;
  filtro: string;
}

/**
 * Procura, dentro da cadeia de cada `.from("tabela")`, um filtro cujo lado
 * direito seja o nome de uma coluna DESSA tabela.
 *
 * Duas formas, porque o cliente aceita as duas:
 *   `.gt("updated_at", "google_synced_at")`  — argumentos separados
 *   `.or("updated_at.gt.google_synced_at")`  — string composta
 */
function achados(): Achado[] {
  const out: Achado[] = [];
  const separados = new RegExp(`\\.(?:${OPERADORES})\\(\\s*"([a-z_]+)"\\s*,\\s*"([a-z_]+)"\\s*\\)`, "g");
  const composto = new RegExp(`([a-z_]+)\\.(?:${OPERADORES})\\.([a-z_]+)`, "g");

  for (const dir of ["app", "lib", "workers", "scripts"]) {
    for (const arquivo of arquivosTs(path.join(RAIZ, dir))) {
      const fonte = semComentarios(fs.readFileSync(arquivo, "utf8"));
      const rel = path.relative(RAIZ, arquivo);
      for (const m of fonte.matchAll(/\.from\("([a-z_]+)"\)/g)) {
        const tabela = m[1] as string;
        const cols = COLUNAS.get(tabela);
        if (!cols) continue;
        const inicio = m.index ?? 0;
        // A cadeia acaba no `;` OU na próxima `.from(` — o que vier primeiro.
        const proxima = fonte.indexOf('.from("', inicio + 1);
        const ponto = fonte.indexOf(";", inicio);
        const fins = [proxima, ponto].filter((n) => n !== -1);
        const cadeia = fonte.slice(inicio, fins.length > 0 ? Math.min(...fins) : fonte.length);
        const linha = fonte.slice(0, inicio).split("\n").length;

        for (const f of cadeia.matchAll(separados)) {
          if (cols.has(f[1] as string) && cols.has(f[2] as string)) {
            out.push({ onde: `${rel}:${linha}`, tabela, filtro: f[0] as string });
          }
        }
        for (const f of cadeia.matchAll(composto)) {
          if (cols.has(f[1] as string) && cols.has(f[2] as string)) {
            out.push({ onde: `${rel}:${linha}`, tabela, filtro: f[0] as string });
          }
        }
      }
    }
  }
  return out;
}

describe("PostgREST: o lado direito de um filtro é valor, nunca coluna", () => {
  it("a varredura leu o schema (senão ela mede o vazio)", () => {
    // Controle do instrumento. Sem isto, uma mudança na forma do dump deixaria o
    // gate verde por não conhecer coluna nenhuma — e ele afirmaria o que não mediu.
    expect(COLUNAS.size).toBeGreaterThanOrEqual(100);
    expect(COLUNAS.get("calendar_appointments")?.has("google_synced_at")).toBe(true);
    expect(COLUNAS.get("calendar_appointments")?.has("updated_at")).toBe(true);
    expect(COLUNAS.get("calendar_appointments")?.has("needs_google_push")).toBe(true);
  });

  it("a sonda reconhece o defeito exato da v1.7.0", () => {
    // Amostra fixa, para o instrumento não depender de o defeito existir no
    // código: quando ele for consertado (é), o caso acima do arquivo ficaria sem
    // controle positivo nenhum.
    const cols = COLUNAS.get("calendar_appointments") as Set<string>;
    const composto = new RegExp(`([a-z_]+)\\.(?:${OPERADORES})\\.([a-z_]+)`);
    const m = composto.exec("google_synced_at.is.null,updated_at.gt.google_synced_at");
    expect(m, "a expressão não casou a forma composta do filtro").not.toBeNull();
    expect(cols.has((m as RegExpExecArray)[1] as string)).toBe(true);
    expect(cols.has((m as RegExpExecArray)[2] as string)).toBe(true);
  });

  it("nenhuma consulta do repo compara coluna com coluna", () => {
    const lista = achados().map((a) => `${a.onde} → ${a.tabela}: ${a.filtro}`);
    expect(
      lista,
      "O lado DIREITO de um filtro do PostgREST é VALOR LITERAL. Ele tenta " +
        "converter o nome da coluna para o tipo da coluna comparada e recusa a " +
        "consulta INTEIRA — nenhuma linha volta, e o erro só aparece em runtime, " +
        "num log. Foi assim que a ida ao Google nunca aconteceu na v1.7.0. " +
        "Para comparar duas colunas, use coluna GERADA (como " +
        "`calendar_appointments.needs_google_push`, migration 0200) ou uma RPC.",
    ).toEqual([]);
  });
});
