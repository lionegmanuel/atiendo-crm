/**
 * QUEM RESPONDE a pergunta da equipe sobre um caso — e por quê.
 *
 * A promessa da feature é "pergunte à IA que ABRIU este caso". Ela nem sempre
 * pode ser cumprida, e quando não pode a tela tem de dizer o motivo em vez de
 * responder com outra voz em silêncio.
 *
 * ## A ordem, e por que o passo 2 não é redundante
 *
 * 1. `agent_cases.agent_id` nulo → `sem_agente`. É caminho REAL, não canto: o
 *    fail-safe do guardrail grava `agentConfig?.agentId ?? null`, e a FK é
 *    `on delete set null`.
 * 2. Ler `archived_at`, `paused_at` e `published_version_id` e passar por
 *    `estadoDoAgente()` — NÃO reimplementar.
 * 3. Só em `no_ar`, chamar `loadPublishedAgentConfigById`.
 *
 * ⚠️ O passo 2 parece redundante e não é: `loadPublishedAgentConfigById` filtra
 * `archived_at is null and v.status = 'published'` e **NÃO filtra `paused_at`**
 * (lido no HEAD desta sessão). O comentário de `agent-config.ts` e o cabeçalho
 * da rota de pausa dizem "pausar = despublicar", e isso é FALSO: a rota grava
 * só `paused_at`. Sem o passo 2, um agente que o dono acabou de pausar
 * continuaria falando com a equipe — com a tela dizendo que ele está parado.
 *
 * ## `parado` é UM valor do `estadoDoAgente` para DOIS motivos
 *
 * Medido: `estadoDoAgente` devolve `parado` tanto para `paused_at != null`
 * quanto para "sem versão publicada". Para a tela são coisas diferentes (uma se
 * resolve despausando, a outra publicando), então o desempate acontece AQUI,
 * sobre os campos que a consulta já trouxe — sem reimplementar a função.
 */
import type pg from "pg";

import { estadoDoAgente } from "@/lib/ai/agents/no-ar";

import { loadPublishedAgentConfigById, type PublishedAgentConfig } from "../agent-config";

/** Por que a persona do agente do caso não pôde ser usada. */
export type MotivoDaPersonaPadrao = "sem_agente" | "arquivado" | "pausado" | "despublicado";

export type PersonaDaConversa =
  | { fonte: "agente_do_caso"; agente: PublishedAgentConfig; nome: string }
  | { fonte: "padrao_da_organizacao"; motivo: MotivoDaPersonaPadrao };

/** Só o que esta resolução precisa do banco — é o que o teste injeta. */
export interface FatosDoAgenteDoCaso {
  archived_at: string | null;
  paused_at: string | null;
  published_version_id: string | null;
}

export interface LeitorDaPersona {
  /** `null` quando a linha do agente não existe mais na organização. */
  fatosDoAgente(agentId: string): Promise<FatosDoAgenteDoCaso | null>;
  carregarPublicado(agentId: string): Promise<PublishedAgentConfig | null>;
}

export async function resolverPersona(
  leitor: LeitorDaPersona,
  agentId: string | null,
): Promise<PersonaDaConversa> {
  if (agentId === null) return { fonte: "padrao_da_organizacao", motivo: "sem_agente" };

  const fatos = await leitor.fatosDoAgente(agentId);
  // Linha ausente é o mesmo desfecho de `agent_id` nulo para quem lê a tela: não
  // há agente daquele caso. Tratar como `despublicado` mandaria publicar um
  // agente que não existe.
  if (fatos === null) return { fonte: "padrao_da_organizacao", motivo: "sem_agente" };

  const estado = estadoDoAgente({
    archived_at: fatos.archived_at,
    paused_at: fatos.paused_at,
    published_version_id: fatos.published_version_id,
  });
  if (estado === "arquivado") return { fonte: "padrao_da_organizacao", motivo: "arquivado" };
  if (estado !== "no_ar") {
    // O desempate que `estadoDoAgente` não faz (ver o cabeçalho).
    return {
      fonte: "padrao_da_organizacao",
      motivo: fatos.paused_at !== null ? "pausado" : "despublicado",
    };
  }

  const agente = await leitor.carregarPublicado(agentId);
  // Corrida entre as duas leituras (alguém despublicou no meio), ou um clone
  // cuja versão publicada sumiu. Falhar ABERTO na informação: a persona padrão
  // responde e a tela diz por quê.
  if (agente === null) return { fonte: "padrao_da_organizacao", motivo: "despublicado" };

  return { fonte: "agente_do_caso", agente, nome: agente.agentName };
}

/** O leitor de produção — `pg.Pool`, org explícita, ids nunca do body. */
export function leitorNoPool(db: pg.Pool, organizationId: string): LeitorDaPersona {
  return {
    async fatosDoAgente(agentId) {
      const { rows } = await db.query<FatosDoAgenteDoCaso>(
        // As TRÊS colunas, sempre. `paused_at` é obrigatório no tipo de
        // `FatosDoAgente` justamente porque uma consulta que a esquecesse
        // devolvia `undefined` e um agente PAUSADO voltava a contar como no ar.
        `select archived_at, paused_at, published_version_id
           from ai_agents where organization_id = $1 and id = $2`,
        [organizationId, agentId],
      );
      return rows[0] ?? null;
    },
    carregarPublicado(agentId) {
      return loadPublishedAgentConfigById(db, organizationId, agentId);
    },
  };
}
