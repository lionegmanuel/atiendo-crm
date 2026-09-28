/**
 * Pool de Postgres compartilhado pelas rotas de skills instaláveis (import + install —
 * Fase 2 do épico harness). Nenhuma rota do app usava `pg` cru antes desta: o app fala
 * com o banco via cliente Supabase, mas `importSkillPackage`/`installPlatformSkill`
 * (Task 4) reusam `insertSkillVersion`/`setSkillPointer` do agent-engine, que esperam
 * `Queryable` (SQL cru — INSERT ON CONFLICT que o client Supabase não expressa direto).
 *
 * Reusa o MESMO `createPool` do worker (lib/agent-engine/db/pool.ts) em vez de duplicar
 * o setup de conexão — só troca o consumidor. Singleton lazy: 1 pool por processo Next,
 * criado no primeiro uso (nunca no import do módulo), compartilhado pelas duas rotas
 * para não abrir dois pools redundantes contra o mesmo Postgres.
 */
import { createPool } from '@/lib/agent-engine/db/pool';
import { env } from '@/lib/env';
import type pg from 'pg';

let pool: pg.Pool | undefined;

export function getSkillsPool(): pg.Pool {
  if (!pool) pool = createPool(env.SUPABASE_DB_URL);
  return pool;
}
