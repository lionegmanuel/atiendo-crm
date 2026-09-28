"use client";
import { Badge } from "@/components/ui/badge";
import type { SourceRow } from "@/hooks/ai/useKnowledgeSources";
import { useT } from "@/hooks/i18n/useT";

type Variant = "default" | "neutral" | "success" | "warning" | "error" | "info";

export type DerivedBadgeStatus =
  | "ready"
  | "failed"
  | "sem_credencial"
  | "indexando"
  | "partial"
  | "archived"
  | "not_indexed";

/**
 * O estado do material como a pessoa o entende.
 *
 * Faltavam DOIS estados que o produto já produzia e a tela mostrava como
 * "Não indexado", neutro:
 *
 *  - **indexando** — o worker está trabalhando agora. Enquanto isso não existia,
 *    subir um documento e recarregar a tela mostrava o mesmo cinza de antes de
 *    subir. Progresso invisível se lê como nada tendo acontecido.
 *  - **sem_credencial** — a organização não tem chave de embedding. Este é o
 *    pior dos dois, porque nunca vai mudar sozinho: sem o estado, "ainda não
 *    tentei" e "não consigo tentar" eram a mesma frase, e a segunda pede uma
 *    ação que a primeira não pede.
 */
export function deriveBadgeStatus(
  source: Pick<SourceRow, "status" | "last_index_status" | "chunks_count">,
): DerivedBadgeStatus {
  if (source.status === "archived") return "archived";
  if (source.last_index_status === "sem_credencial") return "sem_credencial";
  if (source.last_index_status === "indexando") return "indexando";
  if (source.last_index_status === "failed") return "failed";
  if (source.last_index_status === "partial") return "partial";
  if (source.status === "failed") return "failed";
  if (source.status === "ready" && (source.chunks_count ?? 0) > 0) return "ready";
  return "not_indexed";
}

const MAP: Record<DerivedBadgeStatus, { label: string; variant: Variant }> = {
  ready: { label: "O agente já sabe", variant: "success" },
  failed: { label: "Não entrou", variant: "error" },
  sem_credencial: { label: "Esperando a chave", variant: "warning" },
  indexando: { label: "Preparando…", variant: "info" },
  partial: { label: "Entrou pela metade", variant: "warning" },
  archived: { label: "Arquivado", variant: "neutral" },
  not_indexed: { label: "Ainda não preparado", variant: "neutral" },
};

interface Props {
  source: Pick<SourceRow, "status" | "last_index_status" | "chunks_count">;
}

export function SourceStatusBadge({ source }: Props) {
  const t = useT();
  const derived = deriveBadgeStatus(source);
  const { label, variant } = MAP[derived];
  return <Badge variant={variant}>{t(label)}</Badge>;
}
