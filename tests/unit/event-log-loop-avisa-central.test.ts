import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  sincronizarAvisoDoLacoDeEventLog,
  TITULO_LACO_EVENT_LOG_DEGRADADO,
} from "@/lib/event-log/aviso-do-laco";

type Filtro = [string, unknown];
type Row = Record<string, unknown>;

function cadeia<T>(valor: T, filtros: Filtro[]) {
  const q = {
    eq(coluna: string, valorDoFiltro: unknown) {
      filtros.push([coluna, valorDoFiltro]);
      return q;
    },
    then(resolve: (valor: T) => unknown) {
      return Promise.resolve(valor).then(resolve);
    },
  };
  return q;
}

function fakeAdmin(existentes: string[] = []) {
  const inseridos: Row[] = [];
  const updates: Row[] = [];
  const filtrosDeUpdate: Filtro[] = [];
  const filtrosDeSelect: Filtro[] = [];

  const client = {
    from(tabela: string) {
      if (tabela === "organizations") {
        return {
          select: async () => ({ data: [{ id: "org-a" }, { id: "org-b" }], error: null }),
        };
      }
      if (tabela === "agent_inbox_items") {
        return {
          select: () =>
            cadeia(
              { data: existentes.map((organization_id) => ({ organization_id })), error: null },
              filtrosDeSelect,
            ),
          insert: async (rows: Row[]) => {
            inseridos.push(...rows);
            return { error: null };
          },
          update: (patch: Row) => {
            updates.push(patch);
            return cadeia({ error: null }, filtrosDeUpdate);
          },
        };
      }
      throw new Error(`tabela inesperada: ${tabela}`);
    },
  };

  return {
    admin: client as unknown as SupabaseClient,
    inseridos,
    updates,
    filtrosDeUpdate,
    filtrosDeSelect,
  };
}

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Parameters<typeof sincronizarAvisoDoLacoDeEventLog>[2];

describe("laço rápido do event_log — feedback visível", () => {
  it("abre só o aviso que falta, sem duplicar organização já avisada", async () => {
    const f = fakeAdmin(["org-a"]);

    await sincronizarAvisoDoLacoDeEventLog(f.admin, "degradado", log);

    expect(f.inseridos).toEqual([
      expect.objectContaining({
        organization_id: "org-b",
        kind: "other",
        severity: "warn",
        title: TITULO_LACO_EVENT_LOG_DEGRADADO,
        ref_kind: null,
        ref_id: null,
      }),
    ]);
    expect(f.filtrosDeSelect).toEqual(
      expect.arrayContaining([
        ["kind", "other"],
        ["title", TITULO_LACO_EVENT_LOG_DEGRADADO],
        ["status", "open"],
      ]),
    );
  });

  it("resolve o incidente no próximo boot saudável", async () => {
    const f = fakeAdmin();

    await sincronizarAvisoDoLacoDeEventLog(f.admin, "saudavel", log);

    expect(f.updates).toHaveLength(1);
    expect(f.updates[0]).toMatchObject({ status: "resolved", resolved_at: expect.any(String) });
    expect(f.filtrosDeUpdate).toEqual([
      ["kind", "other"],
      ["title", TITULO_LACO_EVENT_LOG_DEGRADADO],
      ["status", "open"],
    ]);
  });

  it("Central fora do ar vira `warn`, nunca `error` — o gate da #604 exige zero error com as deps carregadas", async () => {
    const semBanco = {
      from() {
        throw new Error("fetch failed");
      },
    } as unknown as SupabaseClient;
    const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await sincronizarAvisoDoLacoDeEventLog(semBanco, "saudavel", l as unknown as typeof log);

    expect(l.error).not.toHaveBeenCalled();
    expect(l.warn).toHaveBeenCalledWith(
      expect.stringContaining("falhei ao sincronizar o aviso"),
      expect.objectContaining({ error: "fetch failed" }),
    );
  });
});
