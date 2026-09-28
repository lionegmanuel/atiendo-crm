import { describe, expect, it } from "vitest";

import { agrupaTimeline, ehBlocoColapsavel } from "@/lib/leads/timeline-grouping";
import type { TimelineItemView } from "@/lib/types/contacts";

let n = 0;
function item(over: Partial<TimelineItemView> = {}): TimelineItemView {
  n += 1;
  return {
    id: `a${n}`,
    organization_id: "org",
    lead_id: "lead",
    contact_id: "contato",
    source_module: "ai",
    source_id: null,
    type: "ai_turn",
    payload: {},
    metadata: {},
    performed_at: "2026-07-25T10:00:00Z",
    performed_by_user_id: null,
    actor_kind: "ai",
    actor_agent_id: "agente-1",
    reason: null,
    evidence: null,
    ...over,
  };
}

describe("agrupamento da timeline", () => {
  it("ações seguidas do mesmo agente, no mesmo minuto, viram um bloco", () => {
    const blocos = agrupaTimeline([
      item({ performed_at: "2026-07-25T10:00:30Z" }),
      item({ performed_at: "2026-07-25T10:00:20Z" }),
      item({ performed_at: "2026-07-25T10:00:10Z" }),
    ]);
    expect(blocos).toHaveLength(1);
    expect(blocos[0]!.tipo).toBe("grupo");
    expect(ehBlocoColapsavel(blocos[0]!)).toBe(true);
  });

  it("atores diferentes NÃO se juntam, mesmo lado a lado", () => {
    const blocos = agrupaTimeline([
      item({ actor_kind: "ai" }),
      item({ actor_kind: "user", actor_agent_id: null, performed_by_user_id: "u1" }),
    ]);
    expect(blocos).toHaveLength(2);
  });

  it("DECISÃO HUMANA nunca colapsa, nem cercada por ações do mesmo ator", () => {
    // As únicas linhas que contêm DECISÃO e não relato. Escondê-las num bloco
    // desfaz o que a wave 4 pagou para construir — e o pior é que o bloco
    // ficaria com o rótulo "3 ações", contando a decisão como ação qualquer.
    const blocos = agrupaTimeline([
      item({ actor_kind: "user", performed_by_user_id: "u1", type: "lead_edited" }),
      item({ actor_kind: "user", performed_by_user_id: "u1", type: "next_action_dismissed" }),
      item({ actor_kind: "user", performed_by_user_id: "u1", type: "lead_edited" }),
    ]);
    expect(blocos).toHaveLength(3);
    expect(blocos[1]!.tipo).toBe("item");
  });

  it("O QUE CHEGOU AO VIVO fica FORA do bloco — o novo é visto, não contado", () => {
    // O cruzamento dos dois requisitos: se o evento novo caísse no bloco, a
    // timeline iria de "2 ações" para "3 ações" e ninguém veria o que chegou.
    const a = item({ performed_at: "2026-07-25T10:00:30Z" });
    const b = item({ performed_at: "2026-07-25T10:00:20Z" });
    const novo = item({ performed_at: "2026-07-25T10:00:25Z" });

    const semAoVivo = agrupaTimeline([a, novo, b]);
    expect(semAoVivo).toHaveLength(1); // todos juntos

    const comAoVivo = agrupaTimeline([a, novo, b], new Set([novo.id]));
    expect(comAoVivo).toHaveLength(3); // o novo separa o bloco em dois
    expect(comAoVivo[1]).toMatchObject({ tipo: "item", aoVivo: true });
  });

  it("distância maior que a janela quebra o bloco — pausa é informação", () => {
    const blocos = agrupaTimeline([
      item({ performed_at: "2026-07-25T12:00:00Z" }),
      item({ performed_at: "2026-07-25T10:00:00Z" }),
    ]);
    expect(blocos).toHaveLength(2);
  });

  it("um item sozinho não é apresentado como bloco", () => {
    const blocos = agrupaTimeline([item()]);
    expect(blocos).toHaveLength(1);
    expect(ehBlocoColapsavel(blocos[0]!)).toBe(false);
  });

  it("nenhum item se perde no agrupamento", () => {
    // A garantia mais chata e a que ninguém escreve: agrupar não pode COMER
    // linha. Um bug de índice aqui esconderia atividade sem nada acusar.
    const itens = [
      item({ actor_kind: "ai" }),
      item({ actor_kind: "ai" }),
      item({ actor_kind: "user", type: "next_action_approved" }),
      item({ actor_kind: "user", type: "lead_edited" }),
      item({ actor_kind: "ai", performed_at: "2026-07-25T08:00:00Z" }),
    ];
    const blocos = agrupaTimeline(itens, new Set([itens[3]!.id]));
    const total = blocos.reduce(
      (soma, b) => soma + (b.tipo === "item" ? 1 : b.itens.length),
      0,
    );
    expect(total).toBe(itens.length);
  });

  it("lista vazia não quebra", () => {
    expect(agrupaTimeline([])).toEqual([]);
  });
});

