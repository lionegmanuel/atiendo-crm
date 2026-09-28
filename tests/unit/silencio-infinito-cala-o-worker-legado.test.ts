/**
 * `'infinity'` TEM DE CALAR O WORKER LEGADO — E NÃO CALAVA.
 *
 * ─── O defeito, medido em produção (VPS, 2026-08-30) ──────────────────────
 *
 * Às 14:10 a própria IA escalou uma conversa para atendimento humano
 * (`last_handoff_reason='low_sentiment'`), gravando o silêncio permanente que o
 * produto usa para isso: `conversations.bot_silenced_until = 'infinity'`.
 * A partir dali o motor novo se recusou a responder, corretamente — o log diz
 * `turno pulado — lead em handoff humano (bot silenciado)`.
 *
 * O worker legado continuou respondendo por cima da escalação. A guarda dele era:
 *
 *     if (c.bot_silenced_until && new Date(c.bot_silenced_until).getTime() > Date.now())
 *
 * e `new Date('infinity')` é `Invalid Date`, cujo `getTime()` é `NaN`. **Toda**
 * comparação com `NaN` é falsa, então a guarda nunca disparava: uma proteção que
 * parecia existir e não existia. O cliente que a IA julgou insatisfeito seguiu
 * conversando com a máquina, e ninguém do outro lado soube.
 *
 * ─── Por que o conserto é DELEGAR, e não corrigir a expressão ─────────────
 *
 * A regra certa já existia em `lib/inbox/comando-da-conversa.ts`, é a que move a
 * TELA, e trata `'infinity'` de propósito — inclusive falhando FECHADO em data
 * ilegível. Havia duas regras para a mesma pergunta em dois arquivos, e elas
 * discordavam: a tela dizia "automático parado" enquanto o worker respondia.
 *
 * Reescrever a expressão no worker consertaria a instância e deixaria a classe
 * de pé — a terceira cópia nasceria divergente igual. Por isso o worker passa a
 * chamar `silencioVigente`, e o que este arquivo vigia é que ele **continue**
 * chamando: uma cópia local nova é o defeito voltando com outra cara.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { silencioVigente } from "@/lib/inbox/comando-da-conversa";

const FONTE_BRUTA_DO_WORKER = readFileSync(
  join(process.cwd(), "workers/ai-response-worker.ts"),
  "utf8",
);

/**
 * O worker SEM comentários.
 *
 * A cerca de "não voltou a comparar a data crua" procura a expressão que
 * falhava — e o comentário do conserto CITA essa expressão para explicar o
 * defeito. Medido: a primeira versão desta cerca reprovou o próprio conserto,
 * acusando o texto que o documenta. Uma sonda que lê comentário mede a prosa,
 * não o código; e a saída seria apagar a explicação, que é o pior desfecho.
 */
const FONTE_DO_WORKER = FONTE_BRUTA_DO_WORKER.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /\/\/.*$/gm,
  "",
);

describe("silêncio pós-handoff: 'infinity' cala os dois motores", () => {
  it("a aritmética que produziu o defeito — o porquê, para ninguém 'simplificar' de volta", () => {
    // Sem esta asserção, o conserto parece paranoia e a próxima pessoa reverte.
    expect(Number.isNaN(new Date("infinity").getTime())).toBe(true);
    expect(new Date("infinity").getTime() > Date.now()).toBe(false);
  });

  it("a regra canônica trata 'infinity' como silêncio vigente e durável", () => {
    const r = silencioVigente("infinity", new Date());
    expect(r.vigente).toBe(true);
    expect(r.duravel).toBe(true);
  });

  it("data ilegível também cala — falha fechada na ação", () => {
    expect(silencioVigente("banana", new Date()).vigente).toBe(true);
  });

  it("mas silêncio COM prazo já vencido não cala — senão a guarda vira permanente", () => {
    // O controle. Sem ele, um conserto que devolvesse `vigente: true` sempre
    // passaria nos casos acima e emudeceria o automático para todo mundo.
    const agora = new Date("2026-08-30T21:00:00Z");
    expect(silencioVigente("2026-08-30T20:00:00Z", agora).vigente).toBe(false);
    expect(silencioVigente("2026-08-30T22:00:00Z", agora).vigente).toBe(true);
    expect(silencioVigente(null, agora).vigente).toBe(false);
  });


  it("a sonda sem comentários ainda enxerga o código — senão ela aprova tudo", () => {
    // Controle: uma limpeza gulosa demais devolveria string vazia, e aí a cerca
    // acima passaria por não achar nada — verde pelo motivo errado.
    expect(FONTE_DO_WORKER).toContain("silenced_post_handoff");
    expect(FONTE_DO_WORKER.length).toBeGreaterThan(1000);
  });

  it("O WORKER USA a regra canônica — a função certa e não chamada deixa o defeito de pé", () => {
    expect(
      /silencioVigente\s*\(/.test(FONTE_DO_WORKER),
      "o worker legado não chama silencioVigente — a guarda voltou a ser cópia local",
    ).toBe(true);
  });

  it("e não voltou a comparar a data crua — a expressão exata que falhava", () => {
    const cru = /new Date\(\s*c\.bot_silenced_until\s*\)/.test(FONTE_DO_WORKER);
    expect(
      cru,
      "o worker voltou a fazer new Date(c.bot_silenced_until) — para 'infinity' isso é NaN e a guarda não dispara",
    ).toBe(false);
  });
});
