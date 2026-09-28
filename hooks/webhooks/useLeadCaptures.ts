"use client";
import { useInfiniteQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { DESFECHOS_DA_CAPTACAO } from "@/lib/schemas/lead-captures";

export type DesfechoDaCaptacao = (typeof DESFECHOS_DA_CAPTACAO)[number];

export interface LeadCaptureRow {
  id: string;
  received_at: string;
  source_name: string;
  webhook_source_id: string | null;
  lead_id: string | null;
  contact_id: string | null;
  outcome: DesfechoDaCaptacao;
  reject_reason: string | null;
  captured_name: string | null;
  captured_phone: string | null;
  captured_email: string | null;
  fields: Record<string, unknown>;
  utm: Record<string, string>;
  /** `null` quando não havia proxy à frente — ver lib/http/ip-do-cliente.ts. */
  remote_ip: string | null;
  user_agent: string | null;
  origin: string | null;
}

export interface LeadCaptureFilters {
  source_id?: string;
  outcome?: DesfechoDaCaptacao;
  q?: string;
  from?: string;
  to?: string;
}

interface ListResponse {
  data: LeadCaptureRow[];
  meta?: { cursor?: string | null; has_more?: boolean };
}

const POR_PAGINA = "30";

export function useLeadCaptures(filters: LeadCaptureFilters) {
  return useInfiniteQuery({
    queryKey: ["lead-captures", filters],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams();
      if (filters.source_id) qs.set("source_id", filters.source_id);
      if (filters.outcome) qs.set("outcome", filters.outcome);
      if (filters.q) qs.set("q", filters.q);
      if (filters.from) qs.set("from", filters.from);
      if (filters.to) qs.set("to", filters.to);
      if (pageParam) qs.set("cursor", pageParam);
      qs.set("limit", POR_PAGINA);
      try {
        return await apiClient.get<ListResponse>(`/api/v1/lead-captures?${qs.toString()}`);
      } catch (err) {
        showApiError(err);
        throw err;
      }
    },
    getNextPageParam: (lastPage) =>
      lastPage.meta?.has_more ? (lastPage.meta.cursor ?? undefined) : undefined,
  });
}
