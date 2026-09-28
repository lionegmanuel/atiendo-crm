import { describe, expect, it } from "vitest";

import { limitarCampos } from "@/lib/webhooks/captacao";

/**
 * O TETO DE TAMANHO VALE PARA QUALQUER VALOR — não só para string.
 *
 * Quem manda o corpo do webhook de captação é o site do cliente, então o
 * tamanho não é escolha nossa. A primeira versão cortava só o ramo
 * `typeof valor === "string"` e todo o resto caía num `else` que guardava o
 * valor INTEIRO: um campo aninhado (array de carrinho, objeto de endereço,
 * qualquer JSON) entrava sem limite.
 *
 * O contrato prometido em dois lugares do próprio módulo — e usado para
 * dimensionar a retenção da tabela em `retencao-da-captacao.ts:20`, "60 campos
 * × 2.000 caracteres" — não tinha um único teste. `git grep limitarCampos --
 * tests` voltava vazio.
 */

const TETO = 2000;
const enorme = "x".repeat(TETO + 500);

describe("limitarCampos — o teto vale para todo valor", () => {
  it("string longa é cortada, com o `…` visível", () => {
    const r = limitarCampos({ obs: enorme });
    expect(typeof r.obs).toBe("string");
    expect((r.obs as string).length).toBe(TETO + 1); // o corte + o `…`
    expect((r.obs as string).endsWith("…")).toBe(true);
  });

  it("ARRAY grande é cortado — era o buraco: entrava inteiro", () => {
    const r = limitarCampos({ carrinho: Array.from({ length: 400 }, (_, i) => ({ sku: `item-${i}` })) });
    // Grande demais vira a string cortada — medir `JSON.stringify` do resultado
    // mediria as aspas e os escapes que a serialização acrescenta, não o valor.
    expect(typeof r.carrinho).toBe("string");
    expect((r.carrinho as string).length).toBe(TETO + 1);
    expect((r.carrinho as string).endsWith("…")).toBe(true);
  });

  it("OBJETO grande é cortado", () => {
    const gordo: Record<string, string> = {};
    for (let i = 0; i < 200; i += 1) gordo[`campo${i}`] = "valor razoavelmente longo aqui";
    const r = limitarCampos({ endereco: gordo });
    expect(typeof r.endereco).toBe("string");
    expect((r.endereco as string).length).toBe(TETO + 1);
  });

  it("referência circular não derruba a captação inteira", () => {
    // `JSON.stringify` LANÇA aqui. Sem o try/catch, uma linha de captação
    // inteira se perderia por causa de um campo — e é do formulário estranho
    // que quem depura mais precisa do registro.
    const circular: Record<string, unknown> = { nome: "ana" };
    circular.self = circular;
    expect(() => limitarCampos({ payload: circular })).not.toThrow();
    expect(limitarCampos({ payload: circular }).payload).toBe("[valor não serializável]");
  });

  it("CONTROLE: valor pequeno passa INTACTO, com o tipo original", () => {
    // Sem este caso, cortar tudo indiscriminadamente (ou serializar sempre)
    // passaria nos anteriores e destruiria a feature — o número viraria string.
    const r = limitarCampos({ nome: "ana", idade: 33, ativo: true, tags: ["a", "b"], nada: null });
    expect(r.nome).toBe("ana");
    expect(r.idade).toBe(33);
    expect(r.ativo).toBe(true);
    expect(r.tags).toEqual(["a", "b"]);
    expect(r.nada).toBeNull();
  });

  it("CONTROLE: o teto de 60 campos continua valendo", () => {
    const muitos: Record<string, string> = {};
    for (let i = 0; i < 120; i += 1) muitos[`c${i}`] = "v";
    expect(Object.keys(limitarCampos(muitos)).length).toBe(60);
  });
});
