/**
 * Renderiza o texto que o LEAD vai ler — os componentes de texto do template com os
 * `{{n}}` já substituídos pelos valores.
 *
 * Existe por causa de uma consequência boa do desenho da cadeia: `runBeforeSend`
 * recebe `body: string` e o entrega aos gates de promessa, spinning e disclosure.
 * Passando o template RENDERIZADO como `body`, esses gates avaliam **exatamente o
 * que o contato vai ler** — em vez de o template ser um ponto cego onde a IA poderia
 * prometer o que a tabela de promessas proíbe.
 *
 * Sem isto, "usar template" viraria a forma de escapar dos guardrails de conteúdo.
 */
import { slotKey } from "./build-components";
import { deriveTemplateContract } from "./template-contract";

interface ComponenteTexto {
  type?: string;
  text?: string;
}

/**
 * Junta os textos de HEADER e BODY (nessa ordem) com os valores aplicados.
 *
 * FOOTER fica de fora: é rodapé fixo da marca, nunca carrega parâmetro, e incluí-lo
 * poluiria a análise dos gates com texto que não é da conversa.
 */
export function renderTemplateBody(
  components: unknown,
  values: Record<string, string>,
  meta: { name: string; language: string; parameterFormat?: string },
): string {
  const contrato = deriveTemplateContract({
    name: meta.name,
    language: meta.language,
    ...(meta.parameterFormat !== undefined ? { parameter_format: meta.parameterFormat } : {}),
    components: components as never,
  });

  // Mapa key → valor pelo MESMO `slotKey` que o formulário e o montador usam. Montar
  // a chave de outro jeito aqui recriaria a divergência que a Fase 3a eliminou.
  const porKey = new Map<string, string>();
  for (const s of contrato.slots) {
    const v = values[slotKey(s.address, s.key)];
    if (v !== undefined) porKey.set(s.key, v);
  }

  const lista = Array.isArray(components) ? (components as ComponenteTexto[]) : [];
  const partes: string[] = [];
  for (const c of lista) {
    const tipo = String(c.type ?? "").toUpperCase();
    if (tipo !== "HEADER" && tipo !== "BODY") continue;
    if (typeof c.text !== "string" || c.text.length === 0) continue;
    partes.push(
      c.text.replace(/\{\{(\w+)\}\}/g, (inteiro, chave: string) => porKey.get(chave) ?? inteiro),
    );
  }
  return partes.join("\n\n");
}
