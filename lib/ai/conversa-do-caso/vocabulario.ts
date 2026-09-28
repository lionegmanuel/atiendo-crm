/**
 * O vocabulário da conversa do caso — o par TypeScript do CHECK da 0281.
 *
 * ## Por que fora de `lib/agent-engine`
 *
 * O emissor mora em `lib/agent-engine/agent/conversa-do-caso.ts` (tem de morar,
 * ver o cabeçalho de lá). Este módulo não: ele é importado pela ROTA e, mais
 * adiante, pelo hook da tela — e `lib/agent-engine` arrasta `pg`. Um tipo de
 * duas palavras não vale um driver de Postgres no bundle do browser.
 *
 * ## Por que UMA lista, e não um union ao lado de um array
 *
 * `tests/invariants/vocabulario-banco-x-typescript.test.ts` compara esta lista
 * com os literais do CHECK `agent_case_chat_messages_author_kind_check` num
 * Postgres de verdade. Duas listas no TypeScript seriam a terceira e a quarta
 * representação do mesmo vocabulário — exatamente o que aquele invariante existe
 * para proibir. O array é a fonte (é ele que o Zod e a UI consomem em runtime) e
 * o tipo é derivado dele.
 */

/** Quem escreveu a linha: a pessoa da equipe, ou a IA respondendo a ela. */
export const CASE_CHAT_AUTHOR_KINDS = ["human", "ai"] as const;

export type CaseChatAuthorKind = (typeof CASE_CHAT_AUTHOR_KINDS)[number];
