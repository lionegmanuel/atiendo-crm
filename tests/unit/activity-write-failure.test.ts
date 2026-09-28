import { describe, expect, it, vi } from "vitest";

import { registraFalhaDeAtividade } from "@/lib/leads/activity-write-failure";

/**
 * Falhar baixo é escolher NÃO BLOQUEAR — não é escolher NÃO CONTAR.
 *
 * O DoD afirma "100% das mutações de lead geram crm_lead_activities". Três
 * caminhos engoliam a falha em `console.error`, e log de servidor sem destino
 * não vira alerta de ninguém: a garantia podia ser silenciosamente menos que
 * 100% sem nada indicar. Estes testes provam que a perda é CONTADA.
 */
function supabaseFalso(rpcErro: { message: string } | null = null) {
  const chamadas: Array<{ nome: string; args: Record<string, unknown> }> = [];
  return {
    chamadas,
    client: {
      rpc: async (nome: string, args: Record<string, unknown>) => {
        chamadas.push({ nome, args });
        return { error: rpcErro };
      },
    },
  };
}

const FALHA = {
  organizationId: "org-1",
  leadId: "lead-1",
  tipo: "stage_changed",
  origem: "leads/bulk",
  erro: "23514 violates check constraint",
  requestId: "req-1",
};

describe("o rastro perdido é contado, não engolido", () => {
  it("a perda vira evento em event_log, com o que se perdeu e onde", () => {
    return (async () => {
      const { client, chamadas } = supabaseFalso();
      await registraFalhaDeAtividade(client as never, FALHA);

      expect(chamadas).toHaveLength(1);
      expect(chamadas[0]!.nome).toBe("emit_event");
      const args = chamadas[0]!.args;
      expect(args.p_event_type).toBe("crm.activity_write_failed");
      expect(args.p_entity_id).toBe("lead-1");
      expect(args.p_organization_id).toBe("org-1");

      // O QUE se perdeu e ONDE: sem os dois, o alerta diz que houve um buraco
      // mas não diz de que tamanho nem em qual caminho.
      const payload = args.p_payload as Record<string, unknown>;
      expect(payload.activity_type).toBe("stage_changed");
      expect(payload.origem).toBe("leads/bulk");
      expect(payload.erro).toContain("23514");
    })();
  });

  it("erro ausente vira null explícito, não some do payload", async () => {
    // `undefined` desaparece no JSON e o alerta chegaria sem o campo, como se
    // ninguém tivesse tentado descobrir a causa.
    const { client, chamadas } = supabaseFalso();
    await registraFalhaDeAtividade(client as never, { ...FALHA, erro: undefined });
    const payload = chamadas[0]!.args.p_payload as Record<string, unknown>;
    expect(payload).toHaveProperty("erro");
    expect(payload.erro).toBeNull();
  });

  it("se ATÉ o aviso falhar, sobra o log do processo — segunda linha, não política", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = supabaseFalso({ message: "event_log fora do ar" });
    await registraFalhaDeAtividade(client as never, FALHA);
    expect(spy).toHaveBeenCalledOnce();
    const [msg, detalhe] = spy.mock.calls[0]!;
    expect(msg).toContain("perdi o rastro E o aviso");
    expect(detalhe).toMatchObject({ lead: "lead-1", tipo: "stage_changed" });
    spy.mockRestore();
  });

  it("NÃO lança: a mutação principal já ocorreu e não pode ser desfeita pelo aviso", async () => {
    const { client } = supabaseFalso({ message: "qualquer coisa" });
    await expect(registraFalhaDeAtividade(client as never, FALHA)).resolves.toBeUndefined();
  });
});
