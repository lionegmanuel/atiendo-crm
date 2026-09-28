import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * QUEM SAIU DA EMPRESA PARA DE TER A AGENDA LIDA.
 *
 * `calendar_connections` guarda a agenda PESSOAL de uma pessoa, autorizada por ela via
 * OAuth. Quando o vínculo dela com a organização é revogado, a autorização do Google
 * continua válida — o token não sabe nada de RH. Sem este filtro, os dois crons seguem
 * lendo a agenda pessoal de um ex-funcionário para dentro da empresa da qual ele saiu,
 * indefinidamente.
 *
 * Medido antes de existir: `app/api/v1/team/` não mencionava `calendar_connections`
 * nenhuma vez, contra `revoked_at` aparecendo em 35 arquivos do produto. A revogação
 * parava tudo, menos isto.
 *
 * ⚠️ O FILTRO É AQUI, NO CONSUMO, e não só na rota de revogar — de propósito. Revogar é
 * um caminho; sair por outro (SQL direto de suporte, `update` de migração, uma segunda
 * rota amanhã) não passaria por aquele código. Aqui a leitura falha FECHADA: se a pessoa
 * não é membro ativo AGORA, a agenda dela não é lida, tenha ela saído por onde tiver.
 */
export async function apenasDeMembrosAtivos<T extends { organization_id: string; user_id: string }>(
  admin: ReturnType<typeof createAdminClient>,
  linhas: readonly T[],
): Promise<T[]> {
  if (linhas.length === 0) return [];

  const orgs = [...new Set(linhas.map((l) => l.organization_id))];
  const users = [...new Set(linhas.map((l) => l.user_id))];
  const { data, error } = await admin
    .from("user_organizations")
    .select("organization_id, user_id, revoked_at")
    .in("organization_id", orgs)
    .in("user_id", users);

  // Falha FECHADA: sem conseguir confirmar quem é membro, não sincroniza ninguém. O
  // contrário — sincronizar tudo quando a checagem falha — transformaria uma queda de
  // rede em vazamento de agenda pessoal.
  if (error || !data) return [];

  const ativos = new Set(
    (data as { organization_id: string; user_id: string; revoked_at: string | null }[])
      .filter((v) => v.revoked_at === null)
      .map((v) => `${v.organization_id}:${v.user_id}`),
  );
  return linhas.filter((l) => ativos.has(`${l.organization_id}:${l.user_id}`));
}
