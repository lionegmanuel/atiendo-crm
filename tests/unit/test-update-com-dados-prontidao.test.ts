import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const SCRIPT = fs.readFileSync(path.join(RAIZ, "scripts/test-update-com-dados.sh"), "utf8");

function blocoDeProntidao(script = SCRIPT): string {
  const inicio = script.indexOf("# `pg_isready` e `psql` sem `-h` mentem aqui");
  const fim = script.indexOf("psql_stop()", inicio);

  if (inicio < 0 || fim < 0) {
    throw new Error("não achei o bloco de prontidão de test-update-com-dados.sh");
  }

  return script.slice(inicio, fim);
}

function sondaUsaTcp(bloco: string): boolean {
  return /docker exec \"\$CONTAINER\" psql -h 127\.0\.0\.1\b/.test(bloco);
}

describe("test:db:update espera o Postgres definitivo, não o servidor temporário do initdb", () => {
  it("força a sonda de prontidão a usar TCP", () => {
    const bloco = blocoDeProntidao();

    expect(sondaUsaTcp(bloco)).toBe(true);
    expect(bloco).toContain("temporário não escuta TCP");
  });

  it("fica vermelho se a sonda voltar ao socket local", () => {
    const bloco = blocoDeProntidao();
    const sabotado = bloco.replace("psql -h 127.0.0.1", "psql");

    expect(sondaUsaTcp(sabotado)).toBe(false);
  });
});
