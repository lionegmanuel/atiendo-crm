import { describe, it, expect, vi } from 'vitest';

// env.ts valida process.env no import (a cadeia run-model-call → credentials →
// lib/crypto/aes_gcm → lib/env); o vitest roda em mode 'test' e não carrega
// .env.local de propósito (não reproduzível entre máquinas) — stub mínimo evita
// o throw. Nenhum teste aqui exercita a chamada de modelo de verdade (só as
// funções puras de parse), então o stub nunca é lido de fato.
vi.mock('@/lib/env', () => ({ env: {} }));

import { parseFollowupClassification, parsePlanoDeEsperas } from './followup-flow-classify';

describe('parseFollowupClassification', () => {
  it('extracts a class that is literally in the allowed list', () => {
    expect(parseFollowupClassification('{"class": "hot"}', ['hot', 'cold'])).toBe('hot');
  });

  it('tolerates prose/code-fence around the JSON', () => {
    const text = 'Aqui está:\n```json\n{"class": "cold"}\n```\nEspero ter ajudado.';
    expect(parseFollowupClassification(text, ['hot', 'cold'])).toBe('cold');
  });

  it('rejects a class outside the allowed list — never guesses', () => {
    expect(parseFollowupClassification('{"class": "mystery"}', ['hot', 'cold'])).toBeNull();
  });

  it('returns null when there is no JSON at all', () => {
    expect(parseFollowupClassification('desculpe, não sei responder', ['hot', 'cold'])).toBeNull();
  });

  it('returns null on malformed JSON', () => {
    expect(parseFollowupClassification('{"class": "hot"', ['hot', 'cold'])).toBeNull();
  });
});

describe('parsePlanoDeEsperas', () => {
  const doFluxo = ['w1', 'w2'];

  it('extrai uma espera por nó, na ordem em que o modelo respondeu', () => {
    const text = '{"esperas": [{"node_id": "w1", "aguardar_ms": 900000, "motivo": "lead engajado"}]}';
    expect(parsePlanoDeEsperas(text, doFluxo)).toEqual([
      { node_id: 'w1', aguardar_ms: 900_000, motivo: 'lead engajado' },
    ]);
  });

  it('tolera prosa/cerca de código em volta do JSON', () => {
    const text = 'Claro:\n```json\n{"esperas": [{"node_id": "w2", "aguardar_ms": 3600000, "motivo": "ok"}]}\n```';
    expect(parsePlanoDeEsperas(text, doFluxo)).toEqual([{ node_id: 'w2', aguardar_ms: 3_600_000, motivo: 'ok' }]);
  });

  it('descarta node_id que não existe no fluxo — o modelo não inventa nó', () => {
    const text = '{"esperas": [{"node_id": "fantasma", "aguardar_ms": 900000, "motivo": "x"}]}';
    expect(parsePlanoDeEsperas(text, doFluxo)).toEqual([]);
  });

  it('descarta espera com aguardar_ms ilegível — o nó cai no máximo, não num número inventado', () => {
    const text = '{"esperas": [{"node_id": "w1", "aguardar_ms": "amanhã", "motivo": "x"}]}';
    expect(parsePlanoDeEsperas(text, doFluxo)).toEqual([]);
  });

  it('mantém a espera quando falta o motivo — o instante é o essencial, a frase é acessória', () => {
    const text = '{"esperas": [{"node_id": "w1", "aguardar_ms": 900000}]}';
    expect(parsePlanoDeEsperas(text, doFluxo)).toEqual([
      { node_id: 'w1', aguardar_ms: 900_000, motivo: 'o modelo não explicou a escolha' },
    ]);
  });

  it('ignora a repetição do mesmo nó — a primeira proposta vale', () => {
    const text =
      '{"esperas": [{"node_id": "w1", "aguardar_ms": 900000, "motivo": "primeira"}, {"node_id": "w1", "aguardar_ms": 60000, "motivo": "segunda"}]}';
    expect(parsePlanoDeEsperas(text, doFluxo)).toEqual([
      { node_id: 'w1', aguardar_ms: 900_000, motivo: 'primeira' },
    ]);
  });

  it('devolve vazio quando não há JSON algum', () => {
    expect(parsePlanoDeEsperas('talvez semana que vem', doFluxo)).toEqual([]);
  });

  it('devolve vazio quando o JSON não tem a lista de esperas', () => {
    expect(parsePlanoDeEsperas('{"proposed_at": "2026-07-25T14:00:00.000Z"}', doFluxo)).toEqual([]);
  });
});
