/**
 * O comportamento desta INSTALAÇÃO: o banco manda, o `.env` é o piso.
 *
 * ─── Por que isto existe ────────────────────────────────────────────────────
 *
 * As chaves que decidem como a instalação se comporta JÁ EM OPERAÇÃO — o kill
 * switch do orçamento de IA, a exigência de assinatura no webhook do canal, o
 * modo do portão de divulgação e a camada semântica de promessa — só existiam
 * no `.env`. Mudar qualquer uma delas exigia SSH em quem instalou a VPS, e é
 * exatamente o que a issue #1034 descreve: uma decisão de produto escondida
 * atrás de infraestrutura.
 *
 * A partir daqui a linha de `platform_settings` é a fonte, e o `.env` fica
 * sendo o que sempre foi de fato: SEMENTE e PISO. O banco está ACIMA dele —
 * havendo linha, é ela que vale, e a tela de admin escreve nela.
 *
 * ─── A divisão de papéis, em uma frase ──────────────────────────────────────
 *
 * Mesmo desenho de `lib/auth/politica-de-cadastro.ts` (o molde): o `.env`
 * responde em duas situações, e só nelas:
 *
 *   1. instalação que nunca abriu a tela (não há linha) — o `.env` declara com
 *      o que ela nasce;
 *   2. o processo subiu e ainda não conseguiu ler o banco — sem isto, uma
 *      instalação que desligou o bloqueio de gasto pelo `.env` voltaria a
 *      bloquear sozinha durante a janela cega.
 *
 * ─── A leitura é PEGAJOSA, e este é o ponto de segurança do módulo ──────────
 *
 * Se o banco não responde, a resposta honesta é "não sei", e as duas saídas
 * ingênuas são ruins:
 *
 *   - responder sempre o PISO → uma instalação que desligou o bloqueio pela
 *     tela religa a proteção durante um soluço do banco, e ninguém entende por
 *     quê;
 *   - responder sempre o DEFAULT do produto → a instalação que declarou outra
 *     coisa no `.env` deixa de obedecer ao próprio `.env`.
 *
 * Então: **o último valor lido com sucesso vale**, e o piso só entra quando
 * nunca houve leitura boa nesta vida do processo. Nenhuma leitura lança — quem
 * chama está no caminho de responder uma conversa.
 *
 * ─── Por que o memo mora em `globalThis` ────────────────────────────────────
 *
 * Um `let` de arquivo é por INSTÂNCIA DE MÓDULO, e o Next instancia o mesmo
 * módulo duas vezes no mesmo processo (um runtime para `route.js`, outro para
 * `page.js`...). Aqui isso não é teórico: quem GRAVA é uma server action
 * (runtime de página) e quem LÊ o portão do webhook é uma rota. Com um `let`,
 * desligar a exigência de assinatura pela tela não alcançaria a rota que a
 * aplica — que é justamente a trava que mais importa. Mesmo motivo, medido,
 * do memo da marca da instalação.
 *
 * ─── O que este arquivo NÃO faz de propósito ────────────────────────────────
 *
 * Não importa `@/lib/env`, não importa cliente de banco e não importa `pg`.
 * Quem lê do banco é `./comportamento-sql.ts` (worker) e
 * `./comportamento-servidor.ts` (Next). Assim este módulo é importável pelos
 * DOIS runtimes — o motor do agente é um processo próprio, e `@/lib/env` lança
 * no import quando uma variável obrigatória falta, o que derrubaria o worker no
 * boot: o oposto do que um kill switch faz.
 *
 * E cada LEITOR recebe o próprio piso por parâmetro, em vez de adivinhar de
 * qual `.env` está falando: o piso é do processo que lê, não do módulo.
 */

import { logger } from "@/lib/logger";

/** O vocabulário é o do motor (`ChaveDeOrcamento`), reusado e não traduzido. */
export type ChaveDeOrcamentoDaInstalacao = "on" | "avisar" | "off";

