"use client";

/**
 * A marca da INSTALAÇÃO como um client component pode lê-la — por PROP do
 * servidor, e não por uma fonte que só o navegador enxerga.
 *
 * ── Por que este arquivo existe (o defeito que ele fecha) ─────────────────────
 *
 * `branding()` (`lib/branding.ts`) lê fontes DIFERENTES nos dois lados da
 * fronteira: `window.__PUBLIC_ENV__` no navegador, `process.env` no servidor.
 * Enquanto o `<PublicEnvScript/>` injetava o `.env` cru, as duas fontes diziam a
 * mesma coisa e a assimetria não aparecia. Quando `app/layout.tsx` passou a
 * injetar a marca RESOLVIDA (banco acima do `.env`), elas divergiram: numa
 * instalação com logo gravado pela tela e `APP_LOGO_URL` vazio — o caso normal
 * de quem sobe logo pela tela — o SSR de `components/shell/Sidebar.tsx` via
 * `logoUrl: null` e desenhava `<span>`, e o navegador via a URL do banco e
 * desenhava `<img>`. Trocar o TIPO do elemento entre servidor e cliente é
 * hydration mismatch: React #418 em toda tela, com a árvore descartada e
 * regerada no cliente.
 *
 * A correção é a rota que o produto já usa para `user`/`activeOrg`: o servidor
 * resolve UMA vez e ENTREGA o valor. O que o servidor renderizou e o que o
 * cliente hidrata passam a ser o mesmo objeto, por construção — não por dois
 * caminhos que se espera que concordem.
 *
 * ── Quem monta o provedor ────────────────────────────────────────────────────
 *
 * `app/layout.tsx`, com a MESMA `marcaResolvida()` que alimenta o título da aba,
 * o CSS da marca e o `<PublicEnvScript/>`. Montar a pilha em outro lugar seria
 * criar uma segunda fonte de verdade sobre precedência — que é exatamente o
 * defeito de cima com outra roupa.
 *
 * ── Por que o padrão NÃO lança ───────────────────────────────────────────────
 *
 * Doutrina de marca própria: o resolvedor degrada para o padrão do produto e
 * segue. Um `throw` aqui derrubaria a tela inteira de quem montasse um client
 * component fora do provedor — e a marca é decoração, não é o que a tela faz.
 * Quem garante que ninguém fica de fora é o layout RAIZ (o provedor envolve
 * `children`) mais a catraca de
 * `tests/unit/marca-sem-divergencia-de-hidratacao.test.tsx`, que reprova
 * qualquer `"use client"` que volte a chamar `branding()`.
 */

import { createContext, useContext, type ReactNode } from "react";

import { resolveBranding, type Branding } from "@/lib/branding";

/**
 * O padrão do produto — o que aparece quando ninguém configurou marca nenhuma.
 * Sai do MESMO resolvedor que as camadas usam, e não de um literal redigitado:
 * duas definições do padrão divergiriam na primeira vez que alguém mexesse em
 * uma delas.
 */
const PADRAO_DO_PRODUTO: Branding = resolveBranding(undefined, undefined);

const MarcaDaInstalacao = createContext<Branding>(PADRAO_DO_PRODUTO);

export function MarcaDaInstalacaoProvider({
  marca,
  children,
}: {
  /** A marca já resolvida pelo servidor (banco acima, `.env` embaixo). */
  readonly marca: Branding;
  readonly children: ReactNode;
}) {
  return <MarcaDaInstalacao.Provider value={marca}>{children}</MarcaDaInstalacao.Provider>;
}

/**
 * A marca da instalação num componente `"use client"`.
 *
 * Use ESTE hook, nunca `branding()`: aquela função é server-only desde o defeito
 * descrito no topo deste arquivo, e chamá-la aqui reintroduz o mismatch.
 */
export function useMarcaDaInstalacao(): Branding {
  return useContext(MarcaDaInstalacao);
}
