import { describe, expect, it } from "vitest";

import {
  aiAccessUpdateSchema,
  lerModoDeAcessoDaIa,
  lerNumerosDeTeste,
  metadataInicialDoCanal,
  numeroPodeTestar,
} from "./pre-go-live";

describe("pré-go-live do canal", () => {
  it("todo canal novo nasce fechado e sem número autorizado", () => {
    const metadata = metadataInicialDoCanal();
    expect(lerModoDeAcessoDaIa(metadata)).toBe("pre_go_live");
    expect(lerNumerosDeTeste(metadata)).toEqual([]);
  });

  it("não chama allowlist legado de atendimento aberto", () => {
    expect(lerModoDeAcessoDaIa({ ai_gate: "allowlist" })).toBe("allowlist");
    expect(lerModoDeAcessoDaIa({ ai_gate: "open" })).toBe("open");
    expect(lerModoDeAcessoDaIa({})).toBe("open");
  });

  it("normaliza, canoniza o nono dígito brasileiro e remove repetidos", () => {
    const resultado = aiAccessUpdateSchema.parse({
      mode: "pre_go_live",
      test_phone_numbers: ["+55 (85) 98765-4321", "+5585987654321"],
    });
    expect(resultado.test_phone_numbers).toEqual(["+5585987654321"]);
  });

  it("recusa texto que não identifica um telefone E.164", () => {
    const resultado = aiAccessUpdateSchema.safeParse({
      mode: "pre_go_live",
      test_phone_numbers: ["meu celular"],
    });
    expect(resultado.success).toBe(false);
  });

  it("lê metadata adulterada descartando somente os itens inválidos", () => {
    expect(
      lerNumerosDeTeste({ ai_test_phone_numbers: ["lixo", "+5511987654321", 42] }),
    ).toEqual(["+5511987654321"]);
  });

  it("reconhece o mesmo celular brasileiro com ou sem o nono dígito", () => {
    expect(numeroPodeTestar("+558587654321", ["+5585987654321"])).toBe(true);
    expect(numeroPodeTestar("+558587654321", ["+5585987654000"])).toBe(false);
    expect(numeroPodeTestar(null, ["+5585987654321"])).toBe(false);
  });
});
