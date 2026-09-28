/**
 * OS MARCADORES QUE UM CARD TEM — as DUAS caixas, numa pergunta só.
 *
 * ─── O defeito que este arquivo fecha ───────────────────────────────────────
 *
 * O produto tem TRÊS lugares onde se marca, e eles não são o mesmo:
 *
 * - `crm_leads.tags` — do NEGÓCIO, campo de texto livre em "Editar lead".
 * - `contacts.tags`  — da PESSOA, escrito no Inbox e na ficha. É a caixa que a
 *   campanha lê e a que quem atende usa todo dia.
 * - `conversations.tags` — da CONVERSA, "Tags da conversa" no painel do Inbox,
 *   onde a IA também escreve. Entrou no filtro do quadro por decisão do dono
 *   (doc 40, item 7, 19/09): um marcador editável que não filtra é a pior das
 *   faces, a mesma razão que trouxe a do contato.
 *
 * O filtro do quadro lia só a primeira. Quem marcava o cliente e depois filtrava
 * pelo marcador não achava o card — e a lista de opções, montada da mesma fonte,
 * nem oferecia o marcador que ele acabara de escrever. O relato mede o efeito:
 * o seletor só mostrava uma etiqueta, escrita dentro de um card meses antes.
 *
 * ─── Por que UNIR, e não trocar ─────────────────────────────────────────────
 *
 * Trocar por `contacts.tags` consertaria o relato e quebraria quem já usa o
 * campo do card: o marcador continuaria editável e deixaria de ser filtrável,
 * que é a pior das duas faces. Unir não tira nada de ninguém.
 *
 * ─── Por que num arquivo só ─────────────────────────────────────────────────
 *
 * Quem OFERECE a opção (`FilterBar`) e quem FILTRA (`applyFilters`) precisam
 * responder a mesma pergunta. Com a regra escrita duas vezes, mudar uma faz o
 * seletor oferecer uma etiqueta que a lista nunca casa — sem erro, sem sintoma,
 * só um filtro que devolve vazio. É a mesma classe de defeito que a união vem
 * consertar, e seria irônico reintroduzi-la do lado da leitura.
 */
import type { Lead } from "@/lib/types/leads";

/**
 * Os marcadores do card: os do negócio, os do contato e os das conversas do
 * contato, sem repetição.
 *
 * A ordem é estável (negócio, contato, conversa) só para a saída ser
 * determinística em teste; quem exibe ordena por conta própria.
 */
export function marcadoresDoCard(lead: Lead): string[] {
  const vistos = new Set<string>();
  const marcadores: string[] = [];
  for (const marcador of [
    ...lead.tags,
    ...(lead.contact_tags ?? []),
    ...(lead.conversation_tags ?? []),
  ]) {
    if (vistos.has(marcador)) continue;
    vistos.add(marcador);
    marcadores.push(marcador);
  }
  return marcadores;
}

/** Este card casa com o marcador filtrado? Pergunta as três caixas. */
export function cardTemMarcador(lead: Lead, marcador: string): boolean {
  return (
    lead.tags.includes(marcador) ||
    (lead.contact_tags ?? []).includes(marcador) ||
    (lead.conversation_tags ?? []).includes(marcador)
  );
}
