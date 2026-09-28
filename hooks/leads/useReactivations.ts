"use client";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { ReactivationLive } from "@/app/api/v1/leads/reactivations/route";

/**
 * As propostas de retomada vivas da org, para o board.
 *
 * ⚠️ SEM realtime por enquanto, e isto é decisão declarada e não esquecimento:
 * a entrega em tempo real está sob disputa entre dois aparatos, e construir a
 * tela em cima dela produziria trabalho que não pode ser provado. Com o
 * refetch, a proposta aparece na próxima leitura do board — que é o
 * comportamento de antes desta wave, não uma regressão nova.
 *
 * Quando o realtime tiver veredito, isto ganha a assinatura junto com a peça 3.
 */
export function useReactivations() {
  return useQuery({
    queryKey: ["reactivations"] as const,
    queryFn: async () => {
      const res = await apiClient.get<{ data: { items: ReactivationLive[] } }>(
        "/api/v1/leads/reactivations",
      );
      return (res as { data?: { items?: ReactivationLive[] } }).data?.items ?? [];
    },
    // O prazo corre: uma proposta que venceu há 10 minutos não pode continuar
    // oferecendo botão. 60s é folga suficiente para a menor janela útil.
    refetchInterval: 60_000,
  });
}
