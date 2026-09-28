import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * SPEC QUE NAVEGA PARA UMA ROTA INEXISTENTE FALHA COMO SE A TELA ESTIVESSE QUEBRADA.
 *
 * Custo medido (PR #1265, job `e2e-parte (1)`): a spec do canal mudo apontava
 * para `/app/settings/connections` — Conexões não mora sob Configurações, a
 * rota é `/app/connections`. O Playwright pousou no 404 do produto e esperou
 * 60 segundos por um elemento que jamais apareceria; o veredito que chegou ao
 * log foi "element(s) not found", que se lê como defeito da FEATURE. Só o
 * `error-context.md` do artefato contava a verdade ("404 — Página não
 * encontrada"), e chegar nele custou 18 minutos de e2e mais o download do
 * artefato da rodada.
 *
 * Este gate é o mesmo achado em segundos, no `verify`: a URL literal de todo
 * `goto` de `tests/e2e/` tem que resolver para algo que o App Router serve.
 *
 * ── O que ele NÃO promete ───────────────────────────────────────────────────
 * Ele lê caminho ESTÁTICO. Um `${id}` no meio da URL casa com qualquer segmento
 * dinâmico (`[id]`), sem conferir qual — o gate responde "esta forma de URL tem
 * dono", nunca "este id existe". E ele não enxerga redirecionamento: rota que
 * existe só para mandar o usuário embora (`/app/settings/canal-oficial`) passa,
 * porque ela existe mesmo.
 */

const DIR_E2E = "tests/e2e";
const DIR_APP = "app";

/**
 * O segmento-curinga que substitui cada `${…}` da URL.
 *
 * `*` porque ele não é caractere de segmento de rota nem aparece nas URLs que
 * as specs escrevem: qualquer colisão seria visível, ao contrário de um
 * sentinela invisível como o caractere nulo, que entraria no arquivo como byte nulo e
 * faria o próprio fonte virar binário para o `grep`.
 */
const CURINGA = "*";

/**
 * Caminhos que uma spec visita DE PROPÓSITO sabendo que não existem — o teste é
 * exatamente sobre o que o produto faz com eles. A lista só encolhe, e cada
 * linha carrega o motivo: sem ele, ela vira o lugar onde se esconde o erro que
 * este arquivo existe para pegar.
 */
const AUSENCIA_DELIBERADA = new Map<string, string>([
  ["/404", "error-pages.spec.ts: prova a página de não-encontrado do produto."],
  [
    "/legal/qualquer-outra",
    "error-pages.spec.ts: prova que o vizinho de /legal continua exigindo login — o caminho não pode existir.",
  ],
]);

/**
 * Tudo que o App Router SERVE por GET, já sem os grupos `(x)`.
 *
 * `route.ts` entra junto com `page.tsx` porque o browser também navega para
 * handler: `/auth/confirm` é o link do e-mail de recuperação, e ele responde
 * com um redirecionamento. Exigir `page.tsx` reprovaria uma spec correta.
 */
function rotasServidas(): string[][] {
  const achadas: string[][] = [];
  const andar = (dir: string, segmentos: string[]): void => {
    for (const entrada of readdirSync(dir)) {
      const caminho = join(dir, entrada);
      if (statSync(caminho).isDirectory()) {
        // Grupo de rota não aparece na URL; `@slot` do parallel routing também não.
        const invisivel =
          (entrada.startsWith("(") && entrada.endsWith(")")) || entrada.startsWith("@");
        andar(caminho, invisivel ? segmentos : [...segmentos, entrada]);
      } else if (/^(page|route)\.tsx?$/.test(entrada)) {
        achadas.push(segmentos);
      }
    }
  };
  andar(DIR_APP, []);
  return achadas;
}

/** A URL literal do `goto`, com cada `${…}` virando um segmento-curinga. */
function caminhoDoGoto(literal: string): string | null {
  const comCuringa = literal.replace(/\$\{[^}]*\}/g, CURINGA);
  // `${APP_URL}/app/inbox` e `${url}/login`: o prefixo é a base, não a rota.
  const semBase = comCuringa.startsWith(CURINGA) ? comCuringa.slice(CURINGA.length) : comCuringa;
  if (!semBase.startsWith("/")) return null; // URL absoluta (outro servidor).
  return semBase.split("?")[0]!.split("#")[0]!;
}

function casaSegmento(alvo: string, daRota: string): boolean {
  if (daRota.startsWith("[")) return true; // segmento dinâmico aceita qualquer coisa
  if (alvo.includes(CURINGA)) return false; // `${id}` só casa com segmento dinâmico
  return alvo === daRota;
}

function temDono(caminho: string, rotas: string[][]): boolean {
  const alvo = caminho.split("/").filter(Boolean);
  return rotas.some((rota) => {
    const ultimo = rota[rota.length - 1] ?? "";
    if (ultimo.startsWith("[...") || ultimo.startsWith("[[...")) {
      const fixos = rota.slice(0, -1);
      return alvo.length >= fixos.length && fixos.every((seg, i) => casaSegmento(alvo[i]!, seg));
    }
    if (rota.length !== alvo.length) return false;
    return rota.every((seg, i) => casaSegmento(alvo[i]!, seg));
  });
}

interface Navegacao {
  arquivo: string;
  linha: number;
  caminho: string;
}

function navegacoesDasSpecs(): Navegacao[] {
  const achadas: Navegacao[] = [];
  const specs = readdirSync(DIR_E2E)
    .filter((f) => f.endsWith(".spec.ts"))
    .sort();
  for (const arquivo of specs) {
    const fonte = readFileSync(join(DIR_E2E, arquivo), "utf8");
    for (const m of fonte.matchAll(/\.goto\(\s*(["'`])((?:\\.|(?!\1).)*)\1/g)) {
      const caminho = caminhoDoGoto(m[2]!);
      if (caminho === null) continue;
      achadas.push({ arquivo, linha: fonte.slice(0, m.index).split("\n").length, caminho });
    }
  }
  return achadas;
}

describe("toda navegação de spec e2e aponta para uma rota que existe", () => {
  const rotas = rotasServidas();
  const navegacoes = navegacoesDasSpecs();

  it("acha as rotas e as navegações — sonda vazia mediria nada", () => {
    // Variância zero num conjunto que deveria variar é assinatura de sonda
    // morta: sem este caso, um `readdirSync` apontado para o lugar errado
    // deixaria o arquivo inteiro verde por não ter o que reprovar.
    expect(rotas.length).toBeGreaterThan(50);
    expect(navegacoes.length).toBeGreaterThan(50);
  });

  it("nenhuma spec navega para um caminho que o App Router não serve", () => {
    const orfas = navegacoes
      .filter((n) => !AUSENCIA_DELIBERADA.has(n.caminho))
      .filter((n) => !temDono(n.caminho, rotas))
      .map((n) => `${DIR_E2E}/${n.arquivo}:${n.linha} → ${n.caminho}`);
    expect(orfas).toEqual([]);
  });

  it("a lista de ausências deliberadas não guarda caminho que passou a existir", () => {
    const jaExistem = [...AUSENCIA_DELIBERADA.keys()].filter((c) => temDono(c, rotas));
    expect(jaExistem).toEqual([]);
  });
});