/**
 * O AGRUPAMENTO GROSSO — a timeline longa.
 *
 * O caso que decidiu o desenho não é o "muro de blocos de 2": é o lead com 26
 * itens e 26 blocos, ZERO colapsáveis. Não é parede de blocos, é AUSÊNCIA DE
 * ESTRUTURA acima da linha — e quem tratar só o primeiro deixa o segundo
 * intacto, que é o mais comum dos dois.
 */
describe("agrupaTimeline · lista longa", () => {
  const item = (i: number, dia: number, ator: string, tipo = "stage_changed"): TimelineItemView =>
    ({
      id: `i${i}`,
      type: tipo,
      // Atores DIFERENTES e horas distantes: é assim que os 26 ficavam isolados.
      actor_kind: ator,
      actor_agent_id: null,
      performed_by_user_id: ator,
      performed_at: new Date(2026, 6, dia, 9 + (i % 8), 0, 0).toISOString(),
    }) as unknown as TimelineItemView;

  it("o caso que decide: 26 itens que NÃO colapsavam viram blocos por dia", () => {
    // Cada um com ator próprio e hora própria — zero colapsáveis no fino.
    const itens = Array.from({ length: 26 }, (_, i) => item(i, 20 + (i % 3), `u${i}`));
    const blocos = agrupaTimeline(itens);
    expect(blocos.length).toBeLessThan(26);
    expect(blocos.every((b) => b.tipo === "dia")).toBe(true);
    // Nenhum item se perde no caminho.
    const dentro = blocos.reduce((n, b) => n + (b.tipo === "dia" ? b.itens.length : 1), 0);
    expect(dentro).toBe(26);
  });

  it("lista curta NÃO muda de comportamento — o gatilho é o tamanho", () => {
    const itens = Array.from({ length: 5 }, (_, i) => item(i, 20, `u${i}`));
    const blocos = agrupaTimeline(itens);
    expect(blocos.some((b) => b.tipo === "dia")).toBe(false);
  });

  it("decisão humana NUNCA entra no bloco de dia", () => {
    // Quanto mais grosso o agrupamento, mais fácil sumir com a linha que importa.
    const itens = [
      ...Array.from({ length: 20 }, (_, i) => item(i, 20, `u${i}`)),
      item(99, 20, "u99", "next_action_approved"),
      ...Array.from({ length: 10 }, (_, i) => item(30 + i, 21, `v${i}`)),
    ];
    const blocos = agrupaTimeline(itens);
    const decisao = blocos.find((b) => b.tipo === "item" && b.item.type === "next_action_approved");
    expect(decisao).toBeDefined();
    // E não pode estar DENTRO de nenhum bloco de dia.
    const escondida = blocos.some(
      (b) => b.tipo === "dia" && b.itens.some((i) => i.type === "next_action_approved"),
    );
    expect(escondida).toBe(false);
  });

  it("o que chegou AO VIVO fica fora do bloco de dia", () => {
    const itens = Array.from({ length: 20 }, (_, i) => item(i, 20, `u${i}`));
    const blocos = agrupaTimeline(itens, new Set(["i7"]));
    const solto = blocos.find((b) => b.tipo === "item" && b.item.id === "i7");
    expect(solto).toBeDefined();
    expect(solto && solto.tipo === "item" && solto.aoVivo).toBe(true);
  });

  it("o rótulo do dia é legível para quem lê, não uma chave", () => {
    const itens = Array.from({ length: 20 }, (_, i) => item(i, 20, `u${i}`));
    const dia = agrupaTimeline(itens).find((b) => b.tipo === "dia");
    expect(dia && dia.tipo === "dia" && dia.rotulo).toMatch(/jul/i);
  });
});
