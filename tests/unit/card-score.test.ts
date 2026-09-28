import { describe, expect, it } from "vitest";

import { buildCardInput, resolveCardState } from "@/lib/kanban/card-state";
import type { Lead } from "@/lib/types/leads";

function lead(over: Partial<Lead> = {}): Lead {
  return {
    id: "l1",
    organization_id: "org",
    pipeline_id: "p1",
    stage_id: "s1",
    contact_id: "c1",
    title: "Lead de prova",
    description: null,
    value_cents: null,
    currency: "BRL",
    status: "open",
    lost_reason: null,
    position_in_stage: 1,
    owner_kind: "user",
    owner_user_id: "u1",
    owner_agent_id: null,
    assigned_at: null,
    last_activity_at: "2026-07-25T10:00:00Z",
    created_at: "2026-07-20T10:00:00Z",
    updated_at: "2026-07-25T10:00:00Z",
    tags: [],
    custom_fields: {},
    ...over,
  } as Lead;
}

const opts = { stageName: "Proposta", ownerNames: new Map<string, string | null>() };

describe("o score no card", () => {
  it("score 0 RENDERIZA zero — não vira ausência", () => {
    // `probability || …` é o erro de uma linha que some com o zero legítimo.
    // Zero é "calculei e deu zero", e é uma informação forte: some da tela
    // justamente o lead que a conta diz que não fecha.
    const card = buildCardInput(
      lead({
        score: { probability: 0, reason: "−24 3 objeções em aberto, limitado a 0", band: "frio", factors: [], at: null },
      }),
      opts,
    );
    const estado = resolveCardState(card);
    expect(estado.slot.type).toBe("meter");
    if (estado.slot.type !== "meter") return;
    expect(estado.slot.probability).toBe(0);
  });

  it("score AUSENTE não vira zero na tela", () => {
    // `probability ?? 0` é o outro erro de uma linha — e este INVENTA score
    // onde não há, que é exatamente o que o cenário 17 proíbe.
    const card = buildCardInput(lead({ score: null }), opts);
    const estado = resolveCardState(card);
    expect(estado.slot.type).toBe("idle");
    expect(card.probability).toBeNull();
  });

  it("A UI MOSTRA A FAIXA PERSISTIDA, não a que a régua crua daria", () => {
    // Prova DISCRIMINANTE, não promessa: 67 pela régua crua seria "morno"
    // (limiar de quente é 70), mas a faixa gravada é "quente" — legítima, é a
    // histerese segurando enquanto o lead desce, e o CHECK do banco aceita
    // (piso de quente = 65).
    //
    // Se a UI derivasse a faixa do número, este teste ficaria vermelho. Como
    // ela lê a coluna, fica verde. Sem este caso, "a UI lê a coluna" seria
    // afirmação sobre código, não sobre comportamento.
    const card = buildCardInput(
      lead({
        score: { probability: 67, reason: "…", band: "quente", factors: [], at: null },
      }),
      opts,
    );
    const estado = resolveCardState(card);
    if (estado.slot.type !== "meter") throw new Error("esperava medidor");
    expect(estado.slot.band).toBe("quente");
  });

  it("mostra ATÉ três evidências, e não preenche o que falta", () => {
    // Teto, não cota: cota se preenche, e lastro inventado passa na constraint.
    const quatro = [1, 2, 3, 4].map((n) => ({ pontos: n, frase: `fator ${n}` }));
    const card = buildCardInput(
      lead({ score: { probability: 70, reason: "…", band: "quente", factors: quatro, at: null } }),
      opts,
    );
    const estado = resolveCardState(card);
    if (estado.slot.type !== "meter") throw new Error("esperava medidor");
    expect(estado.slot.factors).toHaveLength(3);

    const uma = buildCardInput(
      lead({
        score: {
          probability: 70,
          reason: "…",
          band: "quente",
          factors: [{ pontos: 12, frase: "um compromisso" }],
          at: null,
        },
      }),
      opts,
    );
    const estadoUma = resolveCardState(uma);
    if (estadoUma.slot.type !== "meter") throw new Error("esperava medidor");
    expect(estadoUma.slot.factors).toHaveLength(1); // não completou até 3
  });

  it("PRECEDÊNCIA: com proposta pendente, o score NÃO aparece — e isso é acerto", () => {
    // A armadilha que reprova por funcionamento correto: quem vir "card sem
    // medidor" vai caçar bug no score, e o slot está ocupado como projetado.
    const card = buildCardInput(
      lead({
        next_action: { label: "ligar amanhã", seq: 1, proposed_at: "2026-07-25T10:00:00Z" },
        score: { probability: 80, reason: "…", band: "quente", factors: [], at: null },
      }),
      opts,
    );
    const estado = resolveCardState(card);
    expect(estado.slot.type).toBe("awaiting");
  });

  it("faixa ausente com número presente não renderiza medidor pela metade", () => {
    // Estado impossível pelo banco (o CHECK amarra os dois), mas possível por
    // um bug de leitura. Melhor cair no estado normal que desenhar meio widget.
    const card = buildCardInput(lead({ score: null }), opts);
    const estado = resolveCardState({ ...card, probability: 70, band: null });
    expect(estado.slot.type).toBe("idle");
  });
});
