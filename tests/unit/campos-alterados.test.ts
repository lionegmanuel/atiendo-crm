import { describe, expect, it } from "vitest";

import { camposAlterados } from "@/lib/leads/campos-alterados";

/**
 * O caso que motivou o arquivo, medido na tela (sonda D20): mudei APENAS a
 * descrição e a timeline registrou "Alterou o título, a descrição, o valor, a
 * data prevista de fechamento e as tags".
 */
const ANTES = {
  id: "abc",
  title: "Carlos — Clínica Vida",
  description: "estourou o prazo do estágio",
  value_cents: 45000,
  currency: "BRL",
  expected_close_date: "2026-08-01",
  tags: ["vip", "recompra"],
  owner_user_id: null,
  updated_at: "2026-07-25T10:00:00Z",
};

describe("camposAlterados", () => {
  it("o formulário manda tudo; só a descrição mudou", () => {
    const patch = {
      updated_at: "2026-07-25T11:28:00Z",
      title: ANTES.title,
      description: "outro texto",
      value_cents: ANTES.value_cents,
      expected_close_date: ANTES.expected_close_date,
      tags: ["recompra", "vip"], // mesma coisa, ordem trocada
    };
    expect(camposAlterados(patch, ANTES)).toEqual(["description"]);
  });

  it("salvar sem mexer em nada não é acontecimento — lista vazia", () => {
    const patch = {
      updated_at: "2026-07-25T11:28:00Z",
      title: ANTES.title,
      description: ANTES.description,
      tags: [...ANTES.tags],
    };
    expect(camposAlterados(patch, ANTES)).toEqual([]);
  });

  it("campo derivado nunca é 'o que a pessoa alterou'", () => {
    // `assigned_at`/`updated_at` são carimbo da máquina. Nomeá-los seria mentir
    // na outra direção: dizer que a pessoa mexeu no que ela não vê.
    const patch = { updated_at: "novo", assigned_at: "novo", owner_kind: "user" };
    expect(camposAlterados(patch, ANTES)).toEqual([]);
  });

  it("vazio e nulo são o mesmo estado — não marcam alteração", () => {
    // A coluna volta `null` do banco e o form manda `""`. Sem isto, todo
    // salvamento de campo em branco acusaria mudança.
    expect(camposAlterados({ owner_user_id: "" }, ANTES)).toEqual([]);
    expect(camposAlterados({ description: null }, { description: undefined })).toEqual([]);
  });

  it("tags: acrescentar é alteração, reordenar não", () => {
    expect(camposAlterados({ tags: ["vip", "recompra", "novo"] }, ANTES)).toEqual(["tags"]);
    expect(camposAlterados({ tags: ["recompra", "vip"] }, ANTES)).toEqual([]);
  });

  it("campo NOVO no patch, ausente no anterior, conta como alteração", () => {
    // Com `select("*")` isto só acontece quando a coluna é de fato nova; a
    // guarda existe para o caso não passar despercebido.
    expect(camposAlterados({ custom_fields: { plano: "premium" } }, ANTES)).toEqual([
      "custom_fields",
    ]);
  });

  it("número não vira string por acidente", () => {
    expect(camposAlterados({ value_cents: 45000 }, ANTES)).toEqual([]);
    expect(camposAlterados({ value_cents: 45001 }, ANTES)).toEqual(["value_cents"]);
  });
});
