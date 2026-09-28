import { addDays, format, startOfWeek } from "date-fns";

import type { Agendamento, HorarioLivre, Pessoa } from "./tipos";

/**
 * Dados de mentira da vitrine.
 *
 * O ANCORA é fixo e não é `new Date()`. Uma vitrine ancorada no relógio faria a
 * spec medir um alvo diferente a cada execução — e pior, passaria de manhã e
 * falharia de madrugada, que é um modo de falha que esta base já pagou mais de
 * uma vez (invariantes que só passavam dentro da janela de atendimento).
 *
 * Escolhido uma quarta-feira às 14h37: dia útil no meio da semana, com a régua
 * do agora caindo num ponto quebrado — se ela estivesse em hora cheia, um erro
 * de arredondamento de meia hora passaria despercebido.
 */
export const ANCORA = new Date(2026, 7, 26, 14, 37, 0); // 2026-08-26, quarta

export const PESSOAS: Pessoa[] = [
  { id: "ana", nome: "Ana Prado", trilha: 1 },
  { id: "bruno", nome: "Bruno Sales", trilha: 2 },
  { id: "clara", nome: "Clara Nunes", trilha: 3 },
  { id: "davi", nome: "Davi Rocha", trilha: 4 },
];

function em(dia: Date, hora: number, minuto: number): string {
  const d = new Date(dia);
  d.setHours(hora, minuto, 0, 0);
  return d.toISOString();
}

const SEG = startOfWeek(ANCORA, { weekStartsOn: 0 });

/**
 * Uma semana com densidade realista de clínica pequena: cheia em alguns dias,
 * vazia no domingo, com uma ocupação vinda do Google e um cancelado — os três
 * estados que a grade precisa desenhar diferente.
 */
export const AGENDAMENTOS: Agendamento[] = [
  { id: "c1", titulo: "Avaliação inicial", quemSeraAtendido: "Marina Alves", responsavelId: "ana", comeca: em(addDays(SEG, 1), 9, 0), termina: em(addDays(SEG, 1), 9, 45), tipo: "Consulta", origem: "ui", situacao: "confirmed" },
  { id: "c2", titulo: "Retorno", quemSeraAtendido: "Pedro Lima", responsavelId: "bruno", comeca: em(addDays(SEG, 1), 10, 30), termina: em(addDays(SEG, 1), 11, 0), tipo: "Retorno", origem: "ui", situacao: "confirmed" },
  { id: "c3", titulo: "Visita ao imóvel", quemSeraAtendido: "Família Souza", responsavelId: "clara", comeca: em(addDays(SEG, 2), 14, 0), termina: em(addDays(SEG, 2), 15, 30), tipo: "Visita", origem: "ui", situacao: "confirmed" },
  { id: "c4", titulo: "Almoço da equipe", responsavelId: "ana", comeca: em(addDays(SEG, 3), 12, 0), termina: em(addDays(SEG, 3), 13, 0), origem: "google_sync", situacao: "confirmed" },
  { id: "c5", titulo: "Consulta", quemSeraAtendido: "Rita Campos", responsavelId: "ana", comeca: em(addDays(SEG, 3), 15, 0), termina: em(addDays(SEG, 3), 15, 30), tipo: "Consulta", origem: "ui", situacao: "confirmed" },
  { id: "c6", titulo: "Procedimento", quemSeraAtendido: "João Bento", responsavelId: "davi", comeca: em(addDays(SEG, 3), 16, 0), termina: em(addDays(SEG, 3), 17, 30), tipo: "Procedimento", origem: "ui", situacao: "pending" },
  { id: "c7", titulo: "Retorno", quemSeraAtendido: "Ícaro Melo", responsavelId: "bruno", comeca: em(addDays(SEG, 4), 8, 30), termina: em(addDays(SEG, 4), 9, 0), tipo: "Retorno", origem: "ui", situacao: "cancelled" },
  { id: "c8", titulo: "Reunião comercial", quemSeraAtendido: "Loja Verde", responsavelId: "clara", comeca: em(addDays(SEG, 4), 11, 0), termina: em(addDays(SEG, 4), 12, 0), tipo: "Call", origem: "ui", situacao: "confirmed" },
  { id: "c9", titulo: "Bloqueado (particular)", responsavelId: "clara", comeca: em(addDays(SEG, 5), 9, 0), termina: em(addDays(SEG, 5), 11, 0), origem: "google_sync", situacao: "confirmed" },
  { id: "c10", titulo: "Consulta", quemSeraAtendido: "Sofia Braga", responsavelId: "davi", comeca: em(addDays(SEG, 5), 13, 30), termina: em(addDays(SEG, 5), 14, 15), tipo: "Consulta", origem: "ui", situacao: "confirmed" },
  // Um passado JÁ RESOLVIDO, de propósito: sem ele o teste da decisão 17 só
  // poderia provar que os botões APARECEM, e não que eles somem depois de a
  // pessoa já ter respondido "aconteceu?".
  { id: "c12", titulo: "Consulta", quemSeraAtendido: "Vera Lins", responsavelId: "bruno", comeca: em(addDays(SEG, 1), 15, 0), termina: em(addDays(SEG, 1), 15, 30), tipo: "Consulta", origem: "ui", situacao: "completed" },
  { id: "c11", titulo: "Encaixe", quemSeraAtendido: "Léo Martins", responsavelId: "ana", comeca: em(ANCORA, 16, 0), termina: em(ANCORA, 16, 30), tipo: "Consulta", origem: "ui", situacao: "confirmed" },
];

/**
 * Horários livres por dia, para o painel de marcação.
 *
 * De propósito NEM TODO dia tem: a quinta fica vazia para provar que dia sem
 * horário nasce apagado e não clicável — se todos tivessem, a spec não teria
 * como distinguir "apagou o dia certo" de "não apaga nunca".
 */
export const HORARIOS_POR_DIA: Record<string, HorarioLivre[]> = (() => {
  const mapa: Record<string, HorarioLivre[]> = {};
  const grade: Array<[number, number]> = [
    [9, 0], [9, 30], [10, 0], [10, 30], [11, 0], [14, 0], [14, 30], [15, 0], [15, 30], [16, 0],
  ];
  for (const offset of [1, 2, 3, 5, 8, 9, 10]) {
    const dia = addDays(SEG, offset);
    mapa[format(dia, "yyyy-MM-dd")] = grade.map(([h, m]) => ({
      instante: em(dia, h, m),
      rotulo: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
    }));
  }
  return mapa;
})();
