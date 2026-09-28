import { describe, it, expect } from "vitest";

describe("lib/ui/icons", () => {
  // O barrel re-exporta o @phosphor-icons/react inteiro (~1300 módulos) — o
  // transform frio sob a suíte paralela passa fácil dos 5s default do vitest.
  it("re-exports at least 20 named icon members", { timeout: 30_000 }, async () => {
    const mod = await import("@/lib/ui/icons");
    const keys = Object.keys(mod).filter((k) => k !== "default");
    expect(keys.length).toBeGreaterThanOrEqual(20);
  });
});
