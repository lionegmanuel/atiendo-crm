import { describe, expect, it } from 'vitest';

import {
  diffParaUpdates,
  explicacaoDoPasso,
  validarMapeamento,
  EXPLICACAO_DO_PASSO,
  ROTULO_DO_PASSO,
} from './agent-mapping';
import { LEAD_STAGES } from '@/lib/agent-engine/agent/lead-state';

const etapas = [
  { id: 'e1', name: 'Novo', is_won: false, is_lost: false, agent_stage_hint: null },
  { id: 'e2', name: 'Proposta', is_won: false, is_lost: false, agent_stage_hint: 'negotiating' },
  { id: 'e3', name: 'Fechado', is_won: true, is_lost: false, agent_stage_hint: null },
  { id: 'e4', name: 'Perdido', is_won: false, is_lost: true, agent_stage_hint: null },
];

/** Duas etapas que JÁ declaram passos — é onde permuta e conflito existem. */
const permutaveis = [
  { id: 'p1', name: 'Avaliação', is_won: false, is_lost: false, agent_stage_hint: 'qualified' },
  { id: 'p2', name: 'Proposta', is_won: false, is_lost: false, agent_stage_hint: 'qualifying' },
];

describe('validarMapeamento', () => {
  it('aceita passo sem etapa — é decisão legítima, não pendência', () => {
    const r = validarMapeamento({ new: 'e1', contacted: null }, etapas);
    expect(r.ok).toBe(true);
  });

  it('recusa "ganho" apontando para etapa que não é de ganho, citando a etapa', () => {
    const r = validarMapeamento({ won: 'e2' }, etapas);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.erros[0]).toMatch(/Proposta/);
  });

  it('recusa etapa de ganho recebendo passo que não é "ganho"', () => {
    // O CHECK do banco proíbe nos DOIS sentidos: etapa is_won só aceita hint 'won'.
    const r = validarMapeamento({ qualifying: 'e3' }, etapas);
    expect(r.ok).toBe(false);
  });

  it('recusa a mesma etapa recebendo dois passos (o índice único do banco)', () => {
    const r = validarMapeamento({ new: 'e1', contacted: 'e1' }, etapas);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.erros[0]).toMatch(/Novo/);
  });

  it('recusa etapa que não é deste pipeline', () => {
    const r = validarMapeamento({ new: 'etapa-de-outro-funil' }, etapas);
    expect(r.ok).toBe(false);
  });

  /* ── casos além do brief ── */

  it('recusa passo fora dos sete — vocabulário fechado do CHECK', () => {
    // Entrada vem de request body: um passo inventado tem que morrer aqui, não no 23514.
    const r = validarMapeamento({ churned: 'e1' }, etapas);
    expect(r.ok).toBe(false);
  });

  it('aceita o mapeamento canônico de ganho e perda', () => {
    // Contraprova das duas regras de coerência: elas recusam o incoerente,
    // não tudo que toca is_won/is_lost.
    const r = validarMapeamento({ won: 'e3', lost: 'e4' }, etapas);
    expect(r.ok).toBe(true);
  });

  it('recusa "perdido" apontando para etapa que não é de perda, citando a etapa', () => {
    // Espelho do caso 'won'. Sem ele, as duas linhas do `lost` podem ser
    // APAGADAS INTEIRAS e a suíte segue verde — metade da regra sem rede.
    //
    // ⚠️ e1 (sem hint) e não e2: e2 declara 'negotiating', então a regra de
    // conflito TAMBÉM recusaria — e o teste passaria mesmo com a coerência
    // apagada. O caso do brief (`{won:'e2'}`) tem exatamente essa ambiguidade;
    // por isso os dois testes abaixo, em etapa livre, é que seguram a regra.
    const r = validarMapeamento({ lost: 'e1' }, etapas);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.erros[0]).toMatch(/Novo/);
  });

  it('recusa "ganho" em etapa livre — a mesma regra sem o conflito por perto', () => {
    const r = validarMapeamento({ won: 'e1' }, etapas);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.erros[0]).toMatch(/Novo/);
  });

  it('recusa etapa de perda recebendo passo que não é "perdido"', () => {
    const r = validarMapeamento({ qualifying: 'e4' }, etapas);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.erros[0]).toMatch(/Perdido/);
  });

  it('recusa ocupar etapa que já representa um passo que a entrada nem menciona', () => {
    // Aceitar desmaparia 'qualified' EM SILÊNCIO — o banco não reclama (uma
    // coluna, um valor) e o tenant só descobriria quando o agente parasse.
    const r = validarMapeamento({ negotiating: 'p1' }, permutaveis);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.erros[0]).toMatch(/Avaliação/);
    expect(r.ok === false && r.erros[0]).toMatch(/Qualificado/);
  });

  it('aceita permuta — o passo largado está na entrada, ninguém perde configuração', () => {
    // Troca de verdade: p1 larga 'qualified' e pega 'qualifying'; p2 o inverso.
    const r = validarMapeamento({ qualifying: 'p1', qualified: 'p2' }, permutaveis);
    expect(r.ok).toBe(true);
  });

  it('nenhuma mensagem de erro vaza id de etapa — elas vão direto para a tela', () => {
    // Uma entrada por FORMA de mensagem: passo inválido, etapa fora do funil,
    // etapa repetida, os quatro ramos de coerência e o conflito. Antes só duas
    // formas eram exercidas, e as outras podiam vazar id sem ninguém notar.
    const erros = [
      validarMapeamento({ churned: 'e1' }, etapas),
      validarMapeamento({ new: 'etapa-de-outro-funil' }, etapas),
      validarMapeamento({ new: 'e1', contacted: 'e1' }, etapas),
      validarMapeamento({ won: 'e1' }, etapas),
      validarMapeamento({ lost: 'e1' }, etapas),
      validarMapeamento({ qualifying: 'e3' }, etapas),
      validarMapeamento({ qualifying: 'e4' }, etapas),
      validarMapeamento({ negotiating: 'p1' }, permutaveis),
    ].flatMap((r) => (r.ok ? [] : r.erros));

    expect(erros).toHaveLength(8); // as 8 formas dispararam mesmo
    // 'e1'/'p2' como palavra inteira: nenhum nome de etapa da fixture contém isso.
    expect(erros.join(' | ')).not.toMatch(/\b[ep]\d\b/);
  });
});

