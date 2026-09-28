// @vitest-environment node
import { describe, expect, it } from "vitest";

import { followupPublicadoDoEnrollment } from "@/lib/agent-engine/agent/janela-de-followup";
import { versionCreateSchema } from "@/lib/ai/agents/validation";

/**
 * Evidência de segurança da #490.
 *
 * A configuração é lida pelo worker com acesso de servidor. Por isso o filtro
 * de tenant não pode depender de RLS: enrollment, agente e versão publicada são
 * unidos com `organization_id` explícito. E o fuso NÃO é input da janela: ele
 * vem de `organizations.timezone`, evitando que uma versão injete outro relógio
 * para contornar a faixa escolhida pela organização.
 */
describe("security: janela de follow-up respeita a fronteira da organização", () => {
  it("a consulta prende enrollment, agente e versão publicada ao mesmo tenant", async () => {
    let capturedSql = "";
    let capturedParams: unknown[] = [];
    const db = {
      async query(sql: string, params: unknown[]) {
        capturedSql = sql;
        capturedParams = params;
        return { rows: [{ followup: null }], rowCount: 1 };
      },
    };

    await followupPublicadoDoEnrollment(db as never, "org-a", "enrollment-a");

    expect(capturedParams).toEqual(["org-a", "enrollment-a"]);
    expect(capturedSql).toContain("e.organization_id = $1");
    expect(capturedSql).toContain("a.organization_id = e.organization_id");
    expect(capturedSql).toContain("v.organization_id = e.organization_id");
    expect(capturedSql).toContain("a.id = e.agent_id");
    expect(capturedSql).toContain("v.id = a.published_version_id");
  });

  it("send_window não aceita timezone injetado pela versão do agente", () => {
    const parsed = versionCreateSchema.safeParse({
      system_prompt: "Você é um atendente de teste.",
      provider: "openai",
      model: "gpt-test",
      credential_id: null,
      channel_session_id: null,
      followup: {
        enabled: true,
        flow_pointer_ids: [],
        send_window: {
          start: "09:00",
          end: "18:00",
          weekdays: [1, 2, 3, 4, 5],
          timezone: "Pacific/Kiritimati",
        },
      },
    });

    expect(parsed.success).toBe(false);
  });
});
