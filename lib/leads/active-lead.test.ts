/**
 * §3.2 — o ponteiro entre o estado cognitivo do agente (por CONTATO) e o
 * negócio do CRM (N por contato).
 *
 * A assimetria destes testes é proposital: há mais casos provando que a função
 * SE RECUSA a escolher do que provando que ela escolhe. Não-roteado é barulho
 * no log; roteado errado move o card do cliente errado.
 */
import { describe, it, expect } from "vitest";

import { resolveActiveLeadForContact, type LeadCandidate } from "./active-lead";

const DEFAULT_PIPE = "pipe-default";
const OUTRO_PIPE = "pipe-outro";

const ORG = "org-a";

const lead = (over: Partial<LeadCandidate> & { id: string }): LeadCandidate => ({
  organization_id: ORG,
  pipeline_id: DEFAULT_PIPE,
  status: "open",
  last_activity_at: "2026-07-20T10:00:00.000Z",
  created_at: "2026-07-01T10:00:00.000Z",
  ...over,
});

describe("resolveActiveLeadForContact — quando roteia", () => {
  it("um único negócio aberto: rota óbvia", () => {
    expect(resolveActiveLeadForContact([lead({ id: "l-1" })], { defaultPipelineId: DEFAULT_PIPE }))
      .toEqual({ routed: true, leadId: "l-1" });
  });

  it("único aberto FORA do pipeline default ainda roteia (quem usa um pipeline só)", () => {
    expect(
      resolveActiveLeadForContact([lead({ id: "l-1", pipeline_id: OUTRO_PIPE })], {
        defaultPipelineId: DEFAULT_PIPE,
      }),
    ).toEqual({ routed: true, leadId: "l-1" });
  });

  it("entre abertos, vence o mais recentemente ativo", () => {
    const r = resolveActiveLeadForContact(
      [
        lead({ id: "velho", last_activity_at: "2026-07-01T10:00:00.000Z" }),
        lead({ id: "novo", last_activity_at: "2026-07-23T10:00:00.000Z" }),
      ],
      { defaultPipelineId: DEFAULT_PIPE },
    );
    expect(r).toEqual({ routed: true, leadId: "novo" });
  });

  it("o pipeline default tem preferência sobre um lead mais recente fora dele", () => {
    const r = resolveActiveLeadForContact(
      [
        lead({ id: "default-antigo", last_activity_at: "2026-07-10T10:00:00.000Z" }),
        lead({ id: "fora-recente", pipeline_id: OUTRO_PIPE, last_activity_at: "2026-07-24T10:00:00.000Z" }),
      ],
      { defaultPipelineId: DEFAULT_PIPE },
    );
    expect(r).toEqual({ routed: true, leadId: "default-antigo" });
  });

  it("negócio sem atividade cai para a data de criação", () => {
    const r = resolveActiveLeadForContact(
      [
        lead({ id: "sem-atividade", last_activity_at: null, created_at: "2026-07-24T10:00:00.000Z" }),
        lead({ id: "com-atividade", last_activity_at: "2026-07-02T10:00:00.000Z" }),
      ],
      { defaultPipelineId: DEFAULT_PIPE },
    );
    expect(r).toEqual({ routed: true, leadId: "sem-atividade" });
  });

  it("fechados não contam — o negócio ganho/perdido saiu de jogo", () => {
    const r = resolveActiveLeadForContact(
      [
        lead({ id: "ganho", status: "won", last_activity_at: "2026-07-24T10:00:00.000Z" }),
        lead({ id: "aberto", last_activity_at: "2026-07-02T10:00:00.000Z" }),
      ],
      { defaultPipelineId: DEFAULT_PIPE },
    );
    expect(r).toEqual({ routed: true, leadId: "aberto" });
  });

  it("recalcula sozinho quando o alvo fecha: some do resultado sem estado guardado", () => {
    const antes = [lead({ id: "l-1", last_activity_at: "2026-07-24T10:00:00.000Z" }), lead({ id: "l-2" })];
    expect(resolveActiveLeadForContact(antes, { defaultPipelineId: DEFAULT_PIPE }))
      .toEqual({ routed: true, leadId: "l-1" });

    const depois = antes.map((l) => (l.id === "l-1" ? { ...l, status: "won" as const } : l));
    expect(resolveActiveLeadForContact(depois, { defaultPipelineId: DEFAULT_PIPE }))
      .toEqual({ routed: true, leadId: "l-2" });
  });
});

