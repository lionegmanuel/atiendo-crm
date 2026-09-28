"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import type { AdminLgpdRequest } from "./useAdminLGPDRequests";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdminLgpdAuditEntry {
  id: string;
  action: string;
  actor_user_id: string | null;
  resource_type: string | null;
  resource_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AdminLgpdTenant {
  id: string;
  display_name: string;
  slug: string;
  status: string | null;
}

export interface AdminLgpdRequestDetail {
  request: AdminLgpdRequest & {
    source: string | null;
    result: Record<string, unknown> | null;
    request_payload: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  };
  tenant: AdminLgpdTenant | null;
  audit_trail: AdminLgpdAuditEntry[];
}

interface DetailResponse {
  data: AdminLgpdRequestDetail;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAdminLgpdRequest(id: string) {
  return useQuery({
    queryKey: ["admin", "lgpd", id] as const,
    queryFn: () =>
      apiClient.get<DetailResponse>(`/api/v1/admin/lgpd/requests/${id}`),
    staleTime: 30_000,
    enabled: !!id,
  });
}