describe('diffParaUpdates', () => {
  it('só mexe no que mudou, e limpa o que saiu do mapa', () => {
    // 'negotiating' sai de e2 e vai para e1; nada mais muda.
    const ups = diffParaUpdates(etapas, { negotiating: 'e1' });
    expect(ups).toEqual(
      expect.arrayContaining([
        { stageId: 'e2', hint: null },
        { stageId: 'e1', hint: 'negotiating' },
      ]),
    );
    expect(ups).toHaveLength(2);
  });

  it('mapa idêntico não gera update nenhum', () => {
    expect(diffParaUpdates(etapas, { negotiating: 'e2' })).toEqual([]);
  });

  /* ── casos além do brief ── */

  it('limpa a etapa quando o passo é explicitamente esvaziado', () => {
    expect(diffParaUpdates(etapas, { negotiating: null })).toEqual([{ stageId: 'e2', hint: null }]);
  });

  it('não encosta em passo que a entrada nem mencionou', () => {
    // e5 declara 'won' e a entrada só fala de 'negotiating': mapa parcial não
    // pode apagar o que o tenant configurou noutra tela/sessão.
    const comGanho = [
      ...etapas.slice(0, 3),
      { id: 'e5', name: 'Ganhou', is_won: true, is_lost: false, agent_stage_hint: 'won' },
    ];
    expect(diffParaUpdates(comGanho, { negotiating: 'e1' })).toEqual(
      expect.not.arrayContaining([{ stageId: 'e5', hint: null }]),
    );
  });

  it('permuta libera AS DUAS etapas antes de ocupar qualquer uma', () => {
    // p1 e p2 trocam de passo. As duas são ALVO da entrada, então nenhuma cai no
    // ramo que limpa "o que saiu do mapa": sem unset explícito no ramo do alvo,
    // saem dois SETs e o primeiro colide com o hint que a outra ainda declara —
    // 23505 cru na tela, e a transação não salva (o índice é imediato).
    const ups = diffParaUpdates(permutaveis, { qualifying: 'p1', qualified: 'p2' });
    expect(ups.slice(0, 2)).toEqual(
      expect.arrayContaining([
        { stageId: 'p1', hint: null },
        { stageId: 'p2', hint: null },
      ]),
    );
    expect(ups.slice(2)).toEqual(
      expect.arrayContaining([
        { stageId: 'p1', hint: 'qualifying' },
        { stageId: 'p2', hint: 'qualified' },
      ]),
    );
    expect(ups).toHaveLength(4);
  });

  it('limpa ANTES de ocupar — senão o índice único recusa a troca no meio', () => {
    // 'negotiating' migra de e2 para e1. A ordem natural do array daria o SET
    // (e1) primeiro; exigir o UNSET (e2) na frente só passa se a função ordenar.
    const ups = diffParaUpdates(etapas, { negotiating: 'e1' });
    expect(ups[0]).toEqual({ stageId: 'e2', hint: null });
  });
});

describe("o vocabulário dos passos", () => {
  it("todo passo tem rótulo E explicação — as duas, sempre", () => {
    // Elas moram juntas de propósito (ver o comentário de `EXPLICACAO_DO_PASSO`):
    // o wizard mostra a frase, a tela de mapeamento mostra o rótulo. Um passo
    // novo com só uma das duas deixa uma das telas com buraco — e o buraco do
    // wizard é pior, porque quem o lê está decidindo o que cada coluna do
    // quadro significa e não tem onde procurar a resposta.
    for (const passo of LEAD_STAGES) {
      expect(ROTULO_DO_PASSO[passo], passo).toBeTruthy();
      expect(EXPLICACAO_DO_PASSO[passo], passo).toBeTruthy();
    }
  });

  it("a explicação é uma frase, não um rótulo repetido", () => {
    // "Em qualificação" não diz nada a quem instalou o sistema há dez minutos.
    for (const passo of LEAD_STAGES) {
      expect(EXPLICACAO_DO_PASSO[passo], passo).not.toBe(ROTULO_DO_PASSO[passo]);
      expect(EXPLICACAO_DO_PASSO[passo].length, passo).toBeGreaterThan(8);
    }
  });

  it("passo que não existe não ganha frase inventada", () => {
    expect(explicacaoDoPasso("mql")).toBeNull();
  });
});
