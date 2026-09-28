"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";

export interface AuditEntry {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  actor_api_token_id: string | null;
  acting_as_platform_admin: boolean;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  request_id: string | null;
  metadata: Record<string, unknown> | null;
  actor_ip: string | null;
  actor_user_agent: string | null;
}

export interface AuditFilters {
  actor_id?: string;
  action?: string;
  resource_type?: string;
  from?: string;
  to?: string;
}

interface ListResponse {
  data: AuditEntry[];
  meta?: { cursor?: string | null; has_more?: boolean };
}

export function useAuditQuery(filters: AuditFilters) {
  return useInfiniteQuery({
    queryKey: ["audit", filters],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams();
      if (filters.actor_id) qs.set("actor_id", filters.actor_id);
      if (filters.action) qs.set("action", filters.action);
      if (filters.resource_type) qs.set("resource_type", filters.resource_type);
      if (filters.from) qs.set("from", filters.from);
      if (filters.to) qs.set("to", filters.to);
      if (pageParam) qs.set("cursor", pageParam);
      qs.set("limit", "50");
      try {
        return await apiClient.get<ListResponse>(`/api/v1/audit?${qs.toString()}`);
      } catch (err) {
        showApiError(err);
        throw err;
      }
    },
    getNextPageParam: (lastPage) =>
      lastPage.meta?.has_more ? (lastPage.meta.cursor ?? undefined) : undefined,
  });
}
