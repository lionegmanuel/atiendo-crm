/**
 * AS FRASES DE FALHA DA CONVERSA DO CASO — UM DONO SÓ, PARA DOIS LEITORES.
 *
 * ## Por que elas saíram de `motivo.ts`
 *
 * `motivo.ts` traduz o ERRO (um `unknown` vindo do `catch`) em código + frase, e
 * para isso importa as classes de erro de `lib/agent-engine/edge/llm/…`. Esse
 * caminho arrasta `pg` — é exatamente o motivo pelo qual `vocabulario.ts` foi
 * posto fora de `lib/agent-engine` (ver o cabeçalho de lá).
 *
 * Só que a TELA precisa das mesmas frases sem ter erro nenhum em mãos: ela lê
 * `agent_case_chat_messages.error_code`, uma string já gravada no banco, e tem
 * de renderizar a frase daquele código. Mostrar `llm_not_configured` a quem ia
 * decidir o caso não é informação — é um enum.
 *
 * Copiar as quatro sentenças para dentro do componente resolveria hoje e
 * envelheceria sozinho: seriam duas fontes para o mesmo texto, com só uma delas
 * coberta pelo dicionário de espanhol. Este módulo é a fonte; `motivo.ts` lê
 * daqui, e o painel também.
 *
 * ## Por que `fraseDaFalha` aceita `string | null`
 *
 * O código vem do BANCO. Um clone com engine mais novo — ou uma linha gravada
 * antes de alguém renomear um código — pode trazer valor que este build não
 * conhece. Cair na frase genérica é o desfecho certo: ela diz o GESTO (tentar
 * de novo, e a quem levar o código), que continua verdadeiro para qualquer
 * falha. Estourar, ou mostrar vazio, trocaria uma falha nomeada por uma tela
 * quebrada.
 */

/** Os códigos que a rota grava em `agent_case_chat_messages.error_code`. */
export const CASE_CHAT_ERROR_CODES = [
  "llm_not_configured",
  "orcamento_esgotado",
  "modelo_indisponivel",
  "case_chat_unavailable",
] as const;

export type CaseChatErrorCode = (typeof CASE_CHAT_ERROR_CODES)[number];

/**
 * pt-BR — a chave do dicionário É o texto (`lib/i18n/dicionario.ts`).
 *
 * As três primeiras dizem ONDE configurar porque têm gesto concreto de quem
 * administra. A quarta fala com quem ia decidir o caso, e por isso descreve o
 * que ELA pode fazer, não um estado do servidor que ela não controla.
 */
export const FRASE_DA_FALHA: Record<CaseChatErrorCode, string> = {
  llm_not_configured:
    "Nenhum provedor de IA está configurado. Peça a quem administra para configurar em IA › Provedores.",
  orcamento_esgotado:
    "A IA parou porque o gasto do mês atingiu o limite definido. Ajuste em Uso de IA › Orçamento.",
  modelo_indisponivel:
    "O modelo escolhido para este uso não está disponível. Reveja a escolha em IA › Provedores.",
  case_chat_unavailable:
    "Não deu para responder agora. Tente de novo; se continuar, mande este código para quem instalou o sistema.",
};

/** Há um gesto concreto de quem administra que resolve? */
export const FALHA_ACIONAVEL: Record<CaseChatErrorCode, boolean> = {
  llm_not_configured: true,
  orcamento_esgotado: true,
  modelo_indisponivel: true,
  case_chat_unavailable: false,
};

/** A frase de um código vindo do banco — desconhecido cai na genérica. */
export function fraseDaFalha(codigo: string | null | undefined): string {
  return (
    (FRASE_DA_FALHA as Record<string, string>)[codigo ?? ""] ??
    FRASE_DA_FALHA.case_chat_unavailable
  );
}
