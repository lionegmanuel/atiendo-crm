import { afterEach, describe, expect, it } from "vitest";

import { canalLigado, gravarCanal, lerPrefs } from "./prefs";

describe("prefs de notificação", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("liga e desliga canal por categoria", () => {
    expect(canalLigado("lead_assigned", "in_app")).toBe(true);
    gravarCanal("lead_assigned", "in_app", false);
    expect(lerPrefs().lead_assigned.in_app).toBe(false);
    expect(canalLigado("lead_won", "push")).toBe(true);
  });

  it("espelha push de mensagem no interruptor legado", () => {
    gravarCanal("message", "push", false);
    expect(window.localStorage.getItem("alerts.enabled")).toBe("0");
    gravarCanal("message", "push", true);
    expect(window.localStorage.getItem("alerts.enabled")).toBe("1");
  });
});
