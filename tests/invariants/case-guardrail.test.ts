import { describe, expect, it } from "vitest";

import {
  casePromiseGate,
  type GateContext,
} from "@/lib/agent-engine/guardrails/before-send";
import { PACING_DEFAULTS } from "@/lib/agent-engine/pacing/defaults";
import { SPINNING_DEFAULTS } from "@/lib/agent-engine/spinning/defaults";

/**
 * Wave 4 (spec 15 §10.2) — o GATE do requisito mais importante do épico: a
 * invariante sagrada é "o lead NUNCA recebe uma mensagem que promete envolver
 * um humano sem que exista um caso aberto correspondente". `casePromiseGate` é
 * a garantia DURA (3ª camada, before-send); estes testes exercitam a lógica do
 * gate EXAUSTIVAMENTE, puro/síncrono (sem DB — `evaluate` não faz I/O).
 *
 * A orquestração fail-safe (1º veto = erro-de-ensino; 2º veto = auto-abre-caso
 * + re-roda a cadeia) vive em `runAgentTurn` (inbound-turn.ts), dentro do
 * `execute` de `send_message` — a MESMA função monolítica que
 * `agent-config-cases.test.ts` (Wave 3a) já documentou como "não tem seam de
 * teste isolável sem harness pesado (não existe inbound-turn.test.ts no
 * repo)". Sem seam novo para isolar (mockar `runBeforeSend`/`openCase` exigiria
 * ou reestruturar `runAgentTurn` para injetá-los, ou reproduzir o harness
 * inteiro — fora do escopo desta wave); a prova ponta-a-ponta do fail-safe
 * fica para o E2E da Wave 6, como o precedente já estabeleceu. O que NÃO pode
 * faltar — e este arquivo prova — é a invariante do GATE em si: ela é o que
 * torna o fail-safe necessário E o que garante que, uma vez o caso aberto
 * (por qualquer caminho: tool do agente OU auto-abre do fail-safe), o envio
 * finalmente passa.
 */

function baseCtx(overrides: Partial<GateContext> = {}): GateContext {
  return {
    now: new Date("2026-07-23T12:00:00Z"),
    body: "",
    optedOut: false,
    provider: "waha",
    pacing: { knobs: PACING_DEFAULTS, state: { lastSentAt: null, sentToday: 0, numberActivatedAt: null }, crmDailyLimit: null },
    spinning: { knobs: SPINNING_DEFAULTS, window: [] },
    promise: { table: null },
    semanticPromise: null,
    disclosure: { template: null, isFirstOutbound: false, mode: "inject" },
    lgpd: null,
    casesEnabled: false,
    hasOpenCase: false,
    openedCaseThisTurn: false,
    ...overrides,
  };
}

describe("casePromiseGate — a invariante sagrada (spec 15 §10.2, Wave 4)", () => {
  it("veta: promessa-de-humano + !hasOpenCase + !openedCaseThisTurn + casesEnabled", () => {
    const verdict = casePromiseGate.evaluate(
      baseCtx({ casesEnabled: true, body: "vou verificar com a equipe" }),
    );
    expect(verdict.pass).toBe(false);
    if (!verdict.pass) {
      expect(verdict.code).toBe("case_promise_without_case");
      expect(verdict.reason).toMatch(/open_human_case/);
    }
  });

  it("pass: hasOpenCase=true (mesmo com promessa clara e casesEnabled)", () => {
    const verdict = casePromiseGate.evaluate(
      baseCtx({ casesEnabled: true, hasOpenCase: true, body: "vou acionar o responsável" }),
    );
    expect(verdict.pass).toBe(true);
  });

  it("pass: openedCaseThisTurn=true (o agente abriu o caso NESTE turno, antes deste envio)", () => {
    const verdict = casePromiseGate.evaluate(
      baseCtx({ casesEnabled: true, openedCaseThisTurn: true, body: "nosso time vai resolver isso" }),
    );
    expect(verdict.pass).toBe(true);
  });

  it("pass: casesEnabled=false — gate OFF (org não habilitou casos humanos)", () => {
    const verdict = casePromiseGate.evaluate(
      baseCtx({ casesEnabled: false, body: "vou acionar o responsável" }),
    );
    expect(verdict.pass).toBe(true);
  });

  it("pass: fala genérica sem promessa de humano (mesmo com casesEnabled e sem caso)", () => {
    const verdict = casePromiseGate.evaluate(
      baseCtx({ casesEnabled: true, body: "vou confirmar o valor pra você" }),
    );
    expect(verdict.pass).toBe(true);
  });

  it("retrocompatibilidade: GateContext sem os 3 campos novos não é o cenário real (TS exige-os) — o " +
    "default seguro mora em runBeforeSend (casesEnabled ausente nos args ?? false); aqui provamos que, " +
    "com o valor default explícito, o gate já é no-op", () => {
    const verdict = casePromiseGate.evaluate(
      baseCtx({ body: "vou acionar o responsável" }), // casesEnabled/hasOpenCase/openedCaseThisTurn = defaults (false)
    );
    expect(verdict.pass).toBe(true);
  });
});
