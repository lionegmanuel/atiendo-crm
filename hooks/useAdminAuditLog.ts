"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdminAuditRow {
  id: string;
  organization_id: string | null;
  action: string;
  actor_user_id: string | null;
  resource_type: string | null;
  resource_id: string | null;
  metadata: Record<string, unknown>;
  request_id: string | null;
  created_at: string;
  acting_as_platform_admin: boolean;
  bypassed_rls: boolean;
  organizations: {
    display_name: string;
    slug: string;
  } | null;
}

export interface AdminAuditFilters {
  tenant_ids?: string[]; // array of uuids
  actor_user_id?: string;
  actions?: string[];
  from?: string; // ISO datetime
  to?: string; // ISO datetime
}

interface ListResponse {
  data: AdminAuditRow[];
  meta?: { cursor?: string | null; has_more?: boolean };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAdminAuditLog(filters: AdminAuditFilters = {}) {
  return useInfiniteQuery({
    queryKey: ["admin", "audit", filters] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams();
      if (filters.tenant_ids && filters.tenant_ids.length > 0) {
        qs.set("tenant_ids", filters.tenant_ids.join(","));
      }
      if (filters.actor_user_id) qs.set("actor_user_id", filters.actor_user_id);
      if (filters.actions && filters.actions.length > 0) {
        qs.set("actions", filters.actions.join(","));
      }
      if (filters.from) qs.set("from", filters.from);
      if (filters.to) qs.set("to", filters.to);
      if (pageParam) qs.set("cursor", pageParam);
      qs.set("limit", "50");
      return apiClient.get<ListResponse>(`/api/v1/admin/audit?${qs.toString()}`);
    },
    getNextPageParam: (last) =>
      last.meta?.has_more && last.meta.cursor ? last.meta.cursor : undefined,
    staleTime: 30_000,
  });
}
