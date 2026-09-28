import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

// scripts/pr-alcanca-o-e2e.sh decide se um PR pula as três partes do e2e. Errar
// para "nao" deixa passar regressão de tela com o check obrigatório `e2e` verde.
const SCRIPT = "scripts/pr-alcanca-o-e2e.sh";

function responde(caminhos: string[]): string {
  return execFileSync("bash", [SCRIPT], { input: caminhos.join("\n") + "\n", encoding: "utf-8" }).trim();
}

describe("pr-alcanca-o-e2e", () => {
  it.each([
    ["app/(app)/leads/page.tsx"],
    ["components/ui/button.tsx"],
    ["lib/qualquer.ts"],
    ["hooks/use-x.ts"],
    ["supabase/baseline.sql"],
    ["supabase/migrations/20260918000000_0300_x.sql"],
    ["tests/e2e/leads.spec.ts"],
    ["tests/e2e/helpers/login.ts"],
    ["tests/setup/vitest.setup.ts"],
    ["tests/fixtures/x.json"],
    ["scripts/seed-e2e-credentials.ts"],
    ["scripts/gerar-env-e2e.sh"],
    ["package.json"],
    ["pnpm-lock.yaml"],
    ["playwright.config.ts"],
    ["next.config.ts"],
    ["middleware.ts"],
    [".github/workflows/e2e.yml"],
    [".github/actions/preparar-node/action.yml"],
    ["lib/agent-engine/playbooks/platform.md"],
    ["hostgator-setup-kit/install.sh"],
  ])("%s → roda", (caminho) => {
    expect(responde(["docs/leia.md", caminho])).toBe("sim");
  });

  it("entrada vazia roda — não saber o que mudou nunca vira 'pula'", () => {
    expect(responde([])).toBe("sim");
  });

  it("PR só de documentação, teste de outra suíte, fragmento, workflow alheio e executor pula", () => {
    expect(
      responde([
        "docs/runbooks/deploy.md",
        "tasks/todo.md",
        ".changes/fragmento.md",
        "tests/unit/x.test.ts",
        "tests/invariants/y.test.ts",
        "tests/cercas/selecao.ts",
        "tests/shell/z.test.sh",
        "lib/api/wrappers.test.ts",
        "components/x/y.test.tsx",
        ".github/workflows/ci.yml",
        ".github/PULL_REQUEST_TEMPLATE.md",
        "CLAUDE.md",
        "infra/executor-proprio/vaga.sh",
      ]),
    ).toBe("nao");
  });
});
