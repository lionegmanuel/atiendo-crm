/**
 * GET /api/v1/agenda/pessoas — quem tem agenda, para a Agenda listar as pessoas.
 *
 * Exceção deliberada e MÍNIMA à matriz spec 13 §4 (team read = manager+), no
 * mesmo espírito de `/api/v1/team/assignable`: o Atendente precisa escolher de
 * quem é a agenda que ele está marcando, e sem a lista o filtro de pessoas
 * ficava invisível (issue 896, item 1). O que sai daqui é o mínimo irredutível
 * — id, papel e nome. Sem e-mail, sem `last_sign_in_at`.
 *
 * A RLS de `user_organizations` só mostra o próprio membership a um agent, por
 * isso o client admin com filtro EXPLÍCITO de `organization_id` vindo do cookie
 * validado (`authz.org`), como manda a doutrina do repo.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { isServiceRoleConfigured } from "@/lib/audit";
import { PAPEL_MINIMO_DA_LISTA } from "@/lib/agenda/lista-de-pessoas";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export interface PessoaDaAgenda {
  user_id: string;
  role: string;
  full_name: string | null;
}

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole(PAPEL_MINIMO_DA_LISTA, {
    requestId,
    resource: "agenda",
  });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId; // fonte confiável (cookie validado)

  const client = isServiceRoleConfigured() ? createAdminClient() : await createClient();
  const { data: rows, error } = await client
    .from("user_organizations")
    .select("user_id, role")
    .eq("organization_id", orgId)
    // Revogado não tem agenda para mostrar hoje: a barra de pessoas da agenda
    // é de quem atende, e ex-membro ali só confunde. (Diferente de
    // `/api/v1/team`, onde a linha revogada CONTINUA porque é de lá que se
    // reativa alguém.)
    .is("revoked_at", null)
    .order("created_at", { ascending: true });

  if (error) return fail("internal_error", error.message, 500, { requestId });

  const membros = (rows ?? []) as Array<{ user_id: string; role: string }>;

  if (!isServiceRoleConfigured() || membros.length === 0) {
    const degradado: PessoaDaAgenda[] = membros.map((m) => ({ ...m, full_name: null }));
    return ok(degradado, { requestId });
  }

  const admin = createAdminClient();
  const pessoas: PessoaDaAgenda[] = await Promise.all(
    membros.map(async (m) => {
      const { data: userRes } = await admin.auth.admin.getUserById(m.user_id);
      return {
        ...m,
        full_name: (userRes?.user?.user_metadata?.full_name as string | undefined) ?? null,
      };
    }),
  );

  return ok(pessoas, { requestId });
}
