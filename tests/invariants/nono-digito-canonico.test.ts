import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

/**
 * Celular BR com e sem o nono dígito é a MESMA pessoa.
 *
 * `+553284793302` (12) e `+5532984793302` (13) — o CRM grava a forma COM o 9
 * e reencontra a grafia antiga. Fixo não ganha 9.
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

const ORG = "c0169000-0000-4000-8000-000000000001";

async function upsert(phone: string | null, lid: string | null, chatId: string): Promise<string> {
  const { rows } = await pool.query<{ fn_upsert_wa_contact: string }>(
    "select public.fn_upsert_wa_contact($1, $2, $3, $4, $5, $6)",
    [ORG, lid ? "lid" : "phone", phone, lid, chatId, null],
  );
  return rows[0]!.fn_upsert_wa_contact;
}

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, 'org-nono-digito', 'Nono LTDA', 'Nono') on conflict (id) do nothing`,
    [ORG],
  );
});

afterAll(async () => {
  await pool.query("delete from organizations where id = $1", [ORG]);
  await pool.end();
});

describe("fn_upsert_wa_contact — nono dígito canônico", () => {
  it("grava o celular de 12 dígitos COM o 9", async () => {
    const id = await upsert("+553284793301", null, "553284793301@c.us");
    const { rows } = await pool.query<{ phone_number: string }>(
      "select phone_number from contacts where id = $1",
      [id],
    );
    expect(rows[0]!.phone_number).toBe("+5532984793301");
  });

  it("reencontra o cadastro de 13 dígitos quando o WhatsApp manda sem o 9", async () => {
    const primeiro = await upsert("+5531998966398", null, "5531998966398@c.us");
    const segundo = await upsert("+553198966398", null, "553198966398@c.us");
    expect(segundo).toBe(primeiro);
    const { rows } = await pool.query<{ n: string }>(
      "select count(*)::text as n from contacts where organization_id = $1 and is_merged_into is null and phone_number in ('+553198966398','+5531998966398')",
      [ORG],
    );
    expect(rows[0]!.n).toBe("1");
  });

  it("fixo NÃO ganha 9", async () => {
    const id = await upsert("+553132345678", null, "553132345678@c.us");
    const { rows } = await pool.query<{ phone_number: string }>(
      "select phone_number from contacts where id = $1",
      [id],
    );
    expect(rows[0]!.phone_number).toBe("+553132345678");
  });
});
