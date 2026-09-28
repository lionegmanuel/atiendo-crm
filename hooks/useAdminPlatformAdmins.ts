"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";

export interface PlatformAdminEntry {
  id: string;
  user_id: string;
  user_email: string | null;
  user_name: string | null;
  granted_by: string | null;
  granted_by_email: string | null;
  granted_at: string;
  scope: string | null;
  mfa_required: boolean;
  reason: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  revoked_by_email: string | null;
  revoke_reason: string | null;
}

interface PlatformAdminsResponse {
  data: PlatformAdminEntry[];
}

export function useAdminPlatformAdmins() {
  return useQuery({
    queryKey: ["admin", "platform-admins"],
    queryFn: () =>
      apiClient
        .get<PlatformAdminsResponse>("/api/v1/admin/platform-admins")
        .then((r) => r.data),
    staleTime: 5 * 60 * 1000, // 5 min — changes are rare (DBA-only mutations)
  });
}
