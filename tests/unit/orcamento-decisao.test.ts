/**
 * AS SEIS CONDIÇÕES CONJUNTIVAS DO BLOQUEIO POR ORÇAMENTO — uma variável por caso.
 *
 * O enforcement vivo nunca teve teste: `grep -rn assertBudget tests/` devolve
 * zero, e os dois arquivos que citam `monthly_budget_cents`
 * (`tests/unit/llm-calls-registra-falha.test.ts`, `tests/unit/seam-respeita-o-binding.test.ts`)
 * só o fixam em `null` para ele NÃO atrapalhar. Uma mudança de semântica no gate
 * atravessava `verify`, `invariants`, `build-and-size` e `e2e` verdes.
 *
 * ═══ COMO ESTE ARQUIVO É CONSTRUÍDO, E POR QUÊ ═══
 *
 * Existe UMA fixture, `BLOQUEIA`, em que as seis condições estão satisfeitas e o
 * gasto atingiu o teto — o controle negativo, que prova que o arquivo consegue
 * ver um bloqueio. Todo caso de recusa nasce dela mudando UMA variável, e o
 * helper `umaVariavel` reprova se alguém mudar duas: dois eixos de uma vez
 * significa que o caso pode passar pelo motivo errado, e um caso que acerta por
 * sorte não guarda nada.
 *
 * A pergunta que cada caso responde é sempre a mesma: *esta condição, SOZINHA,
 * impede o bloqueio?* Se a resposta puder ser "impede porque outra também
 * falhava", o caso não mede a condição que diz medir.
 */
import { describe, expect, it } from 'vitest';

import {
  decidirOrcamento,
  PISO_DE_TETO_CENTS,
  PURPOSES_ISENTOS,
  type EntradaDeOrcamento,
} from '@/lib/agent-engine/edge/llm/orcamento';

const AGORA = new Date('2026-08-14T12:00:00.000Z');
const ONTEM = new Date('2026-08-13T12:00:00.000Z');
const AMANHA = new Date('2026-08-15T12:00:00.000Z');

/**
 * As seis condições satisfeitas + o gatilho (`gasto >= teto`). É o ÚNICO estado
 * deste arquivo que bloqueia; qualquer caso que dele derive mudando um campo
 * deixa de bloquear, e é isso que cada teste afirma.
 */
const BLOQUEIA: EntradaDeOrcamento = {
  modo: 'bloquear',
  tetoCents: 5_000,
  gastoCents: 5_000,
  efetivoEm: ONTEM,
  agora: AGORA,
  purpose: 'agent_turn',
  chave: 'on',
  limiarPct: 80,
  avisadoNesteMes: true,
};

/** Muda mais de um campo — só onde o caso PRECISA de dois eixos, e ele diz qual. */
function com(patch: Partial<EntradaDeOrcamento>): EntradaDeOrcamento {
  return { ...BLOQUEIA, ...patch };
}

/**
 * Isolamento mecânico: exatamente uma chave, e com valor diferente do da
 * fixture. Sem isto, "mudei só uma coisa" seria uma promessa em prosa — e a
 * primeira pessoa a acrescentar um segundo campo num caso existente não veria
 * nada acontecer.
 */
function umaVariavel(patch: Partial<EntradaDeOrcamento>): EntradaDeOrcamento {
  const chaves = Object.keys(patch) as (keyof EntradaDeOrcamento)[];
  expect(chaves).toHaveLength(1);
  const chave = chaves[0];
  expect(chave).toBeDefined();
  if (chave !== undefined) {
    expect(patch[chave]).not.toBe(BLOQUEIA[chave]);
  }
  return com(patch);
}

describe('decidirOrcamento — controle negativo', () => {
  it('bloqueia quando as SEIS condições estão satisfeitas e o gasto atingiu o teto', () => {
    expect(decidirOrcamento(BLOQUEIA)).toEqual({ acao: 'bloquear', porque: 'teto_atingido' });
  });
});

describe('condição 1 — enforcement_mode', () => {
  it("modo 'off' segue sozinho, mesmo com o gasto 10× o teto", () => {
    expect(decidirOrcamento(umaVariavel({ modo: 'off' }))).toEqual({
      acao: 'seguir',
      porque: 'modo_desligado',
    });
    // O valor herdado do DEFAULT 5000 pode estar muito abaixo do gasto real de
    // uma org que nunca abriu a tela; 'off' tem de calar o gate mesmo assim.
    expect(decidirOrcamento(com({ modo: 'off', gastoCents: 50_000 }))).toEqual({
      acao: 'seguir',
      porque: 'modo_desligado',
    });
  });

  it("modo 'avisar' nunca bloqueia — no máximo avisa, mesmo com o gasto 10× o teto", () => {
    expect(decidirOrcamento(umaVariavel({ modo: 'avisar' })).acao).toBe('avisar_e_seguir');
    expect(decidirOrcamento(com({ modo: 'avisar', gastoCents: 50_000 })).acao).toBe(
      'avisar_e_seguir',
    );
  });
});

