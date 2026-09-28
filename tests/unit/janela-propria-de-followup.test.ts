// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  followupPublicadoDoEnrollment,
  proximaAberturaDoFollowup,
} from "@/lib/agent-engine/agent/janela-de-followup";
import { versionCreateSchema } from "@/lib/ai/agents/validation";

const JANELA = {
  enabled: true,
  flow_pointer_ids: [],
  send_window: { start: "09:00", end: "18:00", weekdays: [1, 2, 3, 4, 5] },
};

describe("janela própria do follow-up", () => {
  it("não limita versões antigas que não têm send_window", () => {
    expect(
      proximaAberturaDoFollowup(
        { enabled: true, flow_pointer_ids: [] },
        "America/Sao_Paulo",
        new Date("2026-09-17T23:00:00.000Z"),
      ),
    ).toBeNull();
  });

  it("deixa enviar dentro da faixa no fuso da organização", () => {
    // 17/09/2026 14:00 em São Paulo (quinta-feira).
    expect(
      proximaAberturaDoFollowup(
        JANELA,
        "America/Sao_Paulo",
        new Date("2026-09-17T17:00:00.000Z"),
      ),
    ).toBeNull();
  });

  it("à noite adia para a abertura do próximo dia útil", () => {
    // Quinta 21:00 em São Paulo -> sexta 09:00.
    expect(
      proximaAberturaDoFollowup(
        JANELA,
        "America/Sao_Paulo",
        new Date("2026-09-18T00:00:00.000Z"),
      )?.toISOString(),
    ).toBe("2026-09-18T12:00:00.000Z");
  });

  it("no fim de semana pula para segunda-feira", () => {
    // Sábado 10:00 em São Paulo -> segunda 09:00.
    expect(
      proximaAberturaDoFollowup(
        JANELA,
        "America/Sao_Paulo",
        new Date("2026-09-19T13:00:00.000Z"),
      )?.toISOString(),
    ).toBe("2026-09-21T12:00:00.000Z");
  });

  it("busca a configuração da versão publicada do agente pinado no enrollment", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      async query(sql: string, params: unknown[]) {
        calls.push({ sql, params });
        return { rows: [{ followup: JANELA }], rowCount: 1 };
      },
    };

    await expect(
      followupPublicadoDoEnrollment(db as never, "org-1", "enrollment-1"),
    ).resolves.toEqual(JANELA);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toContain("a.published_version_id");
    expect(calls[0]!.sql).toContain("e.agent_id");
    expect(calls[0]!.params).toEqual(["org-1", "enrollment-1"]);
  });

  it("o handler real consulta a janela antes de entrar no turno que envia", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/agent-engine/agent/followup-turn.ts"),
      "utf8",
    );
    const gate = source.indexOf("proximaAberturaDoFollowup(followup, fuso, agora)");
    const requeue = source.indexOf("follow-up adiado pela janela própria do agente");
    const run = source.indexOf("await runFlowDrivenTurn(deps, job, pool, ctx, clock, target");

    expect(gate, "a janela própria deixou de ser consultada no handler").toBeGreaterThan(-1);
    expect(requeue, "fora da janela deixou de reagendar o job").toBeGreaterThan(gate);
    expect(run, "não encontrei o turno dirigido por fluxo").toBeGreaterThan(requeue);
    expect(source).toContain("payload.purpose === 'send_message'");
  });
});

describe("contrato versionado do agente", () => {
  const base = {
    system_prompt: "Você é um atendente de teste.",
    provider: "openai" as const,
    model: "gpt-test",
    credential_id: null,
    channel_session_id: null,
  };

  it("aceita a janela e preserva o default null para versões sem ela", () => {
    const antigo = versionCreateSchema.parse(base);
    expect(antigo.followup.send_window).toBeNull();

    const novo = versionCreateSchema.parse({ ...base, followup: JANELA });
    expect(novo.followup.send_window).toEqual(JANELA.send_window);
  });

  it("recusa faixa invertida e lista vazia de dias", () => {
    expect(
      versionCreateSchema.safeParse({
        ...base,
        followup: {
          ...JANELA,
          send_window: { start: "18:00", end: "09:00", weekdays: [1] },
        },
      }).success,
    ).toBe(false);

    expect(
      versionCreateSchema.safeParse({
        ...base,
        followup: {
          ...JANELA,
          send_window: { start: "09:00", end: "18:00", weekdays: [] },
        },
      }).success,
    ).toBe(false);
  });
});
