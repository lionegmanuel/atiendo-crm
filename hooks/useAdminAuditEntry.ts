"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdminAuditEntry {
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
  actor_ip: string | null;
  actor_user_agent: string | null;
}

export interface AdminAuditEntryTenant {
  id: string;
  display_name: string;
  slug: string;
  status: string;
}

export interface AdminAuditEntryActor {
  id: string;
  email: string | null;
}

export interface AdminAuditEntryDetail {
  entry: AdminAuditEntry;
  tenant: AdminAuditEntryTenant | null;
  actor: AdminAuditEntryActor | null;
}

interface EntryResponse {
  data: AdminAuditEntryDetail;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAdminAuditEntry(entryId: string) {
  return useQuery({
    queryKey: ["admin", "audit", entryId] as const,
    queryFn: () =>
      apiClient.get<EntryResponse>(`/api/v1/admin/audit/${entryId}`),
    staleTime: 60_000,
    enabled: !!entryId,
  });
}
