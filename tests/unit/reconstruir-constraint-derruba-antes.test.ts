/**
 * RECRIAR UMA CONSTRAINT QUE JÁ EXISTE EXIGE DERRUBÁ-LA ANTES, NO MESMO ARQUIVO.
 *
 * ## O defeito, medido
 *
 * A 0326 (`reconciliacao_das_branches_represadas`) fez
 * `alter table agent_inbox_items add constraint agent_inbox_items_kind_check`
 * SEM `drop constraint if exists` antes — a única, das 21 reconstruções dessa
 * constraint na cadeia. O cabeçalho dela e a linha do MANIFEST afirmavam
 * "Idempotente: `drop constraint if exists` + `add constraint`": a prosa tinha o
 * drop, o SQL não.
 *
 * A constraint existe desde a 0050 (CHECK de coluna, que o Postgres batiza
 * sozinho de `<tabela>_<coluna>_check`). Então, num banco que segue a cadeia, a
 * 0326 falha com 42710 — `constraint "agent_inbox_items_kind_check" for
 * relation "agent_inbox_items" already exists` —, a aplicação PARA ali, e toda
 * migration posterior nunca roda. Reproduzido num Postgres 17 descartável; o
 * controle (o mesmo bloco com o drop na frente) passa.
 *
 * ## Por que nenhum portão viu
 *
 * - `migrations-nao-encolhem-vocabulario` e `kind-check-migration-x-baseline`
 *   comparam LISTAS de valores. A lista da 0326 estava certa; o que faltava era
 *   o comando que abre espaço para ela.
 * - `pnpm test:db` e o job `e2e` aplicam o `baseline.sql`, não a cadeia — e no
 *   baseline o bloco é drop+add. O kit self-host (install.sh / update.sh) também
 *   aplica só o baseline, e por isso nunca foi afetado.
 * - Quem é afetado é o clone que atualiza pela cadeia (`supabase db push`), que é
 *   justamente o caminho que nenhum job exercita.
 *
 * ## O que se guarda
 *
 * Percorrendo as migrations em ordem de aplicação: todo `add constraint X` em
 * que X já existe (criado por um arquivo anterior — por `add constraint`, por
 * `constraint X` dentro de um `create table`, ou pelo nome automático de um
 * CHECK de coluna) tem de estar protegido NO MESMO ARQUIVO por uma destas:
 *
 *   1. `drop constraint [if exists] X` ANTES do add;
 *   2. o add dentro de um `do $$ … exception when duplicate_object … end $$`;
 *   3. o add dentro de um `do $$` que antes pergunta ao `pg_constraint` por
 *      `conname = 'X'`.
 *
 * Medido ao escrever: 279 arquivos, 129 `add constraint`, 38 recriações de nome
 * já existente — 35 com drop, 2 com o padrão 2 (a 0308), e 1 violação, a 0326.
 * A cerca nasce sem allowlist.
 *
 * ## Limite declarado
 *
 * O nome automático é inferido só para CHECK escrito na linha da coluna dentro
 * de `create table`. Constraint criada por `alter table … add check (…)` sem
 * nome, ou por `unique`/`references` de coluna, não entra em "já existe" — um
 * add explícito depois dela não é cobrado aqui.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const DIR_MIGRATIONS = path.join(process.cwd(), "supabase", "migrations");

type Violacao = { arquivo: string; constraint: string; criadaEm: string };

/** Comentários fora: nome de constraint citado em prosa não é constraint. */
function semComentarios(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((linha) => {
      const i = linha.indexOf("--");
      return i === -1 ? linha : linha.slice(0, i);
    })
    .join("\n");
}

