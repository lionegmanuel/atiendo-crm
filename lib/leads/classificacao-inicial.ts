/**
 * Classificação inicial do lead — roda UMA vez, na ingestão do webhook, antes
 * de qualquer humano ou IA conversar com o lead. Três saídas possíveis:
 *
 *   1. `desqualificado` — bateu um dos 2 motivos EXATOS abaixo, os dois
 *      BLOQUEIOS TÉCNICOS/LEGAIS reais (sem telefone válido não há canal;
 *      sem consentimento não há base legal). Determinístico, sem exceção por
 *      regra mal configurada (mesmo raciocínio do gate de consentimento em
 *      `lib/automation/guarda-do-contato.ts`).
 *   2. `revisao_humana` — o dado pede um olho humano antes de seguir
 *      (conflito de identidade, sinal de spam, ou contradição entre o que a
 *      empresa diz investir hoje e o que diz que seria viável). NÃO bloqueia
 *      o primeiro contato automático — é sinal para quem acompanha o funil,
 *      não um gate de envio (esse gate é outro, e vive em
 *      `guarda-do-contato.ts`, olhando telefone/consentimento, não
 *      classificação).
 *   3. `A` | `B` | `C` | `D` | `nao_avaliado` — a classe de score.
 *      `nao_avaliado` é o valor honesto quando `respondi_score` está ausente
 *      ou não é numérico — nunca uma classe adivinhada por omissão (mesmo
 *      raciocínio de `lib/leads/score-writer.ts`: zero é uma afirmação).
 *
 * ═══ A REGRA DE D, E POR QUE MUDOU (decisão de Matheus, 2026-08-25) ═══
 *
 * Versão anterior: `viable_investment_range` abaixo de um corte numérico
 * (R$3.000/mês) forçava D sozinho, sobrescrevendo A/B/C. Rejeitada: uma
 * empresa de alto potencial que declara um orçamento inicial modesto não
 * pode despencar pra D só por causa desse UM campo — orçamento tem que ser
 * parte da pontuação, não o veredito sozinho.
 *
 * Resolução: NÃO existe mais um corte numérico de orçamento aqui. O
 * `respondent.score` do Respondi já é, ele mesmo, um critério COMBINADO — a
 * pergunta de faixa de investimento é uma das ~15 perguntas do caminho
 * condicional que alimentam esse score, então orçamento já pesa no
 * percentual sem eu duplicar o desconto. D só é alcançado por dois caminhos,
 * os dois vindos do critério COMBINADO, nunca de um campo isolado:
 *
 *   (a) o score do Respondi computou para o PISO (percentual === 0) — o
 *       conjunto de respostas, combinado, não rendeu pontuação nenhuma; ou
 *   (b) o respondente disse, com as próprias palavras, "Ainda não posso
 *       investir" — não é um corte que eu inventei, é a frase exata que a
 *       pessoa escolheu no formulário. Sinal FORTE o bastante pra forçar D
 *       mesmo que o score numérico fosse mais alto, mas ainda assim um sinal
 *       do respondente, não uma inferência sobre um número de R$.
 *
 * As duas vias cumprem "leads efetivamente desqualificados pelos critérios
 * combinados do scoring, e não apenas pelo orçamento declarado" — e D
 * continua sendo classe, não desqualificação: o lead segue no CRM, elegível
 * pra a cadência própria de D (oferta de entrada, D+3, D+10).
 *
 * Este módulo é PURO (nenhum I/O) — testável sem banco, chamado pela rota do
 * webhook com os `custom_fields` já mapeados pelo normalizador do Respondi.
 */
import { CONFIG_CLASSIFICACAO_INICIAL } from "@/lib/leads/config-classificacao-inicial";

export type ClasseInicial = "A" | "B" | "C" | "D" | "nao_avaliado";
export type ResultadoClassificacaoInicial =
  | { status: "desqualificado"; motivo: MotivoDesqualificacao }
  | { status: "revisao_humana"; motivo: MotivoRevisaoHumana }
  | { status: "classificado"; classe: ClasseInicial; percentual: number | null };

