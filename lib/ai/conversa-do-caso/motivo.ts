/**
 * ERRO DO SEAM DE MODELO → CÓDIGO + FRASE ACIONÁVEL, para o chat do caso.
 *
 * ## Por que não reusar `motivoDaFalha` de `sugestao-de-resposta.ts`
 *
 * Aquele irmão conhece dois marcadores (`reply_no_agent`,
 * `reply_context_unavailable`) e os textos dele falam de "sugestão". Reusá-lo
 * aqui mandaria quem perguntou sobre um caso conferir a publicação de um agente
 * de canal, que não tem nada com isto.
 *
 * ## Por que esta tradução é OBRIGATÓRIA e não cosmética
 *
 * Os três primeiros erros abaixo acontecem ANTES do `try` de `runModelCall` —
 * sem chave de IA, modelo não habilitado, provider desconhecido — e por isso
 * **não geram linha em `llm_calls`**. A tela de Execuções não os mostra. Se a
 * rota não traduzir, a instalação FRESCA sem chave de IA mostra "Não foi
 * possível responder agora" e ninguém descobre que falta configurar — que é
 * exatamente o cenário de primeira impressão que a doutrina de QA Visual manda
 * testar primeiro e com o maior rigor.
 *
 * ## Por que a frase primária diz o GESTO
 *
 * Quem lê é a pessoa que ia decidir o caso, não quem administra a instalação.
 * A frase genérica diz o que ELA pode fazer (tentar de novo, e a quem levar o
 * código), em vez de descrever um estado do servidor que ela não controla.
 */
import {
  LlmBudgetExceededError,
  LlmModelNotEnabledError,
  LlmNotConfiguredError,
  LlmProviderUnknownError,
} from "@/lib/agent-engine/edge/llm/run-model-call";

// As frases moram em `frases.ts` e não aqui porque a TELA precisa delas sem ter
// erro nenhum em mãos — ela lê `error_code` já gravado no banco — e este módulo
// arrasta `pg` pelo import acima. Ver o cabeçalho de `frases.ts`.
import { FALHA_ACIONAVEL, FRASE_DA_FALHA } from "./frases";

export interface MotivoDaConversa {
  /** Vai para `agent_case_chat_messages.error_code` e para o `fail()` da rota. */
  readonly codigo: string;
  /** pt-BR. A chave do dicionário É o texto — ver `lib/i18n/dicionario.ts`. */
  readonly texto: string;
  /** Há um gesto concreto de quem administra que resolve? */
  readonly acionavel: boolean;
}

export function motivoDaConversaDoCaso(erro: unknown): MotivoDaConversa {
  if (erro instanceof LlmNotConfiguredError) return motivo("llm_not_configured");
  if (erro instanceof LlmBudgetExceededError) return motivo("orcamento_esgotado");
  if (erro instanceof LlmModelNotEnabledError || erro instanceof LlmProviderUnknownError) {
    return motivo("modelo_indisponivel");
  }
  // Diz o GESTO, não o estado do servidor: a pessoa que lê ia decidir o caso.
  return motivo("case_chat_unavailable");
}

function motivo(codigo: keyof typeof FRASE_DA_FALHA): MotivoDaConversa {
  return { codigo, texto: FRASE_DA_FALHA[codigo], acionavel: FALHA_ACIONAVEL[codigo] };
}
