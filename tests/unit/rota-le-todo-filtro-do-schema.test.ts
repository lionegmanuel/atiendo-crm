/**
 * TODO FILTRO QUE O SCHEMA ACEITA, A ROTA TEM DE LER DA URL.
 *
 * ## A rotura, duas vezes, no mesmo ponto
 *
 * `GET /api/v1/conversations` não passa a query string inteira ao Zod: ele monta
 * um objeto campo a campo, com uma LISTA BRANCA escrita à mão. Um filtro novo
 * atravessa quatro peças — schema, hook do browser, handler, e esta lista — e
 * esquecer justamente a lista é invisível para todo gate de tipo, porque
 * `safeParse` recebe `unknown`: nada reclama de uma chave a menos.
 *
 * O sintoma é o pior possível, porque **parece funcionar**: a lista volta
 * INTEIRA, sem erro, sem log. E quando o contador vem de outra rota (que leu o
 * filtro certo), a tela chega a se contradizer sozinha — medido no CI em
 * 2026-08-31, a aba dizia "Fila 1" e listava 5 conversas embaixo.
 *
 * Aconteceu com `tag` (achado por @jmpo, PR #199) e aconteceu de novo com
 * `comando` (migration 0203) — a segunda vez com o comentário do primeiro caso
 * escrito três linhas acima, no mesmo arquivo. Comentário não é mecanismo: quem
 * o lê já está olhando o lugar certo, e quem esquece não chegou lá.
 *
 * ## O que este teste faz
 *
 * Deriva as chaves do PRÓPRIO schema (não uma lista digitada aqui, que teria a
 * mesma doença) e cobra que cada uma seja lida de `searchParams` na rota. Filtro
 * novo nasce ligado ou nasce vermelho.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { listConversationsQuerySchema } from "@/lib/schemas";

const RAIZ = join(__dirname, "..", "..");
const ROTA = "app/api/v1/conversations/route.ts";

/** O texto da rota SEM comentários — eles citam nomes de filtro e falseariam a busca. */
function fonteDaRota(): string {
  return readFileSync(join(RAIZ, ROTA), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/** As chaves que o schema aceita, tiradas dele mesmo. */
function chavesDoSchema(): string[] {
  return Object.keys(listConversationsQuerySchema.shape).sort();
}

describe("a rota lê todo filtro que o schema aceita", () => {
  it("o schema tem chaves — se esta lista vier vazia, o teste abaixo aprova tudo", () => {
    // Controle: `.shape` mudou de forma entre versões do Zod, e um `{}` aqui
    // deixaria o caso principal verde por não ter o que cobrar.
    const chaves = chavesDoSchema();
    expect(chaves.length).toBeGreaterThanOrEqual(6);
    expect(chaves).toContain("status");
    expect(chaves).toContain("comando");
  });

  it.each(chavesDoSchema())("a rota lê `%s` de searchParams", (chave) => {
    const src = fonteDaRota();
    // `limit` e `cursor` também entram: eles são filtros do mesmo objeto e a
    // rotura seria igual (uma página de tamanho errado é tão silenciosa quanto
    // uma lista sem filtro).
    expect(
      new RegExp(`${chave}:\\s*url\\.searchParams\\.get\\(\\s*["']${chave}["']`).test(src) ||
        new RegExp(`${chave}:\\s*url\\.searchParams\\.get\\(["']${chave}["']\\)\\s*===`).test(src),
      `${ROTA} não lê "${chave}" da URL — o schema aceita, o browser manda, e a rota descarta em silêncio`,
    ).toBe(true);
  });

  it("o controle: a cerca reprova quando uma chave some da rota", () => {
    // Uma varredura que nasce verde pode estar certa ou cega. Aqui a sabotagem é
    // simulada no texto, sem tocar no arquivo.
    const sabotado = fonteDaRota().replace(
      /comando:\s*url\.searchParams\.get\(\s*["']comando["']\s*\)\s*\?\?\s*undefined,/,
      "",
    );
    expect(
      new RegExp(`comando:\\s*url\\.searchParams\\.get\\(\\s*["']comando["']`).test(sabotado),
      "a sabotagem não removeu a linha — o regex do teste não casa com o código real",
    ).toBe(false);
  });
});
