import type { SupabaseClient } from "@supabase/supabase-js";

import type { Logger } from "@/lib/agent-engine/obs/logger";

/**
 * Título estável para deduplicar e depois resolver o incidente.
 *
 * `kind="other"` é deliberado: o laço rápido desligado NÃO significa evento
 * morto. O cron de segurança continua drenando a fila uma vez por minuto; o
 * estado é degradação operacional, não perda de evento.
 */
export const TITULO_LACO_EVENT_LOG_DEGRADADO =
  "Processamento rápido de eventos está em modo degradado";

const CORPO_LACO_EVENT_LOG_DEGRADADO =
  "O processamento rápido do event_log não carregou neste worker. " +
  "O cron de segurança continua processando a fila, mas automações e efeitos derivados podem levar até cerca de 1 minuto a mais. " +
  "Quem administra a instalação deve revisar o worker.";

type EstadoDoAviso = "degradado" | "saudavel";

/**
 * Fecha o laço visível do worker sem transformar a Central em causa de queda.
 *
 * - degradado: abre, no máximo, um aviso por organização;
 * - saudável: resolve todos os avisos abertos deste incidente;
 * - qualquer falha aqui vira log e NUNCA derruba o worker.
 *
 * Uma pane global precisa chegar a quem usa cada organização, porque a Central
 * tenant-aware é a superfície que existe hoje. O título estável permite
 * deduplicar entre reinícios sem adicionar schema/constraint nova.
 */
export async function sincronizarAvisoDoLacoDeEventLog(
  admin: SupabaseClient,
  estado: EstadoDoAviso,
  log: Logger,
): Promise<void> {
  try {
    if (estado === "saudavel") {
      const { error } = await admin
        .from("agent_inbox_items")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .eq("kind", "other")
        .eq("title", TITULO_LACO_EVENT_LOG_DEGRADADO)
        .eq("status", "open");
      if (error) throw new Error(`resolver aviso: ${error.message}`);
      return;
    }

    const { data: organizacoes, error: erroOrganizacoes } = await admin
      .from("organizations")
      .select("id");
    if (erroOrganizacoes) throw new Error(`listar organizações: ${erroOrganizacoes.message}`);

    const ids = (organizacoes ?? []).map((o) => o.id as string).filter(Boolean);
    if (ids.length === 0) return;

    const { data: existentes, error: erroExistentes } = await admin
      .from("agent_inbox_items")
      .select("organization_id")
      .eq("kind", "other")
      .eq("title", TITULO_LACO_EVENT_LOG_DEGRADADO)
      .eq("status", "open");
    if (erroExistentes) throw new Error(`listar avisos existentes: ${erroExistentes.message}`);

    const jaAvisadas = new Set(
      (existentes ?? [])
        .map((item) => item.organization_id as string | null)
        .filter((id): id is string => typeof id === "string"),
    );
    const faltantes = ids.filter((id) => !jaAvisadas.has(id));
    if (faltantes.length === 0) return;

    const { error: erroInsert } = await admin.from("agent_inbox_items").insert(
      faltantes.map((organization_id) => ({
        organization_id,
        kind: "other",
        severity: "warn",
        title: TITULO_LACO_EVENT_LOG_DEGRADADO,
        body: CORPO_LACO_EVENT_LOG_DEGRADADO,
        ref_kind: null,
        ref_id: null,
      })),
    );
    if (erroInsert) throw new Error(`abrir aviso: ${erroInsert.message}`);
  } catch (err) {
    // `warn`, e não `error`: o aviso na Central é acessório. O incidente do
    // laço já tem o seu `log.error` em `carregarDepsDoLaco`, e o gate da #604
    // exige zero `log.error` quando as deps carregaram — um Supabase lento no
    // boot não pode se passar por laço quebrado.
    log.warn("event-log drain: falhei ao sincronizar o aviso de degradação na Central", {
      error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
    });
  }
}
