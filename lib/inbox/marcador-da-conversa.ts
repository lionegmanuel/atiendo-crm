/**
 * O MARCADOR DA CONVERSA — uma régua só, para quem LISTA e para quem CONTA.
 *
 * ## Por que este arquivo existe
 *
 * O marcador mora em DUAS caixas: o marcador da CONVERSA (`conversations.tags`,
 * `text[]`, migration 0033) e o marcador do CONTATO, que a conversa enxerga pelo
 * campo calculado `tags_do_contato` (migration 0323). Quem filtra por marcador
 * tem de casar as duas.
 *
 * Enquanto a régua morava dentro de quem LISTA, quem CONTA respondeu à mesma
 * pergunta do seu jeito: pediu IGUALDADE numa coluna `tag`, que não existe em
 * `conversations` (`tag` é o nome do parâmetro da URL). O PostgREST devolvia
 * 42703 (`undefined_column`) e a rota inteira respondia 500 — com um marcador
 * filtrado, TODA aba do Inbox ficava sem número, a "Fechadas" inclusive. Medido
 * na tela: badge nenhum.
 *
 * A segunda régua sempre diverge. Por isso o predicado nasce AQUI, e quem filtra
 * — a lista (`app/api/v1/conversations/_handler.ts`) e a contagem das abas
 * (`app/api/v1/conversations/counts/route.ts`) — apenas o aplica.
 * `tests/unit/badge-espelha-o-filtro.test.ts` vigia os dois lados.
 */

/**
 * `{valor}` como operando de `cs` DENTRO de um `or=` do PostgREST.
 *
 * Duas gramáticas, uma dentro da outra: o literal de array do Postgres
 * (`{"vip"}`, com `"` e `\` escapados por barra) e, por fora, o valor entre
 * aspas do `or=` (mesmo escape). Sem as aspas de fora, marcador com `,` ou `)`
 * quebra a árvore lógica, e com `{`/`}` o PostgREST nem reconhece o array —
 * `pLogicSingleVal` só aceita `{…}` sem chave dentro. O `termoSeguroParaOr` da
 * busca não serve aqui: ele troca esses caracteres por curinga, e marcador é
 * igualdade exata.
 */
export function arrayDeUmValorParaOr(valor: string): string {
  const escapa = (t: string) => t.replace(/[\\"]/g, (c) => `\\${c}`);
  return `"${escapa(`{"${escapa(valor)}"}`)}"`;
}

/**
 * O predicado do marcador: casa a caixa da CONVERSA **ou** a do CONTATO.
 *
 * As duas, e não a troca: trocar a fonte pelo contato consertaria o relato e
 * tiraria o filtro de quem marca a conversa (`ConversationTagsEditor`, e a IA
 * por `crm_manage_tags`) — o marcador continuaria editável e deixaria de ser
 * filtrável. O lado do contato é o campo calculado, e não um `contact_id.in.(…)`:
 * a lista de ids viaja na URL e tem teto (`idsQueCabemNaURL`) — numa org com mais
 * contatos marcados que isso, conversas sumiriam do filtro sem aviso.
 */
export function predicadoDoMarcador(marcador: string): string {
  const valor = arrayDeUmValorParaOr(marcador);
  return `tags.cs.${valor},tags_do_contato.cs.${valor}`;
}

/**
 * Aplica o marcador na consulta — a MESMA função para a lista e para a contagem.
 *
 * Sem marcador não há filtro, e sem filtro não há `or=`. O builder do supabase-js
 * devolve ele mesmo, então quem chama pode encadear sem saber quem aplicou.
 */
export function aplicarMarcador<C extends { or: (filtro: string) => C }>(
  consulta: C,
  marcador: string | null | undefined,
): C {
  if (!marcador) return consulta;
  return consulta.or(predicadoDoMarcador(marcador));
}
