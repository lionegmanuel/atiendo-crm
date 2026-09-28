"use client";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";

/**
 * O tipo vem da ROTA, não é redigitado aqui. Uma cópia local já custou caro nesta
 * entrega: o dono-agente entrou na rota e o radar continuou exibindo "Sem dono"
 * porque a cópia não sabia da coluna nova — e o compilador não reclamou, porque
 * as duas versões eram válidas separadamente. Contrato duplicado é contrato que
 * diverge em silêncio.
 */
export type { AtRiskLead } from "@/app/api/v1/leads/at-risk/route";
import type { AtRiskLead } from "@/app/api/v1/leads/at-risk/route";
import type { DemandaSemProximoPasso } from "@/lib/leads/radar-de-risco";

export interface AtRiskData {
  items: AtRiskLead[];
  counts: { critico: number; em_risco: number; em_voo: number };
  total: number;
  /** Invariante 4 (passo 4 do cap. 5): demandas abertas sem próximo passo. */
  sem_proximo_passo: DemandaSemProximoPasso[];
  total_sem_proximo_passo: number;
}

/** Radar de risco (C1). Polling 60s — a atividade dos leads muda no worker/inbox. */
export function useAtRiskLeads() {
  return useQuery({
    queryKey: ["leads-at-risk"],
    refetchInterval: 60_000,
    queryFn: () =>
      apiClient.get<{ data: AtRiskData }>(`/api/v1/leads/at-risk`).then((r) => r.data),
  });
}
