"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";

interface DecidirArgs {
  leadId: string;
  decision: "accept" | "dismiss";
  /** QUAL proposta estava na tela — a trava do servidor compara esta identidade. */
  proposalId: string;
}

/**
 * A decisão humana sobre a proposta de retomada.
 *
 * ⚠️ NÃO usa o eco local do board, ao contrário do `useDecidirProximaAcao`, e a
 * razão é a lista positiva da 0079: `reactivation_accepted` e
 * `reactivation_dismissed` estão FORA dela, então a atividade emitida NÃO
 * carimba `last_activity_at` — o lead não é tocado, o board não pulsa, e não há
 * eco a suprimir. Marcar eco aqui deixaria uma marca pendurada esperando um
 * evento que nunca vem.
 *
 * A distinção não é cosmética: decidir sobre a retomada é trabalho do TIME, e o
 * relógio que o card mostra mede o silêncio do CLIENTE. Se aceitar a proposta
 * "esquentasse" o negócio, o radar mentiria — o cliente continua sem responder
 * até a mensagem sair e ele reagir.
 */
export function useDecidirReativacao(pipelineId: string) {
  const qc = useQueryClient();
  const queryKey = ["board", pipelineId] as const;

  return useMutation({
    mutationFn: async ({ leadId, decision, proposalId }: DecidirArgs) => {
      return apiClient.post<{ data: { status: string; envio_agendado: boolean } }>(
        `/api/v1/leads/${leadId}/reactivation`,
        { decision, proposal_id: proposalId },
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey });
      // ⚠️ AS DUAS QUERIES, e a segunda foi esquecida na primeira versão: o
      // board vem de `["board", pipelineId]` e a lista de propostas vem de
      // `["reactivations"]`. Invalidar só a primeira refazia os LEADS e mantinha
      // a proposta decidida no cache — medido na tela: o servidor respondia
      // `accepted` e o card SEGUIA OFERECENDO o botão. Clicar de novo daria 409,
      // e o usuário concluiria que o sistema não obedeceu.
      //
      // É a mesma família de defeito da entrega inteira, agora no cache: um lado
      // mudou e o outro não acompanhou, sem ninguém reclamar.
      void qc.invalidateQueries({ queryKey: ["reactivations"] });
    },
    onError: (e) => {
      // O 409 desta rota é INFORMAÇÃO, não falha: a proposta venceu ou já foi
      // decidida entre o render e o clique. A mensagem do servidor explica qual
      // dos dois, e o refetch atualiza o card para o estado real.
      showApiError(e);
      void qc.invalidateQueries({ queryKey });
      void qc.invalidateQueries({ queryKey: ["reactivations"] });
    },
  });
}
