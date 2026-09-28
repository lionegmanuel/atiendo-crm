/**
 * Issue #66 — o `AGENTS.md` declara versões de biblioteca à mão, e à mão elas
 * desatualizam. Já aconteceu: o arquivo nasceu dizendo "Zod 3" num repo em
 * zod 4, numa seção rotulada CONFIRMADO. Um agente lendo aquilo escreveria
 * idioma da major errada.
 *
 * A régua é a MAJOR, e só ela — issue #235.
 *
 * A versão anterior respeitava a precisão que o doc escolhesse: "Zod 4" cobrava
 * a major, "Playwright 1.62" cobrava a minor. Isso tornou o gate INSATISFAZÍVEL
 * POR BOT. Medido em f9abedd0, bumpando um pacote por vez como o grupo
 * `minor-and-patch` do Dependabot faz: **5 dos 8 reprovavam o `verify`** a cada
 * bump minor (next, react, typescript, tailwindcss, @playwright/test), e os 3
 * imunes eram exatamente os que o doc declarava só com a major. O conserto que
 * sobrava era editar prosa em markdown para destravar um merge de dependência —
 * e o histórico tem esse commit (`docs(agents): AGENTS.md acompanha o next 16.3
 * do bump`), feito à mão por um humano depois do bot travar.
 *
 * A major é onde o IDIOMA muda, que é o dano que a #66 existia para impedir: o
 * arquivo nasceu dizendo "Zod 3" num repo em zod 4, sob um rótulo CONFIRMADO, e
 * um agente lendo aquilo escreveria a API errada. Minor não muda idioma.
 *
 * O contrapeso é o AGENTS.md declarar só a MAJOR (ele foi ajustado no mesmo
 * commit): assim o doc não fica "certo na major e desatualizado na minor" — ele
 * afirma exatamente aquilo que este teste cobre, e nada além. Gate e doc medem a
 * mesma coisa.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

/** Como o nome aparece no AGENTS.md → nome do pacote no package.json. */
const BIBLIOTECAS: Array<{ rotulo: string; pacote: string }> = [
  { rotulo: "Next\\.js", pacote: "next" },
  { rotulo: "React", pacote: "react" },
  { rotulo: "TypeScript", pacote: "typescript" },
  { rotulo: "Tailwind", pacote: "tailwindcss" },
  { rotulo: "Zod", pacote: "zod" },
  { rotulo: "Vitest", pacote: "vitest" },
  { rotulo: "Playwright", pacote: "@playwright/test" },
  { rotulo: "Sentry", pacote: "@sentry/nextjs" },
];

function versaoInstalada(pkg: Record<string, Record<string, string>>, nome: string): string {
  const bruto = pkg.dependencies?.[nome] ?? pkg.devDependencies?.[nome];
  if (!bruto) throw new Error(`${nome} não está no package.json`);
  return bruto.replace(/^[\^~>=<\s]+/, "");
}

describe("AGENTS.md × package.json", () => {
  const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<
    string,
    Record<string, string>
  >;

  for (const { rotulo, pacote } of BIBLIOTECAS) {
    it(`declara a versão certa de ${pacote}`, () => {
      const achado = agents.match(new RegExp(`${rotulo}\\s+(\\d+(?:\\.\\d+)*)`));
      expect(achado, `AGENTS.md não declara a versão de ${pacote}`).toBeTruthy();

      const declarada = achado![1]!;
      const instalada = versaoInstalada(pkg, pacote);

      // Guarda de vacuidade: um doc que declarasse "Next.js 16.3" continuaria
      // passando na comparação de major, e o gate deixaria de cobrir o que o doc
      // afirma. Cobrar a forma faz o doc e o teste medirem a MESMA coisa.
      expect(
        /^\d+$/.test(declarada),
        `AGENTS.md declara ${pacote} ${declarada}: escreva só a MAJOR. A minor não é ` +
          `coberta por este gate (issue #235), e declarar o que ninguém verifica é como ` +
          `o "Zod 3" da #66 entrou.`,
      ).toBe(true);

      expect(
        instalada.split(".")[0] === declarada,
        `AGENTS.md diz ${pacote} ${declarada}, package.json tem ${instalada}`,
      ).toBe(true);
    });
  }
});
