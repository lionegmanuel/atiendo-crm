import type { OwnerKind } from "@/lib/types/leads";

/** O que o chamador quer mudar no dono. `undefined` = não mencionou. */
export interface OwnerPatchInput {
  owner_user_id?: string | null;
  owner_agent_id?: string | null;
}

/** O trio que vai para o banco — sempre coerente com a constraint. */
export interface OwnerPatch {
  owner_user_id: string | null;
  owner_agent_id: string | null;
  owner_kind: OwnerKind;
}

export type OwnerPatchResult =
  /** `patch: null` = o chamador não mencionou dono; não mexa nas colunas. */
  | { ok: true; patch: OwnerPatch | null }
  | { ok: false; reason: "two_owners" };

/**
 * Fonte ÚNICA da regra de posse de um negócio (migration 0070).
 *
 * Um lead tem um dono: humano OU agente, nunca os dois, e `owner_kind` sempre
 * concorda com a coluna preenchida. Quem escreve dono — create, patch, bulk,
 * MCP — passa por aqui.
 *
 * Por que um helper e não um guarda em cada chamador: o CHECK do banco aceita
 * `owner_kind = null` (para não quebrar escrita legada), então um escritor
 * distraído não estoura — ele grava um lead **com dono e sem kind**, some do
 * filtro e das métricas, e ninguém vê. Guarda espalhado protege os quatro
 * escritores de hoje; guarda aqui protege também o quinto, que ainda não foi
 * escrito.
 *
 * Puro de propósito: quem valida se o agente é da mesma org é o chamador que
 * tem o cliente do banco na mão.
 */
export function resolveOwnerPatch(input: OwnerPatchInput): OwnerPatchResult {
  const { owner_user_id: user, owner_agent_id: agent } = input;

  if (user === undefined && agent === undefined) {
    return { ok: true, patch: null };
  }

  if (user != null && agent != null) {
    return { ok: false, reason: "two_owners" };
  }

  if (user != null) {
    return {
      ok: true,
      patch: { owner_user_id: user, owner_agent_id: null, owner_kind: "user" },
    };
  }

  if (agent != null) {
    return {
      ok: true,
      patch: { owner_user_id: null, owner_agent_id: agent, owner_kind: "ai" },
    };
  }

  // Algum dos dois veio explicitamente null: tirar o dono limpa os três campos —
  // deixar `owner_kind` para trás é justamente o drift que este helper existe
  // para impedir.
  return { ok: true, patch: { owner_user_id: null, owner_agent_id: null, owner_kind: null } };
}
