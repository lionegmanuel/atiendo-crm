/**
 * Nenhum formulário de autenticação pode mandar credencial pela URL.
 *
 * ACHADO NO USO REAL, não em teste: percorrendo o produto num navegador com os
 * chunks JavaScript respondendo 500, o clique em "Entrar" fez o submit NATIVO
 * do formulário — e o padrão do HTML é GET. A barra de endereços ficou com
 *
 *     /login?email=qa-wizard%40local.test&password=QaWizard%212026%23Real
 *
 * A senha em texto claro na URL vai para o histórico do navegador, para o log
 * de acesso do servidor e para o cabeçalho `Referer` de qualquer recurso que a
 * página carregue depois. É o mesmo motivo pelo qual a doutrina deste
 * repositório proíbe chave de API em query string.
 *
 * O `onSubmit` do React não protege: ele só existe depois que o bundle carrega,
 * e o caso perigoso é justamente quando ele não carrega. `method="post"` é uma
 * garantia do HTML, que vale antes de qualquer JavaScript.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(__dirname, "../../components/auth");

/** Os formulários que carregam segredo: senha, código de verificação, e-mail. */
const FORMULARIOS = readdirSync(DIR).filter((f) => f.endsWith("Form.tsx"));

describe("formulários de autenticação", () => {
  it("existem formulários para vigiar (guarda de vacuidade)", () => {
    // Sem isto, renomear a pasta deixaria o teste abaixo verde por não ter o
    // que verificar.
    expect(FORMULARIOS.length).toBeGreaterThanOrEqual(5);
  });

  it("nenhum deles faz submit em GET — credencial nunca vai para a URL", () => {
    const semMethod = FORMULARIOS.filter((arquivo) => {
      const fonte = readFileSync(resolve(DIR, arquivo), "utf8");
      if (!/<form\b/.test(fonte)) return false;
      return !/method="post"/.test(fonte);
    });

    expect(
      semMethod,
      "sem `method=\"post\"`, o submit nativo (bundle que não carregou) manda " +
        "senha e código na query string — histórico, log e Referer",
    ).toEqual([]);
  });
});
