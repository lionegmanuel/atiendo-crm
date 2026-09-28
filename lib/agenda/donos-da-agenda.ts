/**
 * QUEM tem agenda nesta organização — a lista de donos que a tela pergunta.
 *
 * ─── Por que existe ─────────────────────────────────────────────────────────
 *
 * A ocupação do Google é lida por DONO (`fn_agenda_ocupacao_google_do_dono`,
 * migration 0260) porque é isso que a função security definer sabe responder:
 * `p_owner` é quem manda. Quem chama precisa, então, saber QUEM perguntar — e
 * essa lista não estava em lugar nenhum do servidor: ela só existia no cliente,
 * dentro do hook da barra de pessoas.
 *
 * ─── Por que pelo client ADMIN, e não pela sessão ───────────────────────────
 *
 * A RLS de `user_organizations` só entrega o PRÓPRIO membership a `viewer` e
 * `agent`. Uma leitura pela sessão devolveria, para o Atendente, uma lista de
 * um só — ele mesmo — e a grade continuaria cega para a ocupação da dona, que é
 * exatamente o defeito da issue #896 (item 3). Mesma decisão e mesmo filtro de
 * `app/api/v1/agenda/pessoas/route.ts`: `organization_id` vem de fonte
 * confiável (cookie validado, resolvido por quem chama) e é filtro EXPLÍCITO,
 * nunca inferido pela RLS.
 *
 * Sem service role configurada a leitura degrada para a sessão — a tela mostra
 * a ocupação de quem ela enxerga em vez de não mostrar nada. Degradar é melhor
 * do que derrubar: a grade continua utilizável, e o `erro` devolvido é o que
 * permite a quem chama registrar por quê.
 */
import { isServiceRoleConfigured } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Os `user_id` com membership ativo na organização.
 *
 * Vazio é resposta legítima (organização sem ninguém ativo) e NÃO é erro: quem
 * chama decide o que fazer com uma lista vazia de donos. Erro de banco devolve
 * lista vazia COM a mensagem, para o log de quem chamou contar o que houve.
 */
export async function donosDaAgenda(
  organizationId: string,
): Promise<{ donos: string[]; erro: string | null }> {
  const client = isServiceRoleConfigured() ? createAdminClient() : await createClient();
  const { data, error } = await client
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", organizationId)
    // Revogado não tem agenda viva: perguntar pela ocupação dele gastaria uma
    // chamada por pessoa que não aparece em coluna nenhuma.
    .is("revoked_at", null);

  if (error) return { donos: [], erro: error.message };
  return { donos: (data ?? []).map((linha) => linha.user_id as string), erro: null };
}
