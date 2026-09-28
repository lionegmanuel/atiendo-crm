import { describe, expect, it } from "vitest";

import { parseReplyCount } from "./parse-count";

describe("parseReplyCount", () => {
  it("lê o primeiro número e respeita o teto", () => {
    expect(parseReplyCount("tenho 4 filhos", 12)).toBe(4);
    expect(parseReplyCount("15", 12)).toBe(12);
    expect(parseReplyCount("0", 12)).toBe(0);
  });

  it("aceita nenhum/dois", () => {
    expect(parseReplyCount("nenhum", 12)).toBe(0);
    expect(parseReplyCount("dois", 12)).toBe(2);
  });

  it("recusa texto sem quantidade", () => {
    expect(parseReplyCount("oi", 12)).toBeNull();
    expect(parseReplyCount("   ", 12)).toBeNull();
    expect(parseReplyCount(null, 12)).toBeNull();
  });
});
