/**
 * A ESPERA DA REVELAÇÃO COBRE TODA A NAVEGAÇÃO — e o sintoma da #884 é nominal.
 *
 * ═══ O defeito ══════════════════════════════════════════════════════════════
 *
 * O sintoma reportado na #884 é: "depois de navegar para a Agenda e voltar, o
 * DOM fica com uma segunda cópia oculta de `tela-agenda`", e o `getByTestId`
 * passa a casar dois. A tela da Agenda foi absolvida por MEDIÇÃO, e este
 * arquivo registra como:
 *
 *   · jsdom, `AgendaClient` real, montar → `unmount()` → remontar:
 *     **1 → 0 → 1**. Nenhum componente da Agenda monta sem desmontar;
 *   · nenhum `Activity`/`unstable_Activity`/`keep-alive`/`Offscreen` no app,
 *     nenhuma rota paralela ou interceptada sob `/app/agenda`, e o `AppShell`
 *     renderiza `{children}` uma vez.
 *
 * A cópia é a **caixa do streaming SSR** (`<div hidden id="S:N">`) que o
 * servidor manda e o React esvazia no cliente — já descrita na issue #1374,
 * cujo conserto (PR #1706) entrou em 2026-09-26, onze dias depois da #884.
 *
 * ─── O buraco que sobrou, e que este arquivo fecha ══════════════════════════
 *
 * O `test` da suíte embrulhava `page.goto` e `page.reload` (PR #1706) para só
 * devolverem quando a revelação termina. A spec vermelha citada na #884
 * (`agenda-ocupacao-do-google-no-historico`) navega só por `goto` e `reload`, e
 * esse vermelho o #1706 já fechou. O que sobrou foi `page.goBack()` e
 * `page.goForward()` — NÃO embrulhados: uma spec que volta ou avança por ali
 * (hoje, `central-avisos-destino`) lia o documento no meio da revelação.
 *
 * ⚠️ O PORQUÊ DE UM TESTE DE HARNESS E NÃO DE e2e. A cerca que existia
 * (`e2e-specs-usam-o-test-da-suite.test.ts`) só confere o IMPORT da spec — foi
 * por isso que a lacuna de `goBack` passou. Um e2e aqui exigiria navegador,
 * banco e duas contas para provar uma propriedade que é uma lista de nomes. O
 * que se prova aqui é a COBERTURA, e ela é o que quebrou — pelo embrulho REAL
 * (`embrulharANavegacao`, o mesmo que `test.ts` chama), mais uma cerca de texto
 * que reprova `test.ts` embrulhando algum método à mão, por fora dele.
 *
 * ⚠️ O dublê não é uma página de verdade. Ele existe para observar QUANTAS vezes
 * a espera foi exigida e se veio DEPOIS da navegação — as duas propriedades que
 * o embrulho promete. A revelação em página de verdade é de `goBack` na browser;
 * o dublê prova a ligação, e a spec `buffer-ssr-caixa-orfa` continua sendo a
 * que mede o streaming de fato.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { embrulharANavegacao, METODOS_DE_NAVEGACAO_REVELADOS } from "../e2e/helpers/revelacao-nas-cargas";

/** O que o dublê registra: a ordem das navegações e das esperas. */
class PaginaFalsa {
  /** Ordem dos eventos, para provar que a espera vem DEPOIS da navegação. */
  readonly registro: string[] = [];
  /** Quantas vezes a espera foi cobrada. */
  esperas = 0;

  async goto(url: string, opcoes?: { waitUntil?: string }): Promise<{ url: string }> {
    void opcoes;
    this.registro.push(`goto:${url}`);
    return { url };
  }

  async reload(opcoes?: { waitUntil?: string }): Promise<{ url: string }> {
    void opcoes;
    this.registro.push("reload");
    return { url: "" };
  }

  async goBack(opcoes?: { waitUntil?: string }): Promise<{ url: string }> {
    void opcoes;
    this.registro.push("goBack");
    return { url: "" };
  }

