/**
 * O CATÁLOGO DE MODELOS — a face do módulo.
 *
 * Quem consome (a tela, a rota de instalação, o teste) importa daqui e nunca do
 * arquivo do nicho: acrescentar um nicho novo é acrescentar uma lista a
 * `MODELOS_DE_FOLLOWUP`, sem tocar em nenhum consumidor.
 */
import { MODELOS_DE_CLINICA } from "./clinica";
import type { ModeloDeFollowup, NichoDeModelo } from "./tipos";

export type { ModeloDeFollowup, NichoDeModelo, EntradaDoModelo } from "./tipos";
export { toquesDoModelo, horizonteDoModeloMs, NICHOS_DE_MODELO } from "./tipos";

export const MODELOS_DE_FOLLOWUP: readonly ModeloDeFollowup[] = [...MODELOS_DE_CLINICA];

/** `undefined` — e não um erro — para a rota devolver 404 com a sua própria mensagem. */
export function modeloPorId(id: string): ModeloDeFollowup | undefined {
  return MODELOS_DE_FOLLOWUP.find((m) => m.id === id);
}

export function modelosDoNicho(nicho: NichoDeModelo): ModeloDeFollowup[] {
  return MODELOS_DE_FOLLOWUP.filter((m) => m.nicho === nicho);
}
