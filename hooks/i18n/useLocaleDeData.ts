"use client";
/**
 * O `Locale` do date-fns para o idioma em vigor nesta sessão.
 *
 * Mora ao lado do `useT` porque é a mesma pergunta feita de outro jeito: `t`
 * traduz a PALAVRA, este traduz a DATA. Separá-los faria uma tela pegar o
 * idioma certo para o rótulo e o errado para o dia da semana — que foi
 * exatamente o estado anterior a esta camada.
 *
 * Para função AUXILIAR fora do componente, não chame o hook: receba o `Locale`
 * por parâmetro, como se faz com o `t`. Hook em função que não é componente
 * quebra as regras do React, e a auxiliar fica testável sem montar árvore.
 */
import { useMemo } from "react";

import { localeDeData, tagDeIdioma } from "@/lib/i18n/datas";
import { useIdioma } from "@/lib/i18n/IdiomaProvider";
import type { Locale } from "date-fns";

export function useLocaleDeData(): Locale {
  const idioma = useIdioma();
  return useMemo(() => localeDeData(idioma), [idioma]);
}

/**
 * A etiqueta BCP-47 para `toLocaleDateString` e amigos.
 *
 * Existe porque nem toda data do produto passa pelo date-fns: parte usa a API
 * nativa do browser, que quer a string do idioma e não o objeto `Locale`. As
 * duas formas conviviam com `"pt-BR"` escrito à mão, e a nativa era a mais
 * fácil de esquecer — não tem import para denunciar.
 */
export function useTagDeIdioma(): string {
  const idioma = useIdioma();
  return useMemo(() => tagDeIdioma(idioma), [idioma]);
}
