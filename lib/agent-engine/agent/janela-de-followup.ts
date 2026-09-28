import type { Queryable } from "../queue/queue";
import {
  lerJanelaDeAtendimento,
  msAteAJanelaAbrir,
  type JanelaDeAtendimento,
} from "./janela-de-atendimento";

/**
 * Faixa PRÓPRIA do follow-up proativo. O fuso não mora aqui: ele é sempre o da
 * organização, para não nascer um terceiro relógio ao lado do atendimento e do
 * pacing do canal.
 */
export interface JanelaDeFollowup {
  start: string;
  end: string;
  weekdays: number[];
}

interface FollowupComJanela {
  send_window?: unknown;
}

/**
 * Lê a configuração versionada do agente e a converte para a mesma régua de
 * calendário já usada pelo inbound. `null` = sem janela própria (comportamento
 * antigo) ou shape legado/inválido.
 */
export function lerJanelaDeFollowup(
  followup: unknown,
  timezone: string,
): JanelaDeAtendimento | null {
  if (typeof followup !== "object" || followup === null) return null;
  const janela = (followup as FollowupComJanela).send_window;
  if (typeof janela !== "object" || janela === null) return null;

  const { start, end, weekdays } = janela as {
    start?: unknown;
    end?: unknown;
    weekdays?: unknown;
  };

  // `lerJanelaDeAtendimento` é a fonte única para HH:MM, dias, fuso e a regra
  // de não aceitar janela que cruza meia-noite. Não duplicar essa matemática é
  // o que mantém inbound e follow-up concordando sobre "aberto" sem compartilhar
  // a CONFIGURAÇÃO entre os dois.
  return lerJanelaDeAtendimento({
    filters: {
      business_hours: { timezone, start, end, weekdays },
    },
  });
}

/**
 * `null` = pode enviar agora. Date = instante da próxima abertura.
 */
export function proximaAberturaDoFollowup(
  followup: unknown,
  timezone: string,
  agora: Date,
): Date | null {
  const janela = lerJanelaDeFollowup(followup, timezone);
  if (janela === null) return null;
  const espera = msAteAJanelaAbrir(janela, agora);
  return espera === null ? null : new Date(agora.getTime() + espera);
}

/**
 * A janela pertence ao AGENTE pinado no enrollment, mas a configuração que vale
 * é a versão PUBLICADA atual dele. Assim mudar a faixa e publicar passa a valer
 * para os próximos envios sem reescrever enrollments em voo.
 *
 * Sem agent/version (dado legado) => `null`, preservando o comportamento antigo.
 * Erro de banco SOBE: follow-up é contato proativo; se não conseguimos descobrir
 * se o operador autorizou este horário, é mais seguro tentar de novo do que mandar
 * uma mensagem fora da faixa escolhida.
 */
export async function followupPublicadoDoEnrollment(
  db: Queryable,
  organizationId: string,
  enrollmentId: string,
): Promise<unknown | null> {
  const { rows } = await db.query<{ followup: unknown | null }>(
    `select v.followup
       from followup_enrollments e
       left join ai_agents a
         on a.organization_id = e.organization_id
        and a.id = e.agent_id
       left join ai_agent_versions v
         on v.organization_id = e.organization_id
        and v.id = a.published_version_id
      where e.organization_id = $1
        and e.id = $2
      limit 1`,
    [organizationId, enrollmentId],
  );
  return rows[0]?.followup ?? null;
}
