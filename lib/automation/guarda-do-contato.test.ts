import { describe, expect, it } from "vitest";
import { checarGuardasDeContato } from "@/lib/automation/guarda-do-contato";
import type { ActionCtx } from "@/lib/automation/types";

/**
 * Testes puros (sem DB) do módulo compartilhado por send_whatsapp_message e
 * send_ai_message. A prova de integração via banco real fica em
 * tests/invariants/automation-send-whatsapp.test.ts (casos 6/7/8) — aqui é só
 * a lógica de decisão, isolada.
 */
function ctxComContato(contact: unknown): ActionCtx {
  return {
    admin: {} as ActionCtx["admin"],
    organizationId: "org-1",
    ruleId: "rule-1",
    ruleName: "regra de teste",
    event: {} as ActionCtx["event"],
    context: { contact },
    requestId: "req-1",
  };
}

describe("checarGuardasDeContato", () => {
  it("sem contato no contexto: no_contact", () => {
    const r = checarGuardasDeContato(ctxComContato(undefined));
    expect(r).toEqual({ ok: false, reason: "no_contact" });
  });

  it("contato bloqueado: contact_blocked", () => {
    const r = checarGuardasDeContato(
      ctxComContato({ id: "c1", is_blocked: true, phone_number: "+5511999999999" }),
    );
    expect(r).toEqual({ ok: false, reason: "contact_blocked" });
  });

  it("sem telefone: no_phone", () => {
    const r = checarGuardasDeContato(ctxComContato({ id: "c1", phone_number: null }));
    expect(r).toEqual({ ok: false, reason: "no_phone" });
  });

  /**
   * ⚠️ OS TRÊS CASOS ABAIXO SÃO O CONTRÁRIO DO QUE A PRIMEIRA VERSÃO AFIRMAVA,
   * e a razão está medida no cabeçalho de `guarda-do-contato.ts`: o DEFAULT da
   * coluna `contacts.consent` já é `{marketing: {granted_at: null, …}}`, então
   * "grant ausente" é o estado de NASCIMENTO de todo contato do produto — não
   * um sinal de recusa. Bloquear por ele desligaria a automação de WhatsApp de
   * toda instalação que não usa o formulário do Respondi, sem tela para
   * conceder consentimento em lugar nenhum.
   */
  it("sem objeto consent: PASSA — é o contato que nasceu pelo default, não uma recusa", () => {
    const r = checarGuardasDeContato(
      ctxComContato({ id: "c1", phone_number: "+5511999999999" }),
    );
    expect(r).toEqual({ ok: true, contact: { id: "c1", phone_number: "+5511999999999" } });
  });

  it("consent.marketing ausente: PASSA", () => {
    const r = checarGuardasDeContato(
      ctxComContato({ id: "c1", phone_number: "+5511999999999", consent: {} }),
    );
    expect(r).toEqual({ ok: true, contact: { id: "c1", phone_number: "+5511999999999" } });
  });

  it("granted_at null SEM declined_at: PASSA — é exatamente o default da coluna", () => {
    const r = checarGuardasDeContato(
      ctxComContato({
        id: "c1",
        phone_number: "+5511999999999",
        consent: { marketing: { granted_at: null, source: null, version: null } },
      }),
    );
    expect(r).toEqual({ ok: true, contact: { id: "c1", phone_number: "+5511999999999" } });
  });

  it("declined_at gravado: consent_declined — a pessoa respondeu NÃO", () => {
    const r = checarGuardasDeContato(
      ctxComContato({
        id: "c1",
        phone_number: "+5511999999999",
        consent: { marketing: { granted_at: null, declined_at: "2026-08-26T12:00:00Z" } },
      }),
    );
    expect(r).toEqual({ ok: false, reason: "consent_declined" });
  });

  it("recusa vence sobre concessão antiga: declined_at bloqueia mesmo com granted_at preenchido", () => {
    // A pessoa concedeu num envio e recusou no seguinte. A ingestão reescreve o
    // objeto inteiro, mas se um clone tiver as duas chaves, quem manda é o NÃO.
    const r = checarGuardasDeContato(
      ctxComContato({
        id: "c1",
        phone_number: "+5511999999999",
        consent: {
          marketing: { granted_at: "2026-01-01T00:00:00Z", declined_at: "2026-08-26T12:00:00Z" },
        },
      }),
    );
    expect(r).toEqual({ ok: false, reason: "consent_declined" });
  });

  it("consentimento concedido, tudo em ordem: ok, contato estreito devolvido", () => {
    const r = checarGuardasDeContato(
      ctxComContato({
        id: "c1",
        is_blocked: false,
        phone_number: "+5511999999999",
        consent: { marketing: { granted_at: "2026-08-25T00:00:00Z" } },
        // campo extra do contato que a guarda NÃO deve vazar no resultado
        cpf_hash: "segredo",
      }),
    );
    expect(r).toEqual({ ok: true, contact: { id: "c1", phone_number: "+5511999999999" } });
  });

  it("ordem das guardas: contato ausente vence sobre qualquer outro motivo", () => {
    // Não há como forjar um "contato bloqueado E ausente" — este teste apenas
    // documenta que a checagem de existência é a primeira.
    const r = checarGuardasDeContato(ctxComContato(null));
    expect(r).toEqual({ ok: false, reason: "no_contact" });
  });

  /**
   * Regressão pedida pelo dono do produto (simplificação do fluxo Respondi,
   * 2026-08-26): a classificação inicial (`lib/leads/classificacao-inicial.ts`
   * — score A/B/C/D, "desqualificado", "revisao_humana") NÃO É UMA GUARDA DE
   * ENVIO. Quem decide se `send_whatsapp_message`/`send_ai_message` disparam é
   * só telefone + consentimento, e este teste prova isso no nível estrutural:
   * mesmo com um lead marcado "desqualificado" classe D no MESMO contexto que
   * a ação recebe, a guarda passa — porque `checarGuardasDeContato` só lê
   * `ctx.context.contact`, nunca `ctx.context.lead`. Sabotado (fazendo a
   * função também olhar `ctx.context.lead.custom_fields`) este teste reprova.
   */
  it("lead classificado como 'desqualificado'/classe D no mesmo contexto NÃO bloqueia — a guarda só lê ctx.context.contact, nunca ctx.context.lead", () => {
    const ctx: ActionCtx = {
      admin: {} as ActionCtx["admin"],
      organizationId: "org-1",
      ruleId: "rule-1",
      ruleName: "regra de teste",
      event: {} as ActionCtx["event"],
      requestId: "req-1",
      context: {
        contact: {
          id: "c1",
          phone_number: "+5511999999999",
          consent: { marketing: { granted_at: "2026-08-25T00:00:00Z" } },
        },
        lead: {
          id: "lead-1",
          custom_fields: {
            classificacao_inicial_status: "desqualificado",
            classificacao_inicial_motivo: "sem_consentimento",
            classificacao_inicial_classe: "D",
          },
        },
      },
    };
    const r = checarGuardasDeContato(ctx);
    expect(r).toEqual({ ok: true, contact: { id: "c1", phone_number: "+5511999999999" } });
  });
});
