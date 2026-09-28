import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

describe("cn()", () => {
  it("merges plain strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy conditional values", () => {
    expect(cn("a", false && "b", "c")).toBe("a c");
  });

  it("flattens arrays", () => {
    expect(cn(["a", "b"], "c")).toBe("a b c");
  });

  it("ignores undefined and null", () => {
    expect(cn("a", undefined, null, "b")).toBe("a b");
  });
});
