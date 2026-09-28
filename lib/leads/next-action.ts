import { resolveActiveLeadForContact, type LeadCandidate } from "@/lib/leads/active-lead";

/** Uma linha de `lead_state` que interessa ao board. */
export interface EstadoDoContato {
  contact_id: string;
  next_action: string | null;
  /** Identidade da proposta (migration 0073) — muda a cada escrita. */
  next_action_seq: number;
  updated_at: string;
}

/** O que o card precisa saber sobre a próxima ação proposta. */
export interface ProximaAcao {
  label: string;
  /**
   * QUAL proposta o humano está vendo — não o texto dela.
   *
   * Texto igual não é proposta igual: o agente pode escrever "enviar proposta",
   * o cliente mudar o pedido, e o agente escrever "enviar proposta" de novo,
   * palavra por palavra, significando outra coisa. Se o humano tivesse ignorado
   * a primeira, a segunda seria indistinguível dela.
   *
   * Também não é `updated_at`: aquele se move por estágio e por BANT — move
   * DEMAIS. A regra é comparar a coisa que muda exatamente quando o que importa
   * muda (migration 0073).
   */
  seq: number;
  proposed_at: string;
}

/**
 * De qual LEAD é a próxima ação que o agente escreveu para um CONTATO.
 *
 * `lead_state` é por contato; o card é um negócio. Uma pessoa pode ter N
 * negócios abertos, então juntar por `contact_id` faria a MESMA proposta
 * aparecer em N cards — e aprovar num executaria pelos outros. Uma ação, N
 * botões: é o vazamento da Wave 1 em outra roupa.
 *
 * Por isso a proposta vai para o lead ATIVO do contato, e **quando há
 * ambiguidade não vai para nenhum** — a mesma polaridade de
 * `resolveActiveLeadForContact`, que é reusado aqui em vez de reescrito. Um
 * segundo roteador seria uma segunda regra para divergir da primeira.
 *
 * `candidatos` precisa conter TODOS os negócios abertos do contato na org, não
 * só os do pipeline aberto na tela: com a lista recortada por pipeline, dois
 * negócios ambíguos em boards diferentes pareceriam um único negócio em cada
 * um, e cada board mostraria a proposta como se fosse dele.
 */
/** Proposta que não achou dono — precisa de gente, não de palpite. */
export interface PropostaAmbigua {
  contact_id: string;
  texto: string;
  /** Os negócios abertos entre os quais a proposta ficaria — o humano escolhe. */
  candidateIds: string[];
}

export interface RoteamentoDeProximasAcoes {
  porLead: Map<string, ProximaAcao>;
  /**
   * NÃO ADIVINHAR NÃO PODE VIRAR NÃO AVISAR.
   *
   * Recusar o palpite estava certo; parar aí estava errado. Sem esta lista, a
   * IA propõe, ninguém vê, e a demanda apodrece em silêncio — que é exatamente
   * a morte que este épico existe para matar. Quem chama transforma isto em
   * item de caixa, e o humano desambigua: é a única coisa que ele faz melhor
   * que a máquina aqui.
   */
  ambiguas: PropostaAmbigua[];
}

export function roteiaProximasAcoes(
  estados: EstadoDoContato[],
  candidatos: Array<LeadCandidate & { contact_id: string | null }>,
  opts: { defaultPipelineId?: string | null } = {},
): RoteamentoDeProximasAcoes {
  const porContato = new Map<string, Array<LeadCandidate & { contact_id: string | null }>>();
  for (const c of candidatos) {
    if (!c.contact_id) continue;
    const lista = porContato.get(c.contact_id);
    if (lista) lista.push(c);
    else porContato.set(c.contact_id, [c]);
  }

  const porLead = new Map<string, ProximaAcao>();
  const ambiguas: PropostaAmbigua[] = [];
  for (const estado of estados) {
    const texto = estado.next_action?.trim();
    if (!texto) continue; // sem proposta não há slot — o card fica NORMAL.

    const doContato = porContato.get(estado.contact_id);
    if (!doContato || doContato.length === 0) continue;

    const rota = resolveActiveLeadForContact(doContato, opts);
    if (!rota.routed) {
      // Não aparece em card nenhum — mas SAI da invisibilidade pela caixa.
      // `no_open_lead` fica de fora desta lista de propósito: lá não há negócio
      // para desambiguar, e o item pediria uma escolha que não existe. Esse
      // caso está reportado ao orquestrador como pendência própria.
      if (rota.reason === "ambiguous_open_leads") {
        ambiguas.push({
          contact_id: estado.contact_id,
          texto,
          candidateIds: rota.candidateIds,
        });
      }
      continue;
    }

    porLead.set(rota.leadId, {
      label: texto,
      seq: estado.next_action_seq,
      proposed_at: estado.updated_at,
    });
  }
  return { porLead, ambiguas };
}
