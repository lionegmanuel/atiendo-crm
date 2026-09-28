/**
 * UM tick do cron — a janela declarada para o E4/E6 do cenário 23.
 *
 * ⚠️ O QUE UM TICK FAZ, e o comentário do worker é explícito: ele SÓ ENFILEIRA
 * em `job_queue`. Não envia. A cadeia real é
 *   cron_jobs → job_queue → turno do agente → mensagem
 * e cada seta é um consumidor diferente. Drenar o cron avança UM elo.
 */

import pg from "pg";

import { tickCron } from "@/lib/agent-engine/cron/scheduler";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const env = carregarEnvLocal();

const log = {
  debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
} as unknown as Parameters<typeof tickCron>[2];

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: env.SUPABASE_DB_URL });
  const q = async (sql: string): Promise<string> => (await pool.query(sql)).rows[0]?.r ?? "";

  console.info("ANTES");
  console.info("  " + (await q(`select 'cron_jobs vencidos: ' || count(*) || ' · tentativas somadas: ' || coalesce(sum(attempts),0) as r from cron_jobs where job_kind='followup_turn' and enabled and next_run_at <= now()`)));
  console.info("  " + (await q(`select 'job_queue: ' || count(*) || ' total, ' || count(*) filter (where status='pending') || ' pendentes' as r from job_queue`)));

  const r = await tickCron(pool, { batchSize: 10, staggerWindowMs: 0, retryBaseMs: 1000 }, log);
  console.info(`\nTICK · disparados=${r.fired} · re-tentados=${r.retried} · desligados=${r.disabled}`);

  console.info("\nDEPOIS");
  console.info("  " + (await q(`select 'cron_jobs vencidos: ' || count(*) || ' · tentativas somadas: ' || coalesce(sum(attempts),0) as r from cron_jobs where job_kind='followup_turn' and enabled and next_run_at <= now()`)));
  console.info("  " + (await q(`select 'job_queue: ' || count(*) || ' total, ' || count(*) filter (where status='pending') || ' pendentes' as r from job_queue`)));
  console.info("  " + (await q(`select 'mensagens outbound criadas nos últimos 5min: ' || count(*) as r from messages where direction='outbound' and created_at > now() - interval '5 minutes'`)));

  await pool.end();
}
void main();
