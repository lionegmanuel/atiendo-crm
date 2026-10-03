import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";

import type { ZernioInboundMessage } from "./webhook";

/**
 * O provider entrega o tipo que não sabe representar (enquete, figurinha
 * animada, mensagem de visualização única…) com o texto literal
 * `[Unsupported message]`. Gravado como veio, ele aparecia em inglês no Inbox,
 * no Kanban e no que o agente lê.
 *
 * O corpo da mensagem não passa por `t()` na tela — é texto do cliente —, então
 * a troca acontece na entrada, no idioma da instalação. Fica uma frase que diz
 * o que fazer: abrir no aparelho, onde o conteúdo existe.
 */
export const TEXTO_NAO_SUPORTADO_DO_PROVIDER = "[Unsupported message]";

export function normalizarMensagemNaoSuportada(
  msg: ZernioInboundMessage,
  idioma: Idioma,
): ZernioInboundMessage {
  if (msg.text?.trim() !== TEXTO_NAO_SUPORTADO_DO_PROVIDER) return msg;
  return { ...msg, text: traduzir("Mensagem não suportada (abra no WhatsApp)", idioma) };
}
