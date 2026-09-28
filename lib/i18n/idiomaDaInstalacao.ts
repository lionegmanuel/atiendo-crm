import { env } from "@/lib/env";
import { traduzir } from "@/lib/i18n/dicionario";
import { normalizarIdioma, type Idioma } from "@/lib/i18n/idiomas";

/**
 * O idioma que esta instalação declarou em `APP_LOCALE` — server-only, porque
 * lê `lib/env`. Vazio ou fora dos idiomas servidos cai no padrão do produto,
 * então uma instalação que nunca definiu a variável se comporta como antes.
 *
 * Quem usa: a organização que nasce do cadastro pela tela
 * (`lib/auth/provision.ts`) e o visitante anônimo cujo `Accept-Language` não
 * pede nenhum idioma servido (`lib/i18n/idiomaAnonimo.ts`).
 */
export function idiomaDaInstalacao(): Idioma {
  return normalizarIdioma(env.APP_LOCALE.trim());
}

/**
 * Título de aba (`export const metadata`) no idioma da instalação. O título é
 * avaliado uma vez por módulo, fora de qualquer requisição, então não há
 * usuário de quem ler a preferência — só a instalação. Sem `APP_LOCALE`, o
 * texto sai como está (pt-BR), que é o comportamento de antes.
 */
export function tituloNoIdiomaDaInstalacao(titulo: string): string {
  return traduzir(titulo, idiomaDaInstalacao());
}
