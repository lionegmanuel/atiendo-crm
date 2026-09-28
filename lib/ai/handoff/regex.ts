/**
 * Regex + heuristics used by the handoff orchestrator (EPIC-06 wave 3).
 *
 * G1 — pedido humano explícito (PT-BR).
 * G4 — menção a termos jurídicos / regulatórios.
 * UNCERTAINTY — frases que sinalizam que o bot não tem confiança na resposta.
 *
 * Estes são heurísticos puros (regex / string matching). Mudanças aqui
 * impactam diretamente a taxa de handoff — toque com testes.
 */

export const G1_REGEX =
  /\b(quero|preciso|posso)\s+(falar|conversar|atendimento|atendente|humano|pessoa|gente|alguem|alguém|operador|gerente)\b|\b(humano|atendente|operador)\s+por\s+favor\b|\bsai\s+do\s+bot\b|\bnão\s+(quero|gosto)\s+(de\s+)?(robô|bot|automatic\w*)\b/i;

export const G4_LEGAL_REGEX =
  /\b(procon|advogad\w*|processar|processo\s+judicial|justiça|juiz\w*|reclame\s*aqui|denuncia\w*|denúncia\w*|acionar\s+a\s+justiça|órgão\s+regulador|defensoria|ministério\s+público)\b/i;

export const UNCERTAINTY_MARKERS: readonly string[] = [
  "não tenho certeza",
  "não sei",
  "não posso confirmar",
  "não tenho essa informação",
  "preciso verificar",
  "talvez",
  "acho que",
];

export function containsUncertaintyMarkers(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  for (const m of UNCERTAINTY_MARKERS) {
    if (lower.includes(m)) return true;
  }
  return false;
}
