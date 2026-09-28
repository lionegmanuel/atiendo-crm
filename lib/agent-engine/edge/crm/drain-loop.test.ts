// @vitest-environment node
//
// O loop do drain: quem decide QUANTO esperar entre um tick e o próximo, e o
// que acontece com o listener de abort de cada espera. Os dois casos aqui
// prendem comportamento que nenhum outro teste alcança — o ramo "lote cheio não
// espera" e a remoção do listener — e ambos rodam com knobs EXPLÍCITOS, porque
// o padrão de `env.ts` é decisão de custo e não é assunto deste arquivo.
import { afterEach, expect, it, vi } from 'vitest';
import type pg from 'pg';

import { runDrainLoop } from './drain';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const knobs = {
  batchSize: 2,
  intervalMs: 2000,
  idleIntervalMs: 2000,
  debounceMs: 0,
  reapTimeoutMs: 60_000,
};
afterEach(() => vi.useRealTimers());

it.each([0, 1, 2])(
  'lote com %s eventos respeita o ritmo ocioso/ativo ou escoa o backlog sem pausa',
  async (n) => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let claims = 0;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('returning e.id')) {
        claims++;
        if (claims === 2) controller.abort();
        // Payload inválido é consumido sem acessar banco/modelo/canal.
        return { rows: Array.from({ length: n }, (_, i) => ({ id: `e${i}`, payload: {} })) };
      }
      return { rows: [] };
    });
    const loop = runDrainLoop({ query } as unknown as pg.Pool, knobs, log, controller.signal);
    // Lote CHEIO (n = batchSize) volta ao trabalho sem avançar o relógio; os
    // outros dois só voltam no fim do intervalo.
    await vi.advanceTimersByTimeAsync(n === 2 ? 0 : 1999);
    if (n < 2) {
      expect(claims).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
    }
    await loop;
    expect(claims).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it('remove o listener em cada tick e aborta a espera sem deixar timer', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const add = vi.spyOn(controller.signal, 'addEventListener');
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const pool = { query: vi.fn(async () => ({ rows: [] })) } as unknown as pg.Pool;
  const loop = runDrainLoop(pool, knobs, log, controller.signal);
  await vi.advanceTimersByTimeAsync(6000);
  controller.abort();
  await loop;
  expect(add.mock.calls.length).toBeGreaterThan(2);
  expect(remove).toHaveBeenCalledTimes(add.mock.calls.length);
  expect(vi.getTimerCount()).toBe(0);
});
