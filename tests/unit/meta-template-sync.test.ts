import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { hashContract } from "@/lib/channels/meta/contract-hash";
import {
  TEMPLATE_STATUS_DISABLED,
  planSync,
  templatesToRows,
  type LocalTemplate,
  type MetaTemplateRow,
} from "@/lib/channels/meta/template-sync";

const FIXTURE: unknown = JSON.parse(
  readFileSync("tests/fixtures/meta/message-templates.json", "utf8"),
);

const ORG = "11111111-1111-4000-8000-000000000001";
const WABA = "2434045433735175";

function rows(): MetaTemplateRow[] {
  return templatesToRows(FIXTURE, ORG, WABA);
}

function row(name: string): MetaTemplateRow {
  const found = rows().find((r) => r.name === name);
  if (!found) throw new Error(`fixture sem ${name}`);
  return found;
}

/** Payload mínimo da Graph API, no formato `{ data: [...] }`. */
function payload(...templates: Record<string, unknown>[]): unknown {
  return { data: templates };
}

const BODY_1 = [{ type: "BODY", text: "Oi {{1}}" }];

describe("templatesToRows — o espelho local sai da resposta da Meta, sem redigitação", () => {
  it("os 5 templates reais viram 5 linhas, carimbadas com org e WABA", () => {
    const out = rows();
    expect(out).toHaveLength(5);
    expect(new Set(out.map((r) => r.organization_id))).toEqual(new Set([ORG]));
    expect(new Set(out.map((r) => r.waba_id))).toEqual(new Set([WABA]));
    expect(out.map((r) => `${r.name}/${r.language}`)).toContain(
      "jaspers_market_order_confirmation_v1/en_US",
    );
  });

  it("contract_hash é DERIVADO de components — nunca vem da Meta nem é digitado", () => {
    const r = row("jaspers_market_order_confirmation_v1");
    expect(r.contract_hash).toBe(hashContract(r.components, r.parameter_format));
    // E é o hash do CONTRATO: o carrossel (6 slots) não pode colidir com o texto puro.
    expect(r.contract_hash).not.toBe(row("jaspers_market_plain_text_v1").contract_hash);
  });

  it("parameter_format ausente vale POSITIONAL — é o que a Meta assume", () => {
    // Medido contra a WABA real: o campo só vem quando pedido nos `fields`.
    expect(new Set(rows().map((r) => r.parameter_format))).toEqual(new Set(["POSITIONAL"]));
  });

  it("NAMED muda o hash do MESMO components — senão o flip para NAMED passa em silêncio", () => {
    const [posicional] = templatesToRows(
      payload({ name: "t", language: "pt_BR", status: "APPROVED", components: BODY_1 }),
      ORG,
      WABA,
    );
    const [nomeado] = templatesToRows(
      payload({
        name: "t",
        language: "pt_BR",
        status: "APPROVED",
        parameter_format: "NAMED",
        components: BODY_1,
      }),
      ORG,
      WABA,
    );
    expect(nomeado!.parameter_format).toBe("NAMED");
    expect(nomeado!.contract_hash).not.toBe(posicional!.contract_hash);
  });

  it("rejected_reason 'NONE' vira null — a Meta manda o literal em template aprovado", () => {
    const [aprovado] = templatesToRows(
      payload({
        name: "t",
        language: "pt_BR",
        status: "APPROVED",
        rejected_reason: "NONE",
        components: BODY_1,
      }),
      ORG,
      WABA,
    );
    expect(aprovado!.rejected_reason).toBeNull();

    const [recusado] = templatesToRows(
      payload({
        name: "t",
        language: "pt_BR",
        status: "REJECTED",
        rejected_reason: "INCORRECT_CATEGORY",
        components: BODY_1,
      }),
      ORG,
      WABA,
    );
    expect(recusado!.rejected_reason).toBe("INCORRECT_CATEGORY");
  });

  it("quality_score vem como OBJETO na Graph API e é achatado para o score", () => {
    const [r] = templatesToRows(
      payload({
        name: "t",
        language: "pt_BR",
        status: "APPROVED",
        quality_score: { score: "GREEN", date: 1785252764 },
        components: BODY_1,
      }),
      ORG,
      WABA,
    );
    expect(r!.quality_score).toBe("GREEN");
    expect(row("hello_world").quality_score).toBeNull();
  });

  it("status desconhecido ATRAVESSA — é o motivo de a coluna não ter CHECK", () => {
    const [r] = templatesToRows(
      payload({ name: "t", language: "pt_BR", status: "LIMIT_EXCEEDED", components: BODY_1 }),
      ORG,
      WABA,
    );
    expect(r!.status).toBe("LIMIT_EXCEEDED");
  });

  it("payload sem `data` estoura — devolver [] em silêncio desabilitaria tudo depois", () => {
    expect(() => templatesToRows({ error: { message: "token inválido" } }, ORG, WABA)).toThrow(
      /data/,
    );
    expect(() => templatesToRows(null, ORG, WABA)).toThrow(/data/);
  });

  it("template sem name/language estoura — a chave do espelho é o par", () => {
    expect(() => templatesToRows(payload({ status: "APPROVED", components: [] }), ORG, WABA)).toThrow(
      /name/,
    );
  });
});

