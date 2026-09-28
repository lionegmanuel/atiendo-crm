/**
 * O QUE FALTA NESTE DIA — issue 896, item (b).
 *
 * A grade do atendente abria num dia e dizia "Nenhum horário publicado neste
 * dia" para DUAS situações diferentes:
 *
 *   1. a pessoa publicou jornada e este dia está fora dela (folga, fim de
 *      semana, feriado) — quem lê espera o próximo dia útil;
 *   2. a pessoa nunca publicou jornada — nenhum dia abre, e nada acontece
 *      enquanto os horários não forem configurados.
 *
 * A mesma frase fazia a folga parecer configuração faltando, e mandava quem
 * publicou jornada conferir uma configuração que já estava certa. Os dois
 * textos são diferentes porque as duas saídas são diferentes.
 */
export function mensagemDoDiaSemJanela(publicouHorarios: boolean): string {
  return publicouHorarios
    ? "Este dia está fora da jornada publicada (folga ou dia sem expediente)."
    : "Nenhuma jornada publicada ainda — nenhum dia abre.";
}

/**
 * A frase antiga, a que não distinguia os casos. Existe aqui só para o teste
 * poder afirmar que ela não voltou a ser dita — não use em tela nenhuma.
 */
export const MENSAGEM_UNICA_QUE_NAO_DISTINGUIA =
  "Nenhum horário publicado neste dia.";