describe("resolveActiveLeadForContact — quando SE RECUSA a escolher", () => {
  it("nenhum negócio aberto: no_open_lead (a atividade vai para o event_log)", () => {
    expect(
      resolveActiveLeadForContact([lead({ id: "l-1", status: "lost" })], {
        defaultPipelineId: DEFAULT_PIPE,
      }),
    ).toEqual({ routed: false, reason: "no_open_lead", candidateIds: [] });
  });

  it("contato sem negócio nenhum: no_open_lead", () => {
    expect(resolveActiveLeadForContact([])).toEqual({
      routed: false,
      reason: "no_open_lead",
      candidateIds: [],
    });
  });

  it("empate no instante da última atividade: NÃO chuta", () => {
    const r = resolveActiveLeadForContact(
      [
        lead({ id: "a", last_activity_at: "2026-07-24T10:00:00.000Z" }),
        lead({ id: "b", last_activity_at: "2026-07-24T10:00:00.000Z" }),
      ],
      { defaultPipelineId: DEFAULT_PIPE },
    );
    expect(r).toEqual({
      routed: false,
      reason: "ambiguous_open_leads",
      candidateIds: ["a", "b"],
    });
  });

  it("empate em pipelines diferentes, sem default configurado: NÃO chuta", () => {
    const r = resolveActiveLeadForContact([
      lead({ id: "a", pipeline_id: DEFAULT_PIPE, last_activity_at: "2026-07-24T10:00:00.000Z" }),
      lead({ id: "b", pipeline_id: OUTRO_PIPE, last_activity_at: "2026-07-24T10:00:00.000Z" }),
    ]);
    expect(r.routed).toBe(false);
    if (r.routed) return;
    expect(r.reason).toBe("ambiguous_open_leads");
    expect(r.candidateIds.sort()).toEqual(["a", "b"]);
  });

  it("o desempate só olha o topo: um terceiro atrasado não vira ambiguidade", () => {
    const r = resolveActiveLeadForContact(
      [
        lead({ id: "a", last_activity_at: "2026-07-24T10:00:00.000Z" }),
        lead({ id: "b", last_activity_at: "2026-07-24T10:00:00.000Z" }),
        lead({ id: "c", last_activity_at: "2026-07-01T10:00:00.000Z" }),
      ],
      { defaultPipelineId: DEFAULT_PIPE },
    );
    expect(r).toEqual({
      routed: false,
      reason: "ambiguous_open_leads",
      candidateIds: ["a", "b"],
    });
  });

  it("data corrompida não vira rota silenciosa para o lead errado", () => {
    const r = resolveActiveLeadForContact(
      [
        lead({ id: "quebrado", last_activity_at: "não é data" }),
        lead({ id: "tambem-quebrado", last_activity_at: "tampouco" }),
      ],
      { defaultPipelineId: DEFAULT_PIPE },
    );
    // Ambos caem para 0 e empatam — recusa, em vez de escolher por ordem do array.
    expect(r.routed).toBe(false);
  });
});

describe("resolveActiveLeadForContact — tenancy", () => {
  // A função é pura e não consulta o banco: ela não tem como VERIFICAR tenancy,
  // então o tipo obriga e a lista mistura é recusada. Uma lista de duas orgs
  // rotearia a atividade de um tenant para o negócio de outro, e o vazamento
  // pareceria decisão correta — a função "decidiu certo" com o que recebeu.
  it("recusa candidatos de organizações diferentes — estoura, não roteia", () => {
    expect(() =>
      resolveActiveLeadForContact(
        [
          lead({ id: "l-a", organization_id: "org-a" }),
          lead({ id: "l-b", organization_id: "org-b" }),
        ],
        { defaultPipelineId: DEFAULT_PIPE },
      ),
    ).toThrow(/organizações diferentes/);
  });

  // Estourar é para BUG DE CHAMADOR. Ambiguidade de negócio dentro da mesma org
  // continua sendo `routed: false` — a distinção importa: uma vira exceção no
  // desenvolvimento, a outra vira linha no event_log em produção.
  it("mesma org com ambiguidade real continua devolvendo routed:false, sem estourar", () => {
    const r = resolveActiveLeadForContact(
      [
        lead({ id: "l-1", last_activity_at: "2026-07-20T10:00:00.000Z" }),
        lead({ id: "l-2", last_activity_at: "2026-07-20T10:00:00.000Z" }),
      ],
      { defaultPipelineId: DEFAULT_PIPE },
    );
    expect(r.routed).toBe(false);
  });

  it("uma org só não estoura", () => {
    expect(() =>
      resolveActiveLeadForContact([lead({ id: "l-1" }), lead({ id: "l-2" })], {
        defaultPipelineId: DEFAULT_PIPE,
      }),
    ).not.toThrow();
  });
});
