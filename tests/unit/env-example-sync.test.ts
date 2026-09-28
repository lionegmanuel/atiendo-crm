import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const root = process.cwd();
const ORIGINAL_INTERNAL_AGENT_RUN_STUB = process.env.INTERNAL_AGENT_RUN_STUB;

function schemaEnvKeys(): string[] {
  const envSource = readFileSync(join(root, "lib/env.ts"), "utf8");
  return Array.from(envSource.matchAll(/^\s{2}([A-Z][A-Z0-9_]{3,}):/gm), (match) => match[1]!)
    .filter((key) => key !== "NODE_ENV")
    .sort();
}

function exampleEnvKeys(): string[] {
  const example = readFileSync(join(root, ".env.example"), "utf8");
  return Array.from(example.matchAll(/^([A-Z][A-Z0-9_]{3,})=/gm), (match) => match[1]!).sort();
}

describe(".env.example", () => {
  afterEach(() => {
    if (ORIGINAL_INTERNAL_AGENT_RUN_STUB === undefined) {
      delete process.env.INTERNAL_AGENT_RUN_STUB;
    } else {
      process.env.INTERNAL_AGENT_RUN_STUB = ORIGINAL_INTERNAL_AGENT_RUN_STUB;
    }
    vi.resetModules();
  });

  it("documenta todas as variáveis validadas em lib/env.ts", () => {
    const documented = new Set(exampleEnvKeys());
    const missing = schemaEnvKeys().filter((key) => !documented.has(key));

    expect(missing).toEqual([]);
  });

  it("mantém o teste de agente real ligado por default", async () => {
    vi.resetModules();
    delete process.env.INTERNAL_AGENT_RUN_STUB;

    const { env } = await import("@/lib/env");

    expect(env.INTERNAL_AGENT_RUN_STUB).toBe(false);
  });
});
