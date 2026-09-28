import { describe, expect, it } from "vitest";

import {
  inicioDoPeriodo,
  lerDiagnosticoGoogle,
  lerFiltros,
  lerHistorico,
  rotuloDoEvento,
  situacaoDaLinha,
} from "@/lib/conversoes/historico";

const ETAPA = "11111111-1111-4111-8111-111111111111";

/** Grava cada chamada da cadeia do PostgREST, e responde por tabela. */
function adminGravador(respostas: Record<string, unknown>) {
  const chamadas: Array<{ tabela: string; metodo: string; args: unknown[] }> = [];
  return {
    chamadas,
    admin: {
      from(tabela: string) {
        const q: Record<string, unknown> = {};
        const registrar =
          (metodo: string) =>
          (...args: unknown[]) => {
            chamadas.push({ tabela, metodo, args });
            return q;
          };
        for (const m of ["select", "eq", "gte", "in", "not", "ilike", "order", "range", "limit"])
          q[m] = registrar(m);
        const resposta = respostas[tabela] ?? { data: [], error: null, count: 0 };
        q.maybeSingle = async () => resposta;
        q.then = (ok: (v: unknown) => unknown) => Promise.resolve(resposta).then(ok);
        return q;
      },
    },
  };
}

describe("filtros do histórico vindos da URL", () => {
  it("valor desconhecido cai no padrão e a busca perde o que não é texto", () => {
    expect(
      lerFiltros({
        periodo: "ano",
        situacao: "tudo",
        evento: "DROP TABLE",
        plataforma: "tiktok",
        busca: "Maria%'); --",
        pagina: "-3",
      }),
    ).toEqual({
      periodo: "30d",
      situacao: "todas",
      evento: "",
      plataforma: "",
      busca: "Maria --",
      pagina: 1,
    });
  });
  it("aceita os eventos do livro-razão", () => {
    expect(lerFiltros({ evento: `Etapa:${ETAPA}` }).evento).toBe(`Etapa:${ETAPA}`);
    expect(lerFiltros({ evento: "QualifiedLead" }).evento).toBe("QualifiedLead");
  });
});

describe("situação de uma linha", () => {
  it("separa o que espera a plataforma do que espera a pessoa", () => {
    expect(situacaoDaLinha("sent", null)).toBe("entregue");
    expect(situacaoDaLinha("error", "recusado_pela_plataforma")).toBe("falha");
    expect(situacaoDaLinha("skipped", "aguardando_processamento")).toBe("aguardando");
    expect(situacaoDaLinha("skipped", "sem_valor")).toBe("nao_enviado");
  });
  it("período relativo ao agora", () => {
    const agora = new Date("2026-09-27T12:00:00Z");
    expect(inicioDoPeriodo("24h", agora)).toBe("2026-09-26T12:00:00.000Z");
    expect(inicioDoPeriodo("7d", agora)).toBe("2026-09-20T12:00:00.000Z");
    expect(inicioDoPeriodo("tudo", agora)).toBeNull();
  });
  it("rótulo do evento usa o nome da regra", () => {
    const regras = [{ eventName: `Etapa:${ETAPA}`, label: "Orçamento enviado" }];
    expect(rotuloDoEvento("Purchase", regras)).toBe("Compra");
    expect(rotuloDoEvento(`Etapa:${ETAPA}`, regras)).toBe("Orçamento enviado");
    expect(rotuloDoEvento("QualifiedLead", [])).toBe("Lead qualificado");
  });
});

describe("leitura do histórico", () => {
  it("sempre filtra a organização e aplica cada filtro escolhido", async () => {
    const { admin, chamadas } = adminGravador({
      ad_conversion_dispatches: {
        data: [
          {
            id: "d1",
            lead_id: "l1",
            platform: "google_ads",
            event_name: "Purchase",
            status: "sent",
            reason: null,
            detail: null,
            event_id: "l1:Purchase",
            remote_request_id: "req",
            google_action_id: null,
            value_cents: 1000,
            currency: "BRL",
            event_occurred_at: null,
            attempted_at: "2026-09-27T10:00:00Z",
            crm_leads: { title: "Maria" },
          },
        ],
        error: null,
        count: 51,
      },
    });
    const r = await lerHistorico(
      admin as never,
      "org",
      lerFiltros({ situacao: "falha", plataforma: "google_ads", busca: "Maria", pagina: "2" }),
      new Date("2026-09-27T12:00:00Z"),
    );
    expect(r.total).toBe(51);
    expect(r.linhas[0]).toMatchObject({ tituloDoLead: "Maria", eventoId: "l1:Purchase" });
    const eq = chamadas.filter((c) => c.metodo === "eq").map((c) => c.args);
    expect(eq).toContainEqual(["organization_id", "org"]);
    expect(eq).toContainEqual(["crm_leads.organization_id", "org"]);
    expect(eq).toContainEqual(["status", "error"]);
    expect(eq).toContainEqual(["platform", "google_ads"]);
    expect(chamadas).toContainEqual(
      expect.objectContaining({ metodo: "ilike", args: ["crm_leads.title", "%Maria%"] }),
    );
    expect(chamadas).toContainEqual(expect.objectContaining({ metodo: "range", args: [50, 99] }));
  });
  it("falha de leitura lança (a tela mostra o aviso, não uma lista vazia mentirosa)", async () => {
    const { admin } = adminGravador({
      ad_conversion_dispatches: { data: null, error: { message: "x" }, count: null },
    });
    await expect(lerHistorico(admin as never, "org", lerFiltros({}))).rejects.toThrow();
  });
});

describe("diagnóstico do Google", () => {
  const base = {
    instalacaoConfigurada: true,
    habilitada: true,
    temRefreshToken: true,
    customerId: "1234567890",
    temAcaoDeVenda: true,
    etapasAbertas: 4,
  };
  it("falha de leitura nunca vira diagnóstico saudável", async () => {
    const { admin } = adminGravador({
      ad_conversion_dispatches: { data: null, error: { message: "indisponível" }, count: null },
    });
    await expect(lerDiagnosticoGoogle(admin as never, "org", base)).rejects.toThrow(
      "Não foi possível ler o diagnóstico",
    );
  });
  it("instalação sem credenciais é o primeiro problema, e diz o que configurar", async () => {
    const { admin } = adminGravador({});
    const itens = await lerDiagnosticoGoogle(admin as never, "org", {
      ...base,
      instalacaoConfigurada: false,
    });
    expect(itens[0]).toMatchObject({ chave: "conexao", saude: "problema" });
    expect(itens[0]!.detalhe).toContain("GOOGLE_ADS_OAUTH_CLIENT_ID");
  });
  it("último envio antigo e falhas recentes acendem os cartões certos", async () => {
    const { admin } = adminGravador({
      ad_conversion_dispatches: { data: { attempted_at: "2026-09-01T00:00:00Z" }, error: null, count: 2 },
      google_ads_conversion_rules: { data: [], error: null },
    });
    const itens = await lerDiagnosticoGoogle(
      admin as never,
      "org",
      base,
      new Date("2026-09-27T00:00:00Z"),
    );
    const por = Object.fromEntries(itens.map((i) => [i.chave, i]));
    expect(por.conexao!.saude).toBe("ok");
    expect(por.chegando).toMatchObject({ saude: "atencao", detalhe: expect.stringContaining("há 26 dias") });
    expect(por.falhas!.saude).toBe("problema");
    expect(por.cobertura!.titulo).toContain("1 de 5");
  });
});
