import { describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

/**
 * O BANCO ACEITA O AVISO DO CANAL MUDO — E SÓ ELE (migration 0339).
 *
 * `agent_inbox_items.kind` tem vocabulário FECHADO por CHECK, e `add constraint`
 * não soma valor: ele SUBSTITUI a constraint inteira. Quem reconstrói a lista
 * sem um valor o apaga em silêncio — sem erro de SQL, sem conflito de git — e o
 * aviso daquela feature passa a ser recusado pelo banco num caminho
 * fire-and-forget, onde ninguém vê.
 *
 * Não é hipótese: esta entrega foi escrita com o #1180 em voo, e ele reconstrói
 * exatamente esta constraint. Por isso os três casos abaixo: o valor novo é
 * ACEITO, um inventado é RECUSADO (a cerca ainda é cerca), e a lista não pode
 * ENCOLHER. O par com o TypeScript é vigiado por
 * `vocabulario-banco-x-typescript.test.ts`; aqui a régua é o banco sozinho.
 */

const KIND = "canal_mudo_sem_numero";

/** Os valores que o CHECK aceita hoje, lidos do catálogo do Postgres. */
function valoresDoCheck(): string[] {
  const bruto = sql(
    `select pg_get_constraintdef(k.oid)
       from pg_constraint k
       join pg_class c on c.oid = k.conrelid
      where k.contype = 'c'
        and c.relname = 'agent_inbox_items'
        and k.conname = 'agent_inbox_items_kind_check'`,
  );
  return [...bruto.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!).sort();
}

describe("o aviso do canal mudo cabe no vocabulário do banco", () => {
  it("o CHECK existe e não veio vazio (controle de vivacidade)", () => {
    // Sem isto, um nome de constraint errado devolveria lista vazia e os dois
    // casos abaixo passariam sobre nada.
    expect(valoresDoCheck().length).toBeGreaterThan(20);
  });

  it(`aceita '${KIND}'`, () => {
    expect(valoresDoCheck()).toContain(KIND);
  });

  it("recusa um kind inventado — a cerca continua fechada", () => {
    // Se o CHECK tivesse sido afrouxado (kind virando texto livre), o caso
    // acima passaria e esta tabela aceitaria qualquer coisa.
    expect(valoresDoCheck()).not.toContain("kind_que_nao_existe");
  });

  it("a lista não encolheu: os valores que já existiam continuam lá", () => {
    // A guarda contra o apagamento silencioso. A lista abaixo é o vocabulário
    // de 19/09/2026 — ela só pode CRESCER. Quem tirar um valor daqui está
    // apagando o aviso de alguém, e este caso é o que cobra a conversa.
    const antigos = [
      "appointment_outcome_required",
      "appointment_recovery_review",
      "budget_exceeded",
      "budget_warning",
      "capabilities_missing",
      "case_stale",
      "channel_number_alert",
      "channel_template_review",
      "conhecimento_nao_indexado",
      "contact_proposal_expired",
      "event_dead",
      "followup_dead",
      "followup_sem_agente",
      "handoff",
      "job_dead",
      "judge_unaligned",
      "message_send_stuck",
      "midia_nao_lida",
      "next_action_ambiguous",
      "other",
      "promise_unfulfilled",
      "promotion_review",
      "qr_rescan",
      "reactivation_expired",
      "risk_backlog_seeded",
      "routing_unassigned",
      "snooze_expired",
      "voice_call_missed",
    ];
    const agora = valoresDoCheck();
    expect(antigos.filter((v) => !agora.includes(v))).toEqual([]);
  });
});
