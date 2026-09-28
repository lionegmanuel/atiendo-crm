"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";

export function useDeleteContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (contactId: string) =>
      apiClient.delete<unknown>(`/api/v1/contacts/${contactId}`),
    onError: showApiError,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
}
