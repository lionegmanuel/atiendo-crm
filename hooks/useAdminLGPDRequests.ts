"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdminLgpdRiskLevel = "expired" | "at_risk" | "warning" | "ok";
export type AdminLgpdStatus = "received" | "processing" | "completed" | "failed" | "pending_review";
// Alias do tipo canônico (lib/lgpd/types.ts): o admin e o app falam o MESMO
// vocabulário do banco. Duas listas era como uma podia divergir sozinha.
import type { LgpdRequestType } from "@/lib/lgpd/types";
export type AdminLgpdRequestType = LgpdRequestType;

export interface AdminLgpdRequest {
  id: string;
  organization_id: string;
  request_type: AdminLgpdRequestType;
  status: AdminLgpdStatus;
  received_at: string;
  due_at: string | null;
  completed_at: string | null;
  contact_id: string | null;
  external_customer_id: string | null;
  attempts: number;
  emergency: boolean;
  scope: string;
  error_message: string | null;
  tenant_name: string | null;
  tenant_slug: string | null;
  risk_level: AdminLgpdRiskLevel;
}

export interface AdminLgpdFilters {
  status?: AdminLgpdStatus;
  request_type?: AdminLgpdRequestType;
  risk_level?: AdminLgpdRiskLevel;
  tenant_id?: string;
}

interface ListResponse {
  data: AdminLgpdRequest[];
  meta?: { cursor?: string | null; has_more?: boolean };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAdminLGPDRequests(filters: AdminLgpdFilters = {}) {
  return useInfiniteQuery({
    queryKey: ["admin", "lgpd", filters] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams();
      if (filters.status) qs.set("status", filters.status);
      if (filters.request_type) qs.set("request_type", filters.request_type);
      if (filters.risk_level) qs.set("risk_level", filters.risk_level);
      if (filters.tenant_id) qs.set("tenant_id", filters.tenant_id);
      if (pageParam) qs.set("cursor", pageParam);
      qs.set("limit", "50");
      return apiClient.get<ListResponse>(`/api/v1/admin/lgpd/requests?${qs.toString()}`);
    },
    getNextPageParam: (last) =>
      last.meta?.has_more && last.meta.cursor ? last.meta.cursor : undefined,
    staleTime: 60_000,
  });
}
