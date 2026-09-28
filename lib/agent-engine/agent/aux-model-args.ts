/**
 * De ONDE o classificador auxiliar tira modelo, provider e credencial.
 *
 * ## O defeito que fez esta função existir (PR #151, @Gervanno)
 *
 * Os classificadores auxiliares (estágio, jailbreak, promessa) não têm modelo
 * próprio quando o knob de env está vazio, e então pegam emprestado o do agente
 * publicado. Emprestavam **só a string do modelo** — o provider e a credencial
 * continuavam sendo o default da organização.
 *
 * Num tenant cujo default é Anthropic com um `mcp_agent` publicado em OpenAI, o
 * classificador mandava `gpt-5-mini` para o endpoint da Anthropic, tomava 404
 * `not_found_error`, e o **turno inteiro** morria (`status='dead'`) antes de o
 * agente responder. Sintoma para quem instalou: o agente simplesmente não
 * responde no WhatsApp, sem erro na tela. E o dry-run passava, porque ele não
 * chama classificador — o caminho que funciona não é o caminho que quebra.
 *
 * ## A regra, em uma frase
 *
 * **Modelo e provider/credencial vêm sempre do MESMO lugar.**
 *
 * - knob de env preenchido ⇒ é escolha consciente do operador, e ela já
 *   pressupõe o provider default da org. Sem override.
 * - knob vazio ⇒ herda do agente publicado, e aí provider e credencial vêm
 *   JUNTO com o modelo, nunca soltos.
 *
 * ## Por que módulo separado
 *
 * A lógica nasceu como função interna de `runAgentTurn`, que precisa de banco,
 * job e registry para rodar — ou seja, a regra ficava sem como ser exercitada
 * por unit. Mesmo motivo de `lib/routing/decide.ts` existir fora do worker: a
 * decisão é pura, o resto é I/O.
 */
import type { LlmResolveOverride } from "../edge/llm/credentials";

/** O que o turno sabe do agente publicado — só o que esta decisão consulta. */
export interface AgenteParaAux {
  model?: string | undefined;
  provider: string;
  credentialId: string | null;
}

export interface AuxModelArgs {
  model?: string;
  llmOverride?: LlmResolveOverride;
}

export function auxModelArgs(
  configuredModel: string | undefined,
  agente: AgenteParaAux | null,
): AuxModelArgs {
  if (configuredModel !== undefined) return { model: configuredModel };
  const agentModel = agente?.model;
  if (agentModel === undefined) return {};
  return {
    model: agentModel,
    ...(agente !== null
      ? { llmOverride: { provider: agente.provider, credentialId: agente.credentialId } }
      : {}),
  };
}
