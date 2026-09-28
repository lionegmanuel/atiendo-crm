import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";

import { ExecucoesDeIa } from "./_components/ExecucoesDeIa";

export const dynamic = "force-dynamic";

/**
 * O que a IA fez — e por que falhou quando falhou.
 *
 * A tela de Uso responde "quanto gastei". Esta responde outra pergunta, que não
 * tinha lugar nenhum: "o agente parou de responder, o que aconteceu?". Até a
 * migration 0128 ela seria impossível de construir com honestidade, porque
 * `llm_calls` só registrava sucesso — a tabela ficava vazia exatamente no caso
 * que precisava de explicação.
 */
export default async function ExecucoesPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) redirect("/403");

  return <ExecucoesDeIa />;
}
