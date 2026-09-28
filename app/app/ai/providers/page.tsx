import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";

import { PainelDeProvedores } from "./_components/PainelDeProvedores";

export const dynamic = "force-dynamic";

/**
 * Onde o dono do negócio vê e escolhe qual IA atende cada parte do sistema.
 *
 * O sistema chama modelo em 23 lugares. Até esta tela existir, a escolha estava
 * espalhada por três pilhas de código e sete variáveis de ambiente, e não havia
 * lugar nenhum onde a pergunta "quem usa IA aqui, e com qual chave?" tivesse
 * resposta — o que transformava qualquer falha de configuração em falha muda.
 *
 * Os dados vêm do endpoint (`/api/v1/ai/providers`) e não de uma consulta aqui:
 * a mesma resolução de precedência precisa valer para a tela e para o runtime,
 * e duas leituras diferentes da mesma configuração é como se cria a tela que
 * mente.
 */
export default async function ProvedoresPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) redirect("/403");

  return <PainelDeProvedores />;
}
