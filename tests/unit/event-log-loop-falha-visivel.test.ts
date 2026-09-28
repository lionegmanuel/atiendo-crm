import { beforeEach, describe, expect, it, vi } from "vitest";

const controle = vi.hoisted(() => ({
  falharHandlers: false,
  // Rest param: o wrapper do vi.mock espalha `unknown[]`, e o TS6 só aceita o
  // spread em função com rest parameter (ou tupla tipada).
  sincronizar: vi.fn(async (..._args: unknown[]) => {}),
}));

vi.mock("@/lib/event-log/aviso-do-laco", () => ({
  sincronizarAvisoDoLacoDeEventLog: (...args: unknown[]) => controle.sincronizar(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: vi.fn() }),
}));

vi.mock("@/lib/event-log/drain", () => ({
  drainEventLog: vi.fn(async () => ({ scanned: 0, done: 0, retried: 0, failed: 0, dead: 0 })),
}));

vi.mock("@/lib/event-log/register-handlers", () => ({
  ensureHandlersRegistered: () => {
    if (controle.falharHandlers) throw new Error("register-handlers indisponível");
  },
}));

import {
  _reiniciarProntidaoDoLaco,
  carregarDepsDoLaco,
  prontidaoDoLacoDeEventLog,
} from "@/lib/event-log/drain-loop";

function logger() {
  const info = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  return {
    log: { info, warn, error } as unknown as Parameters<typeof carregarDepsDoLaco>[0],
    info,
    warn,
    error,
  };
}

describe("boot do laço rápido do event_log", () => {
  beforeEach(() => {
    controle.falharHandlers = false;
    controle.sincronizar.mockClear();
    _reiniciarProntidaoDoLaco();
  });

  it("falha em register-handlers aparece na Central sem culpar o admin client", async () => {
    controle.falharHandlers = true;
    const l = logger();

    const deps = await carregarDepsDoLaco(l.log);

    expect(deps).toBeNull();
    expect(prontidaoDoLacoDeEventLog()).toMatchObject({
      carregado: false,
      motivo: "register-handlers indisponível",
    });
    expect(controle.sincronizar).toHaveBeenCalledWith(expect.anything(), "degradado", l.log);
    expect(l.error).toHaveBeenCalledWith(
      expect.stringContaining("falha ao carregar dependências do laço"),
      expect.objectContaining({ error: "register-handlers indisponível" }),
    );
    expect(l.error.mock.calls.flat().join("\n")).not.toContain("não consegui montar o admin client");
  });

  it("boot saudável resolve aviso antigo e marca o laço carregado", async () => {
    const l = logger();

    const deps = await carregarDepsDoLaco(l.log);

    expect(deps).not.toBeNull();
    expect(prontidaoDoLacoDeEventLog()).toEqual({ carregado: true, motivo: null });
    expect(controle.sincronizar).toHaveBeenCalledWith(expect.anything(), "saudavel", l.log);
  });

  it("a prontidão sai ANTES do round-trip à Central, não depois", async () => {
    const l = logger();
    let prontidaoDuranteASincronizacao: unknown = null;
    controle.sincronizar.mockImplementationOnce(async () => {
      prontidaoDuranteASincronizacao = prontidaoDoLacoDeEventLog();
    });

    await carregarDepsDoLaco(l.log);

    expect(prontidaoDuranteASincronizacao).toEqual({ carregado: true, motivo: null });
  });
});
