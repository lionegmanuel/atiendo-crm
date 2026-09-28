import { describe, expect, it, vi } from "vitest";

import { intervaloDeEspera, rodarLoopDaFila } from "@/lib/agent-engine/queue/loop";
import type { Logger } from "@/lib/agent-engine/obs/logger";

/**
 * O laço que consome a fila (issue #258).
 *
 * O que este arquivo guarda, e por que ele dirige o LAÇO e não só a aritmética:
 * as duas coisas que este conserto pode quebrar em produção moram no call site,
 * não na conta. Um teste só de `intervaloDeEspera` ficaria verde com o shutdown
 * derrubando o processo a cada `docker stop`.
 *
 * Sem Postgres e sem fake timers de propósito: `vi.useFakeTimers()` não fakeia o
 * `setTimeout` de `node:timers/promises`, que é o que o worker usa. Aqui o
 * `dormir` é injetado, então o tempo é do teste.
 */
function logSpy(): Logger & { erros: { msg: string }[] } {
  const erros: { msg: string }[] = [];
  const noop = (): void => undefined;
  return {
    info: noop,
    warn: noop,
    error: (msg: string) => void erros.push({ msg }),
    erros,
  } as unknown as Logger & { erros: { msg: string }[] };
}

const INTERVALOS = { ociosoMs: 2_000, retryMs: 250 };

/**
 * Para o laço depois de `n` rodadas COMPLETAS.
 *
 * Contar em `deveParar` não serve: ele é consultado duas vezes por rodada (topo
 * do while e antes da espera), e um contador ali corta o laço no meio de uma
 * volta — foi assim que a primeira versão destes testes mediu a coisa errada.
 * `aoClaimar` roda exatamente uma vez por rodada, então é ele o marcador.
 */
function pararDepoisDe(n: number): { deveParar: () => boolean; contar: () => void } {
  let rodadas = 0;
  return { deveParar: () => rodadas >= n, contar: () => void rodadas++ };
}

describe("intervaloDeEspera", () => {
  it("fila vazia (null) dorme o teto ocioso", () => {
    // Guarda o `case when` do relógio na camada JS: se `null` virasse 0 aqui, a
    // instalação parada voltaria a girar no ritmo curto — o defeito da issue.
    expect(intervaloDeEspera(null, INTERVALOS)).toBe(2_000);
  });

  it("job já vencido que o claim não pegou mantém o ritmo curto", () => {
    // Cap cheio ou lane ocupada: há trabalho esperando vaga. Recolher o ritmo
    // aqui custaria throughput no pico sem economizar nada no ocioso.
    expect(intervaloDeEspera(0, INTERVALOS)).toBe(250);
    expect(intervaloDeEspera(-1, INTERVALOS)).toBe(250);
  });

  it("job agendado à frente acorda NO VENCIMENTO, não no teto", () => {
    // É o ganho inteiro de perguntar QUANDO em vez de SE: trocar isto por
    // `ociosoMs` devolveria o jitter que a sonda booleana teria.
    expect(intervaloDeEspera(500, INTERVALOS)).toBe(500);
  });

  it("o teto limita a soneca de um job distante", () => {
    // Sem o Math.min o laço dormiria através da janela do INBOUND_DEBOUNCE_MS.
    expect(intervaloDeEspera(9_000, INTERVALOS)).toBe(2_000);
  });
});

