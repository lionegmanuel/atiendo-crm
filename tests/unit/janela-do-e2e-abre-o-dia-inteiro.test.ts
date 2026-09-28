/**
 * A premissa do conserto de `tests/e2e/automacao-diz-a-verdade.spec.ts`.
 *
 * Aquela spec passou a fixar a janela de envio do número em 0h–24h antes de
 * disparar a automação, porque fora da janela o envio não é TENTADO: ele vira
 * `adiado` (`registrarAdiamento`, reason `fora_da_janela_de_envio`) e a aba
 * Atividade mostra "Aguardando envio" em vez de "Falhou" — que é justamente a
 * asserção que a spec existe para fazer.
 *
 * O defeito era invisível porque dependia do RELÓGIO: a janela default é
 * 7h–22h no fuso do tenant, o tenant do rig é `America/Sao_Paulo`, e o runner
 * do CI é UTC — ou seja, a janela real do CI é 10:00–01:00 UTC, e toda rodada
 * que alcançasse a spec fora disso falhava. Um teste dependente de horário não
 * falha quando você o escreve; falha semanas depois, na fila de outra pessoa.
 *
 * ═══ Por que este arquivo existe AO LADO da guarda irmã ═════════════════════
 *
 * `spec-de-envio-declara-a-janela.test.ts` (PR #450) guarda a OUTRA metade: ela
 * reprova a spec de envio que não DECLARA a janela. As duas não se cobrem, e a
 * diferença importa — medida, não suposta:
 *
 *     grep -c 'janelaDeEnvioAberta|PACING_DEFAULTS|windowEndHour'
 *       em spec-de-envio-declara-a-janela.test.ts  ->  0
 *
 * Ou seja: a guarda irmã confere que o seed está lá, não que ele ABRE alguma
 * coisa. Se alguém mudar `insideWindow` para ignorar `windowEndHour`, o seed
 * continua declarado, aquela guarda continua verde, e a janela deixa de abrir —
 * a spec volta a depender do relógio sem ninguém notar. Foi exatamente a
 * segunda sabotagem deste arquivo, e ela vermelheceu aqui.
 *
 * Este congela as DUAS pontas de que o conserto depende, para que
 * ele não volte a apodrecer em silêncio:
 *   1. o payload que a spec envia continua sendo ACEITO pelo schema da rota;
 *   2. a janela 0–24 realmente fica aberta nas 24 horas — o EFEITO, não a
 *      presença dos números no arquivo.
 *
 * O caso 3 é o controle negativo: com os defaults, a janela FECHA em algum
 * momento do dia. Sem ele, um `janelaDeEnvioAberta` que devolvesse `true`
 * sempre passaria neste arquivo e a prova seria vazia.
 */
import { describe, it, expect } from "vitest";

import { PACING_DEFAULTS } from "@/lib/agent-engine/pacing/defaults";
import { janelaDeEnvioAberta } from "@/lib/agent-engine/pacing/engine";
import { pacingKnobsUpdateSchema, windowIsValid } from "@/lib/ai/pacing-knobs";

/** As 24 horas cheias de um dia útil (segunda), no fuso do tenant do rig. */
function asVinteEQuatroHoras(): Date[] {
  // 2026-08-31 é uma segunda-feira: dia de semana evita que `allowSunday`
  // vire uma segunda variável no meio da medição.
  return Array.from({ length: 24 }, (_, h) => new Date(Date.UTC(2026, 7, 31, h, 30, 0)));
}

describe("a janela que o e2e fixa abre o dia inteiro", () => {
  it("o payload que a spec envia é aceito pelo schema da rota de pacing", () => {
    const payload = {
      channel_session_id: "11111111-1111-4111-8111-111111111111",
      window_start_hour: 0,
      window_end_hour: 24,
      allow_sunday: true,
    };

    expect(() => pacingKnobsUpdateSchema.parse(payload)).not.toThrow();
    // A rota valida a janela RESULTANTE além do schema — 0 < 24.
    expect(windowIsValid(0, 24)).toBe(true);
  });

  it("com 0h–24h, nenhuma hora do dia fica fora da janela", () => {
    const knobs = {
      ...PACING_DEFAULTS,
      windowStartHour: 0,
      windowEndHour: 24,
      allowSunday: true,
    };

    const fechadas = asVinteEQuatroHoras().filter((t) => !janelaDeEnvioAberta(t, knobs));

    expect(
      fechadas.map((t) => t.toISOString()),
      "com a janela fixada em 0–24 nenhuma hora pode estar fechada — é isto que tira o relógio do teste",
    ).toEqual([]);
  });

  it("CONTROLE: com os defaults (7h–22h) a janela fecha em parte do dia", () => {
    const fechadas = asVinteEQuatroHoras().filter(
      (t) => !janelaDeEnvioAberta(t, { ...PACING_DEFAULTS, allowSunday: true }),
    );

    // Sem esta asserção o caso acima passaria mesmo se `janelaDeEnvioAberta`
    // devolvesse `true` incondicionalmente — instrumento morto lendo como
    // sucesso. Aqui ele TEM que saber dizer "não".
    expect(
      fechadas.length,
      "os defaults têm que fechar em alguma hora do dia, senão a sonda está cega",
    ).toBeGreaterThan(0);
  });
});
