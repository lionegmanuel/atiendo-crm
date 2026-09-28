/**
 * Quem pode assumir AGORA, do lado do motor — e a frase que o agente lê.
 *
 * ## O defeito que isto conserta (ACH-03)
 *
 * A capacidade `crm_list_available_attendants` existia, estava ligada e foi
 * montada no turno — e o agente escalou sem chamá-la. Medido num turno real:
 * ele abriu o chamado e disse ao cliente *"vou providenciar para que alguém da
 * equipe entre em contato"*, sem prazo e sem saber se havia alguém para receber.
 *
 * Capacidade que depende de o modelo LEMBRAR de usar é capacidade que não
 * existe metade das vezes. A doutrina do repo é explícita: não confiar na
 * disciplina do modelo para o que o sistema pode garantir. Então o próprio
 * caminho de escalação passa a consultar e a DEVOLVER a expectativa junto com a
 * confirmação — a promessa ao cliente nasce honesta sem ninguém precisar
 * lembrar de nada.
 *
 * ## Por que duplica a consulta de `atendentes.ts`
 *
 * Não duplica a REGRA: a elegibilidade é `isAttendantEligible`, a mesma função
 * pura que o worker de roteamento e a rota do painel usam. O que difere é o
 * CLIENTE — a API fala supabase-js e o motor fala `pg` (roda fora do request).
 * É o mesmo par que `emitLeadActivity` (supabase) e `emitAgentActivityForContact`
 * (pg) formam sobre `buildLeadActivityRow`: dois leitores, uma regra.
 */
import { ROLE_RANK, type Role } from "@/lib/auth/types";
import { isAttendantEligible, OPEN_LOAD_STATUSES } from "@/lib/routing/eligibility";
import { availabilityScheduleSchema } from "@/lib/schemas/routing";

import type { Queryable } from "../agent-engine/queue/queue";

export interface QuemPodeAssumir {
  /** Atendentes elegíveis AGORA: disponível ∧ com folga ∧ dentro do horário. */
  disponiveis: number;
  /** Membros agent+ da organização, configurados ou não. */
  total: number;
}

interface LinhaDeDisponibilidade {
  user_id: string;
  role: string;
  capacity: number | null;
  schedule: unknown;
  carga: string;
}

/**
 * Uma query só: roster agent+ ⟕ disponibilidade ⟕ carga (conversas abertas
 * atribuídas). A decisão de elegibilidade fica em TypeScript, na função pura
 * compartilhada — SQL que decidisse aqui seria a segunda regra.
 */
export async function quemPodeAssumirAgora(
  db: Queryable,
  tenantId: string,
  now: Date,
): Promise<QuemPodeAssumir> {
  const { rows } = await db.query<LinhaDeDisponibilidade>(
    `select uo.user_id,
            uo.role,
            aa.capacity,
            aa.schedule,
            (select count(*)
               from conversations c
              where c.organization_id = uo.organization_id
                and c.assigned_to_user_id = uo.user_id
                and c.status = any($2::text[])) as carga
       from user_organizations uo
       left join attendant_availability aa
         on aa.organization_id = uo.organization_id
        and aa.user_id = uo.user_id
        and aa.is_available
      where uo.organization_id = $1
        and uo.revoked_at is null`,
    [tenantId, OPEN_LOAD_STATUSES],
  );

  // Viewer não é insumo de roteamento — mesmo corte do roster da API.
  const atendentes = rows.filter(
    (r) => ROLE_RANK[r.role as Role] !== undefined && ROLE_RANK[r.role as Role] >= ROLE_RANK.agent,
  );

  const disponiveis = atendentes.filter((r) => {
    // capacity null = quem nunca configurou disponibilidade, ou está offline (o
    // LEFT JOIN só traz a linha quando `is_available`). O worker de roteamento
    // também não o escolhe; prometer com ele contado seria prometer o que o
    // roteamento nunca vai entregar.
    if (r.capacity === null) return false;
    return isAttendantEligible(
      {
        isAvailable: true,
        capacity: r.capacity,
        currentLoad: Number(r.carga),
        schedule: availabilityScheduleSchema.parse(r.schedule ?? {}),
      },
      now,
    );
  }).length;

  return { disponiveis, total: atendentes.length };
}

/**
 * A frase que vai para o MODELO junto com a confirmação da escalação.
 *
 * Pura e separada da leitura porque é ela que decide o que o cliente ouve — e
 * comparar frase é barato, comparar linha de banco é caro.
 *
 * Os três casos são diferentes de propósito. O terceiro é o da instalação
 * fresca: numa VPS recém-instalada NINGUÉM está em `attendant_availability`, e
 * sem esta frase o agente prometeria contato para o vazio na primeira conversa
 * do cliente — a pior primeira impressão possível num produto self-host.
 */
export function fraseDeExpectativa(q: QuemPodeAssumir): string {
  if (q.total === 0) {
    return (
      "ATENÇÃO: esta conta ainda não tem ninguém configurado para receber atendimento. " +
      "NÃO prometa que alguém entra em contato — diga que o pedido ficou registrado e que " +
      "a equipe responde assim que possível."
    );
  }
  if (q.disponiveis === 0) {
    return (
      "ATENÇÃO: não há ninguém da equipe disponível neste momento. NÃO prometa contato " +
      "imediato nem dê prazo curto — diga que o pedido ficou registrado e que a equipe " +
      "retorna assim que possível."
    );
  }
  const pessoas = q.disponiveis === 1 ? "1 pessoa" : `${q.disponiveis} pessoas`;
  return `Há ${pessoas} da equipe podendo assumir agora — pode dizer ao cliente que alguém continua o atendimento em seguida.`;
}

/**
 * Leitura + frase, com rede de segurança.
 *
 * Falha de leitura NÃO pode derrubar a escalação (o cliente está esperando), e
 * também não pode virar silêncio otimista: sem o dado, o agente recebe a
 * instrução conservadora — não prometer prazo. Errar para o lado de prometer
 * menos é recuperável; prometer o que não se cumpre, não.
 */
export async function expectativaDeAtendimento(
  db: Queryable,
  tenantId: string,
  now: Date,
): Promise<{ quem: QuemPodeAssumir | null; frase: string }> {
  try {
    const quem = await quemPodeAssumirAgora(db, tenantId, now);
    return { quem, frase: fraseDeExpectativa(quem) };
  } catch {
    return {
      quem: null,
      frase:
        "Não foi possível confirmar quem está disponível agora. NÃO prometa contato imediato " +
        "nem dê prazo — diga que o pedido ficou registrado.",
    };
  }
}
