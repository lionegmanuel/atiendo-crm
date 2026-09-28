/**
 * A DECISÃO da sincronização — onde o catálogo pode encolher sozinho.
 *
 * O risco desta peça não é errar uma linha: é apagar em massa. Três formas de
 * fazer isso, todas silenciosas para quem só olha a tela:
 *
 *  1. varrer a tabela inteira e levar junto a curadoria semeada por migration;
 *  2. acreditar numa resposta parcial da origem e depreciar o catálogo todo;
 *  3. deletar em vez de depreciar, e levar junto o preço com que a conta do mês
 *     passado foi somada.
 */
import { describe, expect, it } from "vitest";

import type { LinhaDeCatalogo } from "@/lib/ai/catalogo/openrouter";
import {
  CatalogoSuspeitoError,
  planejarSincronizacao,
  type ModeloExistente,
} from "@/lib/ai/catalogo/sincronizar";

const linha = (model_id: string): LinhaDeCatalogo => ({
  provider: "openrouter",
  model_id,
  display_name: model_id,
  description: null,
  context_window: null,
  input_price_per_million_cents: 10,
  output_price_per_million_cents: 20,
  supports_tools: true,
  supports_vision: false,
  source: "openrouter",
});

const existente = (model_id: string, deprecated = false): ModeloExistente => ({
  model_id,
  deprecated_at: deprecated ? "2026-01-01T00:00:00Z" : null,
});

describe("o caminho normal", () => {
  it("grava tudo que veio da origem", () => {
    const p = planejarSincronizacao([linha("a"), linha("b")], [existente("a")]);
    expect(p.paraGravar.map((l) => l.model_id)).toEqual(["a", "b"]);
  });

  it("deprecia o que sumiu da origem", () => {
    const p = planejarSincronizacao([linha("a"), linha("b")], [existente("a"), existente("b"), existente("c")]);
    expect(p.paraDepreciar).toEqual(["c"]);
  });

  it("ressuscita o que voltou", () => {
    // Sem isto, uma indisponibilidade momentânea da origem enterraria
    // permanentemente parte do catálogo, e a lista encolheria sozinha na tela
    // sem nada explicando.
    const p = planejarSincronizacao([linha("a"), linha("c")], [existente("a"), existente("c", true)]);
    expect(p.paraRessuscitar).toEqual(["c"]);
    expect(p.paraDepreciar).toEqual([]);
  });

  it("não deprecia quem já estava depreciado e continua fora", () => {
    // Depreciar de novo reescreveria `deprecated_at` a cada rodada, e a data
    // deixaria de significar "quando saiu do catálogo".
    const p = planejarSincronizacao([linha("a")], [existente("a"), existente("z", true)]);
    expect(p.paraDepreciar).toEqual([]);
    expect(p.paraRessuscitar).toEqual([]);
  });
});

describe("o piso de sanidade", () => {
  it("recusa a rodada quando a origem devolve muito menos que o conhecido", () => {
    const noBanco = Array.from({ length: 400 }, (_, i) => existente(`m${i}`));
    expect(() => planejarSincronizacao([linha("m0"), linha("m1")], noBanco)).toThrow(
      CatalogoSuspeitoError,
    );
  });

  it("a mensagem do erro diz os DOIS números", () => {
    // Um erro que só diz "abortado" manda o operador adivinhar. Os dois números
    // dizem se foi soluço da origem ou mudança real de catálogo.
    const noBanco = Array.from({ length: 100 }, (_, i) => existente(`m${i}`));
    try {
      planejarSincronizacao([linha("m0")], noBanco);
      expect.unreachable("deveria ter recusado");
    } catch (e) {
      expect(String((e as Error).message)).toContain("1 modelos");
      expect(String((e as Error).message)).toContain("100");
    }
  });

  it("aceita redução DENTRO do piso — catálogo encolhe de verdade às vezes", () => {
    // Se qualquer redução abortasse, uma limpeza legítima da origem travaria a
    // sincronização para sempre, e ninguém entenderia por que parou.
    const noBanco = Array.from({ length: 10 }, (_, i) => existente(`m${i}`));
    const daOrigem = Array.from({ length: 6 }, (_, i) => linha(`m${i}`));
    const p = planejarSincronizacao(daOrigem, noBanco);
    expect(p.paraDepreciar.sort()).toEqual(["m6", "m7", "m8", "m9"]);
  });

  it("a PRIMEIRA execução parte de zero e nunca é recusada", () => {
    // O piso comparado contra zero recusaria a primeira sincronização de toda
    // instalação nova — o catálogo nasceria vazio e o painel não teria o que
    // oferecer no dia da instalação.
    expect(() => planejarSincronizacao([linha("a")], [])).not.toThrow();
  });

  it("o piso só conta os ATIVOS, não os depreciados", () => {
    // Um banco com 400 depreciados e 3 ativos não pode exigir 200 da origem —
    // o histórico não é catálogo vigente.
    const noBanco = [
      ...Array.from({ length: 400 }, (_, i) => existente(`velho${i}`, true)),
      existente("a"),
      existente("b"),
      existente("c"),
    ];
    expect(() => planejarSincronizacao([linha("a"), linha("b")], noBanco)).not.toThrow();
  });

  it("origem vazia com catálogo cheio é sempre recusada", () => {
    // O caso extremo e o mais provável num incidente de rede.
    const noBanco = Array.from({ length: 10 }, (_, i) => existente(`m${i}`));
    expect(() => planejarSincronizacao([], noBanco)).toThrow(CatalogoSuspeitoError);
  });
});

describe("o plano nunca manda apagar", () => {
  it("não existe caminho que produza DELETE", () => {
    // A garantia é estrutural: o plano só tem gravar/depreciar/ressuscitar. Um
    // campo `paraApagar` que aparecesse aqui levaria junto o preço com que a
    // conta do mês passado foi somada.
    const p = planejarSincronizacao([linha("a")], [existente("b")]);
    expect(Object.keys(p).sort()).toEqual(["paraDepreciar", "paraGravar", "paraRessuscitar"]);
  });
});