/** Idem: `inject`/`veto` são os modos do portão de disclosure do motor. */
export type DivulgacaoDePagamento = "inject" | "veto";

export interface ComportamentoDaInstalacao {
  readonly orcamento_de_ia: ChaveDeOrcamentoDaInstalacao;
  readonly exigir_assinatura_no_webhook: boolean;
  readonly divulgacao_de_pagamento: DivulgacaoDePagamento;
  readonly promessa_semantica: boolean;
}

const CHAVES_DE_ORCAMENTO: readonly ChaveDeOrcamentoDaInstalacao[] = ["on", "avisar", "off"];
const DIVULGACOES: readonly DivulgacaoDePagamento[] = ["inject", "veto"];

/**
 * Curto: são decisões de operação, e o custo de uma leitura a mais é
 * irrelevante perto de a tela demorar a refletir uma escolha de quem
 * administra. Mesmo valor do memo da política de cadastro.
 */
const TTL_MS = 30_000;

type Memoria = { readonly valor: ComportamentoDaInstalacao; readonly expiraEm: number };

declare global {
  var __comportamentoDaInstalacao: Memoria | undefined;
  /** O último valor LIDO COM SUCESSO. Sobrevive à expiração do memo. */
  var __ultimoComportamentoConhecido: ComportamentoDaInstalacao | undefined;
  /** Sobe a cada escrita; impede leitura em voo de reinstalar valor pré-escrita. */
  var __geracaoDoComportamento: number | undefined;
}

/** Chamada por quem ESCREVE o comportamento pela tela. */
export function invalidarComportamento(): void {
  globalThis.__geracaoDoComportamento = (globalThis.__geracaoDoComportamento ?? 0) + 1;
  globalThis.__comportamentoDaInstalacao = undefined;
}

/** Só para os testes: devolve o processo ao estado de quem nunca leu nada. */
export function esquecerComportamento(): void {
  globalThis.__comportamentoDaInstalacao = undefined;
  globalThis.__ultimoComportamentoConhecido = undefined;
  globalThis.__geracaoDoComportamento = undefined;
}

/**
 * O que vale AGORA neste processo, ou `null` quando nada foi lido ainda.
 *
 * É a leitura SÍNCRONA dos leitores que não são `async` (o portão do webhook,
 * os knobs do turno). Ela não vai ao banco: quando o memo está velho, quem
 * renova é o próximo `carregarComportamento`. Devolver o último valor conhecido
 * é a degradação declarada — nunca lança, nunca fica vazio por causa de TTL.
 */
export function comportamentoEmVigor(): ComportamentoDaInstalacao | null {
  return (
    globalThis.__comportamentoDaInstalacao?.valor ??
    globalThis.__ultimoComportamentoConhecido ??
    null
  );
}

/**
 * A linha crua → o comportamento. Cada campo que não passa no vocabulário cai
 * no PISO daquele campo, e não no default do produto: quem edita a coluna à mão
 * depois de dropar a constraint não pode, por exemplo, DESLIGAR a proteção de
 * gasto escrevendo lixo nela.
 */
export function interpretarLinha(
  linha: unknown,
  piso: ComportamentoDaInstalacao,
): ComportamentoDaInstalacao {
  if (linha === null || typeof linha !== "object") return piso;
  const bruto = linha as Record<string, unknown>;

  const chave = bruto.orcamento_de_ia;
  const divulgacao = bruto.divulgacao_de_pagamento;
  const exigir = bruto.exigir_assinatura_no_webhook;
  const promessa = bruto.promessa_semantica;

  return {
    orcamento_de_ia: ehChaveDeOrcamento(chave) ? chave : piso.orcamento_de_ia,
    exigir_assinatura_no_webhook:
      typeof exigir === "boolean" ? exigir : piso.exigir_assinatura_no_webhook,
    divulgacao_de_pagamento: ehDivulgacao(divulgacao) ? divulgacao : piso.divulgacao_de_pagamento,
    promessa_semantica: typeof promessa === "boolean" ? promessa : piso.promessa_semantica,
  };
}

