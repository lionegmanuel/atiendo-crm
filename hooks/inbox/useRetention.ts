"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import type { RetentionContext } from "@/lib/inbox/retention-copy";

export interface RetentionTrace {
  id: string;
  created_at: string;
  vetoed_gate: string | null;
  vetoed_code: string | null;
}

export interface RetentionData {
  retentions: RetentionTrace[];
  context: RetentionContext;
}

/**
 * Vetos recentes da cadeia before_send para a conversa aberta (F2-i). Polling
 * leve: um veto acontece no worker, fora do realtime de mensagens — 30s é
 * suficiente pra "operação visível" sem custo de canal dedicado.
 */
export function useRetention(conversationId: string | null) {
  return useQuery({
    queryKey: ["conversation-retention", conversationId],
    enabled: !!conversationId,
    refetchInterval: 30_000,
    queryFn: () =>
      apiClient
        .get<{ data: RetentionData }>(`/api/v1/conversations/${conversationId}/retention`)
        .then((r) => r.data),
  });
}
