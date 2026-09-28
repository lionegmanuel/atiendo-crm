/**
 * O CATÁLOGO DA OPENROUTER, TRADUZIDO PARA O QUE O SISTEMA SABE GUARDAR.
 *
 * A OpenRouter publica ~400 modelos de ~58 fabricantes num endpoint público, e
 * a lista muda sozinha: modelo novo aparece, modelo velho sai, preço muda. Uma
 * lista mantida à mão em migration envelhece entre um deploy e outro — e
 * envelhecer aqui não é cosmético: o preço errado faz o teto de orçamento da
 * organização disparar na hora errada, ou não disparar.
 *
 * Este módulo faz a tradução PURA (resposta da API → linhas do catálogo). O I/O
 * — buscar e gravar — vive no worker, pelo mesmo motivo de sempre neste repo: a
 * parte que erra é a tradução, e ela precisa ser exercitável sem rede.
 *
 * ## Três decisões que valem explicação
 *
 * **Preço em centavos por milhão de tokens, com arredondamento para cima.** A
 * OpenRouter publica dólares por token (`"0.00001"`). A conversão perde
 * precisão em qualquer direção; para BAIXO ela subestima o gasto, e um teto de
 * orçamento que subestima é um teto que não segura. Para cima, o pior caso é o
 * cliente ser avisado um pouco antes.
 *
 * **`tools` vem de `supported_parameters`, não de heurística sobre o nome.** É
 * o dado que impede o operador de escolher, para o ponto que cria o lead, um
 * modelo que não sabe chamar ferramenta — o defeito que faria o agente
 * conversar normalmente e não registrar nada no funil.
 *
 * **Modelo que sai do catálogo é DEPRECIADO, nunca apagado.** A linha continua
 * referenciada pelo histórico de custo; apagá-la faria o relatório do mês
 * passado perder o preço com que a conta foi somada.
 */

/** O recorte da resposta da OpenRouter que este módulo consome. */
export interface ModeloDaOpenRouter {
  id: string;
  name?: string | null;
  description?: string | null;
  context_length?: number | null;
  architecture?: {
    input_modalities?: string[] | null;
  } | null;
  pricing?: {
    prompt?: string | null;
    completion?: string | null;
  } | null;
  supported_parameters?: string[] | null;
}

/** Uma linha pronta para o upsert em `ai_models`. */
export interface LinhaDeCatalogo {
  provider: string;
  model_id: string;
  display_name: string;
  description: string | null;
  context_window: number | null;
  input_price_per_million_cents: number | null;
  output_price_per_million_cents: number | null;
  supports_tools: boolean;
  supports_vision: boolean;
  source: string;
}

export const FONTE_OPENROUTER = "openrouter";

/**
 * Dólares por token → centavos por milhão de tokens, arredondando para CIMA.
 *
 * Devolve `null` quando o preço não veio ou não é numérico — e `null` é
 * deliberado, não zero: zero significaria "de graça" para o somatório de custo,
 * e um modelo caro entrando na conta como gratuito é o erro que só aparece na
 * fatura. A doutrina do repo já diz isso em `llm_calls.cost_cents` ("null =
 * preço desconhecido — nunca inventar 0").
 */
export function precoParaCentavosPorMilhao(valor: string | null | undefined): number | null {
  if (valor === null || valor === undefined || valor.trim() === "") return null;
  const dolaresPorToken = Number(valor);
  if (!Number.isFinite(dolaresPorToken) || dolaresPorToken < 0) return null;
  // Modelo gratuito é 0 de verdade e precisa continuar sendo 0 — distinto de
  // desconhecido, que é null.
  if (dolaresPorToken === 0) return 0;
  return Math.ceil(dolaresPorToken * 1_000_000 * 100);
}

/** Traduz UM modelo. `null` quando a entrada não é utilizável. */
export function traduzirModelo(m: ModeloDaOpenRouter): LinhaDeCatalogo | null {
  const id = (m.id ?? "").trim();
  if (id === "") return null;

  const parametros = m.supported_parameters ?? [];
  const modalidades = m.architecture?.input_modalities ?? [];

  return {
    provider: FONTE_OPENROUTER,
    model_id: id,
    // O nome de exibição cai para o id quando falta: uma linha sem rótulo
    // apareceria em branco na tela, e o operador não saberia o que escolheu.
    display_name: (m.name ?? "").trim() || id,
    description: primeiraFrase(m.description),
    context_window: Number.isFinite(m.context_length) ? (m.context_length as number) : null,
    input_price_per_million_cents: precoParaCentavosPorMilhao(m.pricing?.prompt),
    output_price_per_million_cents: precoParaCentavosPorMilhao(m.pricing?.completion),
    supports_tools: parametros.includes("tools"),
    supports_vision: modalidades.includes("image"),
    source: FONTE_OPENROUTER,
  };
}

/**
 * Traduz o catálogo inteiro, descartando o que não dá para usar e removendo
 * duplicata de id (a origem já mandou o mesmo id duas vezes no passado, e o
 * upsert por `(provider, model_id)` estouraria com
 * "ON CONFLICT DO UPDATE command cannot affect row a second time").
 */
export function traduzirCatalogo(modelos: readonly ModeloDaOpenRouter[]): LinhaDeCatalogo[] {
  const porId = new Map<string, LinhaDeCatalogo>();
  for (const m of modelos) {
    const linha = traduzirModelo(m);
    if (linha === null) continue;
    porId.set(linha.model_id, linha);
  }
  return [...porId.values()];
}

/**
 * A descrição da OpenRouter é longa e vem com markdown e links. A tela mostra
 * uma linha; guardar o texto inteiro só engorda a resposta da API do painel.
 */
function primeiraFrase(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const limpo = texto
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // link markdown → só o texto
    .replace(/\s+/g, " ")
    .trim();
  if (limpo === "") return null;
  const corte = limpo.slice(0, 300);
  const fim = corte.search(/\.\s|$/);
  return (fim > 0 ? corte.slice(0, fim + 1) : corte).trim();
}
