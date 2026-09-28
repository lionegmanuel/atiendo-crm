/**
 * GET /api/v1/cron/media-retention
 *
 * A retenção de mídia EXECUTADA (migration 0432). Enfileira, em tandas, os
 * arquivos de `whatsapp-media` que devem sair — o de mensagem mais velho que
 * `organizations.media_retention_days` e o órfão de conversa apagada — na
 * `storage_redaction_queue`, que o cron `storage-redaction` drena pelo Storage
 * API a cada 5 minutos.
 *
 * Por que existe: o formulário prometia a retenção e nada a cumpria. O bucket
 * só crescia, e numa instalação no Supabase gratuito isso vira restrição 402
 * do projeto inteiro — login, mensagens e agente param juntos (medido em
 * 23/09/2026 com 1,30 GB de órfãos).
 *
 * Sem auditoria por linha, como o `storage-redaction`: o rastro de cada arquivo
 * é a própria linha da fila (status, tentativas, erro). A RODADA audita
 * (`retention.sweep_run`, como o `data-retention`) só quando teve efeito ou
 * falhou: rodada vazia não é mutação, e a que apaga dado de cliente não pode
 * ser indistinguível dela. "Teve efeito" inclui o EXPURGO (#1765): a função
 * também expurga a linha `deleted` da retenção com mais de 90 dias, e uma
 * rodada que só fez isso apaga linha de verdade — só que `vencidas` e `orfas`
 * vinham zeradas, então ela não auditava e a linha de rastro que existia não
 * dizia quantas saíram da fila.
 *
 * Auth: `Authorization: Bearer <INTERNAL_CRON_SECRET>` (fail-closed).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Por chamada da função, em cada uma das duas categorias. */
const TANDA = 500;
/** Teto de tandas por rodada: 10 × 500 × 2 = até 10 mil arquivos por dia. */
const MAX_TANDAS = 10;

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const admin = createAdminClient();
  // `expurgadas` é a contagem do que saiu da FILA (linha `deleted` da
  // retenção com mais de 90 dias), e ela entra na soma do efeito porque
  // é mutação: sem ela na conta, a rodada que só expurgou sairia com
  // `vencidas + orfas = 0` e não auditava (#1765). `tandas` continua o que era:
  // quantas chamadas a função recebeu, para saber se a rodada esbarrou no
  // teto e sobrou trabalho para a próxima.
  const total = { vencidas: 0, orfas: 0, expurgadas: 0, tandas: 0 };
  for (let i = 0; i < MAX_TANDAS; i++) {
    const { data, error } = await admin.rpc("fn_enfileirar_midia_vencida" as never, { p_limite: TANDA } as never);
    if (error) {
      logger.error("[media-retention] a função falhou", { request_id: requestId, error: error.message });
      void audit({
        action: "retention.sweep_run",
        organizationId: null,
        bypassedRls: true,
        metadata: { origem: "media-retention", falhou: true, erro: error.message.slice(0, 300), ...total },
        requestId,
      });
      return fail("internal_error", "media_retention_failed", 500, { requestId });
    }
    // `expurgadas` é o único campo novo (#1765); o `?? 0` também protege a
    // leitura de uma função antiga em caso de a 0435 ainda não ter rodado
    // no banco (mesma razão do `?? 0` dos outros dois).
    const r = (data ?? {}) as { vencidas?: number; orfas?: number; expurgadas?: number };
    const vencidas = r.vencidas ?? 0;
    const orfas = r.orfas ?? 0;
    const expurgadas = r.expurgadas ?? 0;
    total.vencidas += vencidas;
    total.orfas += orfas;
    total.expurgadas += expurgadas;
    total.tandas += 1;
    // Tanda incompleta nas duas categorias = não sobrou nada para esta rodada.
    // O expurgo não entra no laço: ele é livre de `p_limite` e a segunda
    // chamada de uma mesma rodada devolve 0 para ele de qualquer jeito, então
    // parar por causa dele seria parar uma tanda antes de enfileirar o que
    // ainda cabe.
    if (vencidas < TANDA && orfas < TANDA) break;
  }

  if (total.vencidas + total.orfas + total.expurgadas > 0) {
    logger.info("[media-retention] arquivos enfileirados para remoção", { request_id: requestId, ...total });
    void audit({
      action: "retention.sweep_run",
      organizationId: null,
      bypassedRls: true,
      metadata: { origem: "media-retention", ...total },
      requestId,
    });
  }
  return ok(total, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  return GET(req);
}
