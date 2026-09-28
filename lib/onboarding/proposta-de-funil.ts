/**
 * O QUADRO DE CLIENTES PROPOSTO — as regras, sem tocar no banco e sem chamar IA.
 *
 * ═══ O QUE ISTO RESOLVE ═══
 *
 * `trg_seed_default_pipeline_for_org` semeia o MESMO funil de e-commerce em toda
 * organização criada: "Carrinho abandonado", "Aguardando pagamento", "Em
 * separação", "Enviado". Uma clínica termina a instalação e abre o quadro dela
 * com uma coluna chamada "Carrinho abandonado".
 *
 * E tem a metade que não se vê. Medido neste banco em 2026-08-13: **312 etapas
 * em 43 funis, 4 com `agent_stage_hint`** — e as 4 são de organizações de teste.
 * Ou seja, toda instalação nasce com o funcionário incapaz de mover UM card:
 * `coberturaDoFunil` devolve `mudo: true`. Ele tem o funil no escopo (`pipeline_ids`)
 * e não sabe o que significa nenhuma das colunas.
 *
 * Por isso aqui uma etapa é NOME + PASSO indissociáveis. Propor colunas bonitas
 * sem dizer quando o funcionário move o cliente para cada uma seria trocar um
 * quadro errado por um quadro certo e igualmente parado.
 *
 * ⚠️ `is_won`/`is_lost` são DERIVADOS de `passo`, nunca campos próprios. O CHECK
 * `crm_stages_hint_coerente_com_won_lost` vigia justamente a discordância entre
 * os dois, e o jeito de nunca discordar é não ter duas fontes.
 */
import { LEAD_STAGES, type LeadStage } from "@/lib/agent-engine/agent/lead-state";
import { chaveDeNome } from "@/lib/leads/stage-editing";

/** Uma coluna do quadro, do jeito que a pessoa a lê na tela. */
export interface EtapaProposta {
  /** O que aparece no topo da coluna. */
  nome: string;
  /**
   * Quando o funcionário move o cliente para cá. `null` = coluna que só pessoas
   * movem, e isso é resposta, não pendência: "Em separação" não tem equivalente
   * no atendimento, e cobrar uma tradução para ela inflaria a lacuna com uma
   * dívida que não existe.
   */
  passo: LeadStage | null;
}

export interface PropostaDeFunil {
  /** O nome do quadro. "Pedidos" numa clínica é o defeito de origem. */
  nome: string;
  etapas: EtapaProposta[];
}

/**
 * O teto não é estético: um quadro com 12 colunas não cabe na tela do celular do
 * dono, e a primeira coisa que ele faz é parar de usar. O piso é o mínimo que
 * ainda conta uma história (entrou → conversou → fechou/perdeu).
 */
export const MIN_ETAPAS = 4;
export const MAX_ETAPAS = 8;

function ehPasso(v: unknown): v is LeadStage {
  return typeof v === "string" && (LEAD_STAGES as readonly string[]).includes(v);
}

function limpar(texto: unknown): string {
  return typeof texto === "string" ? texto.replace(/\s+/g, " ").trim() : "";
}

/**
 * Arruma o que dá para arrumar, sem inventar conteúdo.
 *
 * Chame SEMPRE antes de validar, inclusive nos pacotes curados: o que sai daqui
 * é exatamente o que a tela mostra, e o que a tela mostra é exatamente o que vai
 * para o banco. Uma normalização que rodasse só depois da confirmação faria a
 * pessoa aprovar uma coisa e receber outra.
 *
 * O que ele NÃO faz: inventar etapa que falta, escolher a de ganho, traduzir
 * passo que a IA não mandou. Completar a proposta seria eu escrevendo o funil e
 * creditando à sugestão — e o dono aprovaria um texto que ninguém propôs.
 */
