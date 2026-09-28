"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { Lead } from "@/lib/types/leads";
import type { CreateLeadInput } from "@/lib/schemas/leads";

export function useCreateLead(pipelineId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateLeadInput) =>
      apiClient.post<{ data: Lead }>("/api/v1/leads", input),
    onError: showApiError,
    onSettled: () => qc.invalidateQueries({ queryKey: ["board", pipelineId] }),
  });
}
