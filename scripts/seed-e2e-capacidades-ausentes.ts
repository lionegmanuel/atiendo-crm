/**
 * Semeia o aviso de capacidades ausentes CHAMANDO O EMISSOR REAL.
 *
 * `avisarCapacidadesAusentes` é a mesma função que `inbound-turn.ts` chama no
 * `catch` quando as tools da tela não montam. Um INSERT à mão aqui provaria que
 * a tela sabe renderizar uma linha — não que o caminho que a produz existe. O
 * que se quer provar é a costura inteira: emissor real → banco → tela.
 *
 * **O que este seed NÃO exercita, e está declarado no spec:** o GATILHO (a falha
 * do mint). Ela era garantida em toda retentativa e foi consertada
 * (`buildEphemeralPrefix`); reproduzi-la de propósito aqui exigiria desfazer o
 * conserto. O gatilho e o emissor têm cobertura própria em
 * `tests/invariants/capacidades-ausentes.test.ts`, contra Postgres real.
 *
 * Uso: pnpm exec tsx --env-file=.env.local scripts/seed-e2e-capacidades-ausentes.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";

import pg from "pg";

import { avisarCapacidadesAusentes } from "../lib/agent-engine/agent/inbound-turn";
import { anunciarDestino, credenciaisSupabaseDeTeste } from "./lib/env-de-teste";

// `process.env` VENCE o `.env.local` (ver scripts/lib/env-de-teste.ts).
//
// A versão anterior lia `.env.local` DIRETO do disco, ignorando o ambiente — e
// por isso a suíte E2E semeava no banco de PRODUÇÃO mesmo com o `.env.e2e`
// injetado no webServer do Playwright: este script nunca olhava para lá.
const credenciais = credenciaisSupabaseDeTeste();
anunciarDestino("seed-e2e-capacidades-ausentes", credenciais);
const env = {
  NEXT_PUBLIC_SUPABASE_URL: credenciais.url,
  SUPABASE_SERVICE_ROLE_KEY: credenciais.serviceRole,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: credenciais.anonKey,
  NEXT_PUBLIC_APP_URL: credenciais.appUrl,
  SUPABASE_DB_URL: credenciais.dbUrl,
} as Record<string, string>;

const pool = new pg.Pool({ connectionString: env.SUPABASE_DB_URL! });

/** O erro EXATO que apareceu no turno real que originou o ACH-04. */
const MOTIVO_REAL =
  'ephemeral_token_insert_failed: duplicate key value violates unique constraint "api_tokens_organization_id_prefix_key"';

const logMudo = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as Parameters<typeof avisarCapacidadesAusentes>[4];

async function main(): Promise<void> {
  const creds = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), ".e2e-creds.json"), "utf8"),
  ) as { org_id: string; escalacao?: { conversation_id: string } };
  const orgId = creds.org_id;

  // Reset do episódio: o aviso deduplica por item ABERTO, então uma corrida
  // anterior deixaria a nova sem efeito e o spec passaria com dado velho.
  await pool.query(
    `delete from agent_inbox_items where organization_id = $1 and kind = 'capabilities_missing'`,
    [orgId],
  );

  const { rows: conv } = await pool.query<{ id: string }>(
    `select id from conversations where organization_id = $1 order by created_at desc limit 1`,
    [orgId],
  );
  const conversationId = creds.escalacao?.conversation_id ?? conv[0]?.id;
  if (!conversationId) throw new Error("nenhuma conversa na org para referenciar o aviso");

  await avisarCapacidadesAusentes(pool, orgId, conversationId, MOTIVO_REAL, logMudo);

  const { rows } = await pool.query<{ kind: string; severity: string; title: string }>(
    `select kind, severity, title from agent_inbox_items
      where organization_id = $1 and kind = 'capabilities_missing' and status = 'open'`,
    [orgId],
  );
  if (rows.length !== 1) {
    throw new Error(`esperava 1 aviso aberto, achei ${rows.length}`);
  }
  console.info(
    `[seed-capacidades] aviso criado pelo emissor real: ${rows[0]!.kind} · ${rows[0]!.severity} · "${rows[0]!.title}"`,
  );
  await pool.end();
}

main().catch(async (err) => {
  console.error("[seed-capacidades] falhou:", err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
