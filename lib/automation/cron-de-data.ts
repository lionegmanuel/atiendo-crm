/**
 * O que as varreduras de DATA têm em comum (issues #989 e o aniversário).
 *
 * Aniversário de contato e "N dias até uma data do funil" não são o mesmo
 * gatilho, mas são o mesmo PROBLEMA de relógio: uma data guardada que precisa
 * virar acontecimento num dia certo, no fuso de quem a guardou, uma vez só, e
 * sem acordar quem não pediu. Este arquivo é o que os dois usam igual — fuso,
 * hora marcada, dia local, teto e tamanho de lote — para que o segundo cron não
 * seja uma cópia do primeiro que diverge no primeiro conserto.
 *
 * ⚠️ `partesNoFuso` LANÇA em fuso inexistente, de propósito. Quem chama trata:
 * uma organização com o campo digitado errado não pode derrubar a varredura das
 * outras (ver `pular("fuso_invalido")` nas rotas).
 *
 * A AUTORIZAÇÃO não mora aqui: as duas rotas usam `autorizaCron`
 * (`lib/auth/cron-auth.ts`), que já é a fonte do resto dos crons — o segredo
 * duplicado neste arquivo concordaria com ele só até a primeira mudança.
 */
import { partesNoFuso } from "@/lib/agenda/fuso";

/** Fuso de quem não declarou o seu — o mesmo padrão do resto do produto. */
export const FUSO_PADRAO = "America/Sao_Paulo";

/**
 * A hora local em que a varredura age.
 *
 * A rota é chamada de hora em hora e só trabalha na organização cujo relógio de
 * parede marca esta hora. É o que resolve, com uma regra só, o DIA certo (o dia
 * da organização, não o do servidor) e uma hora decente para mandar mensagem.
 */
export const HORA_DA_VARREDURA = 9;

/** Quantos leads/contatos uma organização rende por rodada. */
export const TETO_POR_ORGANIZACAO = 200;

/** O PostgREST monta a lista do `in` dentro da URL, e URL tem fim. */
export const TAMANHO_DO_LOTE = 100;

/** O relógio de parede da organização neste instante. */
export function relogioDaOrganizacao(agora: Date, fuso: string): ReturnType<typeof partesNoFuso> {
  return partesNoFuso(agora, fuso);
}

/** O fuso que vale para a organização: o dela, ou o padrão do produto. */
export function fusoDaOrganizacao(timezone: string | null | undefined): string {
  return timezone?.trim() || FUSO_PADRAO;
}

/** É a hora marcada no relógio da organização? */
export function eHoraDaVarredura(agora: Date, fuso: string, hora = HORA_DA_VARREDURA): boolean {
  return partesNoFuso(agora, fuso).hora === hora;
}

/** O dia do relógio de parede (`YYYY-MM-DD`) — o "hoje" que a organização vê. */
export function diaLocal(agora: Date, fuso: string): string {
  const { ano, mes, dia } = partesNoFuso(agora, fuso);
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${ano}-${dois(mes)}-${dois(dia)}`;
}
