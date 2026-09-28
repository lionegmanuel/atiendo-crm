/**
 * A leitura do comportamento da instalação pelo WORKER — pg cru, como o resto
 * do processo (`workers/agent-worker/main.ts` fala `pg`, nunca Supabase client).
 *
 * Separado de `./comportamento.ts` de propósito: lá mora a regra (memo, piso,
 * degradação) e aqui mora o acesso. O worker importa este arquivo; o Next
 * importa o irmão `./comportamento-servidor.ts`.
 *
 * O cliente entra por PARÂMETRO e por tipo ESTRUTURAL (só o `query`), e não
 * como `pg.Pool`: assim o módulo não arrasta `pg` para nenhum bundle e os testes
 * passam um objeto de uma linha.
 */
import { normalizarChaveDeOrcamento } from "@/lib/agent-engine/edge/llm/orcamento";

import {
  carregarComportamento,
  type ComportamentoDaInstalacao,
  type DivulgacaoDePagamento,
} from "./comportamento";

/** O mínimo que o pool do `pg` precisa oferecer. */
export interface ExecutorDeSql {
  query: (
    texto: string,
    valores?: unknown[],
  ) => Promise<{ rows: Array<Record<string, unknown>> }>;
}

const COLUNAS =
  "orcamento_de_ia, exigir_assinatura_no_webhook, divulgacao_de_pagamento, promessa_semantica";

const SQL = `select ${COLUNAS} from public.platform_settings where id = 1`;

/**
 * A linha única da instalação, ou `null` quando ela não existe — que é resposta,
 * não falha. Nunca lança: uma exceção aqui (`42P01` numa instalação que ainda
 * não aplicou a migration) tem que virar piso, e não worker morto no boot.
 */
export async function carregarComportamentoPorPool(
  pool: ExecutorDeSql,
  piso: ComportamentoDaInstalacao,
): Promise<ComportamentoDaInstalacao> {
  return carregarComportamento(async () => {
    const { rows } = await pool.query(SQL);
    return rows[0] ?? null;
  }, piso);
}

/**
 * O PISO do motor: o que o `.env` desta instalação declara para quem roda no
 * worker. Não inclui a exigência de assinatura do webhook porque quem recebe
 * webhook do canal é o Next, não o worker — e um piso inventado aqui seria um
 * valor que nenhum leitor deste processo usa.
 */
export function pisoDoComportamentoDoMotor(env: {
  AI_BUDGET_ENFORCEMENT?: string;
  DISCLOSURE_MODE: DivulgacaoDePagamento;
  PROMISE_SEMANTIC_ENABLED: boolean;
}): ComportamentoDaInstalacao {
  return {
    orcamento_de_ia: normalizarChaveDeOrcamento(env.AI_BUDGET_ENFORCEMENT),
    exigir_assinatura_no_webhook: false,
    divulgacao_de_pagamento: env.DISCLOSURE_MODE,
    promessa_semantica: env.PROMISE_SEMANTIC_ENABLED,
  };
}
