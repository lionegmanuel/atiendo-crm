/**
 * A REGRA da sincronização do catálogo. Sem HTTP, sem Supabase — só a decisão.
 *
 * O que ela decide: dada a lista que veio da origem e a lista que está no
 * banco, o que INSERIR, o que ATUALIZAR e o que marcar como OBSOLETO.
 *
 * ## As três garantias que essa decisão precisa dar
 *
 * **Não pisar no que é de outro dono.** `ai_models` mistura linhas semeadas por
 * migration (`source = 'manual'`) com as sincronizadas. Um sincronizador que
 * varresse a tabela inteira apagaria a curadoria que veio nas migrations — e o
 * operador perderia os defaults recomendados sem nunca saber por quê. Por isso
 * toda decisão é escopada a `source = <a fonte desta execução>`.
 *
 * **Sumir da origem é depreciar, nunca apagar.** A linha continua referenciada
 * pelo histórico de custo; um DELETE faria o relatório do mês passado perder o
 * preço com que a conta foi somada. `deprecated_at` some da tela e preserva a
 * contabilidade.
 *
 * **Voltar à origem é ressuscitar.** Modelo depreciado que reaparece precisa
 * voltar a ser oferecido — sem isso, uma indisponibilidade momentânea da origem
 * enterraria permanentemente metade do catálogo, e o operador veria a lista
 * encolher sozinha sem explicação.
 *
 * ## Por que uma função pura e não um `upsert` direto
 *
 * O `upsert` sabe gravar, não sabe decidir. As três garantias acima são regra
 * de negócio, e regra que vive dentro de uma query só é exercitável com um
 * banco de pé — que é como se chega a "testo depois".
 */
import type { LinhaDeCatalogo } from "./openrouter";

/** O que o banco já tem, para a fonte desta execução. */
export interface ModeloExistente {
  model_id: string;
  deprecated_at: string | null;
}

export interface PlanoDeSincronizacao {
  /** Entram ou são atualizados (upsert por `(provider, model_id)`). */
  paraGravar: LinhaDeCatalogo[];
  /** Estavam ativos e sumiram da origem → recebem `deprecated_at`. */
  paraDepreciar: string[];
  /** Estavam depreciados e voltaram → `deprecated_at = null`. */
  paraRessuscitar: string[];
}

/**
 * Quando a origem devolve MENOS que esta fração do que já conhecíamos, a
 * execução é abortada em vez de depreciar em massa.
 *
 * Não é paranoia: a origem já respondeu lista parcial durante incidente, e o
 * desfecho de acreditar nela seria o operador abrindo o painel e encontrando o
 * catálogo vazio, sem nada na tela explicando que foi um soluço de rede de
 * cinco minutos. Recusar a rodada custa um catálogo desatualizado até a próxima
 * — recuperável e silencioso; aceitar custa a confiança na tela.
 */
export const PISO_DE_SANIDADE = 0.5;

export class CatalogoSuspeitoError extends Error {
  constructor(
    readonly recebidos: number,
    readonly conhecidos: number,
  ) {
    super(
      `origem devolveu ${recebidos} modelos contra ${conhecidos} já conhecidos — ` +
        `abaixo do piso de ${Math.round(PISO_DE_SANIDADE * 100)}%; rodada abortada para não depreciar o catálogo em massa`,
    );
    this.name = "CatalogoSuspeitoError";
  }
}

export function planejarSincronizacao(
  daOrigem: readonly LinhaDeCatalogo[],
  noBanco: readonly ModeloExistente[],
): PlanoDeSincronizacao {
  const ativosConhecidos = noBanco.filter((m) => m.deprecated_at === null).length;

  // O piso só se aplica quando JÁ havia catálogo — a primeira execução parte de
  // zero e qualquer quantidade é progresso.
  if (ativosConhecidos > 0 && daOrigem.length < ativosConhecidos * PISO_DE_SANIDADE) {
    throw new CatalogoSuspeitoError(daOrigem.length, ativosConhecidos);
  }

  const idsDaOrigem = new Set(daOrigem.map((l) => l.model_id));

  const paraDepreciar = noBanco
    .filter((m) => m.deprecated_at === null && !idsDaOrigem.has(m.model_id))
    .map((m) => m.model_id);

  const paraRessuscitar = noBanco
    .filter((m) => m.deprecated_at !== null && idsDaOrigem.has(m.model_id))
    .map((m) => m.model_id);

  return { paraGravar: [...daOrigem], paraDepreciar, paraRessuscitar };
}
