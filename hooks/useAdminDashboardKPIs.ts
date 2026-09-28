"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import type { DashboardKPIs } from "@/app/api/v1/admin/dashboard/kpis/route";

interface KPIsResponse {
  data: DashboardKPIs;
}

export function useAdminDashboardKPIs() {
  return useQuery({
    queryKey: ["admin", "dashboard", "kpis"],
    queryFn: () =>
      apiClient.get<KPIsResponse>("/api/v1/admin/dashboard/kpis").then((r) => r.data),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
