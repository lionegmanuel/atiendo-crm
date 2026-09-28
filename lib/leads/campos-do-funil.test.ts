import { describe, expect, it } from "vitest";

import { camposDoFunil, settingsDoEmbed } from "./campos-do-funil";

describe("camposDoFunil", () => {
  it("ignora entradas que não passam no schema", () => {
    expect(
      camposDoFunil({
        fields: [{ key: "endereco", label: "Endereço", type: "text" }, { key: "??" }],
      }),
    ).toEqual([{ key: "endereco", label: "Endereço", type: "text" }]);
  });
});

describe("settingsDoEmbed", () => {
  it("lê o objeto to-one do PostgREST", () => {
    expect(
      settingsDoEmbed({ settings: { fields: [{ key: "empresa", label: "Empresa", type: "text" }] } }),
    ).toEqual({ fields: [{ key: "empresa", label: "Empresa", type: "text" }] });
  });

  it("lê array (relação que vacilou) pelo primeiro item", () => {
    expect(settingsDoEmbed([{ settings: { fields: [] } }])).toEqual({ fields: [] });
  });

  it("lixo vira null — o painel mostra os campos padrão, não explode", () => {
    expect(settingsDoEmbed(null)).toBeNull();
    expect(settingsDoEmbed("x")).toBeNull();
    expect(settingsDoEmbed({ settings: "não" })).toBeNull();
    expect(settingsDoEmbed({ settings: [1] })).toBeNull();
  });
});
