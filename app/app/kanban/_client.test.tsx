import { describe, expect, it } from "vitest";

import { vizinhoAoMover, type FunilDaLista } from "./_client";

const funil = (id: string): FunilDaLista => ({
  id,
  name: id,
  slug: id,
  description: null,
  position: 1000,
  is_default: false,
});

/**
 * A conta do `i - 2` é a única lógica não-óbvia da tela, e ela erra em silêncio:
 * um funil que "sobe" e não sai do lugar parece lentidão, não bug.
 */
describe("vizinhoAoMover", () => {
  const lista = [funil("a"), funil("b"), funil("c"), funil("d")];

  it("subir troca com quem está acima — o novo vizinho de cima é quem estava DUAS casas acima", () => {
    expect(vizinhoAoMover(lista, 2, "subir")).toBe("a");
  });

  it("subir da segunda posição leva ao topo (sem vizinho de cima)", () => {
    expect(vizinhoAoMover(lista, 1, "subir")).toBeNull();
  });

  it("descer põe o funil logo abaixo do vizinho de baixo", () => {
    expect(vizinhoAoMover(lista, 0, "descer")).toBe("b");
  });

  it("descer do penúltimo aponta para o último", () => {
    expect(vizinhoAoMover(lista, 2, "descer")).toBe("d");
  });

  it("não inventa vizinho fora da lista", () => {
    // A tela desabilita as setas nas pontas; se um dia deixar de desabilitar,
    // isto vira `depois_de: null` (topo) em vez de um id inexistente que a rota
    // recusaria com 422.
    expect(vizinhoAoMover(lista, 0, "subir")).toBeNull();
    expect(vizinhoAoMover(lista, 3, "descer")).toBeNull();
  });
});
