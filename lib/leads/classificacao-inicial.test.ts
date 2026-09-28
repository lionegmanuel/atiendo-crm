import { describe, expect, it } from "vitest";
import {
  avaliarDesqualificacao,
  avaliarRevisaoHumana,
  classificarLeadInicial,
  type EntradaClassificacaoInicial,
} from "@/lib/leads/classificacao-inicial";

function base(overrides: Partial<EntradaClassificacaoInicial> = {}): EntradaClassificacaoInicial {
  return {
    customFields: { viable_investment_range: "De R$ 4 mil a R$ 7 mil por mês", respondi_score: "55" },
    phoneNormalizado: "+5515988887777",
    consentGranted: true,
    consentPerguntado: true,
    contatoExistente: null,
    nomeDoEnvio: "Maria Exemplo",
    ...overrides,
  };
}

describe("avaliarDesqualificacao — só os 2 bloqueios técnicos/legais reais", () => {
  it("telefone ausente (null) desqualifica: contato_invalido", () => {
    expect(avaliarDesqualificacao(base({ phoneNormalizado: null }))).toBe("contato_invalido");
  });

  it("consentimento RECUSADO desqualifica: sem_consentimento", () => {
    expect(avaliarDesqualificacao(base({ consentGranted: false, consentPerguntado: true }))).toBe(
      "sem_consentimento",
    );
  });

  /**
   * O formulário que NÃO TEM a pergunta de autorização devolve `granted: false`
   * pelo mapeador (leitura defensiva correta: silêncio nunca vira concessão).
   * Desqualificar por isso desqualificaria TODO lead de um formulário assim —
   * é a mesma distinção que a guarda de envio faz com `declined_at`.
   */
  it("formulário que nem PERGUNTA não desqualifica — ninguém dizer não é diferente de dizer não", () => {
    expect(
      avaliarDesqualificacao(base({ consentGranted: false, consentPerguntado: false })),
    ).toBeNull();
  });

  it("'Ainda não posso investir' NÃO desqualifica mais (decisão 2026-08-25 — vira sinal de classe D)", () => {
    const r = avaliarDesqualificacao(
      base({ customFields: { viable_investment_range: "Ainda não posso investir" } }),
    );
    expect(r).toBeNull();
  });

  it("tudo em ordem: não desqualifica", () => {
    expect(avaliarDesqualificacao(base())).toBeNull();
  });
});

describe("avaliarRevisaoHumana — conflito de identidade", () => {
  it("contato novo (sem existente): nunca conflita", () => {
    expect(avaliarRevisaoHumana(base({ contatoExistente: null }))).toBeNull();
  });

  it("nome do envio bate com o nome existente: sem conflito", () => {
    const r = avaliarRevisaoHumana(
      base({ contatoExistente: { name: "Maria Exemplo" }, nomeDoEnvio: "maria exemplo" }),
    );
    expect(r).toBeNull();
  });

  it("nome do envio diverge do nome existente: conflito_de_identidade", () => {
    const r = avaliarRevisaoHumana(
      base({ contatoExistente: { name: "João Existente" }, nomeDoEnvio: "Maria Exemplo" }),
    );
    expect(r).toBe("conflito_de_identidade");
  });
});

describe("avaliarRevisaoHumana — spam", () => {
  it("nome só com dígitos: spam_suspeito", () => {
    expect(avaliarRevisaoHumana(base({ nomeDoEnvio: "123456" }))).toBe("spam_suspeito");
  });

  it("nome parece e-mail: spam_suspeito", () => {
    expect(avaliarRevisaoHumana(base({ nomeDoEnvio: "fulano@exemplo.com" }))).toBe("spam_suspeito");
  });

  it("nome parece URL: spam_suspeito", () => {
    expect(avaliarRevisaoHumana(base({ nomeDoEnvio: "www.spam.com" }))).toBe("spam_suspeito");
  });

  it("nome com caractere repetido 5x+: spam_suspeito", () => {
    expect(avaliarRevisaoHumana(base({ nomeDoEnvio: "aaaaaaa" }))).toBe("spam_suspeito");
  });

  it("nome é marcador conhecido de teste: spam_suspeito", () => {
    expect(avaliarRevisaoHumana(base({ nomeDoEnvio: "teste" }))).toBe("spam_suspeito");
  });

  it("nome normal: não é spam", () => {
    expect(avaliarRevisaoHumana(base({ nomeDoEnvio: "Maria Exemplo" }))).toBeNull();
  });

  it("company_name com URL embutida: spam_suspeito", () => {
    const r = avaliarRevisaoHumana(
      base({
        customFields: {
          viable_investment_range: "De R$ 4 mil a R$ 7 mil por mês",
          respondi_score: "55",
          company_name: "Confira em http://spam.example.com",
        },
      }),
    );
    expect(r).toBe("spam_suspeito");
  });

  it("commercial_challenge com sequência longa de dígitos (telefone embutido): spam_suspeito", () => {
    const r = avaliarRevisaoHumana(
      base({
        customFields: {
          viable_investment_range: "De R$ 4 mil a R$ 7 mil por mês",
          respondi_score: "55",
          commercial_challenge: "me chama no 11987654321 agora",
        },
      }),
    );
    expect(r).toBe("spam_suspeito");
  });
});

