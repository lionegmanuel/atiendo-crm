"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import type { BudgetStatus } from "@/lib/ai/budget/check";

export type { BudgetStatus };

export interface BudgetPatch {
  monthly_limit_cents?: number;
  alarm_threshold_pct?: number;
  /**
   * A INTENÇÃO, declarada — não inferida da forma do payload. É o campo que
   * decide se o teto vincula alguém; sem ele, "escolhi um teto" e "nunca abri a
   * tela" seriam o mesmo dado.
   */
  enforcement_mode?: "off" | "avisar" | "bloquear";
  /** Renuncia às 72h de carência ao armar a parada. */
  confirmar_imediato?: boolean;
}

interface SingleResponse {
  data: BudgetStatus;
}

export const aiBudgetQueryKey = ["ai", "budget"] as const;

export function useAiBudget(opts?: { initialData?: BudgetStatus }) {
  return useQuery({
    queryKey: aiBudgetQueryKey,
    queryFn: async () => {
      try {
        const res = await apiClient.get<SingleResponse>("/api/v1/ai/budget");
        return res.data;
      } catch (err) {
        showApiError(err);
        throw err;
      }
    },
    initialData: opts?.initialData,
    staleTime: 30_000,
  });
}

export function useUpdateBudget() {
  const qc = useQueryClient();
  const t = useT();
  return useMutation({
    mutationKey: ["ai", "budget", "update"],
    mutationFn: async (patch: BudgetPatch) => {
      const res = await apiClient.patch<SingleResponse>("/api/v1/ai/budget", patch);
      return res.data;
    },
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: aiBudgetQueryKey });
      const previous = qc.getQueryData<BudgetStatus>(aiBudgetQueryKey);
      if (previous) {
        const optimistic: BudgetStatus = {
          ...previous,
          ...(patch.monthly_limit_cents !== undefined
            ? { monthly_limit_cents: patch.monthly_limit_cents }
            : {}),
          ...(patch.alarm_threshold_pct !== undefined
            ? { alarm_threshold_pct: patch.alarm_threshold_pct }
            : {}),
          // `confirmar_imediato` NÃO entra: ele não é estado, é a renúncia à
          // carência naquele clique. O `enforcement_effective_at` que ele decide
          // vem do servidor — otimizá-lo aqui seria a tela inventar uma data.
          ...(patch.enforcement_mode !== undefined
            ? { enforcement_mode: patch.enforcement_mode }
            : {}),
        };
        qc.setQueryData(aiBudgetQueryKey, optimistic);
      }
      return { previous };
    },
    onError: (err, _patch, context) => {
      if (context?.previous) {
        qc.setQueryData(aiBudgetQueryKey, context.previous);
      }
      showApiError(err);
    },
    onSuccess: (data) => {
      qc.setQueryData(aiBudgetQueryKey, data);
      toast.success(t("Orçamento atualizado"));
    },
  });
}
