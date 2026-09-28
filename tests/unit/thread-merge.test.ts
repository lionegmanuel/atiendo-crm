import { describe, expect, it } from "vitest";
import { mergeThreadItems } from "@/components/inbox/ChatThread";

describe("mergeThreadItems", () => {
  it("intercala mensagens e notas por tempo", () => {
    const msgs = [
      { id: "m1", sent_at: "2026-07-23T10:00:00Z" },
      { id: "m2", sent_at: "2026-07-23T10:02:00Z" },
    ] as never;
    const notes = [{ id: "n1", created_at: "2026-07-23T10:01:00Z" }] as never;
    const out = mergeThreadItems(msgs, notes);
    expect(out.map((i) => i.data.id)).toEqual(["m1", "n1", "m2"]);
    expect(out[1]!.kind).toBe("note");
  });

  it("sem notas → só mensagens", () => {
    const msgs = [{ id: "m1", sent_at: "2026-07-23T10:00:00Z" }] as never;
    expect(mergeThreadItems(msgs, []).every((i) => i.kind === "message")).toBe(true);
  });

  it("empate de timestamp mantém ordem estável (mensagem antes da nota)", () => {
    const msgs = [{ id: "m1", sent_at: "2026-07-23T10:00:00Z" }] as never;
    const notes = [{ id: "n1", created_at: "2026-07-23T10:00:00Z" }] as never;
    const out = mergeThreadItems(msgs, notes);
    expect(out.map((i) => i.data.id)).toEqual(["m1", "n1"]);
  });

  it("array vazio de ambos retorna vazio", () => {
    expect(mergeThreadItems([], [])).toEqual([]);
  });
});

/**
 * A PASSAGEM É O TERCEIRO TIPO DE ITEM DO FIO.
 *
 * Ela não é mensagem (não foi para o cliente) e não é nota (ninguém a escreveu),
 * mas entra no fio pelo mesmo mecanismo — e a posição dela no tempo é o que faz
 * o cartão aparecer onde o olho está: logo depois da última fala do cliente, que
 * é a fala que a causou.
 */
describe("mergeThreadItems — a passagem entra no fio", () => {
  const cartao = (id: string, criadoEm: string) => ({ id, criadoEm }) as never;

  it("o cartão entra pelo `criadoEm`, no meio das mensagens", () => {
    const msgs = [
      { id: "m1", sent_at: "2026-09-18T10:00:00Z" },
      { id: "m2", sent_at: "2026-09-18T10:05:00Z" },
    ] as never;
    const out = mergeThreadItems(msgs, [], [cartao("p1", "2026-09-18T10:02:00Z")]);
    expect(out.map((i) => i.data.id)).toEqual(["m1", "p1", "m2"]);
    expect(out[1]!.kind).toBe("passagem");
  });

  it("no MESMO instante da mensagem que a causou, o cartão vem DEPOIS dela", () => {
    // A passagem é consequência da última fala: mostrá-la antes inverteria a
    // causa na leitura de quem chega, e o empate de timestamp é o caso comum —
    // o motor grava as duas no mesmo turno.
    const msgs = [{ id: "m1", sent_at: "2026-09-18T10:00:00Z" }] as never;
    const notes = [{ id: "n1", created_at: "2026-09-18T10:00:00Z" }] as never;
    const out = mergeThreadItems(msgs, notes, [cartao("p1", "2026-09-18T10:00:00Z")]);
    expect(out.map((i) => i.data.id)).toEqual(["m1", "n1", "p1"]);
  });

  it("o terceiro argumento é OPCIONAL — conversa que nunca saiu do automático não tem nenhuma", () => {
    // Guarda de compatibilidade: o fio existe desde antes da passagem, e os dois
    // chamadores de duas linhas acima continuam válidos.
    const msgs = [{ id: "m1", sent_at: "2026-09-18T10:00:00Z" }] as never;
    expect(mergeThreadItems(msgs, []).map((i) => i.kind)).toEqual(["message"]);
  });

  it("só passagens, sem mensagem nenhuma, ainda é um fio com conteúdo", () => {
    // O fio vazio mostra "Nenhuma mensagem nesta conversa."; se a passagem não
    // contasse como item, uma conversa cujo histórico já foi expurgado abriria
    // dizendo que não há nada, com um cartão de passagem existindo no banco.
    const out = mergeThreadItems([], [], [cartao("p1", "2026-09-18T10:00:00Z")]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("passagem");
  });
});
