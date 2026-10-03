import type { Idioma } from "@/lib/i18n/idiomas";

/**
 * Palabras que llaman a una persona al instante, sugeridas en el formulario del
 * agente. Son DATOS que se comparan con lo que escribe el cliente, no texto de
 * pantalla: por eso no pasan por `t()` y dependen del idioma de quien atiende.
 * Con la lista portuguesa fija, una instalación en español arrancaba con tres
 * palabras que ningún cliente suyo escribe.
 */
export const PALAVRAS_DE_HANDOFF_PADRAO: Record<Idioma, readonly string[]> = {
  "pt-BR": ["falar com humano", "atendente", "pessoa real"],
  es: ["hablar con una persona", "hablar con un asesor", "quiero un humano"],
};

export function palavrasDeHandoffPadrao(idioma: Idioma): string[] {
  return [...(PALAVRAS_DE_HANDOFF_PADRAO[idioma] ?? PALAVRAS_DE_HANDOFF_PADRAO["pt-BR"])];
}
