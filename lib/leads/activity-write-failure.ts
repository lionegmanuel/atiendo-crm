import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * O que fazer quando GRAVAR A ATIVIDADE falha — e o rastro não pode sumir.
 *
 * O DoD deste épico afirma "100% das mutações de lead geram
 * `crm_lead_activities`, zero escrita anônima". Com três caminhos engolindo a
 * falha em `console.error`, isso podia ser silenciosamente MENOS que 100% sem
 * ninguém ficar sabendo — e uma garantia declarada que não é verdadeira é pior
 * que garantia nenhuma, porque as decisões seguintes confiam nela.
 *
 * DUAS POLÍTICAS, COM MOTIVO — e não uma uniformização:
 *
 *  - quando a atividade **É o registro da decisão** (aprovar, ignorar), ela é a
 *    evidência do consentimento humano. Perdê-la em silêncio é pior que recusar
 *    a operação, então ali se FALHA ALTO (500). É o caso de
 *    `leads/[id]/next-action`, que já faz isso e deve continuar fazendo.
 *
 *  - quando a atividade é o **rastro de uma mutação JÁ OCORRIDA** (o card já
 *    moveu), bloquear deixaria o negócio refém da timeline. Aí se FALHA BAIXO —
 *    mas **falhar baixo é escolher não bloquear, não é escolher não contar**.
 *
 * `console.error` é o anti-pattern nº 14 do CLAUDE.md e não é nenhum dos dois:
 * não bloqueia e também não conta, porque log de servidor sem destino não vira
 * alerta de ninguém. A casa já tem doutrina para exatamente isto no audit log
 * (CLAUDE.md, seção Audit): falha de write **gera alerta** e não bloqueia a
 * mutação principal. O rastro perdido segue o mesmo caminho.
 */
export interface FalhaDeAtividade {
  organizationId: string;
  leadId: string;
  /** O tipo que se tentou gravar — sem ele, o alerta não diz o que se perdeu. */
  tipo: string;
  /** Onde aconteceu, para o alerta apontar o caminho e não só a tabela. */
  origem: string;
  erro: string | undefined;
  requestId?: string;
}

/**
 * Registra a perda em `event_log`. Fire-and-forget de propósito: a mutação
 * principal já aconteceu e não pode ser desfeita por causa do aviso.
 *
 * Se ATÉ ISTO falhar, aí sim resta o log do processo — mas essa é a segunda
 * linha de defesa, não a primeira, e a diferença entre as duas é justamente o
 * que o `console.error` sozinho não tinha.
 */
export async function registraFalhaDeAtividade(
  supabase: SupabaseClient,
  f: FalhaDeAtividade,
): Promise<void> {
  const { error } = await supabase.rpc("emit_event", {
    p_event_type: "crm.activity_write_failed",
    p_entity_kind: "crm_lead",
    p_entity_id: f.leadId,
    p_payload: {
      activity_type: f.tipo,
      origem: f.origem,
      erro: f.erro ?? null,
    },
    p_metadata: { request_id: f.requestId ?? null, severity: "warn" },
    p_organization_id: f.organizationId,
  });

  if (error) {
    // Segunda linha: o event_log também caiu. Aqui o log do processo é tudo o
    // que sobra, e ele existe para o caso em que o próprio canal de aviso
    // morreu — não como política de rotina.
    console.error("[activity] perdi o rastro E o aviso", {
      lead: f.leadId,
      tipo: f.tipo,
      origem: f.origem,
      erro: f.erro,
      aviso: error.message,
    });
  }
}