describe("rodarLoopDaFila", () => {
  it("instalação parada NÃO abre transação de claim", async () => {
    // A afirmação central da issue #258. Em 4 rodadas com a fila vazia, o claim
    // (5 statements) é aberto UMA vez — a do boot, antes de existir resposta do
    // relógio — e as outras três custam UM statement cada. Desfazer o conserto,
    // claimando incondicionalmente, leva `claimar` a 4 chamadas.
    const claimar = vi.fn(async () => []);
    const relogio = vi.fn(async () => null);
    const dormiu: number[] = [];
    const { deveParar, contar } = pararDepoisDe(4);

    await rodarLoopDaFila({
      relogio,
      claimar,
      aoClaimar: contar,
      dormir: async (ms) => void dormiu.push(ms),
      deveParar,
      intervalos: INTERVALOS,
      log: logSpy(),
    });

    expect(claimar).toHaveBeenCalledTimes(1);
    expect(relogio).toHaveBeenCalledTimes(3);
    // A 1ª espera é a curta porque a rodada do boot claimou sem consultar o
    // relógio: "claim vazio logo depois de trabalho" é o estado cap-cheio, que
    // merece o ritmo rápido. Da 2ª em diante o relógio governa e é o teto.
    expect(dormiu).toEqual([250, 2_000, 2_000, 2_000]);
  });

  it("relógio que LANÇA faz o laço claimar mesmo assim, e loga", async () => {
    // Falha ABERTA: banco instável não pode ser lido como "não há trabalho",
    // senão um blip de rede adormece a fila pelo teto inteiro. Tratar o throw
    // como fila vazia deixaria `claimar` com 0 chamadas.
    const claimar = vi.fn(async () => []);
    const log = logSpy();
    const { deveParar, contar } = pararDepoisDe(2);

    await rodarLoopDaFila({
      relogio: async () => {
        throw new Error("banco fora do ar");
      },
      claimar,
      aoClaimar: contar,
      dormir: async () => undefined,
      deveParar,
      intervalos: INTERVALOS,
      log,
    });

    // Rodada 1 claima sem relógio (boot); rodada 2 consulta, o relógio lança, e
    // o claim acontece assim mesmo — 2 claims, não 1.
    expect(claimar).toHaveBeenCalledTimes(2);
    expect(log.erros.map((e) => e.msg)).toContain("relógio da fila indisponível — claim segue no ritmo curto");
  });

  it("espera abortada pelo desligamento ENCERRA o laço em vez de rejeitar", async () => {
    // O defeito que quase entrou: `sleep` de node:timers/promises REJEITA quando
    // o signal aborta. Sem o catch, a rejeição chega ao `await workerLoop` do
    // shutdown e derruba o processo antes do drain — os jobs já claimados ficam
    // presos em 'running', invisíveis pelos 10 min do QUEUE_VISIBILITY_TIMEOUT_MS,
    // a cada `docker stop`. Remover o `catch { break }` torna este teste vermelho.
    const abortError = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });

    await expect(
      rodarLoopDaFila({
        relogio: async () => null,
        claimar: async () => [],
        aoClaimar: () => undefined,
        dormir: async () => {
          throw abortError;
        },
        deveParar: () => false,
        intervalos: INTERVALOS,
        log: logSpy(),
      }),
    ).resolves.toBeUndefined();
  });

  it("caminho ocupado não paga o statement do relógio", async () => {
    // Enquanto o claim traz trabalho, o laço claima em sequência no ritmo de
    // hoje. Sondar incondicionalmente cobraria um statement extra por rodada
    // justamente na instalação que está atendendo gente.
    const relogio = vi.fn(async () => null);
    let rodada = 0;
    const claimar = vi.fn(async () => (rodada++ === 0 ? [{ id: "job-1" }, { id: "job-2" }] : []));
    const despachados: { id: string }[] = [];
    const { deveParar, contar } = pararDepoisDe(2);

    await rodarLoopDaFila({
      relogio,
      claimar,
      aoClaimar: (jobs) => {
        despachados.push(...jobs);
        contar();
      },
      dormir: async () => undefined,
      deveParar,
      intervalos: INTERVALOS,
      log: logSpy(),
    });

    // 1ª rodada: nada de relógio (ultimaTrouxe começa true) e o claim traz 2.
    // 2ª rodada: ainda sem relógio, porque a anterior trouxe trabalho.
    expect(relogio).toHaveBeenCalledTimes(0);
    expect(claimar).toHaveBeenCalledTimes(2);
    expect(despachados.map((j) => j.id)).toEqual(["job-1", "job-2"]);
  });

  it("depois de uma rodada vazia o laço volta a consultar o relógio", async () => {
    // Fixar `ultimaTrouxe` em true (não recolher nunca) é a regressão mais fácil
    // de introduzir: o laço nunca voltaria ao modo ocioso e a issue reapareceria.
    const relogio = vi.fn(async () => null);
    const { deveParar, contar } = pararDepoisDe(3);

    await rodarLoopDaFila({
      relogio,
      claimar: async () => [],
      aoClaimar: contar,
      dormir: async () => undefined,
      deveParar,
      intervalos: INTERVALOS,
      log: logSpy(),
    });

    // 1ª rodada claima (ultimaTrouxe=true no boot) e volta vazia; da 2ª em
    // diante o relógio governa.
    expect(relogio).toHaveBeenCalledTimes(2);
  });
});
