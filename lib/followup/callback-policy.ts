/**
 * Decide quais retornos um agente pode criar por conta própria.
 *
 * `callback_enabled` é independente de `followup.enabled`: o segundo controla
 * a inscrição em fluxos publicados; o primeiro controla apenas a criação de um
 * retorno pontual a partir de uma promessa do agente. Versões sem o campo
 * preservam o comportamento legado (habilitado).
 */
export function callbacksHabilitados(followup: unknown): boolean {
  if (followup === null || typeof followup !== "object" || Array.isArray(followup)) {
    return true;
  }
  return !("callback_enabled" in followup && followup.callback_enabled === false);
}

/** `schedule_followup` nativa também exige a janela configurada pelo runtime. */
export function podeExporScheduleFollowup<T>(
  followup: unknown,
  knobs: T | undefined,
): knobs is T {
  return knobs !== undefined && callbacksHabilitados(followup);
}

/** Oculta somente o criador MCP de retorno; consulta, cancelamento e agenda ficam. */
export function filtrarToolsComCallbackDesabilitado(
  toolIds: readonly string[],
  followup: unknown,
): string[] {
  return callbacksHabilitados(followup)
    ? [...toolIds]
    : toolIds.filter((id) => id !== "crm_schedule_followup");
}
