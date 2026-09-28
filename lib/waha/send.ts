/**
 * Thin WAHA send helper exposed for the agent runtime (S-13.08).
 *
 * The runtime uses `sendMessageHandler` for the production path (handles WAHA
 * dispatch + outbound message row + ack + retries), so this module is a small
 * convenience for direct callers (tests, smoke checks). Returns null when
 * WAHA env is not configured — callers must treat that as a noop, not error.
 */
import { getWahaClient } from "./client";

export interface SendWahaInput {
  sessionName: string;
  chatId: string;
  text: string;
}

export interface ResolveWahaChatIdInput {
  isGroup: boolean;
  groupChatId: string | null;
  phoneNumber: string | null | undefined;
  /** `contacts.wa_identity` (migration 0027): 'phone:+E164' | 'lid:<digits>' | null. */
  waIdentity: string | null | undefined;
  /**
   * `contacts.wa_lid` (migration 0122): só os dígitos do Linked ID, ou null.
   *
   * Existe separada de `waIdentity` por uma razão que custou uma correção
   * errada: `wa_identity` é GERADA com o telefone na frente, então o contato
   * @lid que ganha número passa a valer `phone:+55…` e o teste
   * `waIdentity.startsWith("lid:")` fica FALSO — exatamente para quem a regra
   * precisava valer. Ler o lid daqui é o que faz a ordem abaixo significar algo.
   */
  waLid?: string | null | undefined;
}

/**
 * O endereço WAHA de uma conversa 1:1 ou de grupo.
 *
 * ⚠️ **O `lid:` vem ANTES do telefone, e a ordem é a regra.**
 *
 * Até a migration 0122, contato @lid nunca tinha `phone_number` — o número era
 * descartado na ingestão —, então "telefone primeiro" nunca era exercido para
 * quem chegava por Linked ID. A 0122 passou a gravar o telefone que o WhatsApp
 * sempre mandou (`_data.key.remoteJidAlt`), e com a ordem antiga toda conversa
 * @lid viva mudaria de endereço de `@lid` para `@c.us` no envio seguinte.
 *
 * Trocar o canal de uma conversa que funciona é o pior defeito possível aqui: se
 * o `@c.us` não for endereçável — e para contato em modo privacidade ele
 * frequentemente não é —, paramos de responder o cliente, com a mensagem
 * marcada como enviada. O telefone entra para o CRM (identificar, buscar,
 * ligar, deduplicar); o ENVIO continua indo por onde a conversa veio.
 *
 * Contato sem `lid` (import, formulário, pedido) segue por `@c.us` como sempre.
 */
export function resolveWahaChatId(input: ResolveWahaChatIdInput): string | null {
  if (input.isGroup && input.groupChatId) return input.groupChatId;
  // `wa_lid` primeiro; `wa_identity` só como retaguarda para chamador que ainda
  // não lê a coluna nova (e que, por definição, é de contato sem telefone).
  if (input.waLid) return `${input.waLid}@lid`;
  if (input.waIdentity?.startsWith("lid:")) return `${input.waIdentity.slice(4)}@lid`;
  if (input.phoneNumber) return `${input.phoneNumber.replace(/\D/g, "")}@c.us`;
  return null;
}

export async function sendWAHA(input: SendWahaInput): Promise<unknown | null> {
  const client = getWahaClient();
  if (!client) return null;
  return client.sendMessage(input.sessionName, input.chatId, input.text);
}
