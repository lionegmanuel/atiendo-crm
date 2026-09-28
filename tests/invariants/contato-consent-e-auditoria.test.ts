import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { patchContactHandler } from "@/app/api/v1/contacts/_handler";
import type { HandlerCtx } from "@/lib/api/handlers/types";

import { pgComoSupabase } from "../pg-como-supabase";

/**
 * CONSENTIMENTO QUE NÃO SE PERDE, E AUDITORIA QUE DIZ O QUE MUDOU.
 *
 * Dois defeitos no mesmo handler, achados ao preparar a fila de confirmação de
 * dado do contato (spec 17 §4b) — e os dois são exigências ESCRITAS do produto:
 *
 * **L-05** nomeia as finalidades de consentimento (`marketing`, `transactional`,
 * `profiling`) num mapa em `contacts.consent`. O handler atribuía o objeto
 * INTEIRO, então gravar uma finalidade APAGAVA as outras — a base legal de um
 * envio futuro sumindo em silêncio, sem erro nenhum.
 *
 * **L-06** exige audit com `who/what/which/when/**from/to**` em toda mutação de
 * `contacts.email`, `phone_number`, `cpf` e `consent`, com exceção declarada
 * "Nenhuma". O audit gravava só os NOMES dos campos alterados: quem quisesse
 * saber qual e-mail foi substituído não tinha onde olhar. E é exatamente essa
 * pergunta que a fila de confirmação precisa responder.
 *
 * Roda a FUNÇÃO contra Postgres real (`pgComoSupabase` troca só o transporte),
 * porque o que se mede depende do estado ANTERIOR vindo do banco.
 */
const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 3,
});
const db = pgComoSupabase(pool);

const ORG = "c05e7a00-0000-4000-8000-000000000001";
const USUARIO = "c05e7a00-0000-4000-8000-0000000000u1".replace("u", "a");

function ctx(): HandlerCtx {
  return {
    organization_id: ORG,
    actor: { type: "user", id: USUARIO },
    requestId: "req-consent-test",
  };
}

async function criarContato(campos: Record<string, unknown> = {}): Promise<string> {
  const base: Record<string, unknown> = {
    organization_id: ORG,
    display_name: "Alvo do Consent",
    source: "manual",
    ...campos,
  };
  const chaves = Object.keys(base);
  const { rows } = await pool.query<{ id: string }>(
    `insert into contacts (${chaves.map((k) => `"${k}"`).join(",")})
     values (${chaves.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
    chaves.map((k) => (typeof base[k] === "object" && base[k] !== null ? JSON.stringify(base[k]) : base[k])),
  );
  return rows[0]!.id;
}

async function consentDe(id: string): Promise<Record<string, unknown>> {
  const { rows } = await pool.query<{ consent: Record<string, unknown> }>(
    "select consent from contacts where id = $1",
    [id],
  );
  return rows[0]!.consent ?? {};
}

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, 'org-consent', 'Consent LTDA', 'Consent') on conflict (id) do nothing`,
    [ORG],
  );
});

afterAll(async () => {
  await pool.query("delete from organizations where id = $1", [ORG]);
  await pool.end();
});

describe("consentimento — MERGE por finalidade, nunca substituição (L-05)", () => {
  it("gravar UMA finalidade não apaga as outras", async () => {
    // O caso real que a fila de confirmação vai produzir: o contato já
    // consentiu marketing; a confirmação de um dado dito na conversa grava
    // `transactional`. Com atribuição direta, marketing sumiria — e ninguém
    // veria, porque perda de consentimento não dá erro.
    const id = await criarContato({
      consent: { marketing: { granted: true, granted_at: "2026-01-01T00:00:00Z" } },
    });

    await patchContactHandler(db, ctx(), id, {
      consent: { transactional: { granted: true, granted_at: "2026-08-06T00:00:00Z", source: "conversa" } },
    } as never);

    const c = await consentDe(id);
    expect(Object.keys(c).sort(), "as DUAS finalidades têm de sobreviver").toEqual([
      "marketing",
      "transactional",
    ]);
    expect((c.marketing as Record<string, unknown>).granted).toBe(true);
  });

  it("a mesma finalidade é ATUALIZADA, não duplicada", async () => {
    const id = await criarContato({
      consent: { marketing: { granted: true, granted_at: "2026-01-01T00:00:00Z" } },
    });
    await patchContactHandler(db, ctx(), id, {
      consent: { marketing: { granted: false, granted_at: null } },
    } as never);

    const c = await consentDe(id);
    expect(Object.keys(c)).toEqual(["marketing"]);
    // Revogar tem de VALER: se o merge preservasse o valor antigo em vez de
    // substituí-lo, uma revogação viraria no-op — pior que não ter merge.
    expect((c.marketing as Record<string, unknown>).granted).toBe(false);
  });

  it("o formato gravado é o que o export de LGPD já LÊ", async () => {
    // `lib/lgpd/export-collector.ts` lê `{escopo: {granted, granted_at, source}}`
    // desde antes desta mudança — o leitor existia e o escritor nunca foi
    // escrito. Gravar em outro formato criaria um segundo lugar para a mesma
    // verdade, e o export do titular sairia vazio sem erro.
    const id = await criarContato();
    await patchContactHandler(db, ctx(), id, {
      consent: { transactional: { granted: true, granted_at: "2026-08-06T12:00:00Z", source: "x" } },
    } as never);

    const t = (await consentDe(id)).transactional as Record<string, unknown>;
    expect(t).toHaveProperty("granted", true);
    expect(t).toHaveProperty("granted_at");
    expect(t).toHaveProperty("source");
  });
});

/**
 * ⚠️ O `from/to` da L-06 NÃO é medido aqui, e a razão é do AMBIENTE, não do
 * código: `audit()` (lib/audit/index.ts:55) cria o PRÓPRIO client admin, e o
 * `vitest.db.config.ts` aponta a URL do Supabase para uma porta inalcançável de
 * propósito. A linha de audit nunca chega a este Postgres.
 *
 * Descobri isso porque o controle positivo ("a tabela de audit RECEBE a linha")
 * reprovou junto com os outros três — ele separou "o campo não está lá" de "a
 * LINHA não está lá", e sem ele eu teria caçado o campo errado.
 *
 * A cobertura do par antes/depois vive em
 * `tests/unit/contato-audit-from-to.test.ts`, que espia a chamada de `audit()` —
 * mesmo padrão de `team-role-change.test.ts`, que é o precedente da grafia
 * `old_`/`new_` que este código segue.
 */