describe("avaliarRevisaoHumana — incoerência entre investimento atual e viável", () => {
  it("investe hoje MAIS do que diz que seria viável: incoerencia_investimento", () => {
    const r = avaliarRevisaoHumana(
      base({
        customFields: {
          respondi_score: "55",
          current_marketing_investment: "De R$ 10 mil a R$ 15 mil",
          viable_investment_range: "Até R$ 2 mil",
        },
      }),
    );
    expect(r).toBe("incoerencia_investimento");
  });

  it("investe hoje menos ou igual ao viável: sem incoerência", () => {
    const r = avaliarRevisaoHumana(
      base({
        customFields: {
          respondi_score: "55",
          current_marketing_investment: "Até R$ 2 mil",
          viable_investment_range: "De R$ 4 mil a R$ 7 mil por mês",
        },
      }),
    );
    expect(r).toBeNull();
  });

  it("um dos dois valores não parseia (texto fora do padrão 'N mil'): não afirma incoerência", () => {
    const r = avaliarRevisaoHumana(
      base({
        customFields: {
          respondi_score: "55",
          current_marketing_investment: "Não sei dizer",
          viable_investment_range: "De R$ 4 mil a R$ 7 mil por mês",
        },
      }),
    );
    expect(r).toBeNull();
  });
});

describe("classificarLeadInicial — orquestração e precedência", () => {
  it("desqualificação vence sobre revisão humana e sobre classe", () => {
    const r = classificarLeadInicial(
      base({ consentGranted: false, contatoExistente: { name: "Outro Nome" } }),
    );
    expect(r).toEqual({ status: "desqualificado", motivo: "sem_consentimento" });
  });

  it("revisão humana vence sobre classe quando não há desqualificação", () => {
    const r = classificarLeadInicial(base({ contatoExistente: { name: "Outro Nome" } }));
    expect(r).toEqual({ status: "revisao_humana", motivo: "conflito_de_identidade" });
  });

  it("sem respondi_score: nao_avaliado, nunca uma classe adivinhada", () => {
    const r = classificarLeadInicial(
      base({ customFields: { viable_investment_range: "De R$ 4 mil a R$ 7 mil por mês" } }),
    );
    expect(r).toEqual({ status: "classificado", classe: "nao_avaliado", percentual: null });
  });

  it("score 75: classe A", () => {
    const r = classificarLeadInicial(base({ customFields: { respondi_score: "75" } }));
    expect(r).toEqual({ status: "classificado", classe: "A", percentual: 75 });
  });

  it("score 55: classe B", () => {
    const r = classificarLeadInicial(base({ customFields: { respondi_score: "55" } }));
    expect(r).toEqual({ status: "classificado", classe: "B", percentual: 55 });
  });

  it("score 20: classe C", () => {
    const r = classificarLeadInicial(base({ customFields: { respondi_score: "20" } }));
    expect(r).toEqual({ status: "classificado", classe: "C", percentual: 20 });
  });

  it("score 0 (piso do critério combinado): classe D", () => {
    const r = classificarLeadInicial(base({ customFields: { respondi_score: "0" } }));
    expect(r).toEqual({ status: "classificado", classe: "D", percentual: 0 });
  });

  it("'Ainda não posso investir' força D mesmo com score alto — sinal forte do respondente vence o número", () => {
    const r = classificarLeadInicial(
      base({
        customFields: { respondi_score: "90", viable_investment_range: "Ainda não posso investir" },
      }),
    );
    expect(r).toEqual({ status: "classificado", classe: "D", percentual: 90 });
  });

  it("REGRESSÃO — orçamento inicial modesto (mas não a frase exata) NÃO força D sozinho: empresa de alto potencial com score 55 fica B, não D", () => {
    // Este é exatamente o cenário que Matheus rejeitou na primeira versão da
    // regra: "De R$ 4 mil a R$ 7 mil" não é a frase de desistência, é só uma
    // faixa mais baixa — não pode, sozinha, derrubar a classe.
    const r = classificarLeadInicial(
      base({
        customFields: { respondi_score: "55", viable_investment_range: "Até R$ 2 mil" },
      }),
    );
    expect(r).toEqual({ status: "classificado", classe: "B", percentual: 55 });
  });
});
