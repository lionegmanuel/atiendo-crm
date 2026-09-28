import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * NENHUM MARCADOR DE CONFLITO CHEGA À `main`.
 *
 * ─── O defeito, medido ──────────────────────────────────────────────────────
 *
 * Numa sincronização de 198 commits, dois arquivos de migration foram commitados
 * COM os marcadores dentro:
 *
 *   <<<<<<<< HEAD:supabase/migrations/…_0117_canal_zernio_vocabulario.sql
 *   -- 0117 — vocabulário do terceiro canal…
 *   ========
 *   -- 0131 — vocabulário do terceiro canal…
 *   >>>>>>>> upstream/main:…_0131_canal_zernio_vocabulario.sql
 *
 * A causa foi um `git checkout --theirs` num conflito de RENOMEAÇÃO, onde ele
 * não faz o que faz num conflito de conteúdo — o arquivo ficou como estava, e o
 * `git add` seguinte carimbou o estrago.
 *
 * ─── Por que NADA pegou ────────────────────────────────────────────────────
 *
 * `typecheck`, `lint`, `test:unit`, `build` e até `test:db` passaram verdes.
 * O `test:db` aplica o `supabase/baseline.sql`, não os arquivos de
 * `migrations/` — então SQL quebrado ali dentro é invisível para todos os
 * gates. Quem pagaria é o clone que atualiza pela cadeia de migrations: erro de
 * sintaxe no meio de um `update.sh`, num banco que já começou a mudar.
 *
 * Este arquivo é a rede que faltava. Custa milissegundos e cobre a classe
 * inteira, em qualquer arquivo versionado — não só nos dois que falharam.
 */

/** Fonte da lista: o próprio git. Varrer o disco pegaria `node_modules` e lixo. */
function arquivosVersionados(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

/**
 * Sete ou OITO caracteres. O git usa sete no conflito de conteúdo e oito no de
 * renomeação — e foi justamente o de oito que passou, porque a primeira busca
 * que fiz procurava sete exatos.
 */
const MARCADOR = /^(<{7,8}|={7,8}|>{7,8})(\s|$)/m;

/**
 * Arquivos que FALAM sobre marcadores sem os conter de verdade: este teste, e
 * documentação que explica resolução de conflito. A allowlist é por caminho
 * exato — um glob deixaria entrar arquivo novo sem ninguém decidir.
 */
const PERMITIDOS = new Set(["tests/unit/sem-marcador-de-conflito.test.ts"]);

describe("nenhum marcador de conflito versionado", () => {
  it("nenhum arquivo rastreado carrega <<<<<<< / ======= / >>>>>>>", () => {
    const infratores = arquivosVersionados()
      .filter((f) => !PERMITIDOS.has(f))
      .filter((f) => {
        // Binário e arquivo apagado no meio do caminho: ler pode lançar, e um
        // teste que explode por isso vira ruído em vez de rede.
        let conteudo: string;
        try {
          conteudo = readFileSync(f, "utf8");
        } catch {
          return false;
        }
        return MARCADOR.test(conteudo);
      });

    expect(
      infratores,
      "Marcador de conflito num arquivo versionado. Um merge foi commitado pela " +
        "metade — resolva o arquivo de verdade antes do `git add`. Em SQL isto é " +
        "especialmente caro: nenhum outro gate lê `supabase/migrations/`, e quem " +
        "descobre é o clone que roda `update.sh` com o banco já em movimento.",
    ).toEqual([]);
  });

  it("a busca pega as DUAS larguras — sete e oito", () => {
    // O conflito de renomeação usa oito, e foi ele que escapou da primeira
    // varredura. Um teste que só cobre sete daria verde no caso real.
    expect(MARCADOR.test("<<<<<<< HEAD\n")).toBe(true);
    expect(MARCADOR.test("<<<<<<<< HEAD:algum/arquivo.sql\n")).toBe(true);
    expect(MARCADOR.test(">>>>>>>> upstream/main:outro.sql\n")).toBe(true);
    // E não confunde separador de markdown com marcador: `---` não é conflito,
    // e uma linha de `=` como sublinhado de título tampouco.
    expect(MARCADOR.test("texto normal\n=== título ===\n")).toBe(false);
  });
});
