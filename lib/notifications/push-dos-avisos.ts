/**
 * Push para o CELULAR dos avisos que pedem gente.
 *
 * O som da Central (`sons-da-org.ts`) só toca com o CRM aberto na tela. Quem
 * atende pelo WhatsApp passa o dia com o CRM fechado no bolso, e os avisos que
 * pedem uma pessoa esperavam sem ninguém saber. Três momentos vão ao celular:
 *
 *   - a IA passou a conversa para uma pessoa (aviso `handoff`);
 *   - a IA ficou sem saldo no provedor e as respostas estão esperando a
 *     recarga (`lib/agent-engine/queue/espera-de-saldo.ts`);
 *   - um negócio entrou numa etapa que avisa (migration 0440).
 *
 * São os MESMOS que têm som próprio: a regra de quais avisos pedem gente é uma
 * só (`somDoAviso`). Todos chegam pelo barramento como `central.aviso_criado`
 * (migration 0442); o resto da Central fica só na tela.
 *
 * O texto sai no idioma da ORGANIZAÇÃO — ninguém está logado quando o push sai
 * — e não carrega dado do cliente: o push aparece na tela bloqueada, e quem
 * precisa do nome toca e abre o contexto com a permissão que tem. O destino é o
 * mesmo que a Central daria ao aviso (`REFERENCIAS_DE_AVISO`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { REFERENCIAS_DE_AVISO } from "@/lib/ai/inbox-destino";
import { traduzir } from "@/lib/i18n/dicionario";
import { normalizarIdioma, type Idioma } from "@/lib/i18n/idiomas";

import { truncar, type PushPayload } from "./push_payload";
import { somDoAviso } from "./sons-da-org";

/** Sem destino próprio, o push abre a Central — onde o aviso está. */
const CENTRAL = "/app/ai/inbox";

async function idiomaDaOrganizacao(admin: SupabaseClient, orgId: string): Promise<Idioma> {
  const { data } = await admin.from("organizations").select("locale").eq("id", orgId).maybeSingle();
  return normalizarIdioma((data as { locale?: string | null } | null)?.locale ?? null);
}

type Aviso = {
  id: string;
  kind: string;
  ref_kind: string | null;
  ref_id: string | null;
  title: string;
  body: string | null;
};

function destinoDaPassagem(item: Aviso): string {
  if (!item.ref_id) return CENTRAL;
  if (item.ref_kind === "conversation") return REFERENCIAS_DE_AVISO.conversation.href(item.ref_id);
  if (item.ref_kind === "contact") return REFERENCIAS_DE_AVISO.contact.href(item.ref_id);
  return CENTRAL;
}

/**
 * O push de um aviso da Central, ou `null` quando o aviso não vai ao celular.
 * Lê o aviso do banco em vez de confiar no payload: o evento carrega só o id.
 */
export async function pushDoAvisoDaCentral(
  admin: SupabaseClient,
  orgId: string,
  itemId: string,
): Promise<PushPayload | null> {
  // ⚠️ Organização junto do id: o client é service-role e ignora RLS.
  const { data } = await admin
    .from("agent_inbox_items")
    .select("id, kind, ref_kind, ref_id, title, body")
    .eq("organization_id", orgId)
    .eq("id", itemId)
    .maybeSingle();
  const item = data as Aviso | null;
  if (!item) return null;

  const som = somDoAviso(item);
  if (som === null) return null;
  const idioma = await idiomaDaOrganizacao(admin, orgId);
  const tag = `aviso:${item.id}`;

  // Sem saldo no provedor: o título já nasceu no idioma da organização
  // (`espera-de-saldo.ts`); o corpo diz o remédio, que fica fora do CRM.
  if (item.kind === "other" && item.ref_kind === "ai_provider_credential") {
    return {
      title: truncar(item.title),
      body: traduzir("Recarregue o saldo na conta do provedor: as respostas saem sozinhas quando ele voltar.", idioma),
      tag,
      href: REFERENCIAS_DE_AVISO.ai_provider_credential.href(),
    };
  }

  if (som === "pessoa") {
    return {
      title: traduzir("A IA passou uma conversa para a equipe", idioma),
      body: traduzir("Abra a conversa para responder o cliente.", idioma),
      tag,
      href: destinoDaPassagem(item),
    };
  }

  // Etapa que avisa: título e corpo já nasceram no idioma da organização, só
  // com o nome da etapa (`lib/leads/aviso-de-etapa.ts`). O destino é o negócio
  // dentro do funil dele — o mesmo botão «Abrir negócio» da Central.
  let href = CENTRAL;
  if (item.ref_kind === "lead" && item.ref_id) {
    const { data: lead } = await admin
      .from("crm_leads")
      .select("pipeline_id")
      .eq("organization_id", orgId)
      .eq("id", item.ref_id)
      .maybeSingle();
    const pipelineId = (lead as { pipeline_id?: string | null } | null)?.pipeline_id;
    if (pipelineId) href = REFERENCIAS_DE_AVISO.lead.href(item.ref_id, pipelineId);
  }
  return { title: truncar(item.title), body: truncar(item.body ?? ""), tag, href };
}
