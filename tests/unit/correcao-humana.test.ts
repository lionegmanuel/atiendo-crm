import { describe, expect, it } from "vitest";

import {
  ehCorrecaoDeMovimentoDaIa,
  ondeAIaMaisErra,
  type MovimentoRegistrado,
} from "@/lib/leads/correcao-humana";

/**
 * O LAÇO — quando um humano desfaz o que a IA fez (spec 17 passo 5).
 *
 * O invariante 7 do sistema vivo: "toda decisão automática tem retorno que
 * altera decisão futura". O passo 3 deu ao assistente um limite; o 4 mostrou
 * onde falta configuração. Nenhum dos dois responde **o que muda quando ele
 * erra** — e sem isso o produto tem caminho, não ciclo: a IA erra igual amanhã
 * e alguém corrige de novo, para sempre e em silêncio.
 *
 * O risco do lado oposto é igualmente real, e metade destes casos existe para
 * ele: contar movimentação humana normal como "a IA errou" inflaria o número com
 * ruído — e um indicador que sobe sem causa é um indicador que se aprende a
 * ignorar.
 */

const ETAPA_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const ETAPA_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const ETAPA_C = "cccccccc-0000-4000-8000-00000000000c";
const AGENTE = "a9e07e00-0000-4000-8000-000000000001";

function movimento(
  actorKind: string,
  from: string | null,
  to: string,
  agentId: string | null = null,
): MovimentoRegistrado {
  return { actorKind, fromStageId: from, toStageId: to, performedAt: "2026-08-07T10:00:00Z", agentId };
}

describe("o que CONTA como correção", () => {
  it("humano devolve o card para de onde a IA o tirou — o sinal mais forte", () => {
    const v = ehCorrecaoDeMovimentoDaIa({
      anteriores: [movimento("ai", ETAPA_A, ETAPA_B, AGENTE)],
      deEtapa: ETAPA_B,
      paraEtapa: ETAPA_A,
    });
    expect(v.ehCorrecao).toBe(true);
    if (!v.ehCorrecao) return;
    expect(v.tipo).toBe("devolucao");
    // A etapa que a IA ESCOLHEU é o dado do agregado: é ela que aparece em "o
    // assistente está mandando gente para X cedo demais".
    expect(v.etapaDaIa).toBe(ETAPA_B);
    expect(v.agentId).toBe(AGENTE);
  });

  it("humano manda para OUTRA etapa também é correção — ignorá-la perderia metade do sinal", () => {
    // "Não era ali" é tão informativo quanto "estava errado".
    const v = ehCorrecaoDeMovimentoDaIa({
      anteriores: [movimento("ai", ETAPA_A, ETAPA_B, AGENTE)],
      deEtapa: ETAPA_B,
      paraEtapa: ETAPA_C,
    });
    expect(v.ehCorrecao).toBe(true);
    if (!v.ehCorrecao) return;
    expect(v.tipo).toBe("redirecionamento");
    expect(v.etapaDaIa).toBe(ETAPA_B);
  });
});

describe("o que NÃO conta — e cada caso evita um falso sinal", () => {
  it("último movimento foi de OUTRO HUMANO: é trabalho normal de equipe", () => {
    // Se a IA moveu, um humano ajustou e outro humano ajusta de novo, o segundo
    // ajuste é sobre o trabalho do PRIMEIRO HUMANO — não sobre o da IA.
    const v = ehCorrecaoDeMovimentoDaIa({
      anteriores: [movimento("user", ETAPA_B, ETAPA_C), movimento("ai", ETAPA_A, ETAPA_B, AGENTE)],
      deEtapa: ETAPA_C,
      paraEtapa: ETAPA_A,
    });
    expect(v.ehCorrecao).toBe(false);
    if (v.ehCorrecao) return;
    expect(v.motivo).toBe("anterior_nao_foi_a_ia");
  });

  it("movimento do SISTEMA antes não conta — o nascimento do card não é decisão da IA", () => {
    const v = ehCorrecaoDeMovimentoDaIa({
      anteriores: [movimento("system", null, ETAPA_A)],
      deEtapa: ETAPA_A,
      paraEtapa: ETAPA_B,
    });
    expect(v.ehCorrecao).toBe(false);
  });

  it("card sem histórico: primeira movimentação não corrige nada", () => {
    const v = ehCorrecaoDeMovimentoDaIa({ anteriores: [], deEtapa: ETAPA_A, paraEtapa: ETAPA_B });
    expect(v.ehCorrecao).toBe(false);
    if (v.ehCorrecao) return;
    expect(v.motivo).toBe("sem_movimento_anterior");
  });

  it("mover para a MESMA etapa não é correção", () => {
    const v = ehCorrecaoDeMovimentoDaIa({
      anteriores: [movimento("ai", ETAPA_A, ETAPA_B, AGENTE)],
      deEtapa: ETAPA_B,
      paraEtapa: ETAPA_B,
    });
    expect(v.ehCorrecao).toBe(false);
    if (v.ehCorrecao) return;
    expect(v.motivo).toBe("mesmo_destino");
  });

  it("só o ÚLTIMO movimento importa, não qualquer movimento da IA no histórico", () => {
    // Um card com 10 movimentos da IA lá atrás e trabalho humano recente não é
    // correção de nada — senão todo card antigo viraria sinal permanente.
    const v = ehCorrecaoDeMovimentoDaIa({
      anteriores: [
        movimento("user", ETAPA_A, ETAPA_C),
        movimento("ai", ETAPA_B, ETAPA_A, AGENTE),
        movimento("ai", ETAPA_A, ETAPA_B, AGENTE),
      ],
      deEtapa: ETAPA_C,
      paraEtapa: ETAPA_B,
    });
    expect(v.ehCorrecao).toBe(false);
  });
});

describe("o agregado — o sinal só vira decisão quando alguém consegue LER", () => {
  const nome = (id: string) => (id === ETAPA_B ? "Qualificando" : id === ETAPA_C ? "Negociando" : "Novo");
  const correcao = (etapa: string, tipo: "devolucao" | "redirecionamento") => ({
    etapaDaIa: etapa,
    etapaDaIaNome: nome(etapa),
    tipo,
  });

  it("agrupa por etapa e ordena pela mais corrigida", () => {
    // "12 correções" não muda nada; "12 em Qualificando, 11 delas devoluções"
    // diz que o assistente qualifica cedo demais, e o dono sabe o que ajustar.
    const r = ondeAIaMaisErra([
      correcao(ETAPA_B, "devolucao"),
      correcao(ETAPA_B, "devolucao"),
      correcao(ETAPA_C, "redirecionamento"),
      correcao(ETAPA_B, "redirecionamento"),
    ]);
    expect(r[0]!.nome).toBe("Qualificando");
    expect(r[0]!.correcoes).toBe(3);
    expect(r[0]!.devolucoes).toBe(2);
    expect(r[0]!.redirecionamentos).toBe(1);
    expect(r[1]!.nome).toBe("Negociando");
  });

  it("empate desempata por nome — ordem estável numa tela que se compara entre dias", () => {
    const r = ondeAIaMaisErra([correcao(ETAPA_C, "devolucao"), correcao(ETAPA_B, "devolucao")]);
    expect(r.map((x) => x.nome)).toEqual(["Negociando", "Qualificando"]);
  });

  it("sem correções, lista vazia — não zero disfarçado de dado", () => {
    expect(ondeAIaMaisErra([])).toEqual([]);
  });
});
