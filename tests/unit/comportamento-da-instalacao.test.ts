/**
 * O comportamento da INSTALAÇÃO vence o `.env`, e o `.env` é o piso.
 *
 * ─── O que estes testes provam ──────────────────────────────────────────────
 *
 * O defeito de origem (issue #1034): as chaves que decidem o comportamento de
 * quem já está rodando só existiam no `.env`, ou seja, só mudavam com SSH em
 * quem instalou. A tela de admin passa a ser a fonte, e o `.env` fica sendo o
 * que sempre foi de fato: semente e piso — quem responde quando o banco ainda
 * não falou nesta vida do processo.
 *
 * A prova que importa não é "a função devolve o valor da linha": é que os
 * LEITORES REAIS (o gate de orçamento do motor, o portão do webhook do canal,
 * os knobs do turno) sigam a instalação em vez do `.env`. Por isso os testes 7
 * e 8 chamam os módulos de produção, e não a função pura.
 *
 * ─── A degradação é a MESMA do molde ───────────────────────────────────────
 *
 * Molde: `lib/auth/politica-de-cadastro.ts`. Sem leitura boa nesta vida do
 * processo vale o piso; com uma leitura boa, o ÚLTIMO VALOR LIDO manda, mesmo
 * que a próxima leitura falhe. Nenhuma leitura lança: quem chama está no
 * caminho de responder uma conversa.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { envMock } = vi.hoisted(() => ({
  envMock: { WAHA_HMAC_SECRET: "", WAHA_WEBHOOK_REQUIRE_SIGNATURE: "false" },
}));
vi.mock("@/lib/env", () => ({ env: envMock }));

import { turnKnobsFromEnv } from "@/lib/agent-engine/agent/turn-knobs";
import { loadEnv } from "@/lib/agent-engine/env";
import { authenticateWahaWebhook } from "@/lib/waha/webhook-auth";

import {
  carregarComportamento,
  chaveDeOrcamentoDaInstalacao,
  comportamentoEmVigor,
  esquecerComportamento,
  exigirAssinaturaNoWebhookDaInstalacao,
  modoDeDivulgacaoDaInstalacao,
  promessaSemanticaDaInstalacao,
  type ComportamentoDaInstalacao,
} from "@/lib/instalacao/comportamento";
import { carregarComportamentoPorPool, pisoDoComportamentoDoMotor } from "@/lib/instalacao/comportamento-sql";

/** A linha como ela sai do banco: snake_case, colunas NOT NULL. */
const LINHA = {
  orcamento_de_ia: "off",
  exigir_assinatura_no_webhook: true,
  divulgacao_de_pagamento: "veto",
  promessa_semantica: false,
};

const PISO: ComportamentoDaInstalacao = {
  orcamento_de_ia: "on",
  exigir_assinatura_no_webhook: false,
  divulgacao_de_pagamento: "inject",
  promessa_semantica: true,
};

const envDoMotor = () =>
  loadEnv({
    NODE_ENV: "test",
    SUPABASE_DB_URL: "postgresql://postgres:postgres@localhost/postgres",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1",
    SUPABASE_SERVICE_ROLE_KEY: "test-key",
  });

const BODY = '{"event":"message","session":"org_1","payload":{"id":"x"}}';

beforeEach(() => {
  esquecerComportamento();
});

describe("comportamento da instalação", () => {
  it("sem leitura do banco, cada leitor responde com o piso — o comportamento de ontem", () => {
    expect(comportamentoEmVigor()).toBeNull();
    expect(chaveDeOrcamentoDaInstalacao("off")).toBe("off");
    expect(modoDeDivulgacaoDaInstalacao("inject")).toBe("inject");
    expect(promessaSemanticaDaInstalacao(false)).toBe(false);
    expect(exigirAssinaturaNoWebhookDaInstalacao(true)).toBe(true);
  });

  it("a linha do banco vence o piso, nas quatro chaves", async () => {
    await carregarComportamento(async () => LINHA, PISO);

    expect(comportamentoEmVigor()).toEqual({
      orcamento_de_ia: "off",
      exigir_assinatura_no_webhook: true,
      divulgacao_de_pagamento: "veto",
      promessa_semantica: false,
    });
    expect(chaveDeOrcamentoDaInstalacao("on")).toBe("off");
    expect(modoDeDivulgacaoDaInstalacao("inject")).toBe("veto");
    expect(promessaSemanticaDaInstalacao(true)).toBe(false);
    expect(exigirAssinaturaNoWebhookDaInstalacao(false)).toBe(true);
  });

  it("linha AUSENTE é resposta, não falha: vale o piso, e ele fica conhecido", async () => {
    const visto = await carregarComportamento(async () => null, PISO);

    expect(visto).toEqual(PISO);
    expect(comportamentoEmVigor()).toEqual(PISO);
  });

  it("leitura que falha NÃO apaga o último valor conhecido", async () => {
    await carregarComportamento(async () => LINHA, PISO);

    const visto = await carregarComportamento(async () => {
      throw new Error("banco fora do ar");
    }, PISO);

    expect(visto).toEqual(LINHA);
    expect(chaveDeOrcamentoDaInstalacao("on")).toBe("off");
  });

  it("valor irreconhecível no banco cai no piso — e nunca em 'off'", async () => {
    // Quem editou a coluna à mão depois de dropar a constraint. A resposta
    // honesta é "não sei", e "não sei" para o kill switch do orçamento não
    // pode ser o valor que DESLIGA a proteção.
    await carregarComportamento(async () => ({ ...LINHA, orcamento_de_ia: "banana" }), PISO);

    expect(chaveDeOrcamentoDaInstalacao("on")).toBe("on");
  });

  it("o worker lê a linha pelo pool (pg cru) e uma leitura quebrada não derruba nada", async () => {
    const env = envDoMotor();
    const pool = { query: async () => ({ rows: [LINHA] }) };

    await carregarComportamentoPorPool(pool, pisoDoComportamentoDoMotor(env));
    expect(chaveDeOrcamentoDaInstalacao("on")).toBe("off");

    const quebrado = {
      query: async () => {
        throw new Error("pool caiu");
      },
    };
    await expect(
      carregarComportamentoPorPool(quebrado, pisoDoComportamentoDoMotor(env)),
    ).resolves.toEqual(LINHA);
    expect(chaveDeOrcamentoDaInstalacao("on")).toBe("off");
  });

  it("os knobs do TURNO seguem a instalação, não só o .env", () => {
    const env = envDoMotor();

    const antes = turnKnobsFromEnv(env);
    expect(antes.disclosureMode).toBe("inject");
    expect(antes.promiseSemantic?.enabled).toBe(true);

    return carregarComportamento(async () => LINHA, pisoDoComportamentoDoMotor(env)).then(() => {
      const depois = turnKnobsFromEnv(env);
      expect(depois.disclosureMode).toBe("veto");
      expect(depois.promiseSemantic?.enabled).toBe(false);
    });
  });

  it("o portão do webhook do canal exige assinatura quando a INSTALAÇÃO exige", async () => {
    const semAssinatura = { rawBody: BODY, signatureHeader: null, sessionSecret: null };
    expect(authenticateWahaWebhook(semAssinatura)).toEqual({ ok: true, signatureVerified: false });

    await carregarComportamento(async () => LINHA, PISO);

    expect(authenticateWahaWebhook(semAssinatura)).toEqual({
      ok: false,
      reason: "signature_required",
    });
  });
});
