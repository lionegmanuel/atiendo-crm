/**
 * W-07: a janela horária cala à noite; o DOMINGO não veta por default.
 *
 * A regra mudou em 2026-08-20 (decisão do dono do produto) e a metade do
 * domingo **não tinha nenhuma guarda de comportamento**: medido antes de
 * mexer, virar `allowSunday` de `false` para `true` não deixava um único teste
 * vermelho. Um default de regra de negócio sem teste é um default que volta
 * sozinho no próximo refactor.
 *
 * O raciocínio da mudança: a janela horária é CORTESIA, não anti-banimento (a
 * distinção é o `banRisk` de `engine.ts`). Calar o domingo INTEIRO num CRM de
 * atendimento faz quem escreve no domingo só ser respondido na segunda — o
 * custo cai sobre o cliente final, não sobre o risco de bloqueio. Quem faz
 * prospecção ativa e prefere não incomodar no fim de semana desliga o knob,
 * que continua existindo e é testado aqui.
 */
import { describe, expect, it } from "vitest";

import { PACING_DEFAULTS } from "@/lib/agent-engine/pacing/defaults";
import { decidePacing } from "@/lib/agent-engine/pacing/engine";

/** 2026-08-23 é DOMINGO. 13h UTC = 10h BRT, dentro da janela 7h-22h. */
const DOMINGO_COMERCIAL = new Date("2026-08-23T13:00:00Z");
/** Mesmo domingo, 06h UTC = 03h BRT — fora da janela por HORA, não por dia. */
const DOMINGO_MADRUGADA = new Date("2026-08-23T06:00:00Z");
/** Terça, 10h BRT — controle. */
const TERCA_COMERCIAL = new Date("2026-07-28T13:00:00Z");

function input(now: Date, over: Partial<typeof PACING_DEFAULTS> = {}) {
  return {
    now,
    knobs: { ...PACING_DEFAULTS, ...over },
    state: { lastSentAt: null, sentToday: 0, numberActivatedAt: null },
    crmDailyLimit: null,
    banRisk: false, // isola a JANELA: sem isto o cap de warm-up (20) mascararia o veto
    rng: () => 0,
  };
}

describe("W-07 — domingo não veta por default", () => {
  it("o default é `allowSunday: true` — se alguém o virar, este caso cai", () => {
    expect(PACING_DEFAULTS.allowSunday).toBe(true);
  });

  it("domingo dentro da janela horária: PASSA", () => {
    expect(decidePacing(input(DOMINGO_COMERCIAL)).allow).toBe(true);
  });

  it("controle: terça dentro da janela também passa — o caso acima não passou por acidente", () => {
    expect(decidePacing(input(TERCA_COMERCIAL)).allow).toBe(true);
  });

  it("domingo de madrugada: veta por HORA, e o motivo não fala em domingo", () => {
    const d = decidePacing(input(DOMINGO_MADRUGADA));
    expect(d.allow).toBe(false);
    if (d.allow) return;
    expect(d.code).toBe("outside_window");
    expect(d.reason).not.toContain("sem domingo");
  });
});

describe("o knob continua existindo — quem faz prospecção desliga", () => {
  it("com `allowSunday: false` explícito, domingo comercial é VETADO", () => {
    const d = decidePacing(input(DOMINGO_COMERCIAL, { allowSunday: false }));
    expect(d.allow).toBe(false);
    if (d.allow) return;
    expect(d.code).toBe("outside_window");
    expect(d.reason).toContain("sem domingo");
  });

  it("e o próximo horário permitido cai FORA do domingo", () => {
    const d = decidePacing(input(DOMINGO_COMERCIAL, { allowSunday: false }));
    if (d.allow) throw new Error("deveria ter vetado");
    // Em America/Sao_Paulo (UTC-3): segunda 07h local = 10h UTC.
    expect(d.nextAllowedAt.getUTCDay(), "não pode reagendar para outro domingo").not.toBe(0);
  });
});