  async goForward(opcoes?: { waitUntil?: string }): Promise<{ url: string }> {
    void opcoes;
    this.registro.push("goForward");
    return { url: "" };
  }
}

/** Um dublê já embrulhado pelo embrulho REAL, com a espera observável. */
function paginaEmbrulhada(): PaginaFalsa {
  const pagina = new PaginaFalsa();
  embrulharANavegacao(pagina as unknown as Page, async () => {
    pagina.esperas += 1;
    pagina.registro.push("espera");
  });
  return pagina;
}

describe("a espera da revelação cobre toda a navegação (issue #884)", () => {
  it("a lista nomeia goto, reload, goBack e goForward — nenhum método de fora", () => {
    expect([...METODOS_DE_NAVEGACAO_REVELADOS].sort()).toEqual([
      "goBack",
      "goForward",
      "goto",
      "reload",
    ]);
  });

  it("goBack espera a revelação — é por ele que uma spec 'volta para a Agenda'", () => {
    const pagina = paginaEmbrulhada();
    return pagina.goBack().then(() => {
      expect(pagina.esperas).toBe(1);
      expect(pagina.registro).toEqual(["goBack", "espera"]);
    });
  });

  it("goForward espera a revelação", () => {
    const pagina = paginaEmbrulhada();
    return pagina.goForward().then(() => {
      expect(pagina.esperas).toBe(1);
    });
  });

  it("goto espera a revelação", () => {
    const pagina = paginaEmbrulhada();
    return pagina.goto("/app/agenda").then(() => {
      expect(pagina.esperas).toBe(1);
    });
  });

  it("reload espera a revelação", () => {
    const pagina = paginaEmbrulhada();
    return pagina.reload().then(() => {
      expect(pagina.esperas).toBe(1);
    });
  });

  it("a espera vem DEPOIS da navegação, nunca antes", () => {
    const pagina = paginaEmbrulhada();
    return pagina.goBack().then(() => {
      expect(pagina.registro.indexOf("goBack")).toBeLessThan(pagina.registro.indexOf("espera"));
    });
  });

  it("waitUntil: commit não espera — a caixa não existe ainda", () => {
    const pagina = paginaEmbrulhada();
    return pagina.goto("/app/agenda", { waitUntil: "commit" }).then(() => {
      expect(pagina.esperas).toBe(0);
    });
  });

  it("a volta de ida e volta cobre os DOIS sentidos da pilha de navegação", () => {
    const pagina = paginaEmbrulhada();
    return pagina
      .goForward()
      .then(() => pagina.goBack())
      .then(() => {
        expect(pagina.esperas).toBe(2);
        expect(pagina.registro).toEqual(["goForward", "espera", "goBack", "espera"]);
      });
  });

  it("goBack com waitUntil: commit também não espera — o guarda é do argumento", () => {
    const pagina = paginaEmbrulhada();
    return pagina.goBack({ waitUntil: "commit" }).then(() => {
      expect(pagina.esperas).toBe(0);
    });
  });
});

/**
 * A metade que nenhum caso acima vê: `test.ts` tem de PASSAR pelo embrulho
 * provado. Se ele voltar a embrulhar `goto`/`reload` à mão, com a lista intacta,
 * todos os casos acima seguem verdes e o `goBack` volta a ler a revelação pela
 * metade — exatamente a lacuna da #884.
 */
describe("o test da suíte usa o embrulho provado (issue #884)", () => {
  const fonte = readFileSync(join(__dirname, "../e2e/helpers/test.ts"), "utf8");

  it("test.ts chama embrulharANavegacao com a página", () => {
    expect(fonte).toMatch(/embrulharANavegacao\(\s*page\s*,/);
  });

  it("test.ts não embrulha método de navegação à mão", () => {
    const aMao = /\.(goto|reload|goBack|goForward)\s*=(?!=)|\[\s*metodo\s*\]\s*=(?!=)/;
    expect(
      fonte.match(aMao)?.[0] ?? null,
      "embrulhe só por `embrulharANavegacao` (revelacao-nas-cargas.ts) — é ele que este teste prova",
    ).toBeNull();
  });
});
