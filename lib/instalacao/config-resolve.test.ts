import { describe, expect, it } from "vitest";

import { precisaSemear, resolver, type EstadoDaLinha } from "./config-resolve";

const doBanco = (valor: string | null, semeadoDoEnv: boolean): EstadoDaLinha => ({
  valor,
  semeadoDoEnv,
});

describe("resolver — quem vence entre o banco e o .env", () => {
  it("sem linha no banco, o .env responde", () => {
    expect(resolver(null, "sk-do-env")).toEqual({ valor: "sk-do-env", fonte: "ambiente" });
  });

  it("com linha no banco, o banco vence o .env", () => {
    expect(resolver(doBanco("sk-da-tela", false), "sk-do-env")).toEqual({
      valor: "sk-da-tela",
      fonte: "banco",
    });
  });

  it("sem linha e sem .env, a resposta é ausente — nunca uma string vazia", () => {
    expect(resolver(null, null)).toEqual({ valor: null, fonte: "ausente" });
    expect(resolver(null, "")).toEqual({ valor: null, fonte: "ausente" });
    expect(resolver(null, "   ")).toEqual({ valor: null, fonte: "ausente" });
  });

  it("linha apagada de propósito (valor nulo) não ressuscita o .env pela leitura", () => {
    // Apagar a LINHA é o 'voltar ao padrão'. Uma linha que existe com valor nulo
    // é outra coisa: é o operador tendo esvaziado o campo. O .env não a desfaz.
    expect(resolver(doBanco(null, false), "sk-do-env")).toEqual({
      valor: null,
      fonte: "banco",
    });
  });
});

describe("precisaSemear — o .env promove, mas nunca desfaz escolha humana", () => {
  it("sem nada no .env, não semeia", () => {
    expect(precisaSemear(null, null)).toBe("nao");
    expect(precisaSemear(null, "  ")).toBe("nao");
  });

  it("sem linha e com .env, insere", () => {
    expect(precisaSemear(null, "sk-do-env")).toBe("inserir");
  });

  it("linha escrita por uma PESSOA nunca é re-semeada, mesmo com o .env diferente", () => {
    expect(precisaSemear(doBanco("sk-da-tela", false), "sk-do-env")).toBe("nao");
  });

  it("linha escrita por uma pessoa e depois esvaziada continua protegida", () => {
    // O caso que mata o campo: a pessoa apaga de propósito para voltar ao padrão
    // do produto, e a semeadura do render seguinte reescreve o valor antigo.
    expect(precisaSemear(doBanco(null, false), "sk-do-env")).toBe("nao");
  });

  it("linha semeada do .env acompanha o .env quando ele muda", () => {
    expect(precisaSemear(doBanco("sk-antiga", true), "sk-nova")).toBe("atualizar");
  });

  it("linha semeada do .env com o mesmo valor não escreve à toa", () => {
    expect(precisaSemear(doBanco("sk-igual", true), "sk-igual")).toBe("nao");
  });

  it("o .env esvaziado não apaga o que já foi semeado", () => {
    expect(precisaSemear(doBanco("sk-antiga", true), null)).toBe("nao");
  });
});
