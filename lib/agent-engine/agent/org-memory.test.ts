import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';

import { composeSystemPrompt, loadOrgMemory, renderOrgMemory } from './org-memory';

function poolSeq(responses: Array<{ rows: unknown[] }>): pg.Pool {
  const query = vi.fn();
  for (const r of responses) query.mockResolvedValueOnce(r);
  return { query } as unknown as pg.Pool;
}

describe('loadOrgMemory', () => {
  it('resolve doc pelo ponteiro e entries active em ordem estável', async () => {
    const pool = poolSeq([
      { rows: [{ content: 'Regras da org.' }] },
      { rows: [{ id: 'e1', title: 'Horário', body: 'Atendemos 8h-18h.' }] },
    ]);
    const mem = await loadOrgMemory(pool, 'org1');
    expect(mem).toEqual({ content: 'Regras da org.', entries: [{ id: 'e1', title: 'Horário', body: 'Atendemos 8h-18h.' }] });
  });

  it('org sem memória: content null e entries vazias', async () => {
    const mem = await loadOrgMemory(poolSeq([{ rows: [] }, { rows: [] }]), 'org1');
    expect(mem).toEqual({ content: null, entries: [] });
  });
});

describe('renderOrgMemory', () => {
  it('vazio quando não há doc nem entries', () => {
    expect(renderOrgMemory({ content: null, entries: [] })).toBe('');
  });
  it('doc + entries viram bloco determinístico', () => {
    const out = renderOrgMemory({ content: 'Doc.', entries: [{ id: 'e1', title: 'T', body: 'B' }] });
    expect(out).toContain('=== memória da organização (regras e aprendizados — valem para TODO atendimento) ===');
    expect(out).toContain('Doc.');
    expect(out).toContain('- T: B');
  });
});

describe('composeSystemPrompt', () => {
  it('ordem: playbook → memória → índice de skills; blocos vazios somem sem separadores órfãos', () => {
    expect(composeSystemPrompt({ playbookPrompt: 'P', orgMemoryBlock: '', skillIndex: '' })).toBe('P');
    const full = composeSystemPrompt({ playbookPrompt: 'P', orgMemoryBlock: 'M', skillIndex: 'S' });
    expect(full.indexOf('P')).toBeLessThan(full.indexOf('M'));
    expect(full.indexOf('M')).toBeLessThan(full.indexOf('S'));
    expect(full).toContain('=== skills (índice — o corpo carrega no turno quando a situação dispara) ===');
  });
});