describe("planSync — o que sumiu da Meta vira DISABLED, nunca DELETE", () => {
  const atual: MetaTemplateRow[] = templatesToRows(
    payload(
      { name: "vivo", language: "pt_BR", status: "APPROVED", components: BODY_1 },
      { name: "vivo", language: "pt", status: "APPROVED", components: BODY_1 },
    ),
    ORG,
    WABA,
  );

  function local(...t: LocalTemplate[]): LocalTemplate[] {
    return t;
  }

  it("template que sumiu da Meta é MARCADO, não apagado — a config que aponta pra ele sobrevive", () => {
    const plano = planSync(
      atual,
      local(
        { name: "vivo", language: "pt_BR", status: "APPROVED", contract_hash: atual[0]!.contract_hash },
        { name: "sumido", language: "pt_BR", status: "APPROVED", contract_hash: "x" },
      ),
    );
    expect(plano.disable).toEqual([{ name: "sumido", language: "pt_BR" }]);
    expect(plano.counts.disabled).toBe(1);
    // E ele NÃO some da lista de upserts nem é excluído — não há caminho de DELETE.
    expect(plano).not.toHaveProperty("delete");
  });

  it("o que já está DISABLED não é remarcado — senão todo sync escreve à toa", () => {
    const plano = planSync(
      atual,
      local({ name: "sumido", language: "pt_BR", status: TEMPLATE_STATUS_DISABLED, contract_hash: "x" }),
    );
    expect(plano.disable).toEqual([]);
  });

  it("o MESMO nome em outro idioma não salva o par ausente — a chave é (name, language)", () => {
    const plano = planSync(
      atual,
      local({ name: "vivo", language: "es_ES", status: "APPROVED", contract_hash: "x" }),
    );
    expect(plano.disable).toEqual([{ name: "vivo", language: "es_ES" }]);
  });

  it("payload VAZIO não desabilita nada — WABA/token errado não pode apagar o espelho", () => {
    const plano = planSync(
      [],
      local({ name: "vivo", language: "pt_BR", status: "APPROVED", contract_hash: "x" }),
    );
    expect(plano.disable).toEqual([]);
  });

  it("conta o que MUDOU: novo, contrato diferente, status diferente, e o resto igual", () => {
    const plano = planSync(
      atual,
      local({ name: "vivo", language: "pt_BR", status: "APPROVED", contract_hash: "hash-velho" }),
    );
    expect(plano.counts).toEqual({ inserted: 1, updated: 1, unchanged: 0, disabled: 0 });

    const iguais = planSync(
      atual,
      local(
        { name: "vivo", language: "pt_BR", status: "APPROVED", contract_hash: atual[0]!.contract_hash },
        { name: "vivo", language: "pt", status: "APPROVED", contract_hash: atual[1]!.contract_hash },
      ),
    );
    expect(iguais.counts).toEqual({ inserted: 0, updated: 0, unchanged: 2, disabled: 0 });

    const soStatus = planSync(
      atual,
      local(
        { name: "vivo", language: "pt_BR", status: "PAUSED", contract_hash: atual[0]!.contract_hash },
        { name: "vivo", language: "pt", status: "APPROVED", contract_hash: atual[1]!.contract_hash },
      ),
    );
    expect(soStatus.counts).toEqual({ inserted: 0, updated: 1, unchanged: 1, disabled: 0 });
  });
});
