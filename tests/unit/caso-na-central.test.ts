/**
 * O caso aberto aparece na Central NA HORA e sai quando fecha.
 *
 * Medido numa loja que vende pelo WhatsApp: a IA abriu o caso "cliente pergunta
 * a transportadora" e ele só existia na tela de Casos — o sino não mostrava
 * nada, e a cobrança da Central (`case-stale-watcher`) só chega depois de 24
 * horas. O aviso nasce com texto genérico (o título do caso fala do cliente, e
 * ficaria fora da anonimização de LGPD) e aponta para o caso.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { createAdminClient } from "@/lib/supabase/admin";
import { casoNaCentralHandler } from "@/lib/escalacao/caso-na-central.handler";
import { getRegisteredHandlers } from "@/lib/event-log/dispatcher";
import { ensureHandlersRegistered } from "@/lib/event-log/register-handlers";
import type { EventRow } from "@/lib/event-log/dispatcher";

const ORG = "11111111-1111-4111-8111-111111111111";
const CASO = "22222222-2222-4222-8222-222222222222";
const TITULO_DO_CASO = "Cliente pergunta a transportadora do pedido";

let inseridos: Record<string, unknown>[] = [];
let atualizados: Record<string, unknown>[] = [];
/** Filtros `eq` por tabela, na ordem: `[tabela, coluna, valor]`. */
let filtros: [string, string, unknown][] = [];

function banco(t: {
  status?: string | null;
  erroNoCaso?: boolean;
  jaAberto?: boolean;
  abertosParaFechar?: number;
}) {
  inseridos = [];
  atualizados = [];
  filtros = [];
  return {
    from(tabela: string) {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (coluna: string, valor: unknown) => {
          filtros.push([tabela, coluna, valor]);
          return q;
        },
        in: () => q,
        limit: () => q,
        maybeSingle: async () => {
          if (tabela === "agent_cases") {
            return t.erroNoCaso
              ? { data: null, error: { message: "PostgREST fora" } }
              : { data: t.status ? { status: t.status, title: TITULO_DO_CASO } : null, error: null };
          }
          return { data: tabela === "organizations" ? { locale: "es" } : null, error: null };
        },
        insert: async (v: Record<string, unknown>) => {
          inseridos.push(v);
          return { error: null };
        },
        update: (v: Record<string, unknown>) => {
          atualizados.push(v);
          const u: Record<string, unknown> = {
            eq: (coluna: string, valor: unknown) => {
              filtros.push([tabela, coluna, valor]);
              return u;
            },
            in: () => u,
            select: async () => ({
              data: Array.from({ length: t.abertosParaFechar ?? 0 }, (_, i) => ({ id: `i${i}` })),
              error: null,
            }),
          };
          return u;
        },
        then: (ok: (r: unknown) => unknown) => ok({ data: t.jaAberto ? [{ id: "x" }] : [], error: null }),
      };
      return q;
    },
  };
}

const evento = (event_type: string): EventRow => ({
  id: "evt",
  organization_id: ORG,
  event_type,
  entity_kind: "agent_case",
  entity_id: CASO,
  payload: { case_id: CASO },
  metadata: {},
  consumed_by: [],
  attempts: 0,
  created_at: new Date().toISOString(),
});

beforeEach(() => vi.mocked(createAdminClient).mockReset());

describe("caso aberto → aviso na Central", () => {
  it("escuta abertura e fechamento, e está registrado no dreno", () => {
    expect(casoNaCentralHandler.events).toEqual(["ai.case_opened", "ai.case_closed"]);
    ensureHandlersRegistered();
    expect(getRegisteredHandlers().map((h) => h.key)).toContain("escalacao.caso-na-central");
  });

  it("caso esperando pessoa: aviso genérico no idioma da organização, apontando para o caso", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco({ status: "awaiting_human" }) as never);
    const r = await casoNaCentralHandler.handle(evento("ai.case_opened"));
    expect(r.status).toBe("ok");
    expect(inseridos).toHaveLength(1);
    expect(inseridos[0]).toMatchObject({
      organization_id: ORG,
      kind: "other",
      severity: "warn",
      title: "La IA pidió ayuda al equipo",
      body: "Abre el caso para responder. La IA sigue atendiendo al cliente mientras tanto.",
      ref_kind: "agent_case",
      ref_id: CASO,
    });
    // Genérico: o título do caso (escrito pela IA sobre o cliente) não vaza
    // para a Central, que fica fora da cascata de anonimização.
    expect(JSON.stringify(inseridos[0])).not.toContain(TITULO_DO_CASO);
    // O caso é lido na organização do EVENTO — o cliente é service role.
    expect(filtros).toContainEqual(["agent_cases", "organization_id", ORG]);
  });

  it("caso esperando o CLIENTE não pede nada da equipe: nada entra", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco({ status: "awaiting_lead" }) as never);
    expect((await casoNaCentralHandler.handle(evento("ai.case_opened"))).detail).toBe("caso_nao_espera_pessoa");
    expect(inseridos).toHaveLength(0);
  });

  it("caso que fechou antes do dreno (inclusive passado adiante): nada entra", async () => {
    for (const status of ["resolved", "escalated", "cancelled"]) {
      vi.mocked(createAdminClient).mockReturnValue(banco({ status }) as never);
      expect((await casoNaCentralHandler.handle(evento("ai.case_opened"))).detail, status).toBe(
        "caso_nao_espera_pessoa",
      );
      expect(inseridos, status).toHaveLength(0);
    }
  });

  it("reprocessar o evento não empilha um segundo aviso", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco({ status: "awaiting_human", jaAberto: true }) as never);
    expect((await casoNaCentralHandler.handle(evento("ai.case_opened"))).detail).toBe("aviso_ja_aberto");
    expect(inseridos).toHaveLength(0);
  });

  it("leitura do caso que falha tenta de novo mais tarde, sem abrir nada", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco({ erroNoCaso: true }) as never);
    const r = await casoNaCentralHandler.handle(evento("ai.case_opened"));
    expect(r.status).toBe("retry");
    expect(r.retry_at).toBeDefined();
    expect(inseridos).toHaveLength(0);
  });

  it("caso fechado: o aviso sai do sino, só na organização do evento", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco({ abertosParaFechar: 1 }) as never);
    const r = await casoNaCentralHandler.handle(evento("ai.case_closed"));
    expect(r.detail).toBe("aviso_resolvido");
    expect(atualizados[0]).toMatchObject({ status: "resolved" });
    expect(filtros).toContainEqual(["agent_inbox_items", "organization_id", ORG]);
    expect(filtros).toContainEqual(["agent_inbox_items", "ref_id", CASO]);
  });

  it("caso fechado sem aviso aberto (alguém já resolveu no sino): nada a fazer", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco({ abertosParaFechar: 0 }) as never);
    const r = await casoNaCentralHandler.handle(evento("ai.case_closed"));
    expect(r).toMatchObject({ status: "skipped", detail: "sem_aviso_aberto" });
  });
});
