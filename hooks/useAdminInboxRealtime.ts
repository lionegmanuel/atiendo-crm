"use client";
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRealtimeChannel } from "@/hooks/realtime/useRealtimeChannel";

/**
 * Subscribes to postgres_changes on `messages` (INSERT) without org_id filter —
 * platform admin sees all tenants in real-time.
 *
 * NOTE: postgres_changes requires Supabase Realtime to be enabled and the
 * `messages` table added to the `supabase_realtime` publication.
 * If Realtime is not enabled for this table, events will be silently dropped;
 * the list will still refresh on focus (staleTime = 10s).
 */
export function useAdminInboxRealtime() {
  const qc = useQueryClient();

  const onChange = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["admin", "inbox"] });
  }, [qc]);

  return useRealtimeChannel({
    name: "admin-inbox-realtime",
    postgresChanges: {
      event: "INSERT",
      schema: "public",
      table: "messages",
      // No filter — cross-tenant intentional for platform admin
    },
    onChange,
    enabled: true,
  });
}
