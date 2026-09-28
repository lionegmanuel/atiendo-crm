/**
 * Resolução de NOME de usuário (assignee/owner) para os payloads de leitura MCP
 * (G6-03). Dedupe por id — numa listagem de N linhas só resolve K usuários
 * únicos, sem N+1.
 *
 * LGPD (doutrina do repo): expõe SÓ `full_name` do user. NUNCA email, phone,
 * user_metadata completo, tokens ou qualquer outra PII do usuário. Mesmo mínimo
 * que /api/v1/team/assignable já expõe.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export async function resolveUserNames(
  supabase: SupabaseClient,
  userIds: Array<string | null | undefined>,
): Promise<Map<string, string | null>> {
  const unique = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  const entries = await Promise.all(
    unique.map(async (id): Promise<readonly [string, string | null]> => {
      try {
        const { data } = await supabase.auth.admin.getUserById(id);
        const fullName = (data?.user?.user_metadata?.full_name as string | undefined) ?? null;
        return [id, fullName] as const;
      } catch {
        // Nome é não-crítico: falha de lookup não pode quebrar a leitura.
        return [id, null] as const;
      }
    }),
  );
  return new Map(entries);
}
