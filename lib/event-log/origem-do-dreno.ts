/**
 * ESTE DRENO ESTÁ RODANDO DENTRO DE UMA REQUISIÇÃO HTTP?
 *
 * ## Por que a pergunta existe
 *
 * O `event_log` é drenado em TRÊS lugares: o cron, o laço do worker, e um
 * atalho de desenvolvimento (`acelerarPipelineDeEventos`, em
 * `lib/dev/kick-local-pipeline.ts`) que roda o dreno DENTRO do webhook de
 * mensagem, para o follow-up não esperar o relógio.
 *
 * Nos dois primeiros, um handler que fale com um terceiro pela rede custa
 * tempo de um processo que ninguém está esperando. No terceiro, ele soma ao
 * tempo de resposta do webhook do WhatsApp — que tem timeout e REENTREGA. Um
 * aviso de caso que leve 5 segundos ali pode transformar uma mensagem entregue
 * numa mensagem reentregue, e a reentrega dispara o agente de novo.
 *
 * ## Por que `AsyncLocalStorage`, e não uma flag de módulo
 *
 * Requisições concorrentes interleiam nos `await`. Uma flag de módulo marcada
 * no início e apagada no fim vazaria entre elas: o dreno do cron rodando ao
 * mesmo tempo que um webhook se veria "dentro de requisição" e adiaria para
 * sempre. `AsyncLocalStorage` amarra o valor ao CONTEXTO assíncrono, que é
 * exatamente o recorte que a pergunta quer.
 *
 * ## O default é `worker`, e isso é deliberado
 *
 * Fora de qualquer contexto marcado, a resposta é "não estou numa requisição".
 * Errar para esse lado significa, no pior caso, um aviso saindo de dentro de um
 * webhook que ninguém marcou — irritante. Errar para o outro lado significa
 * NENHUM aviso saindo nunca, porque todo dreno se acharia dentro de uma
 * requisição e adiaria em círculo.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type OrigemDoDreno = "worker" | "request";

const contexto = new AsyncLocalStorage<OrigemDoDreno>();

/** Marca `fn` como rodando dentro de uma requisição HTTP. */
export function comOrigemDeRequest<T>(fn: () => Promise<T>): Promise<T> {
  return contexto.run("request", fn);
}

/** De onde o dreno atual está rodando. Ver o cabeçalho sobre o default. */
export function origemDoDreno(): OrigemDoDreno {
  return contexto.getStore() ?? "worker";
}
