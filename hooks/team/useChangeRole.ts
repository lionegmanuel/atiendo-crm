"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import type { TeamMember } from "@/hooks/team/useTeamMembers";
import type { Role } from "@/lib/schemas/team";

const MEMBERS_KEY = ["team", "members"] as const;

/** Optimistic role change (G2-02): cache updated on mutate, rolled back on error. */
export function useChangeRole() {
  const qc = useQueryClient();
  const t = useT();
  return useMutation({
    mutationFn: async (args: { userId: string; role: Role }) =>
      apiClient.patch<{ data: { user_id: string; role: Role } }>(
        `/api/v1/team/${args.userId}`,
        { role: args.role },
      ),
    onMutate: async ({ userId, role }) => {
      await qc.cancelQueries({ queryKey: MEMBERS_KEY });
      const previous = qc.getQueryData<{ data: TeamMember[] }>(MEMBERS_KEY);
      qc.setQueryData<{ data: TeamMember[] }>(MEMBERS_KEY, (old) =>
        old
          ? {
              ...old,
              data: old.data.map((m) => (m.user_id === userId ? { ...m, role } : m)),
            }
          : old,
      );
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) qc.setQueryData(MEMBERS_KEY, context.previous);
      showApiError(err);
    },
    onSuccess: () => {
      toast.success(t("Papel atualizado."));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["team"] });
    },
  });
}
