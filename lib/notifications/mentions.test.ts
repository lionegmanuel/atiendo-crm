import { describe, expect, it } from "vitest";

import { mencaoAtingeUsuario, tokensDeMencao } from "./mentions";

describe("menções em nota", () => {
  const user = { id: "u-1", email: "ana.silva@clinica.com", full_name: "Ana Silva" };

  it("extrai tokens", () => {
    expect(tokensDeMencao("oi @Ana e @ana.silva")).toEqual(["ana", "ana.silva"]);
  });

  it("casa e-mail, local-part e primeiro nome", () => {
    expect(mencaoAtingeUsuario("fala @ana.silva@clinica.com", user)).toBe(true);
    expect(mencaoAtingeUsuario("fala @ana.silva", user)).toBe(true);
    expect(mencaoAtingeUsuario("fala @Ana", user)).toBe(true);
    expect(mencaoAtingeUsuario("sem menção", user)).toBe(false);
  });
});
