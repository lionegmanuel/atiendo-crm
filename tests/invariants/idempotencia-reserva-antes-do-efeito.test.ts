/**
 * A CORRIDA DA `Idempotency-Key` FECHADA CONTRA O BANCO REAL (issue #778).
 *
 * ═══ O QUE ESTE ARQUIVO PROTEGE ═══
 *
 * `comIdempotencia` decide com base em UMA linha de `public.idempotency_keys`.
 * Quem decide se ele está certo não é o dublê do teste unitário — é a
 * constraint que a linha respeita no Postgres: o índice único
 * `idempotency_keys_organization_id_key_endpoint_key`, que não olha
 * `expires_at`, e a coluna `request_hash bytea`, que devolve bytes.
 *
 * Os dois erros que já existiram aqui são invisíveis a um dublê:
 *
 *   1. sem estado de RESERVA (`status_code`/`response_body` nulos antes do
 *      efeito), duas requisições simultâneas executam as duas — não há onde
 *      gravar "esta chave está em curso" e portanto nada com que colidir;
 *   2. escrevendo o hash como hex CRU numa coluna `bytea`, o Postgres grava os
 *      64 bytes ASCII do texto: a releitura (literal `\x…` ou `Buffer`) nunca
 *      casa com o hex, e TODO replay vira 409 `idempotency_conflict`.
 *
 * Aqui o `pg` de verdade é ligado ao helper pelo adaptador
 * `tests/pg-como-supabase.ts` — a decisão do código roda, o que muda é só o
 * transporte. Namespace de fixture: `c0115a00-…-0778`.
 */

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { comIdempotencia, hashDoCorpo, JANELA_DA_RESERVA_MS } from "@/lib/api/idempotency";
import { pgComoSupabase } from "../pg-como-supabase";

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 4,
});

const ORG = "c0115a00-0000-4000-8000-000000000778";
const ENDPOINT = "/api/v1/message-templates";
const CORPO = { title: "corrida" };
const HASH = hashDoCorpo(CORPO);

beforeAll(async () => {
  await pool.query(
    `insert into public.organizations (id, slug, legal_name, display_name)
     values ($1, 'inv-idem-778', 'Idem 778', 'Idem 778') on conflict do nothing`,
    [ORG],
  );
});

afterAll(async () => {
  await pool.end();
});

/**
 * Grava a linha direto, sem passar pelo helper: é o formato que a OUTRA
 * requisição deixou.
 *
 * ⚠️ O prazo passa por `date_trunc('second', …)`. A coluna é `timestamptz`
 * (microssegundos) e neste adaptador o `pg` a devolve como `Date`, que só
 * carrega MILISSEGUNDOS — e o bilhete da retomada é comparado por IGUALDADE
 * (`id` + `expires_at` lido). Uma linha com dígitos de microssegundo não casa
 * na volta, e a tomada de posse então RECUSA (`em_curso`) em vez de roubar a
 * posse de ninguém: falha para o lado seguro, mas não é o que os casos 4 e 5
 * querem medir. Em produção o valor volta do PostgREST como TEXTO, com os
 * microssegundos inteiros, e a igualdade casa.
 */
async function gravarLinha(
  chave: string,
  status: number | null,
  corpo: unknown,
  prazo: string,
): Promise<void> {
  await pool.query(
    `insert into public.idempotency_keys
       (organization_id, key, endpoint, request_hash, status_code, response_body, expires_at)
     values ($1, $2, $3, decode($4, 'hex'), $5, $6, date_trunc('second', ${prazo}))`,
    [ORG, chave, ENDPOINT, HASH, status, corpo === null ? null : JSON.stringify(corpo)],
  );
}

async function linhasDaChave(chave: string): Promise<Array<{ status_code: number | null; n: Buffer }>> {
  const { rows } = await pool.query(
    `select status_code, request_hash as n from public.idempotency_keys
      where organization_id = $1 and key = $2 and endpoint = $3`,
    [ORG, chave, ENDPOINT],
  );
  return rows;
}

