/**
 * GET /api/v1/cron/webhook-log-retention
 *
 * Poda o arquivo do corpo cru dos webhooks (`webhook_events_log`). Um lote por
 * chamada, idempotente: linha já esvaziada não é escolhida de novo.
 *
 * Por que ele existe, em uma linha: numa instalação real o arquivo era 86% do
 * banco (468 MB de 545 MB) e crescia ~23 MB/dia sem teto, contra os 500 MB do
 * plano gratuito do Supabase — onde a maioria dos clones vive. O racional
 * inteiro está em `lib/channels/retencao-do-arquivo.ts`.
 *
 * Auth: `Authorization: Bearer <INTERNAL_CRON_SECRET>` (fecha quando falta o
 * segredo). Mesma forma de `app/api/v1/cron/storage-redaction/route.ts`.
 *
 * ─── A falha da captação, no MESMO canal das podas irmãs (issue #1721) ──────
 *
 * `podarHistoricoDeCaptacao` passou a PROPAGAR o erro do DELETE — a mesma
 * decisão que a 10ª poda do `data-retention` tomou no #1719, e pelo mesmo
 * motivo. Sem esta volta, a falha da captação virava `{ apagadas: 0 }`, que
 * na resposta do cron é a MESMA linha de "não havia nada vencido".
 *
 * O que ela não pode é derrubar a parte da rodada que JÁ FOI FEITA: o arquivo
 * forense roda antes, no mesmo tique, e cada lote fecha a própria transação.
 * Então a captação entra num `try` PRÓPRIO, a falha é reportada pelos três
 * canais que as irmãs já usam (`logger.error`, a linha `retention.sweep_run`
 * com `falhou: true`, e Sentry) e a rodada responde 500 — como respondem o
 * `data-retention` e o `media-retention` quando uma das suas podas falha. O
 * que o arquivo forense conseguiu vai em `details`, para que o dia da falha
 * não vire um dia sem informação.
 *
 * ─── E a do arquivo forense, no mesmo canal (issue #1769) ───────────────────
 *
 * A SEGUNDA poda desta rota — o DELETE de `webhook_events_log` — nasceu no
 * mesmo molde e ficou nele: `.limit(lote)` sem `.order(...)`, que o PostgREST
 * 12.2 recusa com 400 PGRST109, e o erro engolido num `logger.warn`. Como
 * esta é a poda que segura o ESPAÇO (468 MB de um banco de 545 MB medidos
 * numa instalação real), a recusa ali significa banco crescendo ~23 MB/dia
 * contra o teto de 500 MB do plano gratuito, em silêncio.
 *
 * Por isso a ordem das duas podas na rodada importa, e é a que está escrita
 * abaixo: arquivo forense PRIMEIRO (esvaziar o corpo é o que libera espaço, e
 * é idempotente), captação DEPOIS (o horizonte longo, que é despejo). E
 * por isso a falha do arquivo forense tem tratamento próprio e assimétrico:
 * a captação ainda roda depois dela, porque perder o expurgo de uma tabela
 * é trabalho de uma rodada e o que a captação apaga é o mesmo horizonte longo
 * que vai ser tentado de novo em 5 minutos. O que NÃO pode é a falha ser
 * engolida — e o que NÃO pode também é ela derrubar o `ok()` e levar junto o
 * relatório do que JÁ foi esvaziado.
 *
 * A assimetria é deliberada e o inverso seria um erro: se a falha do arquivo
 * forense levasse a captação junto, uma tabela sem `order` derrubaria as DUAS
 * podas, e o conserto de uma passaria a exigir o conserto da outra. O
 * `catch` daqui devolve o resultado parcial e segue.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import {
  ErroAoApagarLinhasVelhas,
  LOTE_PADRAO,
  type ResultadoDaPoda,
  podarArquivoDeWebhooks,
} from "@/lib/channels/retencao-do-arquivo";
import { podarHistoricoDeCaptacao } from "@/lib/webhooks/retencao-da-captacao";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { autorizaCron } from "@/lib/auth/cron-auth";

export const dynamic = "force-dynamic";

const LOTE_MAXIMO = 5_000;

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  // O lote é ajustável pela URL para o PRIMEIRO dia, que é o caso incomum: uma
  // instalação que nunca podou chega aqui com dezenas de milhares de linhas
  // atrasadas, e o operador quer alcançar o estado estável sem esperar dias.
  // O teto existe porque um lote gigante segura a tabela em que TODO webhook
  // escreve — a poda derrubando a entrada de mensagem seria o oposto do ponto.
  const url = new URL(req.url);
  const pedido = Number.parseInt(url.searchParams.get("lote") ?? "", 10);
  const lote =
    Number.isFinite(pedido) && pedido > 0 ? Math.min(pedido, LOTE_MAXIMO) : LOTE_PADRAO;

  const admin = createAdminClient();

  // O ARQUIVO FORENSE primeiro, e ele tem tratamento PRÓPRIO (issue #1769).
  // Ele é a poda que segura o ESPAÇO — esvaziar o corpo libera ~97% do peso
  // da linha — e é a única das duas que o operador vê no tamanho do banco.
  //
  // A assimetria com a captação, logo abaixo, é deliberada: aqui a falha NÃO
  // leva a captação junto (perder um lote de esvaziamento é trabalho de uma
  // rodada, e a próxima roda em 5 minutos repete), mas a falha é DITA pelos
  // três canais das irmãs. O que o passo 1 JÁ esvaziou vai em `details` — a
  // rodada falhou, e mesmo assim isto é verdade, e descartar seria perder
  // trabalho feito.
  let arquivo: ResultadoDaPoda;
  let falhaDoArquivo: string | null = null;
  try {
    arquivo = await podarArquivoDeWebhooks(admin, {
      diasComCorpo: env.WEBHOOK_LOG_BODY_RETENTION_DAYS,
      diasParaApagar: env.WEBHOOK_LOG_ROW_RETENTION_DAYS,
      lote,
    });
  } catch (err) {
    const detalhe = err instanceof Error ? err.message : String(err);
    // O que o passo 1 (o esvaziamento) conseguiu antes do DELETE recusado.
    // Vem preso na exceção justamente porque a função tem a informação e o
    // `catch` do handler não: sem ele, o relatório de uma rodada que esvaziou
    // 500 linhas e falhou ao apagar seria indistinguível do de uma que não fez
    // nada.
    arquivo =
      err instanceof ErroAoApagarLinhasVelhas
        ? err.parcial
        : { esvaziadas: 0, apagadas: 0, temMais: false };
    falhaDoArquivo = detalhe;
    // A LINHA DE TRILHA é chamada AQUI, dentro do `catch`, e não de uma
    // função fora — e isso não é estilo. O guarda de classe
    // (`tests/unit/cron-audita-so-quando-ha-efeito.test.ts`) percorre o AST de
    // TODA rota em `app/api/v1/cron/` e reprova `audit(` que não esteja sob uma
    // condição, subindo a árvore a partir da chamada: uma função que chamasse
    // `audit()` do próprio corpo ficaria fora do alcance do guarda, que é
    // exatamente o tipo de buraco que o guarda existe para fechar. Por isso os
    // três canais são funções MENORES — `registraFalhaDePoda` (log),
    // `linhaDeFalhaDePoda` (que só monta o objeto) e `avisaSentry` — e a
    // chamada de `audit()` fica na mão do `catch`, que é onde a doutrina a
    // quer de qualquer jeito.
    registraFalhaDePoda("arquivo de webhooks", err, requestId);
    void audit(linhaDeFalhaDePoda("webhook_events_log", detalhe, requestId));
    avisaSentry(err, requestId, "webhook_events_log");
  }

  // O HISTÓRICO de captação (`webhook_lead_captures`) roda no MESMO tique, e
  // não num cron novo: são duas tabelas do mesmo assunto, e uma rota a mais
  // seria mais uma linha no `entrypoint.sh` do scheduler para alguém esquecer
  // de agendar — o defeito que já custou meses ao risk-watcher e ao
  // routing-worker. Horizonte próprio (muito mais longo), porque lá a linha é
  // despejo de depuração e aqui ela é o produto.
  //
  // Try PRÓPRIO, e o motivo é o mesmo da cascata de LGPD no `data-retention`:
  // quem falha aqui falha aqui, e a falha é DITA. Sem esta volta a exceção
  // derruba o `ok()` da rodada e leva junto o relatório do arquivo forense —
  // que é a parte do trabalho que JÁ estava feita, porque cada lote fecha a
  // própria transação.
  let captacao: Awaited<ReturnType<typeof podarHistoricoDeCaptacao>>;
  try {
    captacao = await podarHistoricoDeCaptacao(admin, {
      // A STRING crua, e não um número já coagido: quem interpreta é
      // `lib/retencao/politica.ts`, que sabe resolver lixo para o lado seguro E
      // devolver a frase de aviso. Coagir antes jogaria o aviso fora.
      diasBrutos: env.LEAD_CAPTURE_RETENTION_DAYS,
      lote,
    });
  } catch (err) {
    const detalhe = err instanceof Error ? err.message : String(err);
    // A LINHA DE TRILHA dentro do `catch`, pelo mesmo motivo da poda de cima —
    // o guarda de classe reconhece a condição andando para cima a partir da
    // chamada, e uma função fora a deixaria invisível para ele.
    void audit(linhaDeFalhaDePoda("webhook_lead_captures", detalhe, requestId));
    registraFalhaDePoda("captação", err, requestId);
    avisaSentry(err, requestId, "webhook_lead_captures");
    // 500, como `data-retention` e `media-retention` respondem quando uma
    // poda falha: o `curl -fsS` do scheduler passa a ver a falha, e não um 200
    // de "tudo certo". O que o arquivo forense conseguiu vem em `details` — a
    // rodada falhou, e mesmo assim isto é verdade.
    return fail("internal_error", "webhook_lead_captures_retention_failed", 500, {
      requestId,
      details: {
        erro: detalhe.slice(0, 300),
        arquivo_forense: arquivo,
        // Quando as DUAS podas falham na mesma rodada, isto é o que separa
        // uma da outra na tela do operador: a do arquivo forense já foi
        // reportada acima, e o 200 não vai mascará-la.
        arquivo_forense_falhou: falhaDoArquivo,
      },
    });
  }

  // A captação passou e o arquivo forense não. A rodada responde 500 pelo
  // MESMO motivo de quando a captação falha — a poda que segura o espaço é a
  // que o operador precisa ver parada — e o que a captação conseguiu vem em
  // `details` para não se perder com ela.
  if (falhaDoArquivo) {
    return fail("internal_error", "webhook_events_log_retention_failed", 500, {
      requestId,
      details: { erro: falhaDoArquivo.slice(0, 300), arquivo_forense: arquivo, captacao },
    });
  }

  return ok({ ...arquivo, captacao }, { requestId });
}

/**
 * A LINHA DE TRILHA de uma poda que falhou, no formato de `reportAuditFailure`
 * (`lib/audit/index.ts`) e o mesmo das podas irmãs do `data-retention`.
 *
 * A forma é a de `reportAuditFailure`: a linha entra com `falhou: true` e o
 * `poda` no metadata, que é o que diz ao operador qual das duas tabelas da
 * rodada parou — sem ele, duas linhas `falhou` idênticas na mesma rodada não
 * diriam se uma tabela parou ou duas.
 *
 * Esta função SÓ monta o objeto. Ela não chama `audit()`, e isso é
 * deliberado: o guarda de classe
 * (`tests/unit/cron-audita-so-quando-ha-efeito.test.ts`) percorre o AST de
 * toda rota em `app/api/v1/cron/` e reprova `audit(` que não esteja sob uma
 * condição, subindo a árvore a partir da chamada. Uma função que chamasse
 * `audit()` do próprio corpo ficaria INVISÍVEL para o guarda (ou seria
 * reprovada, se ele enxergasse). A chamada fica, então, dentro do `catch` de
 * cada poda — que é onde a doutrina a quer de qualquer jeito.
 */
