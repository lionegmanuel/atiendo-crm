"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

import { apiClient } from "@/lib/api/client";
import { useRealtimeChannel } from "@/hooks/realtime/useRealtimeChannel";
import { useRefetchDeSeguranca, type RefetchDeSeguranca } from "@/hooks/realtime/useRefetchDeSeguranca";
import type { TimelineItemView } from "@/lib/types/contacts";

/**
 * A timeline do dossiê, viva.
 *
 * ⚠️ **NÃO reuse o eco local do board aqui.** As duas superfícies têm
 * polaridades OPOSTAS pelo mesmo motivo: no card, a própria ação já é visível e
 * repetir seria ruído; na timeline, a própria ação é JUSTAMENTE o que se quer
 * ver registrado. Suprimir o eco aqui faria a atividade que o usuário acabou de
 * gerar sumir para ele — e sumir em silêncio, porque ela FOI gravada.
 *
 * A semelhança é a armadilha: dois usos do mesmo mecanismo com polaridade
 * oposta parecem duplicação para quem lê rápido, e "remover duplicação" é o
 * refactor mais aplaudido que existe.
 */
export interface TimelineAoVivo {
  itens: TimelineItemView[];
  isLoading: boolean;
  isError: boolean;
  /**
   * Ids que chegaram por realtime NESTE mount.
   *
   * Existem porque o colapso e o tempo real se anulam: se o evento novo cai
   * dentro de um bloco já colapsado, a timeline vai de "3 ações" para "4 ações"
   * e o usuário NÃO VÊ O QUE CHEGOU — o requisito de agrupar esconde o que o
   * requisito de tempo real promete mostrar.
   *
   * A saída não é expandir o bloco sozinho (isso mudaria retroativamente o que
   * já está na tela e a pessoa perde onde estava lendo): o que chega fica FORA
   * do agrupamento nesta sessão, e só se junta ao bloco numa abertura nova do
   * dossiê. O que vem de fora tem de ser VISTO, não contado.
   */
  chegouAoVivo: Set<string>;
  realtimeStatus: string;
  /** A rede que cura a perda e denuncia a falha — ver o hook. */
  seguranca: RefetchDeSeguranca;
}

async function fetchTimeline(leadId: string): Promise<TimelineItemView[]> {
  const res = await apiClient.get<{ data: TimelineItemView[] }>(
    `/api/v1/leads/${leadId}/timeline`,
  );
  if (res && typeof res === "object" && "data" in res) {
    return (res as { data: TimelineItemView[] }).data;
  }
  return res as unknown as TimelineItemView[];
}

/** O id da atividade dentro do payload do postgres_changes. */
function idDoEvento(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { new?: { id?: unknown } };
  return typeof p.new?.id === "string" ? p.new.id : null;
}

export function useLeadTimeline(
  leadId: string | null,
  contactId: string | null,
): TimelineAoVivo {
  const qc = useQueryClient();
  const queryKey = ["timeline", leadId] as const;
  const [chegouAoVivo, setChegouAoVivo] = useState<Set<string>>(new Set());
  // `useRef` para o Set não virar dependência do callback e o canal não
  // re-assinar a cada evento — re-assinar perderia eventos na janela.
  const recebidos = useRef<Set<string>>(new Set());

  const query = useQuery({
    queryKey,
    queryFn: () => fetchTimeline(leadId as string),
    enabled: !!leadId,
  });

  const onChange = useCallback(
    (payload: unknown) => {
      qc.invalidateQueries({ queryKey });
      const id = idDoEvento(payload);
      if (!id || recebidos.current.has(id)) return;
      recebidos.current.add(id);
      setChegouAoVivo(new Set(recebidos.current));
    },
    [qc, queryKey],
  );

  // O EIXO É O LEAD, e o comentário anterior aqui dizia o contrário com um
  // argumento bom — o que é pior que não ter comentário, porque faz o próximo
  // leitor parar de procurar. Ele dizia que filtrar por lead_id "deixaria de
  // fora a atividade que nasce da conversa": isso é VERDADE sobre a timeline do
  // CONTATO e MUDO sobre o negócio SEM contato, que não tinha porta nenhuma —
  // 25% dos leads, com 64% das atividades.
  //
  // A rota (`leads/[id]/timeline`) resolve isso com a cláusula que une o lead
  // com `contact_id = <contato> and lead_id is null`. Aqui no realtime o filtro
  // é simples por limitação do supabase-js, então assina por `lead_id`: cobre
  // 100% do que existe hoje, e a atividade órfã de lead (se um dia nascer)
  // chega pelo refetch da invalidação, não ao vivo. Limitação conhecida e
  // escrita, não descoberta depois.
  const { status, ultimaEntrega } = useRealtimeChannel({
    name: leadId ? `timeline-${leadId}` : "timeline-disabled",
    postgresChanges: leadId
      ? {
          event: "INSERT",
          schema: "public",
          table: "crm_lead_activities",
          filter: `lead_id=eq.${leadId}`,
        }
      : undefined,
    onChange,
    enabled: !!leadId,
  });
  void contactId; // a rota usa; o canal não consegue (filtro simples).

  // A REDE, aqui pelo mesmo motivo do board e com um agravante: o dossiê está
  // INTEIRAMENTE quebrado quando a entrega morre — a timeline nunca recupera,
  // nem por tempo nem ao voltar para a aba. E o dossiê é a superfície que
  // PROMETE contar a vida do negócio: uma timeline congelada não parece
  // congelada, parece um negócio sem novidade.
  //
  // A assinatura é a contagem mais o id do item mais recente: sensível a
  // exatamente o que o canal deveria ter trazido (atividade nova), e insensível
  // a reordenação — que não é perda.
  const seguranca = useRefetchDeSeguranca<TimelineItemView[]>({
    queryKey,
    assinatura: (d) => `${d?.length ?? 0}:${d?.[0]?.id ?? ""}`,
    ultimaEntrega,
    enabled: !!leadId,
  });

  return {
    itens: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    chegouAoVivo,
    realtimeStatus: status,
    seguranca,
  };
}
