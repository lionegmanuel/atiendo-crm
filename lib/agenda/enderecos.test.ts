import { describe, expect, it } from "vitest";

import {
  enderecoJaConhecido,
  juntarEnderecos,
  normalizarEndereco,
  podeSalvarEndereco,
} from "./enderecos";

describe("endereços reutilizáveis na marcação", () => {
  it("normaliza espaço e recorta ponta", () => {
    expect(normalizarEndereco("  Rua  das   Flores, 10  ")).toBe("Rua das Flores, 10");
  });

  it("junta salvos primeiro, depois os já usados, sem repetir maiúscula", () => {
    expect(
      juntarEnderecos(["Sala 1"], ["sala 1", "Unidade Centro", "  "], ""),
    ).toEqual(["Sala 1", "Unidade Centro"]);
  });

  it("filtra pelo que foi digitado, sem distinguir maiúscula", () => {
    expect(
      juntarEnderecos(["Sala 1", "Sala 2"], ["Unidade Centro"], "sala"),
    ).toEqual(["Sala 1", "Sala 2"]);
  });

  it("só oferece salvar o que ainda não está na lista", () => {
    expect(podeSalvarEndereco(["Sala 1"], "sala 1")).toBe(false);
    expect(podeSalvarEndereco(["Sala 1"], "Sala 2")).toBe(true);
    expect(podeSalvarEndereco([], "   ")).toBe(false);
  });

  it("reconhece o mesmo endereço com espaço extra", () => {
    expect(enderecoJaConhecido(["Rua das Flores, 10"], "  rua das flores, 10 ")).toBe(true);
  });
});
