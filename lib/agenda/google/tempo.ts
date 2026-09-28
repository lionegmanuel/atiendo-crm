/**
 * O instante em que um DIA começa, num fuso — o inverso de `localMoment()`.
 *
 * ─── Por que este arquivo existe ───────────────────────────────────────────
 *
 * O Google descreve evento de dia inteiro como `{ "date": "2026-09-02" }`, sem
 * hora e **sem fuso** (`timeZone` vem nulo nesses eventos). Quem lê isso com
 * `new Date("2026-09-02")` recebe **meia-noite UTC** — e a especificação manda
 * mesmo: string só-data em JS é parseada como UTC. Para quem está em São Paulo
 * (UTC−3) o dia 2 passa a ocupar das 21h do dia 1 às 21h do dia 2. O compromisso
 * some do fim do dia e aparece na véspera; o motor de horários oferece um
 * horário que está ocupado e esconde um que está livre. É a classe de bug que a
 * referência do cal.com carrega até hoje.
 *
 * A conversão certa precisa do fuso DO CALENDÁRIO, que quem chama injeta.
 *
 * ─── Por que não é `new Date(...)` com offset fixo ────────────────────────
 *
 * O deslocamento de um fuso muda ao longo do ano (horário de verão) e ao longo
 * da história (o Brasil aboliu o dele em 2019). Um `-03:00` colado no código
 * acerta hoje e erra em qualquer data antiga. Quem sabe o deslocamento de um
 * instante é o `Intl` — a mesma base que `lib/routing/eligibility.ts` já usa em
 * produção, e sem dependência nova.
 *
 * ─── O buraco do horário de verão, que não é hipótese ─────────────────────
 *
 * Enquanto o Brasil teve horário de verão, a virada era **à meia-noite**: em
 * `America/Sao_Paulo`, 2018-11-04 pulou de 2018-11-03 23:59:59 (GMT−3) direto
 * para 2018-11-04 01:00:00 (GMT−2). **A meia-noite daquele dia não existiu.**
 * Medido neste runtime, não suposto. Uma conversão ingênua devolve um instante
 * que cai na véspera — o dia inteiro escorrega um dia para trás.
 *
 * Quem resolve isso é `instanteDe`, em `lib/agenda/fuso.ts`: ela devolve o
 * **primeiro instante que existe naquele dia**, que é o que a palavra "dia
 * inteiro" quer dizer. A busca de duas passadas morava aqui e foi para lá —
 * ver a seção seguinte.
 *
 * ─── A DUPLICAÇÃO ANUNCIADA AQUI FOI PAGA ────────────────────────────────
 *
 * Este cabeçalho declarava que existia uma segunda implementação da mesma
 * conta em `lib/agenda/fuso.ts` (motor de horários) e que, quando as branches
 * se encontrassem, esta função viraria uma casca sobre a de lá. As branches se
 * encontraram, e virou.
 *
 * O que sobrou aqui é só o que é próprio de ler dado de TERCEIRO, e que não
 * existe do lado do motor: o parse do formato `AAAA-MM-DD`, a recusa de data
 * que não existe no calendário (`Date.UTC` normaliza 31 de fevereiro para 3 de
 * março em silêncio), e a recusa de fuso desconhecido — porque `instanteDe`
 * assume fuso válido e o `Intl` **lança** num fuso que não existe. Nos três
 * casos a resposta certa é `null`, não exceção: um evento malformado no meio de
 * um lote de sincronização não pode derrubar os seguintes.
 *
 * O caminho por onde a divergência foi encontrada e o critério que decidiu qual
 * lado sobrevive estão na DECISÃO 15. Em resumo: as duas escolhiam diferente na
 * hora que não existe, e a do motor caía na véspera em todo fuso de
 * deslocamento positivo (Beirute, Teerã). Hoje ela faz `Math.max` e diz por
 * quê. Medido depois do merge, nesta árvore: os três pares que divergiam e a
 * hora ambígua de Nova York dão o MESMO instante nas duas.
 */

import { instanteDe, type HoraDeParede } from "@/lib/agenda/fuso";
import { fusoValido } from "@/lib/tempo/fusos";

/** `AAAA-MM-DD`, o formato que o Google usa em evento de dia inteiro. */
const SO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * O primeiro instante do dia `AAAA-MM-DD` naquele fuso.
 *
 * Só isto mora aqui: as três recusas acima e a delegação. A conta de fuso é a
 * do motor de horários, e é uma só no projeto.
 */
export function primeiroInstanteDoDia(dataYmd: string, fuso: string): Date | null {
  const casou = SO_DATA.exec(dataYmd.trim());
  if (!casou) return null;
  const [, anoTexto, mesTexto, diaTexto] = casou;
  if (!anoTexto || !mesTexto || !diaTexto) return null;

  const ano = Number(anoTexto);
  const mes = Number(mesTexto);
  const dia = Number(diaTexto);

  // Data que não existe no calendário: `Date.UTC(2026, 1, 31)` devolve 3 de
  // março sem reclamar, e o dia ocupado seria outro. Só passa quando a volta
  // bate com o que veio escrito.
  const conferencia = new Date(Date.UTC(ano, mes - 1, dia));
  if (
    conferencia.getUTCFullYear() !== ano ||
    conferencia.getUTCMonth() !== mes - 1 ||
    conferencia.getUTCDate() !== dia
  ) {
    return null;
  }

  // `instanteDe` assume fuso válido — o `Intl` lança num fuso que não existe,
  // e o acento que um hispanofalante escreve é o caso real (ver o cabeçalho de
  // `lib/tempo/fusos.ts`). Aqui a resposta é `null`, e quem chama a transforma
  // em recusa nomeada.
  if (!fusoValido(fuso)) return null;

  return instanteDe({ ano, mes, dia, hora: 0, minuto: 0, segundo: 0 }, fuso);
}

/**
 * Hora de parede qualquer → instante, com as mesmas três recusas.
 *
 * Existe porque a leitura de `dateTime` sem deslocamento precisa dela (ver
 * `evento.ts`), e porque ali o fuso também vem de fora e pode não existir.
 */
export function instanteDaParede(parede: HoraDeParede, fuso: string): Date | null {
  const { ano, mes, dia } = parede;
  const hora = parede.hora ?? 0;
  const minuto = parede.minuto ?? 0;
  const segundo = parede.segundo ?? 0;
  if (![ano, mes, dia, hora, minuto, segundo].every((n) => Number.isInteger(n))) return null;

  const conferencia = new Date(Date.UTC(ano, mes - 1, dia, hora, minuto, segundo));
  if (
    conferencia.getUTCFullYear() !== ano ||
    conferencia.getUTCMonth() !== mes - 1 ||
    conferencia.getUTCDate() !== dia ||
    conferencia.getUTCHours() !== hora ||
    conferencia.getUTCMinutes() !== minuto ||
    conferencia.getUTCSeconds() !== segundo
  ) {
    return null;
  }
  if (!fusoValido(fuso)) return null;

  return instanteDe({ ano, mes, dia, hora, minuto, segundo }, fuso);
}

export type { HoraDeParede };
