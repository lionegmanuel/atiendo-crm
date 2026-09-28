/**
 * QUANDO UM HUMANO DESFAZ O QUE A IA FEZ (spec 17 passo 5).
 *
 * ═══ O INVARIANTE 7 DO SISTEMA VIVO ═══
 *
 * "Toda decisão automática tem retorno que altera decisão futura." O passo 3 deu
 * ao assistente um limite; o passo 4 mostrou onde falta configuração. Nenhum dos
 * dois responde a pergunta que fecha o ciclo: **quando ele erra, o que muda no
 * sistema?**
 *
 * Sem isto, o produto tem caminho (invariante 1) e não tem ciclo. A IA erra do
 * mesmo jeito amanhã, e o dono corrige de novo — para sempre, em silêncio.
 *
 * ═══ O QUE CONTA COMO CORREÇÃO ═══
 *
 * Um humano mover um card que **a IA moveu por último**. Não é qualquer
 * movimentação humana: o dono reorganizar o funil dele não diz nada sobre o
 * assistente.
 *
 * Duas formas, e as duas contam:
 *
 *  - **devolução** — o humano põe o card de volta na etapa de onde a IA o tirou.
 *    É o sinal mais forte: "esse movimento estava errado";
 *  - **redirecionamento** — o humano manda para OUTRA etapa. Também é correção
 *    ("não era ali"), e ignorá-la perderia metade do sinal.
 *
 * ═══ O QUE NÃO CONTA, E POR QUÊ ═══
 *
 * Se a última movimentação foi de outro humano, mexer no card é trabalho normal
 * de equipe. Contar isso como "a IA errou" inflaria o número com ruído — e um
 * indicador que sobe sem causa é um indicador que se aprende a ignorar.
 */

/** Uma movimentação já registrada na timeline do negócio. */
export interface MovimentoRegistrado {
  /** 'ai' | 'user' | 'system' | 'rule' | 'contact' — o vocabulário da timeline. */
  actorKind: string | null;
  fromStageId: string | null;
  toStageId: string | null;
  performedAt: string;
  agentId?: string | null;
}

export type TipoDeCorrecao = "devolucao" | "redirecionamento";

export type VereditoDaCorrecao =
  | { ehCorrecao: false; motivo: "sem_movimento_anterior" | "anterior_nao_foi_a_ia" | "mesmo_destino" }
  | {
      ehCorrecao: true;
      tipo: TipoDeCorrecao;
      /** Para onde a IA tinha levado — é a etapa que ela errou. */
      etapaDaIa: string;
      /** Para onde o humano levou. */
      etapaDoHumano: string;
      agentId: string | null;
    };

/**
 * Este movimento humano corrige o último movimento da IA?
 *
 * Função pura: o chamador traz o histórico. É o que permite testar todos os
 * casos sem banco, e é o que mantém a regra num lugar só quando houver um
 * segundo caminho de movimentação.
 */
export function ehCorrecaoDeMovimentoDaIa(entrada: {
  /** Movimentos anteriores do MESMO negócio, do mais recente para o mais antigo. */
  anteriores: readonly MovimentoRegistrado[];
  /** Para onde o humano está movendo agora. */
  paraEtapa: string;
  /** De onde o card está saindo agora. */
  deEtapa: string;
}): VereditoDaCorrecao {
  const ultimo = entrada.anteriores[0];
  if (!ultimo) return { ehCorrecao: false, motivo: "sem_movimento_anterior" };

  // Só o ÚLTIMO movimento importa. Se a IA moveu, um humano ajustou, e outro
  // humano ajusta de novo, o segundo ajuste é sobre o trabalho do primeiro
  // humano — não sobre o da IA.
  if (ultimo.actorKind !== "ai") return { ehCorrecao: false, motivo: "anterior_nao_foi_a_ia" };

  // Movimento que termina onde já estava não é correção de nada.
  if (entrada.paraEtapa === entrada.deEtapa) return { ehCorrecao: false, motivo: "mesmo_destino" };

  const voltouParaOrigem = ultimo.fromStageId !== null && entrada.paraEtapa === ultimo.fromStageId;

  return {
    ehCorrecao: true,
    tipo: voltouParaOrigem ? "devolucao" : "redirecionamento",
    // A etapa que a IA escolheu — o dado que importa para o agregado. É ela que
    // aparece em "o assistente está mandando gente para X cedo demais".
    etapaDaIa: ultimo.toStageId ?? entrada.deEtapa,
    etapaDoHumano: entrada.paraEtapa,
    agentId: ultimo.agentId ?? null,
  };
}

// ---------------------------------------------------------------------------
// O AGREGADO — o sinal só vira decisão quando alguém consegue LER
// ---------------------------------------------------------------------------

export interface CorrecaoRegistrada {
  etapaDaIa: string;
  etapaDaIaNome: string;
  tipo: TipoDeCorrecao;
}

export interface EtapaCorrigida {
  stageId: string;
  nome: string;
  correcoes: number;
  devolucoes: number;
  redirecionamentos: number;
}

/**
 * Onde o assistente mais erra.
 *
 * Uma linha por etapa, ordenada pela que mais foi corrigida. É a forma que
 * responde "e daí?" (invariante 5): "12 correções" não muda nada; "12 correções
 * em Qualificando, 11 delas devoluções" diz que o assistente está qualificando
 * cedo demais, e o dono sabe o que ajustar.
 */
export function ondeAIaMaisErra(correcoes: readonly CorrecaoRegistrada[]): EtapaCorrigida[] {
  const porEtapa = new Map<string, EtapaCorrigida>();
  for (const c of correcoes) {
    const atual = porEtapa.get(c.etapaDaIa) ?? {
      stageId: c.etapaDaIa,
      nome: c.etapaDaIaNome,
      correcoes: 0,
      devolucoes: 0,
      redirecionamentos: 0,
    };
    atual.correcoes += 1;
    if (c.tipo === "devolucao") atual.devolucoes += 1;
    else atual.redirecionamentos += 1;
    porEtapa.set(c.etapaDaIa, atual);
  }
  return [...porEtapa.values()].sort(
    // Desempate por nome: ordem estável importa numa tela que alguém compara
    // entre dias.
    (a, b) => b.correcoes - a.correcoes || a.nome.localeCompare(b.nome),
  );
}
