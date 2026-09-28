import { describe, expect, it } from 'vitest';
import { READ_ONLY_TOOLS } from './tool-breaker';

describe('READ_ONLY_TOOLS', () => {
  it('search_knowledge é read-only (isenta dos gates de mutação do breaker)', () => {
    expect(READ_ONLY_TOOLS).toContain('search_knowledge');
  });

  it('read_skill_reference é read-only (só lê storage, nunca muta estado)', () => {
    expect(READ_ONLY_TOOLS).toContain('read_skill_reference');
  });
});
