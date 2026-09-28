/**
 * Hash do CONTRATO DE PARÂMETROS de um template — a âncora da trava por obsolescência.
 *
 * Uma config de disparo guarda o hash do contrato que ela preencheu. No sync seguinte,
 * hash divergente significa que alguém editou o template na Meta e a config ficou
 * obsoleta — trabalho visível, em vez de erro de envio em produção.
 *
 * **O hash não é do JSON cru: é do contrato DERIVADO.** A diferença decide o desenho.
 * Hash do JSON cru muda quando alguém corrige uma vírgula no corpo — e um alarme que
 * dispara por vírgula invalida a config de todo mundo a cada sync, vira ruído, e alguém
 * o desliga. O que precisa entrar no hash é só o que muda o PAYLOAD DE ENVIO:
 *
 *   - os slots (endereço + chave + tipo esperado, na ordem) — pega o 132000 (contagem)
 *     e o 132012 (formato do header, que não tem `{{n}}` nenhum para contar);
 *   - o `parameter_format` — POSITIONAL e NAMED montam parâmetros diferentes.
 *
 * A serialização é determinística porque os endereços são construídos AQUI, por
 * literais de objeto sempre na mesma ordem — nunca copiados do JSON de entrada, cuja
 * ordem de chaves é do emissor e não vale confiança.
 */
import { createHash } from "node:crypto";

import { deriveTemplateContract } from "./template-contract";

type MetaComponents = Parameters<typeof deriveTemplateContract>[0]["components"];

/**
 * @param components  `components[]` cru do template, como a Graph API devolve.
 * @param parameterFormat  o `parameter_format` declarado pela Meta. Omitir vale
 *   POSITIONAL, que é o que ela assume quando o campo não vem. **Não é opcional por
 *   conveniência:** os mesmos `components` sob formatos diferentes exigem payloads
 *   diferentes, então precisam de hashes diferentes.
 */
export function hashContract(components: unknown, parameterFormat?: string): string {
  const contract = deriveTemplateContract({
    name: "",
    language: "",
    parameter_format: parameterFormat,
    components: components as MetaComponents,
  });
  const canonical = JSON.stringify({
    parameterFormat: contract.parameterFormat,
    slots: contract.slots.map((s) => [s.address, s.key, s.expects]),
  });
  return createHash("sha256").update(canonical).digest("hex");
}