describe('condição 2 — carência (enforcement_effective_at)', () => {
  it('efetivoEm no futuro só avisa: a proteção ainda não começou a valer', () => {
    expect(decidirOrcamento(umaVariavel({ efetivoEm: AMANHA })).acao).toBe('avisar_e_seguir');
  });

  it('efetivoEm null nunca vence — é como a coluna nasce, e null não é passado', () => {
    expect(decidirOrcamento(umaVariavel({ efetivoEm: null })).acao).toBe('avisar_e_seguir');
  });
});

describe('condição 3 — o teto precisa ser um valor útil', () => {
  it('teto 0 é "sem limite", NUNCA "bloqueia tudo"', () => {
    expect(decidirOrcamento(umaVariavel({ tetoCents: 0 }))).toEqual({
      acao: 'seguir',
      porque: 'sem_teto',
    });
  });

  it('teto 0 com gasto 0 segue — a inversão perfeita do gate antigo, onde `spent < 0` é falso já na primeira chamada', () => {
    // Dois eixos de propósito: é a reprodução literal do defeito do produto —
    // quem desativou o orçamento pela tela ("0 desativa o orçamento") levava o
    // corte mais duro, sem ter gastado um centavo.
    expect(decidirOrcamento(com({ tetoCents: 0, gastoCents: 0 }))).toEqual({
      acao: 'seguir',
      porque: 'sem_teto',
    });
  });

  it('teto abaixo do piso de US$ 1,00 segue — é erro de unidade, não orçamento', () => {
    expect(decidirOrcamento(umaVariavel({ tetoCents: PISO_DE_TETO_CENTS - 1 }))).toEqual({
      acao: 'seguir',
      porque: 'teto_abaixo_do_piso',
    });
  });
});

describe('condição 4 — a chave de emergência só sabe afrouxar', () => {
  it("chave 'off' cala o gate inteiro (o kill switch do operador da VPS)", () => {
    expect(decidirOrcamento(umaVariavel({ chave: 'off' }))).toEqual({
      acao: 'seguir',
      porque: 'chave_de_emergencia',
    });
  });

  it("chave 'avisar' rebaixa o bloqueio a aviso", () => {
    expect(decidirOrcamento(umaVariavel({ chave: 'avisar' })).acao).toBe('avisar_e_seguir');
  });
});

describe('condição 5 — purposes isentos', () => {
  it.each(PURPOSES_ISENTOS)('purpose %s nunca é recusado por gasto', (purpose) => {
    expect(decidirOrcamento(umaVariavel({ purpose }))).toEqual({
      acao: 'seguir',
      porque: 'purpose_isento',
    });
  });
});

describe('condição 6 — ninguém é bloqueado sem ter sido avisado', () => {
  it('sem aviso neste mês, o gasto acima do teto AVISA e segue', () => {
    expect(decidirOrcamento(umaVariavel({ avisadoNesteMes: false }))).toEqual({
      acao: 'avisar_e_seguir',
      porque: 'primeiro_cruzamento',
    });
  });

  it('o salto de 79% para 101% entre duas chamadas também avisa antes de calar', () => {
    // Dois eixos: o cenário só existe com gasto ACIMA do teto e sem aviso prévio.
    expect(decidirOrcamento(com({ gastoCents: 5_050, avisadoNesteMes: false }))).toEqual({
      acao: 'avisar_e_seguir',
      porque: 'primeiro_cruzamento',
    });
  });
});

describe('a faixa entre o limiar e o teto', () => {
  it('gasto acima do limiar e abaixo do teto avisa e segue', () => {
    // limiar = 80% de 5.000 = 4.000
    expect(decidirOrcamento(umaVariavel({ gastoCents: 4_500 }))).toEqual({
      acao: 'avisar_e_seguir',
      porque: 'limiar',
    });
  });

  it('gasto abaixo do limiar segue calado — o caminho normal de toda chamada', () => {
    expect(decidirOrcamento(umaVariavel({ gastoCents: 3_999 }))).toEqual({
      acao: 'seguir',
      porque: 'abaixo_do_limiar',
    });
  });
});
