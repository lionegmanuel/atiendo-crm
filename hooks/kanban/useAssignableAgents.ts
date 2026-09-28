"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import type { AssignableAgent } from "@/app/api/v1/ai/agents/assignable/route";

export type { AssignableAgent };

/** 0070: agentes que podem ser donos de um negócio (par de useAssignableMembers). */
export function useAssignableAgents(enabled: boolean) {
  return useQuery({
    queryKey: ["ai", "agents", "assignable"],
    queryFn: async () =>
      apiClient.get<{ data: AssignableAgent[] }>("/api/v1/ai/agents/assignable"),
    enabled,
    staleTime: 60_000,
    select: (res) => res.data,
  });
}
