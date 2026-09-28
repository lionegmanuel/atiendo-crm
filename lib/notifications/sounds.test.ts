import { describe, expect, it } from "vitest";

import { playSound, SOUND_IDS } from "./sounds";

describe("catálogo de sons", () => {
  it("expõe os presets nomeados", () => {
    expect([...SOUND_IDS].sort()).toEqual(["attention", "failure", "message", "silent", "success"]);
  });

  it("playSound não lança sem AudioContext (jsdom)", () => {
    expect(() => playSound("silent")).not.toThrow();
    expect(() => playSound("message")).not.toThrow();
    expect(() => playSound("attention")).not.toThrow();
    expect(() => playSound("success")).not.toThrow();
    expect(() => playSound("failure")).not.toThrow();
    expect(() => playSound("message", 0)).not.toThrow();
    expect(() => playSound("message", 0.25)).not.toThrow();
  });
});
