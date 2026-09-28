"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";

export type LgpdRequestStatus =
  | "received"
  | "processing"
  | "completed"
  | "failed"
  | "pending_review";

// Fonte única do vocabulário: lib/lgpd/types.ts (espelha o CHECK do banco).
export type { LgpdRequestType } from "@/lib/lgpd/types";
import type { LgpdRequestType } from "@/lib/lgpd/types";

export type SlaBucket = "overdue" | "critical" | "warning" | "ok";

export interface LgpdRequest {
  id: string;
  organization_id: string;
  request_type: LgpdRequestType;
  source: string | null;
  contact_id: string | null;
  external_customer_id: string | null;
  status: LgpdRequestStatus;
  attempts: number;
  received_at: string;
  due_at: string | null;
  completed_at: string | null;
  emergency: boolean;
  scope: "contact" | "tenant";
  error_message: string | null;
  sla_bucket: SlaBucket;
}

export interface LgpdRequestsFilters {
  status?: LgpdRequestStatus;
  type?: LgpdRequestType;
  sla_bucket?: SlaBucket;
  page?: number;
  limit?: number;
}

interface LgpdRequestsResponse {
  data: LgpdRequest[];
  meta: {
    total: number;
    page: number;
    limit: number;
    has_more: boolean;
  };
}

export function useLgpdRequests(filters: LgpdRequestsFilters = {}) {
  return useQuery({
    queryKey: ["lgpd-requests", filters],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (filters.status) qs.set("status", filters.status);
      if (filters.type) qs.set("type", filters.type);
      if (filters.sla_bucket) qs.set("sla_bucket", filters.sla_bucket);
      if (filters.page) qs.set("page", String(filters.page));
      if (filters.limit) qs.set("limit", String(filters.limit));

      try {
        return await apiClient.get<LgpdRequestsResponse>(
          `/api/v1/lgpd/requests?${qs.toString()}`,
        );
      } catch (err) {
        showApiError(err);
        throw err;
      }
    },
    staleTime: 30_000,
  });
}
