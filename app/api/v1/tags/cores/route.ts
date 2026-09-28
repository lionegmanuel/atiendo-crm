/**
 * GET /api/v1/tags/cores — as cores das etiquetas da organização ativa
 * (issue #1271, fatia S6 da #852).
 *
 * ── Por que uma rota própria, e não a leitura do vocabulário ─────────────────
 *
 * `fn_vocabulario_de_tags` responde "posso mexer nesta etiqueta": conta uso em
 * contatos, leads, conversas e regras de agente, e a rota dela exige `manager`
 * (a escrita reescreve o vocabulário de todo mundo). O chip de uma conversa não
 * precisa de nada disso — precisa do nome e da cor — e precisa alcançar quem
 * ATENDE. Trazer os contadores para cá seria ler três tabelas inteiras para
 * desenhar um marcador.
 *
 * O que esta rota lê é UMA linha de `organizations` (o mesmo `settings` que a
 * `/api/v1/conversation-tags` já lê para as sementes), com o client da SESSÃO:
 * a RLS de `organizations` isola o tenant sozinha.
 *
 * ── Por que `viewer`, e não `manager` ───────────────────────────────────────
 *
 * Aqui não se escreve nada. Negar a leitura a um atendente deixaria a lista de
 * conversas cinza para quem mais olha para ela, e a cor não é segredo de
 * configuração: o NOME da etiqueta já aparece na mesma tela. O portão de escrita
 * segue onde sempre esteve — `requireRole("manager")` no POST da rota do
 * vocabulário e `fn_role_at_least(p_org, 'manager')` dentro da função.
 *
 * ── Sem MFA, deliberado ─────────────────────────────────────────────────────
 *
 * A dívida de segundo fator trava ATOS (a escrita do vocabulário exige). Ler
 * decoração de tela não é ato: exigir MFA aqui faria o chip sumir para quem está
 * com a verificação em dívida, e a lista pareceria quebrada por um motivo que
 * não tem relação nenhuma com ela.
 */
import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { etiquetasComCor } from "@/lib/tags/cor-da-etiqueta";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const auth = await requireRole("viewer", { requestId, resource: "settings_tags" });
  if (!auth.ok) return auth.response;

  const db = await createClient();
  const { data, error } = await db
    .from("organizations")
    .select("settings")
    .eq("id", auth.org.orgId)
    .maybeSingle();
  if (error) return fail("internal_error", "Não foi possível carregar as cores.", 500, { requestId });

  // A MESMA função que o mapa do chip usa (`etiquetasComCor`): uma
  // interpretação só de "etiqueta com cor", testável sem servidor.
  const tags = etiquetasComCor(data?.settings ?? null);
  return ok(tags, { requestId, meta: { total: tags.length } });
}
