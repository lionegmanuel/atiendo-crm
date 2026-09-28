/**
 * UM AVISO DE ENVIO FALHO NÃO PODE VIRAR DUZENTOS.
 *
 * A causa típica de falha de envio não é uma mensagem: é o transporte inteiro
 * fora do ar. Nesse estado toda automação que disparar falha — e um formulário
 * de campanha entrega leads em rajada. Sem dedupe, 200 leads em minutos viram
 * 200 avisos críticos idênticos na Central, que deixa de ser lida exatamente no
 * dia em que mais precisa ser.
 *
 * A regra não é invenção deste arquivo: é a que o cron irmão
 * (`recover-stuck-messages`) já aplica em prosa — "um aviso por organização por
 * rodada, não um por mensagem". `avisarEnvioQueFalhou` nasceu sem ela.
 */
import { describe, it, expect, vi } from "vitest";

import { avisarEnvioQueFalhou } from "@/lib/automation/desfecho-do-envio";

const ORG = "11111111-1111-4111-8111-111111111111";
const ENTRADA = { organizationId: ORG, ruleName: "Boas-vindas do formulário", motivo: "O WhatsApp não respondeu." };

/**
 * Duplo do client. `existentes` é o que a BUSCA por avisos abertos devolve;
 * `inseridos` acumula o que a função tentou gravar.
 */
function admin(existentes: unknown[], erroDaBusca: { message: string } | null = null) {
  const inseridos: Record<string, unknown>[] = [];
  const filtros: Record<string, unknown> = {};
  const busca = {
    select: () => busca,
    eq: (col: string, val: unknown) => { filtros[col] = val; return busca; },
    gte: (col: string, val: unknown) => { filtros[col] = val; return busca; },
    limit: async () => ({ data: erroDaBusca ? null : existentes, error: erroDaBusca }),
  };
  const client = {
    from: () => ({
      ...busca,
      insert: async (linha: Record<string, unknown>) => { inseridos.push(linha); return { error: null }; },
    }),
  };
  return { client: client as never, inseridos, filtros };
}

describe("a rajada não enterra a Central", () => {
  it("com um aviso ABERTO recente, o segundo envio falho NÃO abre outro", async () => {
    const { client, inseridos } = admin([{ id: "aviso-que-ja-existe" }]);
    await avisarEnvioQueFalhou(client, ENTRADA);
    expect(inseridos).toHaveLength(0);
  });

  it("sem aviso recente, avisa", async () => {
    const { client, inseridos } = admin([]);
    await avisarEnvioQueFalhou(client, ENTRADA);
    expect(inseridos).toHaveLength(1);
    expect(inseridos[0]?.kind).toBe("message_send_stuck");
    expect(inseridos[0]?.severity).toBe("critical");
    // O nome da regra é o que o operador precisa para saber ONDE mexer.
    expect(String(inseridos[0]?.body)).toContain("Boas-vindas do formulário");
  });

  it("a busca é pelos ABERTOS da MESMA org, dentro da janela — não por qualquer aviso", async () => {
    const AGORA = new Date("2026-08-25T12:00:00Z");
    const { client, filtros } = admin([]);
    await avisarEnvioQueFalhou(client, ENTRADA, AGORA);

    expect(filtros.organization_id).toBe(ORG);
    expect(filtros.kind).toBe("message_send_stuck");
    // Sem este filtro, um aviso que o operador JÁ resolveu calaria os próximos:
    // ele tratou, o problema voltou, e ele não seria informado.
    expect(filtros.status).toBe("open");
    // 15 minutos antes de `agora`. Cravado de propósito: encurtar a janela em
    // silêncio traz a rajada de volta, e alargá-la esconde falha nova.
    expect(filtros.created_at).toBe("2026-08-25T11:45:00.000Z");
  });
});

describe("falhar ABERTO: quando a checagem quebra, o aviso sai", () => {
  it("erro ao buscar avisos repetidos não engole o aviso", async () => {
    const aviso = vi.spyOn(await import("@/lib/logger").then((m) => m.logger), "warn")
      .mockImplementation(() => {});
    const { client, inseridos } = admin([], { message: "connection reset" });

    await avisarEnvioQueFalhou(client, ENTRADA);

    // Entre repetir um aviso e engolir o ÚNICO sinal de que o cliente não
    // recebeu a mensagem, repetir é o erro barato. A direção importa: uma
    // checagem de ruído nunca pode calar o sinal que ela existe para organizar.
    expect(inseridos).toHaveLength(1);
    expect(aviso).toHaveBeenCalledOnce();
    aviso.mockRestore();
  });
});
