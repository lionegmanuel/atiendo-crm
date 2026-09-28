/**
 * O MARCADOR DO CONTATO É NORMALIZADO NA ESCRITA — E A REGRA É UMA SÓ (issue #1224).
 *
 * Defeito: a ficha normalizava ao gravar (`trim().toLowerCase()`), e os outros
 * caminhos não. Um marcador que entrou como "VIP" pela API, pela importação de
 * CSV ou pela assistente (MCP) ficava no banco com a caixa que veio do cliente, e
 * o filtro da lista — que procura em caixa baixa (`?tag=vip` →
 * `contains("tags", ["vip"])`) — devolvia lista vazia com o chip bem visível na
 * ficha do contato. Ninguém via erro: só o contato que não aparecia.
 *
 * Conserto: `lib/contacts/tag-normalizada.ts` passa a ser o ÚNICO lugar onde a
 * regra existe (corta as pontas, minúsculas, teto de 40 caracteres, sem
 * repetição), e todos os caminhos de escrita passam por ela — API
 * (`lib/schemas/contacts.ts`), importação por CSV (`lib/contacts/csv.ts`), ficha
 * (`components/contacts/NewContactDialog.tsx` e `EditContactDialog.tsx`) e
 * `crm_manage_tags` (`lib/mcp/tools/governance.ts`, coberto em
 * `mcp-governance-tools.test.ts`).
 *
 * O que este teste mede é só o valor que sairia gravado e o valor que o filtro
 * procura: se os dois forem iguais, o contato aparece na lista. Nada aqui espiona
 * implementação — trocar a normalização de lugar não deve deixar este arquivo
 * vermelho, desde que escrita e filtro continuem na mesma regra.
 */
import { describe, expect, it } from "vitest";

import { mapLinha } from "@/lib/contacts/csv";
import { normalizarTag, normalizarTags } from "@/lib/contacts/tag-normalizada";
import {
  contactCreateSchema,
  contactListQuerySchema,
  contactPatchSchema,
} from "@/lib/schemas/contacts";

describe("normalizarTag / normalizarTags (a regra única)", () => {
  it("caixa mista e espaço nas pontas viram caixa baixa", () => {
    expect(normalizarTag("VIP")).toBe("vip");
    expect(normalizarTag("  Vip  ")).toBe("vip");
    expect(normalizarTag("São Paulo")).toBe("são paulo");
  });

  it("o teto de 40 caracteres vale por marcador, e não pela lista", () => {
    expect(normalizarTag("a".repeat(45))).toBe("a".repeat(40));
    expect(normalizarTags(["b".repeat(45), "curto"])).toEqual(["b".repeat(40), "curto"]);
  });

  it("lista: descarta vazio, não repete e preserva a ordem da primeira aparição", () => {
    expect(normalizarTags(["VIP", " vip ", "", "   ", "Suporte", "VIP"])).toEqual([
      "vip",
      "suporte",
    ]);
    expect(normalizarTags([])).toEqual([]);
  });
});

describe("o que a escrita grava é o que o filtro procura (#1224)", () => {
  it("contactCreateSchema grava o marcador em caixa baixa", () => {
    const criado = contactCreateSchema.parse({
      name: "Cliente Exemplo",
      email: "cliente@exemplo.com",
      tags: ["VIP", " vip ", "Suporte"],
    });

    expect(criado.tags).toEqual(["vip", "suporte"]);
  });

  it("contactPatchSchema grava o marcador em caixa baixa", () => {
    expect(contactPatchSchema.parse({ tags: ["VIP"] }).tags).toEqual(["vip"]);
  });

  it("o filtro procura pelo mesmo valor que a ficha gravou", () => {
    const criado = contactCreateSchema.parse({ tags: ["VIP"] });
    const filtro = contactListQuerySchema.parse({ tag: "VIP" });

    // A comparação do handler é `contains("tags", [q.tag])`: é esta igualdade que
    // faz o contato marcado como "VIP" aparecer em `?tag=vip`.
    expect(criado.tags).toEqual([filtro.tag]);
  });
});

describe("a importação por CSV normaliza o marcador da planilha", () => {
  it("caixa mista, espaço nas pontas e repetido entram como um marcador só", () => {
    const { contato, motivo } = mapLinha(
      ["Cliente Exemplo", "cliente@exemplo.com", "VIP; Suporte |vip"],
      { name: 0, email: 1, tags: 2 },
    );

    expect(motivo).toBeNull();
    expect(contato.tags).toEqual(["vip", "suporte"]);
  });

  it("o teto de 20 marcadores da planilha continua valendo", () => {
    const planilha = Array.from({ length: 25 }, (_, i) => `Marcador ${i}`).join(";");

    const { contato } = mapLinha(
      ["Cliente Exemplo", "cliente@exemplo.com", planilha],
      { name: 0, email: 1, tags: 2 },
    );

    expect(contato.tags).toHaveLength(20);
    expect(contato.tags?.[0]).toBe("marcador 0");
  });

  it("coluna de marcadores vazia não inventa marcador", () => {
    const { contato } = mapLinha(
      ["Cliente Exemplo", "cliente@exemplo.com", "  ; | "],
      { name: 0, email: 1, tags: 2 },
    );

    expect(contato.tags).toBeUndefined();
  });
});
