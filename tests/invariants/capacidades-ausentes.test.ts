/**
 * O AGENTE NÃO PODE ATENDER SEM AS CAPACIDADES E NINGUÉM FICAR SABENDO (ACH-04).
 *
 * Achado num turno REAL: o job falhou uma vez, retentou, e a partir da segunda
 * tentativa o log dizia `tools MCP da tela não montadas — turno segue sem elas`,
 * com `ephemeral_token_insert_failed: duplicate key value violates unique
 * constraint "api_tokens_organization_id_prefix_key"`.
 *
 * São DOIS defeitos, e o teste cobra os dois separados porque consertar um só
 * deixaria o outro de pé:
 *
 *   1. **A colisão.** O prefixo do token efêmero era derivado só do `runId`, e
 *      `api_tokens` tem `unique (organization_id, prefix)`. Não era raro: era
 *      GARANTIDO em toda retentativa do mesmo job.
 *   2. **O silêncio.** A falha não derrubava o turno (certo — a conversa do
 *      cliente não morre por uma tool extra), mas o único registro era um log de
 *      worker. Numa VPS ninguém abre aquilo. Capacidade anunciada na tela,
 *      ausente na execução, e nada contando: falha-em-verde.
 *
 * Roda contra Postgres real porque a colisão é uma constraint do banco — em
 * unitário com dublê ela não existe, e o teste passaria sem tocar no defeito.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { avisarCapacidadesAusentes } from "@/lib/agent-engine/agent/inbound-turn";
import { buildEphemeralPrefix } from "@/lib/ai/runtime/mcp_token";

import { GOV_ORG, GOV_ADMIN, seedGov, sql } from "./gov-helpers";

const PORTA = process.env.TEST_DB_PORT ?? "54329";
const pool = new pg.Pool({
  connectionString: `postgres://postgres:postgres@127.0.0.1:${PORTA}/postgres`,
  max: 2,
});

beforeAll(async () => {
  seedGov();
  const { rows } = await pool.query<{ n: string }>(
    `select count(*)::text as n from public.organizations where id = $1`,
    [GOV_ORG],
  );
  // Controle positivo: pool no banco errado devolveria contagens zeradas e
  // pareceria medição.
  if (rows[0]?.n !== "1") throw new Error(`pool fora do banco do harness (porta ${PORTA})`);
});

afterAll(async () => {
  await pool.end();
});

/**
 * O INSERT é local (o mint real usa o client do Supabase, que não existe neste
 * harness), mas o PREFIXO vem da função REAL — `buildEphemeralPrefix`. Com uma
 * cópia da regra aqui, o teste continuaria verde depois de alguém reverter o
 * conserto: seria ele próprio a segunda lista.
 */
async function mintar(runId: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into api_tokens (organization_id, created_by, name, prefix, token_hash, scopes, expires_at)
     values ($1, $2, $3, $4, decode(md5(random()::text), 'hex'), '[]'::jsonb, now() + interval '5 minutes')
     returning id`,
    [GOV_ORG, GOV_ADMIN, `agent-run:${runId}`, buildEphemeralPrefix(runId)],
  );
  return rows[0]!.id;
}

describe("token efêmero do turno", () => {
  it("a constraint que causou o defeito existe de verdade", () => {
    // Sem esta guarda, os casos abaixo passariam num banco SEM a constraint —
    // verde por ausência do mecanismo, não por conserto dele.
    const def = sql(
      `select pg_get_constraintdef(oid) from pg_constraint
        where conname = 'api_tokens_organization_id_prefix_key';`,
    );
    expect(def).toContain("organization_id");
    expect(def).toContain("prefix");
  });

  it("o MESMO run mintando duas vezes não colide — é o caso da retentativa", async () => {
    const runId = "7f3a91cc-0000-4000-8000-000000000001";
    const primeiro = await mintar(runId);
    // Exatamente o que acontecia quando um job falhava e era retentado.
    const segundo = await mintar(runId);
    expect(primeiro).not.toBe(segundo);
  });

  it("dez mintagens do mesmo run seguem passando", async () => {
    // Retentativa em rajada: o defeito aparecia na SEGUNDA, mas um prefixo com
    // pouca entropia só adiaria o problema.
    const runId = "7f3a91cc-0000-4000-8000-000000000002";
    const ids = new Set<string>();
    for (let i = 0; i < 10; i++) ids.add(await mintar(runId));
    expect(ids.size).toBe(10);
  });

  it("dois runs com os 8 primeiros caracteres iguais não colidem", async () => {
    // O irmão silencioso: uuids distintos podem começar igual, e o prefixo
    // usava só os 8 primeiros.
    const a = await mintar("aaaaaaaa-1111-4000-8000-000000000001");
    const b = await mintar("aaaaaaaa-2222-4000-8000-000000000002");
    expect(a).not.toBe(b);
  });
});

describe("o aviso de capacidades ausentes", () => {
  it("'capabilities_missing' é aceito pelo banco (migration 0102)", () => {
    const def = sql(
      `select pg_get_constraintdef(oid) from pg_constraint
        where conname = 'agent_inbox_items_kind_check';`,
    );
    expect(def).toContain("capabilities_missing");
  });

  it("o aviso nasce na Central e deduplica por episódio aberto", async () => {
    // A função REAL do turno, não uma cópia do INSERT: com uma cópia, remover a
    // guarda de dedup lá deixaria este teste verde.
    const mudo = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never;
    const contar = async (): Promise<number> => {
      const { rows } = await pool.query<{ n: string }>(
        `select count(*)::text as n from agent_inbox_items
          where organization_id = $1 and kind = 'capabilities_missing' and status = 'open'`,
        [GOV_ORG],
      );
      return Number(rows[0]!.n);
    };

    await pool.query(
      `delete from agent_inbox_items where organization_id = $1 and kind = 'capabilities_missing'`,
      [GOV_ORG],
    );
    const CONV = "cccccccc-4444-4000-8000-000000000001";

    await avisarCapacidadesAusentes(pool, GOV_ORG, CONV, "ephemeral_token_insert_failed", mudo);
    expect(await contar()).toBe(1);

    // Rajada de retentativas não pode virar dezenas de linhas iguais: inbox
    // inundado é inbox ignorado.
    await avisarCapacidadesAusentes(pool, GOV_ORG, CONV, "de novo", mudo);
    await avisarCapacidadesAusentes(pool, GOV_ORG, CONV, "e de novo", mudo);
    expect(await contar()).toBe(1);

    // Resolvido e o problema voltando ⇒ aviso NOVO. Silenciar para sempre seria
    // trocar o defeito por um mudo.
    await pool.query(
      `update agent_inbox_items set status = 'resolved'
        where organization_id = $1 and kind = 'capabilities_missing'`,
      [GOV_ORG],
    );
    await avisarCapacidadesAusentes(pool, GOV_ORG, CONV, "voltou", mudo);
    expect(await contar()).toBe(1);
  });
});
