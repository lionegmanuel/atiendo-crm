/**
 * useImportContacts — POST multipart do CSV para /api/v1/contacts/import.
 *
 * Usa fetch cru (não o apiClient) porque o client serializa body como JSON e
 * não fala FormData — mesmo padrão de hooks/ai/useSkills.ts. Erro é sempre
 * ApiError para o diálogo mostrar `message` direto no toast.
 */
import { ApiError } from "@/lib/api/types";
import type { ApiErrorBody } from "@/lib/api/types";
import { randomId } from "@/lib/random-id";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export interface ImportContactsResult {
  total_linhas: number;
  imported: number;
  skipped_duplicates: number;
  errors: Array<{ linha: number; motivo: string }>;
}

async function importarCsv(file: File): Promise<ImportContactsResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/v1/contacts/import", {
    method: "POST",
    headers: { "Idempotency-Key": randomId() },
    body: form,
    credentials: "same-origin",
  });
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const errBody = parsed as ApiErrorBody | null;
    const e = errBody?.error;
    throw new ApiError(
      res.status,
      e?.code ?? "unknown_error",
      e?.details,
      e?.request_id ?? randomId(),
      e?.message,
    );
  }
  return (parsed as { data: ImportContactsResult }).data;
}

export function useImportContacts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: importarCsv,
    onSuccess: () => {
      // A lista pode ter crescido em qualquer página/filtro — invalida tudo.
      qc.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
}
