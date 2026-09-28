/**
 * Quem mexeu na CONFIGURAÇÃO da operação, gravado ao lado do estado que mudou.
 *
 * ⚠️ POR QUE ISTO PRECISOU EXISTIR. Até o agente de IA ganhar mãos sobre a
 * operação, toda mudança em etapa de funil, entrada automática de contatos e
 * regra automática vinha de uma pessoa com papel `manager+` — quem olhava a tela
 * era, necessariamente, quem tinha mudado. A partir do momento em que o agente
 * liga uma regra que roda sozinha, o estado na tela deixa de responder a
 * pergunta que importa: **fui eu ou foi ele?**
 *
 * O `api_audit_log` registra tudo, mas nenhuma tela de configuração o lê — e log
 * que não aparece é log morto (doutrina do sistema vivo, invariante 3). Por isso
 * a autoria mora na PRÓPRIA LINHA: o estado e a autoria do estado são lidos
 * juntos, na mesma consulta, pela tela que já existe.
 *
 * ⚠️ NÃO GUARDAMOS QUAL AGENTE, E ISSO É DELIBERADO — mas o motivo MUDOU, e a
 * versão anterior desta nota já não descreve o código. Ela dizia que os três
 * caminhos discordavam sobre o que `Actor.id` significa para `ai_agent`. Dois
 * foram alinhados: o runtime nativo passou a mandar o id do AGENTE (`bddeeb6`,
 * BUG-01) e o harness sempre mandou. **O terceiro não.**
 * `lib/mcp/auth.ts` `deriveActor()` ainda devolve o id do RUN (do scope
 * `agent_run:<uuid>`) ou, sem ele, o id do TOKEN — e é justamente o caminho de
 * um cliente MCP externo. Uma coluna `..._agent_id uuid references ai_agents(id)`
 * alimentada de `Actor.id` seria verdadeira em dois caminhos e recusaria a
 * escrita com `23503` no terceiro. Guardar a ESPÉCIE do ator é a afirmação que
 * se sustenta nos três; o `api_audit_log` continua guardando o identificador cru
 * para quem investiga.
 */
import type { Actor } from "@/lib/api/handlers/types";

/** As espécies de autor que uma mudança de configuração pode ter. */
export type EspecieDeAutor = "user" | "ai" | "system";

/** As colunas que toda tabela de configuração ganha (migration 0101). */
export interface AutoriaDaMudanca {
  last_change_actor_kind: EspecieDeAutor;
  last_change_at: string;
}

/**
 * A autoria pronta para entrar no `insert`/`update`.
 *
 * `webhook_source` e qualquer ator futuro que não seja pessoa nem agente caem em
 * `system`: o produto agiu, não alguém. O mesmo vocabulário de
 * `lib/leads/activity-emitter.ts` — duas escalas de ator no mesmo sistema seriam
 * duas legendas para o usuário decorar.
 */
export function autoriaDaMudanca(actor: Actor, agora: Date = new Date()): AutoriaDaMudanca {
  return {
    last_change_actor_kind: especieDe(actor),
    last_change_at: agora.toISOString(),
  };
}

export function especieDe(actor: Actor): EspecieDeAutor {
  if (actor.type === "user") return "user";
  if (actor.type === "ai_agent") return "ai";
  return "system";
}

/**
 * Como a autoria é dita na tela — e QUANDO ela não é dita.
 *
 * ⚠️ MUDANÇA FEITA POR PESSOA NÃO GERA SELO, e isso foi MEDIDO, não estimado.
 * A primeira versão mostrava "alterado por você/time" em cinza discreto, e num
 * funil recém-instalado (uma etapa do agente, oito de fábrica sem autoria) ela
 * parecia ótima. Simulei um mês de uso normal — o dono renomeando e reordenando
 * etapas ao longo de semanas — e abri a tela:
 *
 *   selos na tela → assistente: 1 · você/time: 7   (13% do sinal era o que importa)
 *   altura ocupada por selo: 128px de 1091px da lista (12%)
 *
 * Sete linhas dizendo ao dono que foi ele quem mexeu, informação que ele já tem,
 * afogando a única linha que ele PRECISA ver. O selo existe para responder "fui
 * eu ou foi ele?" — e responder "foi você" em toda linha destrói a própria
 * resposta. Silêncio para pessoa é o que faz a notícia continuar sendo notícia.
 *
 * ⚠️ A AMBIGUIDADE QUE ISSO CRIA É INÓCUA, e é o que sustenta a decisão: sem
 * selo passa a significar "foi uma pessoa" OU "é anterior à migration 0101". Nos
 * dois casos a resposta à pergunta que importa é a mesma — **não foi o
 * assistente**. Quem precisa do detalhe tem o `api_audit_log`, que guarda os
 * dois casos com nome e hora.
 */
export function autorNaTela(kind: string | null): string | null {
  if (kind === "ai") return "alterado pelo assistente";
  if (kind === "system") return "alterado automaticamente pelo sistema";
  // `user` e `null` não falam: ver o aviso acima.
  return null;
}

/** `true` quando a última mudança NÃO foi de uma pessoa — o que a tela destaca. */
export function mudadoPorAgente(kind: string | null): boolean {
  return kind === "ai";
}
