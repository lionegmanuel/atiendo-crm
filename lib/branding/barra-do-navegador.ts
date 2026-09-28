/**
 * A cor da barra do navegador (`<meta name="theme-color">`) — LIDA da régua.
 *
 * ─── Por que NÃO é dinâmico, e por que trocar por `generateViewport()` erra ──
 *
 * A marca do operador não move o fundo da página. O serializador
 * (`lib/branding/css.ts`) emite `--color-brand` e a família do accent
 * (`--color-accent-{50..950}`, `-fg`, `-hover`, `-soft`) e mais nada — medido:
 * `grep -c color-bg lib/branding/css.ts` devolve 1, e essa única ocorrência
 * está dentro de um comentário sobre contraste. Logo `#faf9f6` / `#161510` são
 * a cor CERTA da barra para qualquer marca, e um `generateViewport()` lendo o
 * banco custaria uma leitura por requisição para devolver sempre a mesma
 * constante. Isto está escrito aqui porque a leitura apressada ("a barra tem a
 * cor do produto em todo clone!") é verdadeira e não é defeito, e sem o motivo
 * registrado alguém a "conserta" de novo.
 *
 * ─── O defeito que este módulo conserta é DUPLICAÇÃO ────────────────────────
 *
 * Os dois hexes estavam escritos em três lugares — `app/layout.tsx`,
 * `lib/branding/regua-do-produto.ts` e `app/globals.css` — sem nada os mantendo
 * em sincronia. No dia em que o fundo do produto mudasse, a barra do navegador
 * ficaria com a cor velha e nenhum gate reprovaria. Agora há uma fonte, e a
 * régua é gerada do `globals.css` por `branding-regua-do-produto.test.ts`.
 *
 * ─── Nunca lança ────────────────────────────────────────────────────────────
 *
 * Isto roda no `viewport` do layout raiz: uma exceção aqui é 500 em TODA tela.
 * Tema sem `--color-bg` na régua simplesmente não emite entrada, e o navegador
 * usa o padrão dele — degrada em vez de derrubar. Quem reprova nesse caso é
 * `tests/unit/branding-barra-do-navegador.test.ts`, no build, e não o usuário.
 */

import type { Regua, TemaDaRegua } from "./contraste";

/** O formato que `Viewport["themeColor"]` do Next aceita. */
export type CorDaBarra = { readonly media: string; readonly color: string };

/** A chave da superfície de fundo dentro de `TemaDaRegua.base`. */
const TOKEN_DE_FUNDO = "--color-bg";

function corDeFundo(tema: TemaDaRegua): string | undefined {
  return tema.base.find((t) => t.chave === TOKEN_DE_FUNDO)?.hex;
}

/**
 * As duas entradas de `theme-color`, na ordem claro → escuro.
 *
 * `flatMap` e não `map`: é o que descarta o tema sem cor sem precisar de `!`
 * num campo que o tipo do Next declara obrigatório — o cast que a doutrina
 * proíbe, e que aqui esconderia justamente a régua quebrada.
 */
export function coresDaBarraDoNavegador(regua: Regua): CorDaBarra[] {
  return (
    [
      ["(prefers-color-scheme: light)", corDeFundo(regua.claro)],
      ["(prefers-color-scheme: dark)", corDeFundo(regua.escuro)],
    ] as const
  ).flatMap(([media, color]) => (color ? [{ media, color }] : []));
}