const ADD = /\badd\s+constraint\s+(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?/gi;
const NOMEADA = /\bconstraint\s+"?([a-z0-9_]+)"?\s+(?:check|unique|primary|foreign|exclude)\b/gi;
const CREATE_TABLE = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?\s*\(/gi;
const PALAVRAS_QUE_NAO_SAO_COLUNA = new Set([
  "constraint", "primary", "unique", "foreign", "check", "exclude", "like",
]);

/**
 * `create table t (col text check (…))` cria `t_col_check`, sem que esse nome
 * apareça no SQL. Foi exatamente o caso da 0050, e sem esta inferência a
 * primeira recriação explícita de uma constraint assim passaria.
 */
function nomesAutomaticos(sql: string): string[] {
  const nomes: string[] = [];
  for (const m of sql.matchAll(CREATE_TABLE)) {
    const tabela = m[1]!;
    let profundidade = 1;
    let fim = m.index! + m[0].length;
    while (fim < sql.length && profundidade > 0) {
      if (sql[fim] === "(") profundidade++;
      else if (sql[fim] === ")") profundidade--;
      fim++;
    }
    const corpo = sql.slice(m.index! + m[0].length, fim - 1);
    // Colunas separadas por vírgula no nível zero de parênteses.
    const colunas: string[] = [];
    let nivel = 0;
    let inicio = 0;
    for (let i = 0; i < corpo.length; i++) {
      if (corpo[i] === "(") nivel++;
      else if (corpo[i] === ")") nivel--;
      else if (corpo[i] === "," && nivel === 0) {
        colunas.push(corpo.slice(inicio, i));
        inicio = i + 1;
      }
    }
    colunas.push(corpo.slice(inicio));
    for (const col of colunas) {
      const nome = /^\s*"?([a-z0-9_]+)"?\s+[a-z]/i.exec(col)?.[1]?.toLowerCase();
      if (!nome || PALAVRAS_QUE_NAO_SAO_COLUNA.has(nome)) continue;
      if (/\bcheck\s*\(/i.test(col) && !/\bconstraint\b/i.test(col)) {
        nomes.push(`${tabela}_${nome}_check`);
      }
    }
  }
  return nomes;
}

/** O add em `posicao` está protegido dentro do próprio arquivo? */
function protegido(sql: string, nome: string, posicao: number): boolean {
  const antes = sql.slice(0, posicao);
  if (new RegExp(`\\bdrop\\s+constraint\\s+(?:if\\s+exists\\s+)?"?${nome}"?\\b`, "i").test(antes)) {
    return true;
  }
  // Dentro de um `do $$`? O bloco começa no último `do $$` antes do add e
  // termina no primeiro `end $$` depois dele. Exigir o bloco — e não o padrão
  // em qualquer lugar do arquivo — impede que um `duplicate_object` de OUTRA
  // constraint absolva esta.
  const abre = antes.search(/do\s+\$\$(?![\s\S]*do\s+\$\$)/i);
  const fechaAntes = antes.search(/end\s*;?\s*\$\$(?![\s\S]*end\s*;?\s*\$\$)/i);
  if (abre === -1 || fechaAntes > abre) return false;
  const depois = sql.slice(posicao);
  const fim = depois.search(/end\s*;?\s*\$\$/i);
  const bloco = sql.slice(abre, fim === -1 ? sql.length : posicao + fim);
  if (/exception\s+when\s+duplicate_object/i.test(bloco)) return true;
  return new RegExp(`conname\\s*=\\s*'${nome}'`, "i").test(sql.slice(abre, posicao));
}

/** O verificador, sobre uma cadeia qualquer — o teste o usa também em cadeia sintética. */
function violacoes(cadeia: Array<{ arquivo: string; sql: string }>): Violacao[] {
  const existentes = new Map<string, string>();
  const achados: Violacao[] = [];
  for (const { arquivo, sql: bruto } of cadeia) {
    const sql = semComentarios(bruto);
    for (const m of sql.matchAll(ADD)) {
      const nome = m[1]!;
      const criadaEm = existentes.get(nome);
      if (criadaEm !== undefined && !protegido(sql, nome, m.index!)) {
        achados.push({ arquivo, constraint: nome, criadaEm });
      }
    }
    // Registrar DEPOIS de conferir: um arquivo que cria X e em seguida recria X
    // sem drop é outro defeito, que o próprio Postgres acusa na primeira
    // aplicação — este teste mede a cadeia entre arquivos.
    for (const m of [...sql.matchAll(ADD), ...sql.matchAll(NOMEADA)]) {
      if (!existentes.has(m[1]!)) existentes.set(m[1]!, arquivo);
    }
    for (const nome of nomesAutomaticos(sql)) {
      if (!existentes.has(nome)) existentes.set(nome, `${arquivo} (nome automático)`);
    }
  }
  return achados;
}

function cadeiaReal(): Array<{ arquivo: string; sql: string }> {
  return readdirSync(DIR_MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    // Prefixo de timestamp de largura fixa: ordem lexicográfica é a ordem de
    // aplicação do Supabase CLI.
    .sort()
    .map((arquivo) => ({ arquivo, sql: readFileSync(path.join(DIR_MIGRATIONS, arquivo), "utf8") }));
}

describe("recriar uma constraint existente derruba a anterior antes", () => {
  it("controle positivo: o parser enxerga a cadeia e o nome automático da 0050", () => {
    const cadeia = cadeiaReal();
    // Sem isto, um erro de caminho devolveria zero arquivo e o caso de baixo
    // passaria sem medir nada.
    expect(cadeia.length).toBeGreaterThan(200);
    const adds = cadeia.reduce((n, { sql }) => n + [...semComentarios(sql).matchAll(ADD)].length, 0);
    expect(adds).toBeGreaterThan(100);
    const zero050 = cadeia.find((c) => c.arquivo.includes("_0050_"));
    expect(zero050, "a 0050 sumiu da pasta").toBeTruthy();
    expect(nomesAutomaticos(semComentarios(zero050!.sql))).toContain("agent_inbox_items_kind_check");
  });

  it("controle de vivacidade: o verificador reprova o defeito e aceita as três proteções", () => {
    const criacao = {
      arquivo: "0001_cria.sql",
      sql: "create table public.t (id int, kind text not null check (kind in ('a')));",
    };
    const semDrop = "alter table public.t add constraint t_kind_check check (kind in ('a','b'));";
    // O defeito da 0326, em miniatura — inclusive a prosa que promete o drop.
    expect(
      violacoes([criacao, { arquivo: "0002_recria.sql", sql: `-- drop constraint if exists t_kind_check\n${semDrop}` }]),
    ).toEqual([{ arquivo: "0002_recria.sql", constraint: "t_kind_check", criadaEm: "0001_cria.sql (nome automático)" }]);

    const protecoes = [
      `alter table public.t drop constraint if exists t_kind_check;\n${semDrop}`,
      `do $$ begin\n${semDrop}\nexception when duplicate_object then null; end $$;`,
      `do $$ begin if not exists (select 1 from pg_constraint where conname = 't_kind_check') then\n${semDrop}\nend if; end $$;`,
    ];
    for (const sql of protecoes) {
      expect(violacoes([criacao, { arquivo: "0002_recria.sql", sql }]), sql).toEqual([]);
    }

    // O `duplicate_object` de OUTRO bloco não absolve este add.
    const outroBloco =
      "do $$ begin alter table public.t add constraint outra check (true);\nexception when duplicate_object then null; end $$;\n" +
      semDrop;
    expect(violacoes([criacao, { arquivo: "0002_recria.sql", sql: outroBloco }])).toHaveLength(1);
  });

  it("nenhuma migration recria constraint existente sem derrubá-la antes", () => {
    const achados = violacoes(cadeiaReal()).map(
      (v) => `${v.arquivo}: add constraint ${v.constraint} sem drop antes (ela já existe desde ${v.criadaEm})`,
    );
    expect(
      achados,
      "Num banco que segue a cadeia, este add falha com 42710 (already exists) e " +
        "nenhuma migration posterior roda. Ponha `alter table … drop constraint if exists <nome>;` " +
        "antes do add, no mesmo arquivo.",
    ).toEqual([]);
  });
});
