import type { FlowEdge } from "./graph-schema";

/**
 * O par chave/rótulo de uma condição de aresta — o que o painel da aresta grava
 * e o que o fio mostra quando a origem não está no grafo.
 *
 * ⚠️ AQUI HAVIA UM MENU DE OPÇÕES POR TIPO DE NÓ (`edgeConditionOptions`), e ele
 * saiu. O painel passou a montar as opções a partir de `nodeBranches()` na
 * W2-RAMOS — a lista por tipo continuava oferecendo "Sim"/"Não" a um nó no modo
 * uma-saída-por-regra —, e o menu ficou sem consumidor. Ficar não era neutro:
 * ele ainda chamava a saída de escape de "Sempre" em nó ramificado, o defeito
 * que `graph-schema.ts` acabou de corrigir. Quem religar isto religa o defeito.
 */
/** Stable key for a condition value — inverse of the `key` on the option it produced. */
export function conditionKey(condition: FlowEdge["condition"]): string {
  switch (condition.type) {
    case "always":
      return "always";
    case "class_match":
      return `class_match:${condition.value}`;
    case "cond_result":
      return `cond_result:${condition.value}`;
    case "branch":
      return `branch:${condition.branch_id}`;
  }
}

/** Human label for a condition value, used both by the options above and the edge's on-wire label. */
export function conditionLabel(condition: FlowEdge["condition"]): string {
  switch (condition.type) {
    case "always":
      return "Sempre";
    case "class_match":
      return condition.value === "no_reply" ? "Sem resposta" : condition.value;
    case "cond_result":
      return condition.value ? "Sim" : "Não";
    case "branch":
      // Only the source node knows a branch's label. This file has no node in
      // scope, and nothing emits `branch` conditions until the builder switches
      // to `nodeBranches()` (W2-RAMOS) — where both functions here get replaced
      // by the node-aware branch list. Until then: the id, never a wrong name.
      return condition.branch_id;
  }
}
