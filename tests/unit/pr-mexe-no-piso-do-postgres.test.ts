import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

// scripts/pr-mexe-no-piso-do-postgres.sh decide se a matriz do `invariants-majors`
// leva a major de PISO (pg15). Errar para "nao" deixa entrar mudança de schema
// sem prova de que o baseline sobe na menor major que dizemos suportar (#454).
const SCRIPT = "scripts/pr-mexe-no-piso-do-postgres.sh";

function responde(caminhos: string[]): string {
  return execFileSync("bash", [SCRIPT], { input: caminhos.join("\n") + "\n", encoding: "utf-8" }).trim();
}

describe("pr-mexe-no-piso-do-postgres", () => {
  it.each([
    ["supabase/baseline.sql"],
    ["supabase/migrations/20260918000000_0300_x.sql"],
    ["supabase/migrations/MANIFEST.md"],
    ["supabase/config.toml"],
    ["scripts/test-db.sh"],
    ["scripts/test-update-com-dados.sh"],
    ["tests/invariants/isolamento-rls.test.ts"],
    ["hostgator-setup-kit/install.sh"],
    ["hostgator-setup-kit/update.sh"],
    [".github/workflows/ci.yml"],
    ["scripts/pr-mexe-no-piso-do-postgres.sh"],
  ])("%s → roda as duas majors", (caminho) => {
    expect(responde(["docs/leia.md", caminho])).toBe("sim");
  });

  it("entrada vazia roda as duas — não saber o que mudou nunca vira 'só a de cima'", () => {
    expect(responde([])).toBe("sim");
  });

  it("PR de produto, teste de unidade, documentação e outro workflow roda só a major de cima", () => {
    expect(
      responde([
        "app/(app)/leads/page.tsx",
        "components/ui/button.tsx",
        "lib/agent-engine/agent/inbound-turn.ts",
        "lib/database.types.ts",
        "tests/unit/x.test.ts",
        "tests/e2e/leads.spec.ts",
        "docs/runbooks/deploy.md",
        ".changes/fragmento.md",
        ".github/workflows/e2e.yml",
        "package.json",
      ]),
    ).toBe("nao");
  });
});
