/**
 * A trava por hash — a peça que impede o erro voltar DEPOIS de tudo pronto.
 *
 * O cenário que ela existe para cobrir: alguém configura um follow-up apontando
 * para `pedido_confirmado`, hoje. Semanas depois, outra pessoa edita o template no
 * Gerenciador da Meta e o corpo ganha um `{{3}}`. A config salva continua mandando
 * dois parâmetros, e o envio passa a falhar com **132000** — em produção, no
 * disparo, quando o lead já esperava a mensagem.
 *
 * Sem esta trava, o sistema só descobre no erro. É exatamente o estado do TomikCRM.
 *
 * O bind guarda o **hash do contrato** vigente quando foi salvo. No disparo, hash
 * divergente não é "tentar mesmo assim": é config obsoleta, que vira trabalho
 * visível com o diff do que mudou (invariantes 4 e 6 do sistema vivo).
 *
 * Puro e síncrono de propósito — quem lê banco é o chamador.
 */

/** Estados possíveis de um bind, do mais grave ao menos. A ORDEM importa (ver abaixo). */
export type BindingState = "missing" | "not_approved" | "stale" | "ok";

export interface TemplateBinding {
  name: string;
  language: string;
  /** Hash do contrato no momento em que o operador configurou os valores. */
  contractHash: string;
  /** Valores por slot, chaveados por `slotKey` (ver build-components.ts). */
  values: Record<string, string>;
}

/** A linha do espelho local correspondente — `null` = não existe mais. */
export interface CurrentTemplate {
  name: string;
  language: string;
  contractHash: string;
  status: string;
}

/**
 * Só `APPROVED` pode ser disparado. `PENDING` também não pode — mandar um template
 * ainda em análise é erro garantido, e tratá-lo como "quase ok" adia a descoberta.
 */
const SENDABLE = "APPROVED";

/**
 * Veredito do bind contra o estado atual do espelho.
 *
 * **Precedência: `missing` > `not_approved` > `stale` > `ok`.** Um template
 * rejeitado E com hash diferente reporta `not_approved`, não `stale`: mandar o
 * operador reconfigurar parâmetros de um template que a Meta recusou é fazê-lo
 * trabalhar à toa. O problema que ele precisa resolver primeiro é a recusa.
 */
export function bindingState(
  binding: TemplateBinding,
  current: CurrentTemplate | null,
): BindingState {
  // A chave é o PAR (name, language) — `pt_BR` e `pt` são templates distintos na
  // Meta, com corpos e aprovações independentes. Casar só por nome faria a config
  // de um idioma resolver para o contrato do outro.
  if (
    !current ||
    current.name !== binding.name ||
    current.language !== binding.language
  ) {
    return "missing";
  }
  if (current.status !== SENDABLE) return "not_approved";
  if (current.contractHash !== binding.contractHash) return "stale";
  return "ok";
}

/** `true` quando o bind pode ser disparado sem intervenção humana. */
export function isSendable(state: BindingState): boolean {
  return state === "ok";
}

/**
 * A mesma regra, para quem NÃO tem um bind — o agente escolhe `name`+`language` no
 * turno, sem contrato pré-configurado, então `bindingState` não se aplica.
 *
 * Existe como função exportada, e não como constante, porque o call-site não deve
 * reimplementar a comparação: no dia em que "disparável" deixar de ser exatamente
 * um status, quem chama não muda.
 */
export function isStatusSendable(status: string): boolean {
  return status === SENDABLE;
}

/**
 * Frase que o humano lê no inbox/tela. Não é decoração: um item que diz apenas
 * "config inválida" transfere ao operador o trabalho de descobrir o quê — e é
 * assim que item de inbox vira ruído que todo mundo ignora.
 */
export function explainBindingState(
  state: BindingState,
  binding: TemplateBinding,
): string {
  const alvo = `${binding.name} (${binding.language})`;
  switch (state) {
    case "missing":
      return `O template ${alvo} não existe mais na Meta. Escolha outro ou recrie-o antes do próximo disparo.`;
    case "not_approved":
      return `O template ${alvo} não está aprovado na Meta. Enquanto isso, nada será enviado por ele.`;
    case "stale":
      return `O template ${alvo} mudou na Meta desde que foi configurado — os parâmetros precisam ser revistos antes do próximo disparo.`;
    case "ok":
      return `O template ${alvo} está aprovado e com os parâmetros em dia.`;
  }
}
