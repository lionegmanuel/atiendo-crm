/**
 * O LINK DO E-MAIL DE AUTH É MONTADO POR DOIS ARQUIVOS QUE NÃO SE CONHECEM.
 *
 * Quem inicia a query é o Server Action (`?type=recovery` / `?type=signup` em
 * `redirectTo`/`emailRedirectTo`); quem a continua é o template HTML que o
 * GoTrue renderiza (`&token_hash={{ .TokenHash }}`). Um é TypeScript, o outro
 * é HTML lido por um serviço em Go — nenhum compilador, tipo ou teste de
 * unidade existente liga os dois.
 *
 * ## O defeito que fez este arquivo existir
 *
 * O template usava `?token_hash=...`. Quando o Action passou a anexar
 * `?type=...` ao redirect (necessário porque, com o template PADRÃO do
 * Supabase, o link chega via PKCE `code` e o `type` não sobrevive ao hop pelo
 * GoTrue), o link virou:
 *
 *     /auth/confirm?type=recovery?token_hash=pkce_abc&type=recovery
 *                               ↑ segundo `?`
 *
 * O parser de URL do browser trata tudo depois do PRIMEIRO `?` como query, e o
 * segundo `?` vira parte do VALOR de `type`. `token_hash` deixa de ser um
 * parâmetro, `/auth/confirm` recebe `null` e manda o usuário para
 * `/login?error=link_invalido` — com um token perfeitamente válido na mão.
 *
 * Nada acusava: `typecheck`, `lint` e `test:unit` passam, porque HTML errado
 * não compila nem é importado. O sintoma que o usuário vê ("link expirado") não
 * se parece com a causa.
 *
 * ## O que se guarda
 *
 * Os DOIS sentidos, porque consertar um lado sozinho reintroduz o bug pelo
 * outro: se o Action parar de abrir a query, o `&` do template passa a ser o
 * separador errado e o link quebra igual.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const raiz = process.cwd();
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const PARES = [
  {
    fluxo: "recovery",
    action: "app/actions/auth/requestPasswordReset.ts",
    template: "supabase/templates/recovery.html",
  },
  {
    fluxo: "signup",
    action: "app/actions/auth/signUp.ts",
    template: "supabase/templates/confirmation.html",
  },
] as const;

describe("o link do e-mail de auth tem UMA query só", () => {
  for (const { fluxo, action, template } of PARES) {
    it(`${fluxo}: o Action ABRE a query com ?type=`, () => {
      const fonte = ler(action);
      // Guarda de vacuidade: arquivo movido ou vazio faria o `toMatch` abaixo
      // falhar por ausência de dado, e a mensagem não diria isso.
      expect(fonte.length, `${action} veio vazio — o teste ficou cego`).toBeGreaterThan(200);
      expect(
        fonte,
        `${action} precisa anexar ?type=${fluxo} ao redirect — é o que sobrevive ao hop do GoTrue no formato PKCE`,
      ).toMatch(new RegExp(`/auth/confirm\\?type=${fluxo}`));
    });

    it(`${fluxo}: o template CONTINUA a query com &token_hash=`, () => {
      const html = ler(template);
      expect(html.length, `${template} veio vazio — o teste ficou cego`).toBeGreaterThan(200);

      // A régua é o HREF, não o arquivo: a primeira versão deste teste usava
      // `not.toContain("?token_hash")` sobre o texto inteiro e reprovou por
      // causa do COMENTÁRIO que explica o bug. Medir o arquivo quando se quer
      // medir um atributo é o mesmo erro que o gate do canal zernio cometia.
      const href = /href="(\{\{ \.RedirectTo \}\}[^"]*)"/.exec(html)?.[1];
      expect(href, `${template}: não achei o href do RedirectTo — o teste ficou cego`).toBeTruthy();
      expect(
        href,
        `${template} precisa usar & (a query já foi aberta pelo Action); ? aqui duplica o separador e o browser para de enxergar token_hash`,
      ).toBe("{{ .RedirectTo }}&token_hash={{ .TokenHash }}");
    });
  }
});