export function normalizarProposta(bruta: {
  nome?: unknown;
  etapas?: unknown;
}): PropostaDeFunil {
  const etapasBrutas = Array.isArray(bruta.etapas) ? bruta.etapas : [];

  const nomesUsados = new Set<string>();
  const passosUsados = new Set<LeadStage>();
  const etapas: EtapaProposta[] = [];

  for (const item of etapasBrutas) {
    if (etapas.length >= MAX_ETAPAS) break;
    const registro = (item ?? {}) as { nome?: unknown; passo?: unknown };

    const nome = limpar(registro.nome);
    if (!nome) continue;
    // Duas colunas que a pessoa leria como a mesma ("Pós-venda" e "Pos venda")
    // viram uma. A segunda não é renomeada com sufixo: um quadro com "Proposta"
    // e "Proposta 2" é pior que um quadro com uma "Proposta".
    const chave = chaveDeNome(nome);
    if (nomesUsados.has(chave)) continue;
    nomesUsados.add(chave);

    // Passo repetido: o índice `uniq_crm_stages_pipeline_hint` é uma etapa por
    // passo. Fica com a PRIMEIRA — a ordem da proposta é a ordem do funil, e o
    // primeiro lugar onde o cliente chega é o que o passo descreve.
    let passo: LeadStage | null = ehPasso(registro.passo) ? registro.passo : null;
    if (passo && passosUsados.has(passo)) passo = null;
    if (passo) passosUsados.add(passo);

    etapas.push({ nome, passo });
  }

  return { nome: limpar(bruta.nome), etapas };
}

export type ResultadoDaProposta =
  | { ok: true; proposta: PropostaDeFunil }
  | { ok: false; erros: string[] };

/**
 * Recusa a proposta que não vira um funil usável.
 *
 * As recusas são as que o BANCO imporia mais tarde — e tarde demais: o
 * `uniq_crm_stages_pipeline_won` e o `fn_validate_lost_reason_required` chegam
 * como código de erro do Postgres numa tela de onboarding.
 *
 * ⚠️ RECUSAR É O DESFECHO CERTO, NÃO O RUIM. Quem chama cai no pacote curado do
 * ramo e diz isso na tela. Completar a proposta pela metade entregaria um quadro
 * que ninguém desenhou — nem a IA, nem o dono, nem o produto.
 */
export function validarProposta(p: PropostaDeFunil): ResultadoDaProposta {
  const erros: string[] = [];

  if (!p.nome) erros.push("O quadro precisa de um nome.");

  if (p.etapas.length < MIN_ETAPAS) {
    erros.push(
      `Um quadro com ${p.etapas.length} ${p.etapas.length === 1 ? "coluna" : "colunas"} não conta a história de uma venda — o mínimo é ${MIN_ETAPAS}.`,
    );
  }

  // Sem etapa de ganho, `/leads/[id]/win` responde 422 `pipeline_no_won_stage` e
  // nenhum negócio deste tenant consegue ser fechado.
  if (!p.etapas.some((e) => e.passo === "won")) {
    erros.push("Falta a coluna onde o negócio é fechado.");
  }
  // Sem etapa de perda, o funcionário não tem para onde mandar quem desistiu — e
  // o card fica para sempre numa coluna do meio, inflando o quadro.
  if (!p.etapas.some((e) => e.passo === "lost")) {
    erros.push("Falta a coluna de quem não fechou.");
  }

  return erros.length === 0 ? { ok: true, proposta: p } : { ok: false, erros };
}

/** Uma linha de `crm_stages`, do jeito que a gravação precisa dela. */
export interface EtapaParaGravar {
  nome: string;
  slug: string;
  position: number;
  is_won: boolean;
  is_lost: boolean;
  agent_stage_hint: LeadStage | null;
}

/**
 * A proposta traduzida nas linhas do banco.
 *
 * `slugDeNome` recebe os slugs já emitidos nesta mesma conversão porque
 * `uniq_crm_stages_pipeline_slug` não é parcial: duas colunas cujo nome colapsa
 * no mesmo slug ("Proposta!" e "Proposta?") colidiriam no INSERT.
 *
 * O passo de 1000 em 1000 é o mesmo do gatilho de seed e o que o `midpoint()`
 * do arrastar-e-soltar espera encontrar entre duas colunas.
 */
export function etapasParaGravar(
  p: PropostaDeFunil,
  slugDeNome: (nome: string, existentes: string[]) => string,
): EtapaParaGravar[] {
  const slugs: string[] = [];
  return p.etapas.map((e, i) => {
    const slug = slugDeNome(e.nome, slugs);
    slugs.push(slug);
    return {
      nome: e.nome,
      slug,
      position: (i + 1) * 1000,
      is_won: e.passo === "won",
      is_lost: e.passo === "lost",
      agent_stage_hint: e.passo,
    };
  });
}