export type MotivoDesqualificacao = "contato_invalido" | "sem_consentimento";
export type MotivoRevisaoHumana = "conflito_de_identidade" | "spam_suspeito" | "incoerencia_investimento";

export interface EntradaClassificacaoInicial {
  customFields: Record<string, unknown>;
  /** `null` = telefone ausente ou não normalizável (ver `normalizePhoneBR`). */
  phoneNormalizado: string | null;
  consentGranted: boolean;
  /**
   * O formulário CHEGOU A PERGUNTAR? `false` quando o mapeador não achou a
   * pergunta de autorização (`detectedVia === "not_found"`).
   *
   * Existe porque `consentGranted` é `false` nos DOIS casos — a pessoa disse
   * não, e ninguém perguntou —, e desqualificar o segundo é desqualificar todo
   * lead de um formulário que não faz a pergunta. Mesma distinção que a guarda
   * de envio faz com `consent.marketing.declined_at`
   * (`lib/automation/guarda-do-contato.ts`).
   */
  consentPerguntado: boolean;
  /**
   * Presente só quando o contato foi casado com um JÁ EXISTENTE (mesmo
   * telefone ou mesmo e-mail) — necessário pra checar conflito de identidade.
   * `null` = contato novo, sem conflito possível.
   */
  contatoExistente: { name: string | null } | null;
  /** Nome que ESTE envio trouxe (`mapped.name`). */
  nomeDoEnvio: string | null;
}

/** A frase exata que sinaliza "sem capacidade de investimento agora" — sinal forte pra D, não desqualificação. */
const FRASE_SEM_CAPACIDADE = "ainda não posso investir";

function normalizaTexto(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().toLowerCase() : null;
}

/**
 * Os 2 motivos EXATOS de desqualificação — os únicos que são bloqueio
 * TÉCNICO/LEGAL real (não dá pra mandar WhatsApp sem telefone válido; não dá
 * base legal pra mandar sem consentimento). "Ainda não posso investir" NÃO
 * está mais aqui — vira sinal de classe (D), não motivo de exclusão (decisão
 * de 2026-08-25, ver cabeçalho do arquivo). Spam/incoerência também não —
 * vão pra `avaliarRevisaoHumana`, que não bloqueia nada.
 */
export function avaliarDesqualificacao(input: EntradaClassificacaoInicial): MotivoDesqualificacao | null {
  if (!input.phoneNormalizado) return "contato_invalido";
  // A recusa desqualifica; a AUSÊNCIA DA PERGUNTA, não. Ver `consentPerguntado`.
  if (input.consentPerguntado && !input.consentGranted) return "sem_consentimento";
  return null;
}

const AFIRMACOES_URL = /https?:\/\/|www\./i;
const SEQUENCIA_DE_DIGITOS_LONGA = /\d{8,}/;
const CARACTERE_REPETIDO = /(.)\1{4,}/;
const MARCADORES_DE_TESTE = new Set(["teste", "test", "asdf", "spam", "xxx", "aaaa", "qwerty", "n/a", "-"]);

/** Nome que não parece nome: só dígito, e-mail/URL, caractere repetido, ou um marcador conhecido de teste/spam. */
function nomePareceSpam(nome: string | null): boolean {
  if (!nome) return false;
  const n = nome.trim();
  if (!n) return false;
  const nLower = n.toLowerCase();
  if (MARCADORES_DE_TESTE.has(nLower)) return true;
  if (/^\d+$/.test(n)) return true;
  if (n.includes("@") || AFIRMACOES_URL.test(n)) return true;
  if (CARACTERE_REPETIDO.test(n)) return true;
  return false;
}

/** Campo de texto livre com URL ou sequência de dígitos longa (telefone/WhatsApp embutido) — divulgação, não resposta. */
function textoLivrePareceSpam(texto: unknown): boolean {
  if (typeof texto !== "string" || !texto.trim()) return false;
  return AFIRMACOES_URL.test(texto) || SEQUENCIA_DE_DIGITOS_LONGA.test(texto);
}

