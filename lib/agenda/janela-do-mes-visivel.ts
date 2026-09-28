import { addDays, endOfMonth, startOfMonth } from "date-fns";

/**
 * O recorte que a consulta de horários livres pede para o mês que o painel
 * está mostrando.
 *
 * A busca NÃO é "hoje + N dias". Esse teto artificial travava o calendário:
 * o mês visível era estado local, a consulta não acompanhava, e "Próximo mês"
 * desligava assim que acabavam os dias já pedidos — daqui a dois meses nunca
 * chegava. O motor já corta pelo `booking_window_days` do tipo; a tela só
 * precisa perguntar pelo mês que a pessoa está vendo.
 *
 * Mês corrente começa em `agora`, não no dia 1: o sync do Google cobre a
 * partir de ontem, e pedir setembro inteiro no dia 17 fazia a cobertura
 * acusar "ainda não verificada neste período" à toa.
 */
export function janelaDoMesVisivel(mes: Date, agora: Date): { de: Date; ate: Date } {
  const inicio = startOfMonth(mes);
  const ate = addDays(endOfMonth(mes), 1);
  if (inicio.getTime() >= agora.getTime()) return { de: inicio, ate };
  if (ate.getTime() <= agora.getTime()) return { de: inicio, ate };
  return { de: agora, ate };
}
