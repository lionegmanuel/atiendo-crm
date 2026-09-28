"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";

interface PauseArgs {
  conversation_id: string;
}

interface PauseResponse {
  data: { paused: boolean; assumiu_ao_pausar: boolean };
}

/**
 * Pausa o atendimento automático nesta conversa — o lado que faltava do par.
 *
 * `useResumeAiAttendance` existia sozinho: a tela sabia LIGAR o automático de
 * volta e não sabia desligá-lo. Ele só calava por efeito colateral (o agente
 * escalando, ou a janela de 5 minutos que um envio manual abre), então a pessoa
 * não tinha como dizer "daqui eu cuido" sem mandar uma mensagem primeiro.
 *
 * Invalida as CONTAGENS junto: pausar move a conversa entre abas (sem dono →
 * minhas), e um badge que conta o que a aba não mostra manda o atendente procurar
 * trabalho que não existe.
 */
export function usePauseAiAttendance() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: PauseArgs) =>
      apiClient.post<PauseResponse>(
        `/api/v1/conversations/${args.conversation_id}/pause-ai`,
        {},
      ),
    onError: (err) => showApiError(err),
    onSuccess: (_data, args) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation", args.conversation_id] });
      qc.invalidateQueries({ queryKey: ["conversation-counts"] });
    },
  });
}
