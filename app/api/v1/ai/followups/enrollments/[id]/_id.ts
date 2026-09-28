/**
 * A validação do `:id` do caminho, uma vez.
 *
 * Cinco rotas irmãs a repetiam com a mesma regex; arquivo `_`-prefixado não vira
 * rota no App Router, então ele mora ao lado de quem usa.
 */
import { fail } from "@/lib/api/wrappers";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Devolve a resposta de erro quando o id não é um uuid; `null` quando está ok. */
export function validaIdDaRota(id: string, requestId: string): Response | null {
  return UUID_RX.test(id) ? null : fail("invalid_request", "id inválido.", 400, { requestId });
}
