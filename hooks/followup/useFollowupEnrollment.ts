"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";
import { useT } from "@/hooks/i18n/useT";
import type { EventoDeEnrollment, NoDoDossie } from "@/lib/followup/eventos-legiveis";
import type { TimingPlan } from "@/lib/followup/plano-de-tempo";

export interface SaidaDoPasso {
  edge_id: string;
  target_id: string;
  target_rotulo: string;
  quando: string;
}

export interface FollowupEnrollmentDossie {
  id: string;
  status: string;
  current_node_id: string;
  next_eval_at: string | null;
  claimed_until: string | null;
  motor_ocupado: boolean;
  started_at: string;
  completed_at: string | null;
  updated_at: string;
  outcome: string | null;
  cancel_reason: string | null;
  last_error: string | null;
  attempts: number;
  max_attempts: number;
  steps_taken: number;
  contact: { id: string; name: string };
  flow: {
    pointer_id: string;
    name: string | null;
    version_id: string;
  };
  agent_name: string | null;
  no_atual: NoDoDossie | null;
  nos: NoDoDossie[];
  saidas: SaidaDoPasso[];
  eventos: EventoDeEnrollment[];
  eventos_truncados: boolean;
  plano_de_tempo: TimingPlan | null;
  autores: Record<string, string>;
}

export const dossieQueryKey = (id: string) => ["followup", "enrollment", id] as const;

export function useFollowupEnrollment(id: string) {
  return useQuery({
    queryKey: dossieQueryKey(id),
    queryFn: async () => {
      const res = await apiClient.get<{ data: FollowupEnrollmentDossie }>(
        `/api/v1/ai/followups/enrollments/${id}`,
      );
      return res.data;
    },
    // O dossiê é uma leitura de estado vivo: o motor pode avançar o passo entre
    // dois olhares. 10s é o compromisso entre não martelar a API e não mostrar
    // uma foto velha de algo que a pessoa está prestes a alterar.
    staleTime: 10_000,
  });
}

type Intervencao = "pause" | "resume" | "snooze" | "skip";

interface Variaveis {
  id: string;
  acao: Intervencao;
  body?: Record<string, unknown>;
}

const AVISO: Record<Intervencao, string> = {
  pause: "Follow-up pausado.",
  resume: "Follow-up retomado.",
  snooze: "Follow-up adiado.",
  skip: "Passo pulado.",
};

/**
 * As quatro intervenções, uma mutação.
 *
 * Elas diferem só na URL e no corpo; o que precisa ser igual — invalidar o
 * dossiê E a fila, avisar quem clicou, mostrar o erro do servidor em vez de um
 * genérico — é o que erra quando se escreve quatro vezes. O `showApiError` é o
 * que faz o 409 do motor ocupado chegar como frase ("tente de novo em alguns
 * instantes") em vez de sumir.
 */
export function useIntervirNoFollowup() {
  const t = useT();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["followup", "enrollment", "intervencao"],
    mutationFn: async ({ id, acao, body }: Variaveis) => {
      const res = await apiClient.post<{ data: { id: string; status: string; next_eval_at: string | null } }>(
        `/api/v1/ai/followups/enrollments/${id}/${acao}`,
        body ?? {},
      );
      return res.data;
    },
    onSuccess: (_data, variaveis) => {
      void qc.invalidateQueries({ queryKey: dossieQueryKey(variaveis.id) });
      void qc.invalidateQueries({ queryKey: ["followup", "queue"] });
      toast.success(t(AVISO[variaveis.acao]));
    },
    onError: (err) => {
      showApiError(err);
    },
  });
}
