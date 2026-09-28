import type { PipelineVocabulary } from "./types";

const DEFAULTS: Required<PipelineVocabulary> = {
  lead: "Lead",
  deal: "Negócio",
  won: "Ganho",
  lost: "Perdido",
};

export function resolveVocabulary(
  v: PipelineVocabulary | null | undefined,
): Required<PipelineVocabulary> {
  return { ...DEFAULTS, ...(v ?? {}) };
}
