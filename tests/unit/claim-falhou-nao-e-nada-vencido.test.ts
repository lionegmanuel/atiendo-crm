/**
 * "O claim falhou" e "nada vencido" produzem o MESMO `claimed: 0`.
 *
 * O `catch` do claim em `runFollowupTick` está certo em não lançar — derrubar o
 * worker por falha de infra pararia todos os follow-ups da instalação. O defeito
 * era ele sair **mudo**: se o claim falhar SEMPRE, o follow-up morre inteiro e o
 * sintoma é a ausência de sintoma, porque `claimed: 0` é também o estado normal
 * de um tick sem nada vencido.
 *
 * A doutrina do repo já tinha a regra escrita para o audit (`CLAUDE.md`: falha
 * de write gera alerta, não bloqueia a mutação principal). O que faltava era
 * levá-la para cá.
 *
 * Este teste guarda as DUAS metades, porque consertar uma sem a outra deixa o
 * defeito de pé: o erro tem que deixar sinal, E o tick normal não pode passar a
 * gritar (senão o alarme vira ruído e alguém o desliga).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { runFollowupTick } from "@/lib/followup/engine";
import { logger } from "@/lib/logger";

function deps(claim: () => Promise<never[]> | never) {
  return {
    db: {
      claimDueEnrollments: claim,
      loadFlowGraph: async () => null,
      loadLeadFacts: async () => ({ lead_stage: null, tags: [] }),
      updateEnrollment: async () => {},
      insertEvent: async () => {},
    },
    clock: () => new Date("2026-08-05T12:00:00Z"),
    enqueueJob: async () => {},
  } as never;
}

describe("claim que falha não se disfarça de 'nada vencido'", () => {
  let erro: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    erro = vi.spyOn(logger, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    erro.mockRestore();
  });

  it("claim falhando deixa sinal E marca o summary", async () => {
    const s = await runFollowupTick(
      deps(async () => {
        throw new Error("connection refused");
      }),
    );

    expect(s.claimed, "sem enrollments, como antes").toBe(0);
    expect(s.claim_falhou, "o summary distingue os dois zeros").toBe(true);
    expect(erro, "falha de infra sem sinal é follow-up morrendo em silêncio").toHaveBeenCalled();
  });

  it("tick normal sem nada vencido NÃO grita (alarme que sempre toca é desligado)", async () => {
    const s = await runFollowupTick(deps(async () => []));

    expect(s.claimed).toBe(0);
    expect(s.claim_falhou, "nada vencido não é falha").toBeFalsy();
    expect(erro, "o caminho normal precisa ficar quieto").not.toHaveBeenCalled();
  });
});
