/**
 * A etapa marcada avisa a equipe na Central (migration 0440).
 *
 * Os modos de falha vigiados: avisar etapa que ninguém marcou (ruído que
 * ensina a ignorar a Central), empilhar o mesmo aviso a cada reprocessamento,
 * vazar o nome/telefone do cliente no texto do aviso, e uma falha do banco que
 * girasse para sempre como reagendamento benigno em vez de contar tentativa.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { avisoDeEtapaHandler } from "@/lib/leads/aviso-de-etapa.handler";
import { atualizarEtapa, corpo } from "@/lib/leads/stage-operations";
import { tituloDoAvisoDeEtapa } from "@/lib/leads/aviso-de-etapa";
import type { EventRow } from "@/lib/event-log/dispatcher";
import { IDIOMAS } from "@/lib/i18n/idiomas";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const ORG = "11111111-1111-1111-1111-111111111111";
const LEAD = "22222222-2222-2222-2222-222222222222";
const ETAPA = "33333333-3333-3333-3333-333333333333";

const inseridos: Record<string, unknown>[] = [];
const filtros: Array<[string, string, unknown]> = [];

function fakeAdmin(t: {
  avisar: boolean | null;
  jaAberto?: boolean;
  locale?: string;
  erroNaEtapa?: boolean;
  erroNoInsert?: boolean;
}) {
  return {
    from(tabela: string) {
      const q = {
        select: () => q,
        eq: (coluna: string, valor: unknown) => {
          filtros.push([tabela, coluna, valor]);
          return q;
        },
        limit: async () => ({ data: t.jaAberto ? [{ id: "x" }] : [], error: null }),
        maybeSingle: async () => {
          if (tabela === "crm_stages" && t.erroNaEtapa) return { data: null, error: { message: "conexão caiu" } };
          return {
            data:
              tabela === "crm_stages"
                ? { name: "Pedido confirmado", avisar_na_central: t.avisar }
                : tabela === "organizations"
                  ? { locale: t.locale ?? "es" }
                  : null,
            error: null,
          };
        },
        insert: async (linha: Record<string, unknown>) => {
          if (t.erroNoInsert) return { error: { message: "check violation" } };
          inseridos.push(linha);
          return { error: null };
        },
      };
      return q;
    },
  };
}

const evento = (payload: Record<string, unknown>): EventRow => ({
  id: "evt",
  organization_id: ORG,
  event_type: "lead.stage_changed",
  entity_kind: "crm_lead",
  entity_id: LEAD,
  payload,
  metadata: {},
  consumed_by: [],
  attempts: 0,
  created_at: new Date().toISOString(),
});

beforeEach(() => {
  inseridos.length = 0;
  filtros.length = 0;
});

describe("aviso na Central ao entrar numa etapa marcada", () => {
  it("escuta a mudança de etapa", () => {
    expect(avisoDeEtapaHandler.events).toContain("lead.stage_changed");
  });

  it("etapa marcada: abre um aviso que aponta para o negócio, no idioma da organização", async () => {
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin({ avisar: true }) as never);

    const r = await avisoDeEtapaHandler.handle(evento({ from_stage_id: "outra", to_stage_id: ETAPA }));

    expect(r.status).toBe("ok");
    expect(inseridos).toHaveLength(1);
    expect(inseridos[0]).toMatchObject({
      organization_id: ORG,
      kind: "other",
      severity: "info",
      ref_kind: "lead",
      ref_id: LEAD,
      title: "Negocio entró en «Pedido confirmado»",
      body: "Abre el negocio para dar el siguiente paso. Este aviso se pidió en la configuración de la etapa.",
    });
  });

  it("a etapa é lida COM o filtro da organização do evento (o client ignora RLS)", async () => {
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin({ avisar: true }) as never);
    await avisoDeEtapaHandler.handle(evento({ to_stage_id: ETAPA }));
    expect(filtros).toContainEqual(["crm_stages", "organization_id", ORG]);
    expect(filtros).toContainEqual(["agent_inbox_items", "organization_id", ORG]);
  });

  it("o texto não carrega nada do cliente — só a etapa", async () => {
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin({ avisar: true, locale: "pt-BR" }) as never);

    await avisoDeEtapaHandler.handle(evento({ to_stage_id: ETAPA, lead_title: "Maria Souza +5511999990000" }));

    const texto = JSON.stringify(inseridos[0]);
    expect(texto).not.toContain("Maria");
    expect(texto).not.toContain("99999");
    expect(inseridos[0]!.title).toBe("Negócio entrou em «Pedido confirmado»");
  });

  it("etapa sem a marca não avisa", async () => {
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin({ avisar: false }) as never);
    const r = await avisoDeEtapaHandler.handle(evento({ to_stage_id: ETAPA }));
    expect(r.status).toBe("skipped");
    expect(inseridos).toHaveLength(0);
  });

  it("aviso já aberto para o mesmo negócio e etapa não empilha", async () => {
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin({ avisar: true, jaAberto: true }) as never);
    const r = await avisoDeEtapaHandler.handle(evento({ to_stage_id: ETAPA }));
    expect(r.detail).toBe("aviso_ja_aberto");
    expect(inseridos).toHaveLength(0);
  });

  it("sem etapa de destino, ou movendo para a mesma etapa, não faz nada", async () => {
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin({ avisar: true }) as never);
    expect((await avisoDeEtapaHandler.handle(evento({}))).status).toBe("skipped");
    expect((await avisoDeEtapaHandler.handle(evento({ from_stage_id: ETAPA, to_stage_id: ETAPA }))).status).toBe("skipped");
    expect(inseridos).toHaveLength(0);
  });

  it("falha do banco é `error` (conta tentativa no dreno), nunca `retry` benigno", async () => {
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin({ avisar: true, erroNaEtapa: true }) as never);
    const leitura = await avisoDeEtapaHandler.handle(evento({ to_stage_id: ETAPA }));
    expect(leitura.status).toBe("error");

    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin({ avisar: true, erroNoInsert: true }) as never);
    const gravacao = await avisoDeEtapaHandler.handle(evento({ to_stage_id: ETAPA }));
    expect(gravacao.status).toBe("error");
    expect(gravacao.detail).toContain("aviso não entrou na Central");
  });
});

describe("o título do aviso", () => {
  it("existe em todo idioma servido e carrega o nome da etapa entre aspas angulares", () => {
    expect(IDIOMAS.length).toBeGreaterThan(0);
    for (const idioma of IDIOMAS) {
      const titulo = tituloDoAvisoDeEtapa("Pedido confirmado", idioma);
      expect(titulo.endsWith(" «Pedido confirmado»")).toBe(true);
      expect(titulo.length).toBeGreaterThan(" «Pedido confirmado»".length);
    }
  });
});

describe("a chave da etapa é gravada e lida pela regra de etapas", () => {
  const PIPE = "44444444-4444-4444-4444-444444444444";
  const etapa = (over: Record<string, unknown> = {}) => ({
    id: ETAPA, name: "Pedido confirmado", slug: "pedido-confirmado", position: 2,
    is_won: false, is_lost: false, is_archived: false, win_probability: null,
    agent_stage_hint: null, last_change_actor_kind: null, last_change_at: null, ...over,
  });

  function supabaseDeSessao(linhas: Record<string, unknown>[], updates: Record<string, unknown>[]) {
    return {
      from(tabela: string) {
        const q = {
          select: () => q,
          eq: () => q,
          order: async () => ({ data: linhas, error: null }),
          maybeSingle: async () => ({ data: tabela === "crm_pipelines" ? { id: PIPE } : null, error: null }),
          update: (patch: Record<string, unknown>) => {
            updates.push(patch);
            const u = { eq: () => u, then: (ok: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(ok) };
            return u;
          },
        };
        return q;
      },
    };
  }

  it("PATCH com `avisar_na_central` grava a coluna — e só ela, com a autoria", async () => {
    const updates: Record<string, unknown>[] = [];
    await atualizarEtapa(
      {
        supabase: supabaseDeSessao([etapa()], updates) as never,
        organizationId: ORG,
        actor: { type: "user", id: "u1", role: "manager" } as never,
        requestId: "r1",
      },
      { pipelineId: PIPE, stageId: ETAPA, pedido: { avisar_na_central: true } },
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ avisar_na_central: true, last_change_actor_kind: "user" });
    expect(Object.keys(updates[0]!).sort()).toEqual(["avisar_na_central", "last_change_actor_kind", "last_change_at"]);
  });

  it("a etapa sai para a tela com a chave; etapa anterior à coluna sai desligada", () => {
    expect(corpo([etapa({ avisar_na_central: true }) as never]).etapas[0]!.avisar_na_central).toBe(true);
    expect(corpo([etapa() as never]).etapas[0]!.avisar_na_central).toBe(false);
  });
});