function linhaDeFalhaDePoda(poda: string, detalhe: string, requestId: string) {
  return {
    action: "retention.sweep_run" as const,
    organizationId: null,
    bypassedRls: true,
    metadata: {
      origem: "webhook-log-retention",
      poda,
      falhou: true,
      erro: detalhe.slice(0, 300),
    },
    requestId,
  };
}

/**
 * O LOG estruturado de uma poda que falhou — o primeiro dos três canais e o
 * que existe sempre, porque é o único que não depende de serviço nenhum.
 *
 * O `rotulo` é o que vai na frase ("a poda de captação falhou"), e não o
 * `poda`: o rótulo é português e o `poda` é o identificador que a trilha e o
 * Sentry usam para separar as duas tabelas da rodada.
 */
function registraFalhaDePoda(rotulo: string, err: unknown, requestId: string): void {
  logger.error(`[webhook-log-retention] a poda de ${rotulo} falhou`, {
    error: err instanceof Error ? err.message : String(err),
    request_id: requestId,
  });
}

/**
 * O SENTRY — o terceiro canal, e o único que sobrevive a um contêiner cujo
 * stdout ninguém lê.
 *
 * Por import DINÂMICO e com `.catch` no fim, como em `reportAuditFailure`: numa
 * instalação com `SENTRY_DSN=off` essa import pode nem carregar, e ela não pode
 * virar a segunda falha da rodada. É por isso que a promessa é `void` aqui e
 * nos dois pontos de chamada: o que ela resolve é DEPOIS da resposta, e um
 * teste que a esperasse no mesmo tique mediria a ordem das microtasks.
 */
function avisaSentry(err: unknown, requestId: string, poda: string): void {
  const detalhe = err instanceof Error ? err.message : String(err);
  void import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.captureException(err instanceof Error ? err : new Error(detalhe), {
        level: "error",
        tags: { subsystem: "retencao", poda },
        extra: { request_id: requestId },
      });
    })
    .catch(() => {
      /* sem Sentry configurado: o logger.error e a linha de trilha bastam */
    });
}
