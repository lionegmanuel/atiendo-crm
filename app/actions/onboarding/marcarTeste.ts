"use server";

/**
 * Server Actions do passo "Ver ele atender".
 *
 * Ninguém é obrigado a testar — mas o wizard precisa saber que a tela foi
 * encarada, senão ela volta para sempre. `respondeu` guarda se o funcionário
 * chegou a responder alguma coisa: é a diferença entre "vi funcionando" e
 * "passei por aqui".
 */
import { redirect } from "next/navigation";

import { audit } from "@/lib/audit";
import { requireOnboardingCtx, patchOnboardingState } from "./_shared";

export async function marcarTesteFeito(respondeu: boolean): Promise<void> {
  const ctx = await requireOnboardingCtx();
  await patchOnboardingState(ctx.orgId, { teste: { respondeu } });
  await audit({
    action: "onboarding.agente_testado",
    actorUserId: ctx.userId,
    organizationId: ctx.orgId,
    metadata: { respondeu },
  });
  redirect("/onboarding");
}

export async function pularTeste(): Promise<void> {
  const ctx = await requireOnboardingCtx();
  await patchOnboardingState(ctx.orgId, { teste: { skipped: true } });
  await audit({
    action: "onboarding.agente_teste_pulado",
    actorUserId: ctx.userId,
    organizationId: ctx.orgId,
  });
  redirect("/onboarding");
}
