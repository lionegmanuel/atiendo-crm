import { describe, it, expect } from "vitest";
import { makeQueryClient } from "@/lib/query/client";

describe("makeQueryClient()", () => {
  it("returns canonical defaults", () => {
    const qc = makeQueryClient();
    const opts = qc.getDefaultOptions();
    expect(opts.queries?.staleTime).toBe(30_000);
    expect(opts.queries?.gcTime).toBe(300_000);
    expect(opts.queries?.refetchOnWindowFocus).toBe(false);
    expect(opts.mutations?.retry).toBe(false);
  });
});
