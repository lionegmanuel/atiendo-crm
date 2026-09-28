"use client";
/**
 * Reexporta o `useT` do provider de idioma.
 *
 * O caminho `@/hooks/i18n/useT` é o que as telas importam; a implementação mora
 * em `lib/i18n/IdiomaProvider`, junto do contexto que ela lê. Separar o hook do
 * seu contexto faria os dois divergirem no dia em que alguém mudasse um.
 */
export { useT } from "@/lib/i18n/IdiomaProvider";
