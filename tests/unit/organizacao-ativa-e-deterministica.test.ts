import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A ORGANIZAÇÃO ATIVA NÃO PODE SER SORTEADA.
 *
 * ─── O defeito ───────────────────────────────────────────────────────────────
 * `resolveActiveOrg` pega `authUser.organizations[0]` quando não há cookie
 * `active_org` — primeiro acesso, sessão nova, cookie expirado. E a lista vinha
 * de uma consulta a `user_organizations` SEM `ORDER BY`.
 *
 * Sem ordenação, "a primeira" é o que o Postgres devolver, e isso não é estável
 * por especificação: muda com plano de execução, com a ordem física das linhas e
 * com qualquer reescrita delas. Para quem administra DUAS empresas na mesma
 * instalação, entrar sem cookie podia cair numa ou na outra sem critério — e o
 * produto não dava sinal de que tinha escolhido.
 *
 * ⚠️ NÃO OBSERVEI A TROCA ACONTECER. Tentei provocá-la com `UPDATE` na linha e a
 * ordem se manteve. O que está medido é a INDETERMINAÇÃO (não há `ORDER BY`), e
 * é ela que este teste prende — não um sintoma. Guardar só o que se observou
 * deixaria de fora justamente o caso que ninguém consegue reproduzir sob demanda
 * e que aparece no cliente.
 *
 * ─── Por que um teste de FONTE e não de comportamento ────────────────────────
 * A propriedade é "a consulta pede ordem". Um teste de comportamento com dublê
 * não a alcança: o dublê devolve o array na ordem que quiser, e passaria com ou
 * sem `ORDER BY`. Contra Postgres real, ele passaria enquanto a ordem física
 * casasse — verde por acidente, que é o pior desfecho.
 */
const RAIZ = process.cwd();
const FONTE = fs.readFileSync(path.join(RAIZ, "lib/auth/server.ts"), "utf8");

/** A cadeia da consulta de memberships, do `.from` até o fim da instrução. */
function consultaDeMemberships(): string {
  const i = FONTE.indexOf('.from("user_organizations")');
  expect(i, "a consulta de memberships sumiu de lib/auth/server.ts").toBeGreaterThan(-1);
  const fim = FONTE.indexOf(";", i);
  return FONTE.slice(i, fim === -1 ? FONTE.length : fim);
}

describe("a organização ativa é escolhida por uma regra, não pelo acaso", () => {
  it("a consulta que alimenta `organizations[0]` pede ORDEM explícita", () => {
    const cadeia = consultaDeMemberships();
    expect(
      /\.order\(/.test(cadeia),
      "a consulta de `user_organizations` não ordena. `resolveActiveOrg` pega " +
        "`organizations[0]` quando não há cookie, então sem `ORDER BY` a organização " +
        "ativa de quem tem duas empresas é o que o Postgres devolver — instável por " +
        "especificação, e sem sinal nenhum na tela.",
    ).toBe(true);
  });

  it("a ordem tem DESEMPATE — senão ela só empurra o acaso um nível", () => {
    // `accepted_at` sozinho não basta: duas organizações aceitas no mesmo
    // instante (convite em lote) voltam a empatar, e o desempate vira o acaso de
    // novo. É o modo de falha que uma ordenação parcial esconde melhor do que
    // nenhuma, porque parece resolvido.
    const cadeia = consultaDeMemberships();
    const quantas = [...cadeia.matchAll(/\.order\(/g)].length;
    expect(
      quantas,
      `a consulta ordena por ${quantas} critério(s). Com um só, duas linhas de mesmo ` +
        "valor voltam a sair em ordem indeterminada — o desempate precisa ser por " +
        "algo único, como o id da organização.",
    ).toBeGreaterThanOrEqual(2);
  });

  it("`resolveActiveOrg` continua consumindo o PRIMEIRO — o vínculo que dá sentido ao resto", () => {
    // Controle do instrumento: se um dia a escolha deixar de ser
    // `organizations[0]`, os dois casos acima passam a guardar uma ordenação que
    // não decide mais nada, e ninguém perceberia.
    expect(
      /organizations\[0\]/.test(FONTE),
      "`resolveActiveOrg` não usa mais `organizations[0]` — reveja se esta ordenação " +
        "ainda decide a organização ativa, ou remova esta guarda com o motivo escrito",
    ).toBe(true);
  });
});
