"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import type { Message } from "@/lib/types/messaging";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdminConversationDetail {
  id: string;
  organization_id: string;
  contact_id: string | null;
  channel: string;
  status: string;
  assigned_to_user_id: string | null;
  last_inbound_at: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count_for_assignee: number;
  created_at: string;
  updated_at: string;
}

export interface AdminOrganizationInfo {
  id: string;
  display_name: string;
  slug: string;
  status: string;
}

export interface AdminContactInfo {
  id: string;
  name: string | null;
  phone_number: string | null;
  email: string | null;
  is_anonymized: boolean;
  is_blocked: boolean;
}

export interface AdminConversationDetailResponse {
  conversation: AdminConversationDetail;
  organization: AdminOrganizationInfo | null;
  contact: AdminContactInfo | null;
  messages: Message[];
}

interface ApiResponse {
  data: AdminConversationDetailResponse;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAdminConversation(conversationId: string | null) {
  return useQuery({
    queryKey: ["admin", "inbox", conversationId] as const,
    enabled: !!conversationId,
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse>(
        `/api/v1/admin/inbox/conversations/${conversationId}`,
      );
      return res.data;
    },
    staleTime: 10_000,
  });
}
