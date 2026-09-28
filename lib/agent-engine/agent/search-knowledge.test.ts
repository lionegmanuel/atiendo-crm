import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';

// search-knowledge importa lib/ai/embed → lib/env, que valida env no import.
// O CI roda sem .env; o teste injeta seu próprio `embed`, então mockar env
// evita a validação real (mesmo padrão de dispatcher-external-mode.test.ts).
vi.mock('@/lib/env', () => ({ env: {} }));

import { citationsFromHits, searchKnowledge } from './search-knowledge';

const hit = {
  chunk_id: 'c1', knowledge_source_id: 's1',
  content: 'Frete grátis acima de R$ 199.', similarity: 0.91, metadata: { source_type: 'faq' },
};

describe('searchKnowledge', () => {
  it('embeda a query e devolve os hits da RPC', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [hit] });
    const embed = vi.fn().mockResolvedValue({ embedding: [0.1, 0.2], promptTokens: 3, model: 'm' });
    const out = await searchKnowledge(
      { query } as unknown as pg.Pool,
      { organizationId: 'org1', kbVersionId: 'kb1', query: 'frete', topK: 5, threshold: 0.72 },
      { embed },
    );
    expect(out).toEqual({ ok: true, results: [hit] });
    // `ponto` viaja junto desde a 0181: é dele que sai QUAL binding de chave
    // vale. Sem o campo, indexar e consultar poderiam usar chaves diferentes
    // sem ninguém conseguir dizer qual.
    expect(embed).toHaveBeenCalledWith('frete', {
      organizationId: 'org1',
      ponto: 'embedding_consultar',
    });
    // embedding vai à RPC como literal pgvector '[0.1,0.2]'; o limiar do agente
    // NÃO vai à RPC (vai o piso -1) — o corte agora é aqui, ver testes abaixo.
    expect(query.mock.calls[0]?.[1]).toEqual(['org1', 'kb1', '[0.1,0.2]', 5, -1]);
  });

  it('erro de embedding vira erro de ENSINO, nunca exceção', async () => {
    const embed = vi.fn().mockRejectedValue(new Error('embed_unavailable: no key'));
    const out = await searchKnowledge(
      { query: vi.fn() } as unknown as pg.Pool,
      { organizationId: 'org1', kbVersionId: 'kb1', query: 'frete', topK: 5, threshold: 0.72 },
      { embed },
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('knowledge_unavailable');
  });

  it('erro de RPC (pool.query) vira erro de ENSINO, nunca exceção', async () => {
    const query = vi.fn().mockRejectedValue(new Error('rpc_error: pgvector dimension mismatch'));
    const embed = vi.fn().mockResolvedValue({ embedding: [0.1, 0.2], promptTokens: 3, model: 'm' });
    const out = await searchKnowledge(
      { query } as unknown as pg.Pool,
      { organizationId: 'org1', kbVersionId: 'kb1', query: 'frete', topK: 5, threshold: 0.72 },
      { embed },
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.code).toBe('knowledge_unavailable');
      expect(out.error.message).toContain('indisponível');
    }
  });

  it('devolve ao chamador SÓ o que passa do limiar, mesmo pedindo tudo ao banco', async () => {
    const pool = {
      query: async (sql: string) => {
        if (sql.includes('retrieve_top_k_chunks')) {
          return {
            rows: [
              { chunk_id: 'c1', knowledge_source_id: null, content: 'passa', similarity: 0.91, metadata: null },
              { chunk_id: 'c2', knowledge_source_id: null, content: 'nao passa', similarity: 0.70, metadata: null },
            ],
          };
        }
        return { rows: [] };
      },
    };

    const r = await searchKnowledge(
      pool as never,
      { organizationId: 'org-1', kbVersionId: 'kb-1', query: 'oi', topK: 5, threshold: 0.72 },
      { embed: async () => ({ embedding: [0.1, 0.2] }) } as never,
    );

    expect(r.ok).toBe(true);
    // O contrato com o modelo não muda: 0.70 continua fora.
    expect(r.ok && r.results.map((h) => h.chunk_id)).toEqual(['c1']);
  });

  it('registra a busca com o top_score REAL, mesmo quando nada passa do limiar', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        if (sql.includes('retrieve_top_k_chunks')) {
          return {
            rows: [
              { chunk_id: 'c1', knowledge_source_id: null, content: 'quase', similarity: 0.703, metadata: null },
            ],
          };
        }
        return { rows: [] };
      },
    };

    await searchKnowledge(
      pool as never,
      { organizationId: 'org-1', kbVersionId: 'kb-1', query: 'entregam sábado?', topK: 5, threshold: 0.72, jobId: 'job-9' },
      { embed: async () => ({ embedding: [0.1, 0.2] }) } as never,
    );

    const registro = queries.find((q) => q.sql.includes('knowledge_searches'));
    expect(registro, 'a busca não foi registrada').toBeDefined();
    expect(registro!.params[0]).toBe('org-1');
    // Este é o teste que sustenta a tabela inteira: 0 hits E 0.703 de melhor
    // candidato. Se o top_score vier null aqui, o painel não consegue distinguir
    // "a base não tem" de "o limiar cortou" — e a Task 1 vira peso morto.
    expect(registro!.params).toContain(0.703);
    expect(registro!.params).toContain(0.72);
    // Posicional: pega a troca `threshold` ↔ piso `-1`, que o `toContain` acima
    // sozinho não pega se os dois valores sobrarem em posições erradas. Gravar
    // -1 em `threshold` faria TODA busca parecer acima do limiar e zeraria o
    // "quase acertou" do painel para sempre.
    // As seis primeiras posições são o contrato antigo, preservado de propósito:
    // parâmetro novo entra no FIM. As duas últimas são os materiais consultados
    // e o assistente que perguntou (0181).
    expect(registro!.params).toEqual(['org-1', 'job-9', 'kb-1', 0, 0.703, 0.72, [], null]);
  });

  it('o RPC é chamado com o piso da similaridade, não com o limiar do agente', async () => {
    let paramsRpc: unknown[] = [];
    const pool = {
      query: async (sql: string, params: unknown[] = []) => {
        if (sql.includes('retrieve_top_k_chunks')) paramsRpc = params;
        return { rows: [] };
      },
    };

    await searchKnowledge(
      pool as never,
      { organizationId: 'org-1', kbVersionId: 'kb-1', query: 'oi', topK: 5, threshold: 0.72 },
      { embed: async () => ({ embedding: [0.1] }) } as never,
    );

    expect(paramsRpc[4]).toBe(-1);
  });

  it('falha ao registrar NUNCA derruba a busca — mas GRITA no log', async () => {
    const pool = {
      query: async (sql: string) => {
        if (sql.includes('knowledge_searches')) throw new Error('tabela não existe');
        return {
          rows: [{ chunk_id: 'c1', knowledge_source_id: null, content: 'texto', similarity: 0.9, metadata: null }],
        };
      },
    };
    const warn = vi.fn();

    const r = await searchKnowledge(
      pool as never,
      { organizationId: 'org-1', kbVersionId: 'kb-1', query: 'oi', topK: 5, threshold: 0.72 },
      { embed: async () => ({ embedding: [0.1] }), log: { info: vi.fn(), warn, error: vi.fn() } } as never,
    );

    expect(r.ok).toBe(true);
    expect(r.ok && r.results).toHaveLength(1);
    // Catch mudo é o pior caso do painel: insert falhando SEMPRE (grant, tipo,
    // coluna) mostraria "zero buscas", indistinguível de "ninguém buscou".
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[1]).toMatchObject({ error: expect.stringContaining('tabela não existe') });
  });

  it('top_score NaN (chunk de embedding zerado) vira null, não envenena a coluna', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        if (sql.includes('retrieve_top_k_chunks')) {
          // pgvector devolve NaN na distância de um vetor todo-zero; `numeric`
          // ACEITA 'NaN', então sem guarda isto grava e o painel mente calado.
          return { rows: [{ chunk_id: 'c1', knowledge_source_id: null, content: 'lixo', similarity: NaN, metadata: null }] };
        }
        return { rows: [] };
      },
    };

    const r = await searchKnowledge(
      pool as never,
      { organizationId: 'org-1', kbVersionId: 'kb-1', query: 'oi', topK: 5, threshold: 0.72 },
      { embed: async () => ({ embedding: [0.1] }) } as never,
    );

    expect(r.ok && r.results).toHaveLength(0);
    const registro = queries.find((q) => q.sql.includes('knowledge_searches'));
    expect(registro!.params[4]).toBeNull();
  });

  it('uma linha NaN NÃO anula o top_score das linhas boas da mesma busca', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        if (sql.includes('retrieve_top_k_chunks')) {
          // KB pequena (chunks <= topK) com UM chunk defeituoso: sem o filtro, o
          // NaN contamina o Math.max e TODA busca dessa base grava top_score
          // null — o painel cego justamente na KB nova, que é a primeira
          // impressão do produto.
          return {
            rows: [
              { chunk_id: 'c1', knowledge_source_id: null, content: 'bom', similarity: 0.91, metadata: null },
              { chunk_id: 'c2', knowledge_source_id: null, content: 'lixo', similarity: NaN, metadata: null },
            ],
          };
        }
        return { rows: [] };
      },
    };

    await searchKnowledge(
      pool as never,
      { organizationId: 'org-1', kbVersionId: 'kb-1', query: 'oi', topK: 5, threshold: 0.72 },
      { embed: async () => ({ embedding: [0.1] }) } as never,
    );

    const registro = queries.find((q) => q.sql.includes('knowledge_searches'));
    expect(registro!.params[4]).toBe(0.91);
  });

  it('top_score não depende da ordem das linhas da RPC', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        if (sql.includes('retrieve_top_k_chunks')) {
          return {
            rows: [
              { chunk_id: 'c1', knowledge_source_id: null, content: 'a', similarity: 0.60, metadata: null },
              { chunk_id: 'c2', knowledge_source_id: null, content: 'b', similarity: 0.71, metadata: null },
            ],
          };
        }
        return { rows: [] };
      },
    };

    await searchKnowledge(
      pool as never,
      { organizationId: 'org-1', kbVersionId: 'kb-1', query: 'oi', topK: 5, threshold: 0.72 },
      { embed: async () => ({ embedding: [0.1] }) } as never,
    );

    const registro = queries.find((q) => q.sql.includes('knowledge_searches'));
    expect(registro!.params[4]).toBe(0.71);
  });
});

describe('citationsFromHits', () => {
  it('mapeia hit para o shape Citation da UI (snippet truncado, score)', () => {
    const citations = citationsFromHits([{ ...hit, content: 'x'.repeat(500) }]);
    expect(citations).toHaveLength(1);
    const c = citations[0]!;
    expect(c).toMatchObject({ chunk_id: 'c1', knowledge_source_id: 's1', score: 0.91 });
    expect((c.snippet ?? '').length).toBeLessThanOrEqual(240);
  });
});
