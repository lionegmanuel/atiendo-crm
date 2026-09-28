import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 0 (convergência, spec 2026-07-23): dispatch nativo aposentado — a rota
 * cron é NO-OP permanente em QUALQUER valor de AGENT_DISPATCH_CONSUMER
 * ('engine' ou 'native'). O agent-worker (drain) é o único consumidor de
 * ai_agent.dispatch_requested; dispatchAgents nunca é chamado por este cron.
 */

const dispatchAgentsMock = vi.fn().mockResolvedValue({
  batch_size: 0,
  outcomes: {},
  errors: [],
});
const auditMock = vi.fn().mockResolvedValue(undefined);
const envMock: Record<string, unknown> = {
  INTERNAL_CRON_SECRET: "cron-secret",
  INTERNAL_SECRET: "internal-secret",
  AGENT_DISPATCH_CONSUMER: "engine",
};

vi.mock("@/lib/ai/dispatcher", () => ({ dispatchAgents: dispatchAgentsMock }));
vi.mock("@/lib/audit", () => ({ audit: auditMock }));
vi.mock("@/lib/env", () => ({ env: envMock }));

async function callRoute(): Promise<Response> {
  const { POST } = await import("./route");
  const req = new Request("http://test.local/api/v1/cron/agent-dispatcher", {
    method: "POST",
    headers: { authorization: "Bearer cron-secret" },
  });
  return POST(req as never);
}

describe("4A-1 — cron agent-dispatcher respeita o dono do dispatch", () => {
  beforeEach(() => {
    dispatchAgentsMock.mockClear();
    vi.resetModules();
  });

  it("modo 'engine' (default da fusão): responde skipped e NÃO chama dispatchAgents", async () => {
    envMock.AGENT_DISPATCH_CONSUMER = "engine";
    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { skipped?: boolean; deprecated?: boolean; reason?: string } };
    expect(body.data.skipped).toBe(true);
    expect(body.data.deprecated).toBe(true);
    expect(body.data.reason).toBe("native dispatcher retired (Fase 0)");
    expect(dispatchAgentsMock).not.toHaveBeenCalled();
  });

  it("modo 'native' (obsoleto, Fase 0): também no-opa, NÃO despacha", async () => {
    envMock.AGENT_DISPATCH_CONSUMER = "native";
    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { skipped?: boolean; deprecated?: boolean; reason?: string } };
    expect(body.data.skipped).toBe(true);
    expect(body.data.deprecated).toBe(true);
    expect(body.data.reason).toBe("native dispatcher retired (Fase 0)");
    expect(dispatchAgentsMock).not.toHaveBeenCalled();
  });

  it("sem secret: 403 em qualquer modo (nada muda na auth)", async () => {
    envMock.AGENT_DISPATCH_CONSUMER = "engine";
    const { POST } = await import("./route");
    const req = new Request("http://test.local/api/v1/cron/agent-dispatcher", { method: "POST" });
    const res = await POST(req as never);
    expect(res.status).toBe(403);
    expect(dispatchAgentsMock).not.toHaveBeenCalled();
  });
});
