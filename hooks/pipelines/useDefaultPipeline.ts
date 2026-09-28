"use client";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { Pipeline, Stage } from "@/lib/kanban/types";

export interface DefaultPipelineData {
  pipeline: Pipeline;
  stages: Stage[];
}

/** Pipeline padrão da org ativa + estágios — usado por fluxos "crie um lead
 * daqui" que não têm um pipeline no contexto (ex.: painel do Inbox). */
export function useDefaultPipeline(enabled: boolean) {
  return useQuery({
    queryKey: ["default-pipeline"],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<DefaultPipelineData> => {
      const res = await apiClient.get<{ data: DefaultPipelineData }>(
        "/api/v1/pipelines/default",
      );
      return res.data;
    },
  });
}
