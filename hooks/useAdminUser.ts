"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdminUserFactor {
  id: string;
  type: string;
  status: string;
}

export interface AdminUserDetail {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  last_sign_in_at: string | null;
  created_at: string;
  email_confirmed_at: string | null;
  factors: AdminUserFactor[];
}

export interface AdminUserMembership {
  organization_id: string;
  tenant_name: string | null;
  tenant_slug: string | null;
  role: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

export interface AdminUserAuditEntry {
  id: string;
  action: string;
  organization_id: string | null;
  resource_type: string | null;
  resource_id: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

export interface AdminUserDetailResponse {
  data: {
    user: AdminUserDetail;
    memberships: AdminUserMembership[];
    recent_audit: AdminUserAuditEntry[];
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAdminUser(id: string) {
  return useQuery({
    queryKey: ["admin", "user", id] as const,
    queryFn: () =>
      apiClient.get<AdminUserDetailResponse>(`/api/v1/admin/users/${id}`),
    staleTime: 60_000,
    enabled: !!id,
  });
}