export function ehChaveDeOrcamento(valor: unknown): valor is ChaveDeOrcamentoDaInstalacao {
  return typeof valor === "string" && CHAVES_DE_ORCAMENTO.includes(valor as never);
}

export function ehDivulgacao(valor: unknown): valor is DivulgacaoDePagamento {
  return typeof valor === "string" && DIVULGACOES.includes(valor as never);
}

/**
 * Lê o comportamento e o instala no processo. `ler` devolve a LINHA CRUA (`null`
 * = não há linha, que é resposta, não falha) e pode lançar — quem lança é o
 * banco, não este módulo.
 *
 * NUNCA LANÇA: é chamada no boot do worker, no caminho de renderizar a tela de
 * admin e no de montar o card de orçamento.
 */
export async function carregarComportamento(
  ler: () => Promise<unknown>,
  piso: ComportamentoDaInstalacao,
): Promise<ComportamentoDaInstalacao> {
  const memoria = globalThis.__comportamentoDaInstalacao;
  if (memoria && memoria.expiraEm > Date.now()) return memoria.valor;

  // Lida ANTES do await e conferida depois: sem isto, uma leitura em voo que
  // entrou antes de `invalidarComportamento()` volta com o valor PRÉ-ESCRITA e
  // o reinstala com TTL novo, desfazendo a invalidação — o lost-update medido
  // no memo da marca da instalação em 2026-08-20.
  const geracao = globalThis.__geracaoDoComportamento ?? 0;

  let lida: unknown;
  try {
    lida = await ler();
  } catch (erro) {
    avisarUmaVez("leitura|excecao", {
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
    return globalThis.__ultimoComportamentoConhecido ?? piso;
  }

  // Sem linha = instalação que nunca abriu a tela. É uma resposta COM SUCESSO,
  // e é por isso que ela vira o "último conhecido": a partir daqui o piso já foi
  // lido, e uma falha posterior não muda mais nada.
  const valor = lida === null || lida === undefined ? piso : interpretarLinha(lida, piso);
  globalThis.__ultimoComportamentoConhecido = valor;

  if ((globalThis.__geracaoDoComportamento ?? 0) === geracao) {
    globalThis.__comportamentoDaInstalacao = { valor, expiraEm: Date.now() + TTL_MS };
  }
  return valor;
}

const avisado = new Set<string>();

function avisarUmaVez(chave: string, contexto: Record<string, unknown>): void {
  if (avisado.has(chave)) return;
  avisado.add(chave);
  logger.warn(
    "comportamento da instalação: não deu para ler do banco; vale o último valor conhecido",
    contexto,
  );
}

/* ── Os leitores. Cada um recebe o PISO de quem lê. ─────────────────────────── */

/** Kill switch do orçamento: lido a CADA chamada de modelo. */
export function chaveDeOrcamentoDaInstalacao(
  piso: ChaveDeOrcamentoDaInstalacao,
): ChaveDeOrcamentoDaInstalacao {
  return comportamentoEmVigor()?.orcamento_de_ia ?? piso;
}

/** Portão do webhook do canal: lido a cada entrega. */
export function exigirAssinaturaNoWebhookDaInstalacao(piso: boolean): boolean {
  return comportamentoEmVigor()?.exigir_assinatura_no_webhook ?? piso;
}

/** Modo do portão de disclosure do motor: lido nos knobs do turno. */
export function modoDeDivulgacaoDaInstalacao(piso: DivulgacaoDePagamento): DivulgacaoDePagamento {
  return comportamentoEmVigor()?.divulgacao_de_pagamento ?? piso;
}

/** Camada semântica de promessa na cadeia de envio. */
export function promessaSemanticaDaInstalacao(piso: boolean): boolean {
  return comportamentoEmVigor()?.promessa_semantica ?? piso;
}