describe("idempotência — a reserva fecha a corrida (banco real)", () => {
  it("1. duas requisições SIMULTÂNEAS com a mesma chave: o efeito acontece UMA vez", async () => {
    const chave = randomUUID();
    const db = pgComoSupabase(pool);
    let efeitos = 0;

    // O efeito segura a reserva: é a janela em que a segunda requisição chega.
    const executar = async () => {
      efeitos += 1;
      await new Promise((r) => setTimeout(r, 400));
      return { resposta: { id: "t-1" }, status: 201 };
    };
    const entrada = { db, organizationId: ORG, endpoint: ENDPOINT, chave, corpo: CORPO, executar };

    const desfechos = await Promise.all([
      comIdempotencia(entrada),
      comIdempotencia(entrada),
    ]);

    expect(efeitos).toBe(1);
    expect(desfechos.map((d) => d.tipo).sort()).toEqual(["em_curso", "executou"]);
    expect(desfechos.find((d) => d.tipo === "executou")).toMatchObject({
      resposta: { id: "t-1" },
      status: 201,
    });
  });

  it("2. a releitura do recibo é REPLAY, e não conflito — a coluna é bytea de verdade", async () => {
    const chave = randomUUID();
    const db = pgComoSupabase(pool);
    let efeitos = 0;

    const executar = async () => {
      efeitos += 1;
      return { resposta: { id: "t-2" }, status: 201 };
    };
    const entrada = { db, organizationId: ORG, endpoint: ENDPOINT, chave, corpo: CORPO, executar };

    expect(await comIdempotencia(entrada)).toEqual({
      tipo: "executou",
      resposta: { id: "t-2" },
      status: 201,
    });

    // O transporte do hash é o que este caso mede: com o hex cru, o Postgres
    // grava 64 bytes ASCII e a classificação vira `conflito`.
    expect(await comIdempotencia(entrada)).toEqual({
      tipo: "replay",
      resposta: { id: "t-2" },
      status: 201,
    });
    expect(efeitos).toBe(1);

    const linhas = await linhasDaChave(chave);
    expect(linhas).toHaveLength(1);
    // 32 bytes = o sha256 DECODIFICADO, como as funções SQL do repo gravam
    // (`decode(p_hash, 'hex')`). 64 seria o texto hexadecimal.
    expect(linhas[0]!.n.length).toBe(32);
    expect(linhas[0]!.n.toString("hex")).toBe(HASH);
  });

  it("3. reserva VIVA de outra requisição não é atropelada: em_curso, sem efeito", async () => {
    const chave = randomUUID();
    await gravarLinha(chave, null, null, `now() + interval '${JANELA_DA_RESERVA_MS / 1000} seconds'`);

    const db = pgComoSupabase(pool);
    let efeitos = 0;
    const desfecho = await comIdempotencia({
      db,
      organizationId: ORG,
      endpoint: ENDPOINT,
      chave,
      corpo: CORPO,
      executar: async () => {
        efeitos += 1;
        return { resposta: { id: "t-3" }, status: 201 };
      },
    });

    expect(desfecho).toEqual({ tipo: "em_curso" });
    expect(efeitos).toBe(0);
  });

  it("4. reserva VENCIDA não tranca a chave: quem chega depois toma posse e executa", async () => {
    const chave = randomUUID();
    await gravarLinha(chave, null, null, "now() - interval '5 minutes'");

    const db = pgComoSupabase(pool);
    let efeitos = 0;
    const desfecho = await comIdempotencia({
      db,
      organizationId: ORG,
      endpoint: ENDPOINT,
      chave,
      corpo: CORPO,
      executar: async () => {
        efeitos += 1;
        return { resposta: { id: "t-4" }, status: 201 };
      },
    });

    expect(efeitos).toBe(1);
    expect(desfecho).toMatchObject({ tipo: "executou", status: 201 });
    // A MESMA linha: a reserva vencida é reescrita, não duplicada — o índice
    // único não deixa a chave ter dois donos.
    const linhas = await linhasDaChave(chave);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.status_code).toBe(201);
  });

  it("5. recibo VENCIDO não conta (a janela de 24h): operação nova, e a linha continua UMA", async () => {
    const chave = randomUUID();
    await gravarLinha(chave, 201, { id: "velho" }, "now() - interval '1 hour'");

    const db = pgComoSupabase(pool);
    const desfecho = await comIdempotencia({
      db,
      organizationId: ORG,
      endpoint: ENDPOINT,
      chave,
      corpo: CORPO,
      executar: async () => ({ resposta: { id: "t-5" }, status: 201 }),
    });

    expect(desfecho).toEqual({ tipo: "executou", resposta: { id: "t-5" }, status: 201 });
    const linhas = await linhasDaChave(chave);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.status_code).toBe(201);
  });

  it("6. corpo DIFERENTE com a mesma chave: conflito, e o efeito não roda", async () => {
    const chave = randomUUID();
    await gravarLinha(chave, 201, { id: "t-6" }, "now() + interval '1 hour'");

    const db = pgComoSupabase(pool);
    let efeitos = 0;
    const desfecho = await comIdempotencia({
      db,
      organizationId: ORG,
      endpoint: ENDPOINT,
      chave,
      corpo: { title: "outro corpo" },
      executar: async () => {
        efeitos += 1;
        return { resposta: { id: "t-6" }, status: 201 };
      },
    });

    expect(desfecho).toEqual({ tipo: "conflito" });
    expect(efeitos).toBe(0);
  });
});
