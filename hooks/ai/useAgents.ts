"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { AgentRow } from "./useAgent";

interface ListResponse {
  data: AgentRow[];
}

export const agentsListQueryKey = ["ai", "agents", "list"] as const;

export function useAgentsList(opts?: { initialData?: AgentRow[] }) {
  return useQuery({
    queryKey: agentsListQueryKey,
    queryFn: async () => {
      try {
        const res = await apiClient.get<ListResponse>("/api/v1/ai/agents");
        return res.data;
      } catch (err) {
        showApiError(err);
        throw err;
      }
    },
    initialData: opts?.initialData,
  });
}
