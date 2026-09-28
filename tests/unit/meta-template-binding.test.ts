import { describe, expect, it } from "vitest";

import {
  bindingState,
  explainBindingState,
  isSendable,
  type CurrentTemplate,
  type TemplateBinding,
} from "@/lib/channels/meta/template-binding";

const SALVO: TemplateBinding = {
  name: "pedido_confirmado",
  language: "pt_BR",
  contractHash: "abc123",
  values: { "1": "{{lead.nome}}" },
};

const ATUAL: CurrentTemplate = {
  name: "pedido_confirmado",
  language: "pt_BR",
  contractHash: "abc123",
  status: "APPROVED",
};

describe("bindingState", () => {
  it("hash igual e APPROVED = ok", () => {
    expect(bindingState(SALVO, ATUAL)).toBe("ok");
    expect(isSendable("ok")).toBe(true);
  });

  it("hash divergente = stale — alguém editou o template na Meta", () => {
    // É o caso que a fase inteira persegue: o corpo ganhou um {{3}} e a config
    // salva continua mandando 2 parâmetros. Sem esta trava, só o 132000 avisa.
    expect(bindingState(SALVO, { ...ATUAL, contractHash: "def456" })).toBe("stale");
    expect(isSendable("stale")).toBe(false);
  });

  it("template sumiu da Meta = missing", () => {
    expect(bindingState(SALVO, null)).toBe("missing");
  });

  it("template pausado ou rejeitado = not_approved, mesmo com hash igual", () => {
    expect(bindingState(SALVO, { ...ATUAL, status: "PAUSED" })).toBe("not_approved");
    expect(bindingState(SALVO, { ...ATUAL, status: "REJECTED" })).toBe("not_approved");
  });

  it("PENDING também não é enviável — 'quase aprovado' não existe no disparo", () => {
    expect(bindingState(SALVO, { ...ATUAL, status: "PENDING" })).toBe("not_approved");
  });

  it("idioma diferente NÃO casa — a chave é (name, language)", () => {
    // pt_BR e pt são templates distintos na Meta, com corpos e aprovações
    // independentes. Casar só por nome resolveria para o contrato errado.
    expect(bindingState(SALVO, { ...ATUAL, language: "pt" })).toBe("missing");
  });

  it("nome diferente NÃO casa", () => {
    expect(bindingState(SALVO, { ...ATUAL, name: "outro_template" })).toBe("missing");
  });

  it("precedência: não-aprovado E hash mudado reporta not_approved, não stale", () => {
    // Mandar o operador reconfigurar parâmetros de um template que a Meta
    // recusou é fazê-lo trabalhar à toa — a recusa é o problema anterior.
    expect(
      bindingState(SALVO, { ...ATUAL, status: "REJECTED", contractHash: "def456" }),
    ).toBe("not_approved");
  });

  it("precedência: sumido vence tudo", () => {
    expect(bindingState({ ...SALVO, contractHash: "qualquer" }, null)).toBe("missing");
  });
});

describe("explainBindingState", () => {
  it("cada estado tem frase própria, nomeando o template e o próximo passo", () => {
    const estados = ["missing", "not_approved", "stale", "ok"] as const;
    const frases = estados.map((e) => explainBindingState(e, SALVO));

    // Nenhuma frase genérica: item de inbox que diz só "config inválida"
    // transfere ao operador o trabalho de descobrir o quê, e vira ruído.
    expect(new Set(frases).size).toBe(4);
    for (const f of frases) {
      expect(f).toContain("pedido_confirmado");
      expect(f).toContain("pt_BR");
    }
    expect(explainBindingState("stale", SALVO)).toMatch(/mudou na Meta/);
    expect(explainBindingState("missing", SALVO)).toMatch(/não existe mais/);
  });
});
