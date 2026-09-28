"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdminConversationRow {
  id: string;
  organization_id: string;
  contact_id: string | null;
  channel: string;
  status: string;
  last_inbound_at: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count_for_assignee: number;
  created_at: string;
  organizations: { display_name: string; slug: string } | null;
  contacts: { name: string | null; phone_number: string | null } | null;
}

export interface AdminInboxFilters {
  q?: string;
  status?: "pending" | "open" | "resolved";
  tenant_id?: string;
}

interface ListResponse {
  data: AdminConversationRow[];
  meta?: { cursor?: string | null; has_more?: boolean };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAdminInbox(filters: AdminInboxFilters = {}) {
  return useInfiniteQuery({
    queryKey: ["admin", "inbox", filters] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams();
      if (filters.q) qs.set("q", filters.q);
      if (filters.status) qs.set("status", filters.status);
      if (filters.tenant_id) qs.set("tenant_id", filters.tenant_id);
      if (pageParam) qs.set("cursor", pageParam);
      qs.set("limit", "30");
      return apiClient.get<ListResponse>(
        `/api/v1/admin/inbox/conversations?${qs.toString()}`,
      );
    },
    getNextPageParam: (last) =>
      last.meta?.has_more && last.meta.cursor ? last.meta.cursor : undefined,
    staleTime: 10_000,
  });
}
