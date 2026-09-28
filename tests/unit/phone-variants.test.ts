import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { canonicalPhoneBR, phoneForDisplay, phoneLookupVariants, samePhone } from "@/lib/channels/phone-variants";

/** Payloads REAIS capturados da WABA de teste em 2026-07-29. */
const INBOUND = JSON.parse(
  readFileSync("tests/fixtures/meta/inbound-webhooks.json", "utf8"),
) as Array<{ entry: Array<{ changes: Array<{ value: { contacts?: Array<{ wa_id: string }> } }> }> }>;

const waIdReal = INBOUND[0]!.entry[0]!.changes[0]!.value.contacts![0]!.wa_id;

describe("o caso que motivou o módulo — medido, não suposto", () => {
  it("o `wa_id` real do inbound tem 12 dígitos", () => {
    // Se esta asserção quebrar, a Meta mudou o formato e todo o resto precisa ser
    // re-medido antes de confiar.
    expect(waIdReal).toBe("553198966398");
    expect(waIdReal).toHaveLength(12);
  });

  it("o número para o qual ENVIAMOS tem 13 — e é a mesma pessoa", () => {
    expect(samePhone(waIdReal, "5531998966398")).toBe(true);
  });

  it("sem o módulo, os dois seriam contatos diferentes", () => {
    // A prova de que o problema existe: comparação crua diz que não é a mesma pessoa.
    expect(`+${waIdReal}`).not.toBe("+5531998966398");
  });
});

describe("phoneLookupVariants", () => {
  it("celular de 12 dígitos ganha a variante COM o nono", () => {
    expect(phoneLookupVariants("553198966398")).toEqual(["+553198966398", "+5531998966398"]);
  });

  it("celular de 13 dígitos ganha a variante SEM o nono", () => {
    expect(phoneLookupVariants("5531998966398")).toEqual(["+5531998966398", "+553198966398"]);
  });

  it("a original vem SEMPRE primeiro — a busca tenta o que chegou antes do palpite", () => {
    expect(phoneLookupVariants("553198966398")[0]).toBe("+553198966398");
    expect(phoneLookupVariants("5531998966398")[0]).toBe("+5531998966398");
  });

  it("FIXO de 12 dígitos NÃO ganha variante — fundir dois contatos não tem volta", () => {
    // 3xxx é fixo em BH. Adicionar um 9 criaria um celular inexistente e poderia
    // casar com o número de outra pessoa.
    expect(phoneLookupVariants("553132345678")).toEqual(["+553132345678"]);
    expect(phoneLookupVariants("551123456789")).toEqual(["+551123456789"]);
  });

  it("número de fora do Brasil sai com variante única", () => {
    // O número de teste da própria WABA é americano.
    expect(phoneLookupVariants("15556320979")).toEqual(["+15556320979"]);
    expect(phoneLookupVariants("351912345678")).toEqual(["+351912345678"]);
  });

  it("estrangeiro com FORMATO parecido com BR não ganha variante", () => {
    // Este caso existe porque a sabotagem "remover a checagem de +55" passou VERDE
    // com os dois exemplos acima: os dois cairiam fora das regras de qualquer jeito,
    // por tamanho. Ou seja, eles não provavam nada sobre a checagem de país.
    //
    // `123498765432` tem 12 dígitos, "34" passaria como DDD e "98765432" cai na faixa
    // de celular — sem a checagem de país, ganharia a variante espúria +34998765432,
    // que é o número de OUTRA pessoa em outro país.
    expect(phoneLookupVariants("123498765432")).toEqual(["+123498765432"]);
  });

  it("aceita formatação humana e devolve E.164", () => {
    expect(phoneLookupVariants("+55 (31) 99896-6398")).toEqual([
      "+5531998966398",
      "+553198966398",
    ]);
  });

  it("DDD inválido não gera palpite", () => {
    expect(phoneLookupVariants("550198966398")).toEqual(["+550198966398"]);
  });

  it("vazio devolve lista vazia, não `+`", () => {
    expect(phoneLookupVariants("")).toEqual([]);
    expect(phoneLookupVariants("abc")).toEqual([]);
  });

  it("13 dígitos que NÃO começam em 9 no local ficam sozinhos", () => {
    // Não é o padrão de celular brasileiro; remover o primeiro dígito seria chute.
    expect(phoneLookupVariants("5531812345678")).toEqual(["+5531812345678"]);
  });
});

describe("canonicalPhoneBR — o CRM guarda e mostra COM o nono", () => {
  it("o caso que o operador lê como dois números é um só, com o 9", () => {
    expect(canonicalPhoneBR("+553284793302")).toBe("+5532984793302");
    expect(canonicalPhoneBR("+5532984793302")).toBe("+5532984793302");
    expect(samePhone("+553284793302", "+5532984793302")).toBe(true);
  });

  it("celular de 12 dígitos ganha o nono; o de 13 já está canônico", () => {
    expect(canonicalPhoneBR("553198966398")).toBe("+5531998966398");
    expect(canonicalPhoneBR("+55 (31) 99896-6398")).toBe("+5531998966398");
  });

  it("FIXO não ganha 9 — fundir com um celular inventado não tem volta", () => {
    expect(canonicalPhoneBR("553132345678")).toBe("+553132345678");
    expect(canonicalPhoneBR("551123456789")).toBe("+551123456789");
  });

  it("fora do Brasil não inventa regra", () => {
    expect(canonicalPhoneBR("+595991733685")).toBe("+595991733685");
    expect(canonicalPhoneBR("15556320979")).toBe("+15556320979");
  });

  it("phoneForDisplay vazio continua vazio", () => {
    expect(phoneForDisplay(null)).toBe("");
    expect(phoneForDisplay("  ")).toBe("");
    expect(phoneForDisplay("+553284793302")).toBe("+5532984793302");
  });
});

describe("samePhone", () => {
  it("é simétrico", () => {
    expect(samePhone("553198966398", "5531998966398")).toBe(true);
    expect(samePhone("5531998966398", "553198966398")).toBe(true);
  });

  it("pessoas diferentes continuam diferentes", () => {
    expect(samePhone("5531998966398", "5531998966399")).toBe(false);
    expect(samePhone("553198966398", "553198966399")).toBe(false);
  });

  it("fixo e celular com dígitos parecidos NÃO se confundem", () => {
    expect(samePhone("553132345678", "5531932345678")).toBe(false);
  });
});
