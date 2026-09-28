"use client";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { EvolutionPayload } from "@/lib/ai/evolution/aggregate";

export interface EvolutionRange {
  from: string;
  to: string;
}

/**
 * O intervalo entra na CHAVE de cache, não só na URL: sem isso, trocar as datas
 * devolveria o payload do intervalo anterior enquanto o novo carrega, e o
 * usuário leria números velhos com rótulo novo.
 */
export function useEvolution(range?: EvolutionRange) {
  const qs = range ? `?from=${range.from}&to=${range.to}` : "";
  return useQuery({
    queryKey: ["evolution", range?.from ?? null, range?.to ?? null],
    queryFn: () =>
      apiClient
        .get<{ data: EvolutionPayload }>(`/api/v1/ai/evolution${qs}`)
        .then((r) => r.data),
  });
}
