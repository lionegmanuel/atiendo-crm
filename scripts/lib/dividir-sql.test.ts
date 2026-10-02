import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { dividirSql } from "./dividir-sql";

describe("dividirSql — o `;` só fecha sentença onde o psql fecharia", () => {
  it("separa sentenças e guarda a linha onde cada uma começa", () => {
    const r = dividirSql("-- cabeçalho\nselect 1;\n\ncreate table t (a int);\n");
    expect(r).toEqual([
      { sql: "select 1", linha: 2 },
      { sql: "create table t (a int)", linha: 4 },
    ]);
  });

  it("não corta dentro de corpo entre cifrões, string, identificador ou comentário", () => {
    const sql = [
      "create function f() returns int language plpgsql as $$ begin perform 1; return 2; end $$;",
      "create function g() returns text language sql as $corpo$ select 'a;b' $corpo$;",
      "select 'it''s; fine', E'barra\\'; ainda', \"col;una\" from x;",
      "/* bloco; /* aninhado; */ ainda */ select $1, nome$x from y;",
      "select 2 -- comentário; com ponto e vírgula\n;",
    ].join("\n");
    const r = dividirSql(sql);
    expect(r.map((s) => s.linha)).toEqual([1, 2, 3, 4, 5]);
    expect(r[0]!.sql).toContain("return 2; end $$");
    expect(r[1]!.sql).toContain("'a;b'");
    expect(r[2]!.sql).toContain("\"col;una\"");
    expect(r[3]!.sql).toContain("nome$x from y");
  });

  it("recusa meta-comando do psql em vez de mandá-lo ao banco", () => {
    expect(() => dividirSql("select 1;\n\\connect outra\n")).toThrow(/linha 2: meta-comando/);
  });

  it("o baseline inteiro divide sem meta-comando e termina no último bloco", () => {
    const baseline = readFileSync(join(process.cwd(), "supabase", "baseline.sql"), "utf8");
    const r = dividirSql(baseline);
    expect(r.length).toBeGreaterThan(1000);
    // Cada sentença começa numa linha que existe e em ordem crescente.
    for (let k = 1; k < r.length; k++) expect(r[k]!.linha).toBeGreaterThan(r[k - 1]!.linha - 1);
    // A sentença final do arquivo é a última coisa que o arquivo faz.
    const ultima = r[r.length - 1]!;
    expect(baseline.trimEnd().endsWith(";")).toBe(true);
    expect(baseline.lastIndexOf(ultima.sql)).toBeGreaterThan(baseline.length - ultima.sql.length - 200);
  });
});
