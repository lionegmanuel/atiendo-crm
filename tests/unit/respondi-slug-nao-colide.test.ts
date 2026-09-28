import { describe, expect, it } from "vitest";

import { isRespondiPayload, mapRespondiPayload } from "@/lib/webhooks/respondi";

/**
 * "NUNCA DESCARTADAS" TEM DE SER VERDADE — inclusive para pergunta longa.
 *
 * O módulo promete, em `respondi.ts:196`, que pergunta sem alias conhecido é
 * "NUNCA descartada … entra sob uma chave derivada do próprio texto, pra
 * sobreviver a uma pergunta nova adicionada no Respondi sem exigir deploy".
 *
 * O slug cortava em 60 caracteres sem mais nada. Duas perguntas longas com os
 * mesmos 60 primeiros caracteres colidiam no `Record` e a última sobrescrevia a
 * primeira — sem erro, sem log, sem sinal na tela. A promessa e o código
 * discordavam, e quem paga é quem acrescenta duas perguntas parecidas no
 * formulário meses depois.
 *
 * Era LATENTE quando foi medido: as 15 perguntas do formulário real têm alias e
 * nenhuma chega ao slug. Este arquivo existe para que continue latente.
 */

/** Um payload Respondi mínimo, com as respostas que o caso precisa. */
function payload(answers: Record<string, string>) {
  const p = {
    form: { id: "f1", title: "Formulário" },
    respondent: { respondent_id: "r1", answers },
  };
  // Guarda de vacuidade: se a forma mudar, o teste não pode passar por não
  // exercitar nada — `mapRespondiPayload` só é chamada se o guard aceitar.
  expect(isRespondiPayload(p), "o payload de teste deixou de ser reconhecido").toBe(true);
  return p as Parameters<typeof mapRespondiPayload>[0];
}

/**
 * Só as chaves que o slug gerou. Elas vão para `custom_fields` — `source_metadata`
 * recebe apenas as `utm_*` (ver o `if` em `respondi.ts:235`). Minha primeira
 * versão olhava o campo errado e devolvia `[]`: instrumento quebrado devolvendo
 * zero, que passa por "nada errado" se ninguém tiver um controle.
 */
function chavesDeSlug(m: { custom_fields?: Record<string, unknown> }): string[] {
  return Object.keys(m.custom_fields ?? {}).filter((k) => k.startsWith("respondi_q_"));
}

const PREFIXO = "Qual e a sua expectativa de investimento para este imovel no"; // 60 chars de slug

describe("pergunta longa não some por colisão de slug", () => {
  it("duas perguntas com os mesmos 60 primeiros caracteres geram chaves DIFERENTES", () => {
    const m = mapRespondiPayload(
      payload({
        [`${PREFIXO} bairro Centro`]: "R$ 300 mil",
        [`${PREFIXO} bairro Jardins`]: "R$ 900 mil",
      }),
    );
    const chaves = chavesDeSlug(m);
    expect(chaves, "as duas perguntas colidiram numa chave só").toHaveLength(2);
    const valores = chaves.map((k) => m.custom_fields?.[k]);
    expect(new Set(valores).size, "uma resposta sobrescreveu a outra").toBe(2);
  });

  it("o limiar: divergir no caractere 61 ainda produz duas chaves", () => {
    // Antes do conserto, este era exatamente o caso que colidia — divergir DEPOIS
    // do corte. Divergir antes do 60 nunca colidiu, então não prova nada.
    const base = "a".repeat(60);
    const m = mapRespondiPayload(payload({ [`${base}X`]: "um", [`${base}Y`]: "dois" }));
    expect(chavesDeSlug(m)).toHaveLength(2);
  });

  it("CONTROLE: pergunta CURTA mantém o slug limpo, sem sufixo", () => {
    // Sem este caso, sufixar TUDO passaria nos dois acima e mudaria o nome de
    // toda chave existente — quebrando quem já lê `respondi_q_orcamento`.
    const m = mapRespondiPayload(payload({ "Qual seu orçamento?": "R$ 500 mil" }));
    expect(chavesDeSlug(m)).toEqual(["respondi_q_qual_seu_orcamento"]);
  });

  it("CONTROLE: o valor da resposta chega inteiro", () => {
    const m = mapRespondiPayload(payload({ "Observações do cliente": "quer mudar em janeiro" }));
    expect(m.custom_fields?.respondi_q_observacoes_do_cliente).toBe("quer mudar em janeiro");
  });
});
