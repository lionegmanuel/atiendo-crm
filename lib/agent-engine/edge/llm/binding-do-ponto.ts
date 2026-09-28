/**
 * A ponte entre o painel de provedores e o seam de chamada de modelo.
 *
 * O seam já recebia `purpose` em toda chamada — e o usava só para rotular o
 * custo em `llm_calls`. A escolha de modelo continuava vindo de outro lugar.
 * Este módulo é o que faz o `purpose` finalmente DECIDIR: lê o binding daquele
 * ponto (se o operador configurou um) e devolve a decisão já no formato que o
 * seam sabe aplicar.
 *
 * A leitura acontece por chamada, igual à config da org: trocar o provedor de
 * um ponto no painel vale na chamada seguinte, sem restart nem deploy. O custo
 * é um SELECT por índice parcial (`ai_purpose_bindings_lookup_idx`) contra uma
 * tabela com no máximo uma linha por ponto por organização.
 *
 * Falha de leitura NÃO derruba o turno: sem binding, o comportamento é o de
 * antes desta frente. Uma tabela indisponível deixando o cliente sem resposta
 * seria trocar um problema de configuração por um de disponibilidade.
 */
import type pg from 'pg';

import {
  decidirBinding,
  type AgentePublicado,
  type DecisaoDeBinding,
  type LinhaDeBinding,
} from '../../../ai/pontos/resolver';

/** Lê o binding de um ponto. `null` = o operador não configurou este ponto. */
export async function carregarBinding(
  db: pg.Pool,
  organizationId: string,
  purpose: string,
): Promise<LinhaDeBinding | null> {
  const { rows } = await db.query<LinhaDeBinding>(
    `select purpose, provider, credential_id, model_id, base_url, is_enabled
       from ai_purpose_bindings
      where organization_id = $1 and purpose = $2 and is_enabled
      limit 1`,
    [organizationId, purpose],
  );
  return rows[0] ?? null;
}

export interface EntradaDoSeam {
  organizationId: string;
  purpose: string;
  /**
   * O modelo que o call site passou. Hoje ele carrega DUAS coisas distintas —
   * o knob de ambiente do ponto e o modelo herdado do agente publicado — e
   * quem separa as duas é a presença de `llmOverride` (que só o agente
   * publicado preenche, ver `aux-model-args.ts`).
   */
  modeloDoCallSite: string | undefined;
  /** Preenchido apenas quando a origem é a versão publicada do agente. */
  overrideDoAgente: AgentePublicado | null;
  padraoDaOrganizacao: { provider: string; defaultModel: string | null };
}

/**
 * Decide o que vale para esta chamada. Devolve a decisão inteira — provider,
 * modelo, credencial e ORIGEM — para o seam aplicar e para o log registrar por
 * que aquele modelo foi usado.
 */
export async function decidirParaOSeam(
  db: pg.Pool,
  entrada: EntradaDoSeam,
  deps: { log?: { warn: (msg: string, meta?: Record<string, unknown>) => void } } = {},
): Promise<DecisaoDeBinding> {
  let binding: LinhaDeBinding | null = null;
  try {
    binding = await carregarBinding(db, entrada.organizationId, entrada.purpose);
  } catch (err) {
    // Segue o caminho de antes desta frente — indisponibilidade da tabela não
    // pode virar cliente sem resposta.
    //
    // Mas NÃO em silêncio. Um clone que não aplicou o baseline não tem esta
    // tabela; sem este aviso, o painel inteiro pareceria funcionar (salva na
    // tela, mostra a escolha) enquanto nenhuma chamada de modelo a respeitaria
    // — que é a forma exata do problema que esta frente veio resolver, agora
    // criada por ela. O aviso é por chamada e barato; quem o consome é o log
    // estruturado, e na frente de logs vira aviso na Central.
    binding = null;
    deps.log?.warn('llm: não consegui ler o binding do ponto — usando o padrão', {
      organization_id: entrada.organizationId,
      purpose: entrada.purpose,
      motivo: err instanceof Error ? err.message : String(err),
    });
  }

  return decidirBinding({
    pontoId: entrada.purpose,
    binding,
    agentePublicado: entrada.overrideDoAgente,
    // Quando o override do agente está presente, o modelo do call site É o do
    // agente e já viaja em `agentePublicado.model` — repeti-lo aqui faria o
    // resolvedor tratar a herança do agente como se fosse knob de ambiente, e
    // a origem reportada na tela ficaria errada.
    modeloDeAmbiente: entrada.overrideDoAgente === null ? entrada.modeloDoCallSite : undefined,
    padraoDaOrganizacao: entrada.padraoDaOrganizacao,
  });
}
