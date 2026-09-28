import { describe, expect, it } from "vitest";

import { shouldNotifyInbound } from "./policy";

describe("shouldNotifyInbound", () => {
  const base = {
    direction: "inbound" as const,
    conversationId: "c1",
    openConversationId: "c2",
    tabFocused: true,
  };

  it("emite inbound de outra conversa com a aba em foco", () => {
    expect(shouldNotifyInbound(base)).toBe(true);
  });

  it("pula inbound da conversa já aberta na aba em foco", () => {
    expect(shouldNotifyInbound({ ...base, openConversationId: "c1" })).toBe(false);
  });

  it("emite inbound da conversa aberta se a aba NÃO está em foco", () => {
    expect(shouldNotifyInbound({ ...base, openConversationId: "c1", tabFocused: false })).toBe(
      true,
    );
  });

  it("pula outbound", () => {
    expect(shouldNotifyInbound({ ...base, direction: "outbound" })).toBe(false);
  });

  it("pula payload sintético de reassinatura", () => {
    expect(shouldNotifyInbound({ ...base, tipo: "reassinado" })).toBe(false);
  });

  it("pula sem conversationId", () => {
    expect(shouldNotifyInbound({ ...base, conversationId: null })).toBe(false);
  });
});
