/**
 * A troca de comando de uma conversa vira linha na linha do tempo.
 *
 * ## Por que aqui e não numa tabela nova
 *
 * A auditoria de atribuição (`conversation_assignment_events`) já existe, é
 * append-only e é escrita na MESMA transação da troca de dono. O que faltava não
 * era registro — era **visibilidade**: ela tem cinco escritores e nenhum leitor de
 * tela. A tentação é criar uma seção "Quem atendeu" no painel lendo aquela tabela;
 * medido, seria uma SEGUNDA linha do tempo ao lado da que já existe, porque a ida
 * e a volta IA↔humano (`handoff_triggered` / `handoff_resolved`) já são emitidas
 * como atividade e já aparecem naquele mesmo painel. Duas listas contando a mesma
 * história é como o vocabulário da timeline já divergiu uma vez (ver o cabeçalho
 * de `activity-vocabulary.ts`).
 *
 * Então: a troca de comando entra na linha do tempo que JÁ existe, pelo
 * vocabulário que JÁ é único, e a tabela de auditoria segue sendo o que ela é —
 * auditoria e insumo do rodízio.
 *
 * ## O que este arquivo NÃO conserta
 *
 * `crm_lead_activities.lead_id` é `NOT NULL`: conversa sem negócio aberto não tem
 * onde pendurar a linha, e a atividade simplesmente não nasce. É a MESMA
 * limitação que a ida e a volta IA↔humano já têm hoje — não uma que este arquivo
 * introduz. Consertá-la é mudar a chave daquela tabela, o que é outro problema e
 * outra migration.
 *
 * Fire-and-forget, como todo o resto da timeline: a linha do tempo não pode
 * derrubar a operação que ela descreve.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/lib/api/handlers/types";
import { isServiceRoleConfigured } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveActiveLeadForContact, type LeadCandidate } from "@/lib/leads/active-lead";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import type { ActivityType } from "@/lib/leads/activity-vocabulary";
import { logger } from "@/lib/logger";

/** Só os tipos que descrevem troca de comando — o resto do vocabulário não entra. */
export type AtividadeDeComando =
  | "conversation_claimed"
  | "conversation_transferred"
  | "conversation_released"
  | "conversation_ai_paused";

interface Entrada {
  /**
   * Client do REQUEST — usado para ESCREVER a atividade, herdando a RLS de quem
   * clicou.
   */
  supabase: SupabaseClient;
  organizationId: string;
  conversationId: string;
  contactId: string | null;
  tipo: AtividadeDeComando;
  actor: Actor;
  /**
   * O PORQUÊ legível. Quando a pessoa escreveu um motivo ao transferir, é ELE que
   * vem aqui — hoje esse texto morre no `metadata` do audit log, que só `admin`
   * lê, e some justamente de quem vai continuar o atendimento.
   *
   * Vai para `crm_lead_activities.reason`, que é coberto pela cascata de
   * anonimização da LGPD (`fn_lgpd_cascade_redact_contact` faz `update` nessa
   * tabela) — é por isso que texto escrito por humano sobre um cliente pode morar
   * aqui e não podia morar na tabela de auditoria, que é append-only e está fora
   * da cascata.
   */
  motivo: string;
  payload?: Record<string, unknown>;
}

export async function registrarTrocaDeComando(entrada: Entrada): Promise<void> {
  const { supabase, organizationId, conversationId, contactId, tipo, actor, motivo } = entrada;
  if (!contactId) return;

  try {
    /**
     * A BUSCA DOS CANDIDATOS USA O ADMIN CLIENT, e isso não é atalho.
     *
     * `crm_leads` tem SELECT visibility-aware (`fn_can_view_lead`, migration
     * 0036). Com o client do request, a lista de negócios do contato chega
     * RECORTADA por quem clicou — e `resolveActiveLeadForContact` existe
     * justamente para RECUSAR o palpite quando há empate. Lista truncada desarma
     * essa defesa duas vezes:
     *
     *   (a) o atendente que não é dono do negócio vê 0 candidatos, a função sai
     *       por `no_open_lead` e nenhuma linha nasce — a reclamação nº 4 continua
     *       de pé, com um `info` no log como único rastro;
     *   (b) com DOIS negócios abertos, um de cada atendente, quem clica vê só o
     *       seu, não há empate, e a linha é pendurada no negócio ERRADO. A mesma
     *       ação daria destinos diferentes conforme quem a executa.
     *
     * Medido em pg17 com o baseline desta branch, org no default do produto
     * (`visibility_mode='own_and_unassigned'`), negócio do agent B: agent A lê 0,
     * agent B lê 1, manager lê 1.
     *
     * É o mesmo padrão de `lib/followup/retorno-crm.ts`, que já passa lista de
     * admin. Doutrina do service role satisfeita: `organizationId` vem de fonte
     * confiável (o cookie validado pela rota), e todo filtro é explícito.
     */
    const leitor = isServiceRoleConfigured() ? createAdminClient() : supabase;
    const [{ data: leadsData }, { data: defaultPipeline }] = await Promise.all([
      leitor
        .from("crm_leads")
        .select("id, organization_id, pipeline_id, status, last_activity_at, created_at")
        .eq("organization_id", organizationId)
        .eq("contact_id", contactId),
      leitor
        .from("crm_pipelines")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("is_default", true)
        .eq("is_archived", false)
        .limit(1)
        .maybeSingle(),
    ]);

    const alvo = resolveActiveLeadForContact((leadsData ?? []) as LeadCandidate[], {
      defaultPipelineId: (defaultPipeline as { id: string } | null)?.id ?? null,
    });
    if (!alvo.routed) {
      // Não é erro: é a conversa que ainda não virou negócio. Fica no log para a
      // ausência na timeline ter explicação quando alguém a procurar.
      logger.info("[inbox.comando] troca de comando sem negócio para pendurar", {
        conversation_id: conversationId,
        tipo,
        motivo_sem_rota: alvo.reason,
      });
      return;
    }

    const resultado = await emitLeadActivity(supabase, {
      organizationId,
      leadId: alvo.leadId,
      contactId,
      type: tipo satisfies AtividadeDeComando as ActivityType,
      sourceModule: "inbox.comando",
      sourceId: conversationId,
      actor,
      reason: motivo,
      payload: { conversation_id: conversationId, ...(entrada.payload ?? {}) },
    });
    if (!resultado.ok) {
      logger.warn("[inbox.comando] atividade da troca de comando não foi gravada", {
        conversation_id: conversationId,
        tipo,
      });
    }
  } catch (err) {
    logger.warn("[inbox.comando] atividade da troca de comando falhou", {
      conversation_id: conversationId,
      tipo,
      erro: err instanceof Error ? err.message : String(err),
    });
  }
}