/**
 * Extrai o MAIOR valor em reais mencionado num texto de faixa do Respondi
 * ("De R$ 4 mil a R$ 7 mil por mês" → 7000; "Até R$ 2 mil" → 2000).
 * `null` quando não há nenhum padrão "N mil" reconhecível — nunca um valor
 * chutado a partir de texto que não bate no formato conhecido.
 */
function extraiValorMaximoBRL(texto: unknown): number | null {
  if (typeof texto !== "string") return null;
  const matches = [...texto.matchAll(/(\d+(?:[.,]\d+)?)\s*mil/gi)];
  if (!matches.length) return null;
  const valores = matches.map((m) => Number(m[1]!.replace(",", ".")) * 1000);
  return Math.max(...valores);
}

/**
 * Os 3 sinais de revisão humana — NENHUM deles bloqueia envio automático.
 * São pedido de olho humano, não gate: quem controla se a mensagem sai é
 * `guarda-do-contato.ts` (telefone/consentimento), que não lê nada disto.
 */
export function avaliarRevisaoHumana(input: EntradaClassificacaoInicial): MotivoRevisaoHumana | null {
  const nomeExistente = normalizaTexto(input.contatoExistente?.name);
  const nomeNovo = normalizaTexto(input.nomeDoEnvio);
  if (input.contatoExistente && nomeExistente && nomeNovo && nomeExistente !== nomeNovo) {
    return "conflito_de_identidade";
  }

  if (
    nomePareceSpam(input.nomeDoEnvio) ||
    textoLivrePareceSpam(input.customFields.company_name) ||
    textoLivrePareceSpam(input.customFields.commercial_challenge)
  ) {
    return "spam_suspeito";
  }

  const investeHoje = extraiValorMaximoBRL(input.customFields.current_marketing_investment);
  const faixaViavel = extraiValorMaximoBRL(input.customFields.viable_investment_range);
  if (investeHoje !== null && faixaViavel !== null && investeHoje > faixaViavel) {
    return "incoerencia_investimento";
  }

  return null;
}

function bandaDoPercentual(percentual: number): "A" | "B" | "C" {
  const { bandas } = CONFIG_CLASSIFICACAO_INICIAL;
  if (percentual >= bandas.A.min) return "A";
  if (percentual >= bandas.B.min) return "B";
  return "C";
}

export function classificarLeadInicial(input: EntradaClassificacaoInicial): ResultadoClassificacaoInicial {
  const motivoDesqualificacao = avaliarDesqualificacao(input);
  if (motivoDesqualificacao) return { status: "desqualificado", motivo: motivoDesqualificacao };

  const motivoRevisao = avaliarRevisaoHumana(input);
  if (motivoRevisao) return { status: "revisao_humana", motivo: motivoRevisao };

  const bruto = Number(input.customFields.respondi_score);
  if (!Number.isFinite(bruto)) {
    // Sem pontuação suficiente pra avaliar — nunca uma classe adivinhada.
    return { status: "classificado", classe: "nao_avaliado", percentual: null };
  }
  // Arredondado a 2 casas: divisão seguida de multiplicação por 100 gera
  // ruído de ponto flutuante (55/100*100 = 55.00000000000001) mesmo quando o
  // resultado matemático é exato — sem isto, todo teste de igualdade (e toda
  // comparação de banda) fica refém do float.
  const bruta = Math.max(0, Math.min(100, (bruto / CONFIG_CLASSIFICACAO_INICIAL.maxScoreConhecido) * 100));
  const percentual = Math.round(bruta * 100) / 100;

  // D via sinal FORTE e direto do respondente — não um corte de R$ inventado.
  const faixaViavel = normalizaTexto(input.customFields.viable_investment_range);
  if (faixaViavel === FRASE_SEM_CAPACIDADE) {
    return { status: "classificado", classe: "D", percentual };
  }

  // D via piso do critério COMBINADO (o score do Respondi já pesa orçamento
  // como uma das ~15 perguntas do caminho condicional — sem desconto extra).
  if (percentual === 0) {
    return { status: "classificado", classe: "D", percentual };
  }

  return { status: "classificado", classe: bandaDoPercentual(percentual), percentual };
}
