/**
 * O RODÍZIO DISTRIBUI LEAD, NÃO SÓ CONVERSA (issue #144).
 *
 * ## O buraco que este arquivo fecha
 *
 * `fn_conversation_assign` grava `conversations.assigned_to_user_id` e não toca
 * em `crm_leads.owner_user_id` — medido: a função inteira só faz `update
 * public.conversations`. Enquanto `visibility_mode` era `all` ou
 * `own_and_unassigned`, ninguém notava, porque lead sem dono aparecia para todo
 * mundo. No modo `own` — que é exatamente o que a issue #144 pede — lead sem
 * dono não aparece para NINGUÉM: o atendente receberia a conversa e abriria um
 * funil vazio. A restrição funcionaria e a fila não existiria.
 *
 * ## Por que testar as CONDIÇÕES e não só o efeito
 *
 * As três condições do UPDATE são o que separa "distribuir" de "roubar". Um
 * teste que só conferisse "o lead ficou com dono" passaria numa implementação
 * que reatribui a carteira inteira do contato a cada mensagem nova.
 */
import { describe, expect, it } from "vitest";

import { adotarLeadsDoContato } from "@/lib/routing/worker";

interface Chamada {
  tabela: string;
  filtros: Record<string, unknown>;
  valores?: Record<string, unknown>;
}

function clientDuble(atualizadas: Array<{ id: string }>, erro: { message: string } | null = null) {
  const chamadas: Chamada[] = [];
  const client = {
    from(tabela: string) {
      const filtros: Record<string, unknown> = {};
      let valores: Record<string, unknown> | undefined;
      const cadeia: Record<string, unknown> = {
        update(v: Record<string, unknown>) {
          valores = v;
          return cadeia;
        },
        eq(col: string, val: unknown) {
          filtros[`eq:${col}`] = val;
          return cadeia;
        },
        is(col: string, val: unknown) {
          filtros[`is:${col}`] = val;
          return cadeia;
        },
        select() {
          chamadas.push({ tabela, filtros, valores });
          return Promise.resolve({ data: erro ? null : atualizadas, error: erro });
        },
      };
      return cadeia;
    },
  };
  return { client, chamadas };
}

const ORG = "11111111-1111-4111-8111-111111111111";
const CONTATO = "22222222-2222-4222-8222-222222222222";
const ATENDENTE = "33333333-3333-4333-8333-333333333333";

describe("rodízio adota o lead do contato", () => {
  it("só toca em lead aberto, do contato, e sem dono de nenhum tipo", async () => {
    const { client, chamadas } = clientDuble([{ id: "lead-1" }]);
    const n = await adotarLeadsDoContato(client as never, ORG, CONTATO, ATENDENTE);

    expect(n).toBe(1);
    const c = chamadas[0]!;
    expect(c.tabela).toBe("crm_leads");
    // Service role bypassa RLS: o filtro de org é programático, não opcional.
    expect(c.filtros["eq:organization_id"]).toBe(ORG);
    expect(c.filtros["eq:contact_id"]).toBe(CONTATO);
    // Negócio fechado não muda de dono.
    expect(c.filtros["eq:status"]).toBe("open");
    // As duas: roubar de um humano é reatribuição silenciosa; roubar do agente
    // de IA arranca o lead de quem está trabalhando nele.
    expect(
      c.filtros["is:owner_user_id"],
      "sem esta condição o rodízio reatribui a carteira do colega a cada mensagem nova",
    ).toBe(null);
    expect(
      c.filtros["is:owner_agent_id"],
      "sem esta condição o rodízio arranca o lead que a IA está tocando",
    ).toBe(null);
  });

  it("grava owner_kind junto com owner_user_id", async () => {
    // O CHECK aceita kind nulo, então dono sem kind é drift silencioso: o lead
    // teria dono e sumiria do filtro por dono e das métricas por kind.
    const { client, chamadas } = clientDuble([{ id: "lead-1" }]);
    await adotarLeadsDoContato(client as never, ORG, CONTATO, ATENDENTE);
    expect(chamadas[0]!.valores?.owner_user_id).toBe(ATENDENTE);
    expect(chamadas[0]!.valores?.owner_kind).toBe("user");
  });

  it("conversa sem contato não vira query", async () => {
    const { client, chamadas } = clientDuble([]);
    expect(await adotarLeadsDoContato(client as never, ORG, null, ATENDENTE)).toBe(0);
    expect(chamadas).toEqual([]);
  });

  it("falha do banco não derruba a atribuição, que já aconteceu", async () => {
    // A conversa JÁ tem dono quando esta função roda. Deixar a exceção subir
    // faria o evento voltar para a fila e tentar atribuir de novo — troca um
    // funil incompleto por um retry inútil.
    const { client } = clientDuble([], { message: "boom" });
    await expect(adotarLeadsDoContato(client as never, ORG, CONTATO, ATENDENTE)).resolves.toBe(0);
  });
});
