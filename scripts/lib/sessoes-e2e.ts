export const NOMES_DE_SESSAO_E2E = [
  "e2e-queue-session",
  "e2e-radar-session",
  "e2e-numero-conectado",
] as const;

export type NomeDeSessaoE2E = (typeof NOMES_DE_SESSAO_E2E)[number];

export function ehNomeDeSessaoE2E(nome: string | null | undefined): nome is NomeDeSessaoE2E {
  return typeof nome === "string" && (NOMES_DE_SESSAO_E2E as readonly string[]).includes(nome);
}
