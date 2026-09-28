import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

/**
 * A FILA DE CONFIRMAÇÃO DE DADO DO CONTATO (migration 0123, spec 17 §4b).
 *
 * Decisão do dono do produto: o Operador PROPÕE, um humano CONFIRMA. A IA não
 * grava dado de contato direto — sem isso, um e-mail dito de brincadeira
 * substituiria o correto e o valor antigo não existiria em lugar nenhum.
 *
 * O que este arquivo congela são as promessas que só o BANCO pode cumprir, e
 * cada uma existe por um motivo que já custou caro em outra tabela:
 *
 *  1. **idempotência por índice**, não por `where not exists` — check-then-act
 *     deixa dois turnos concorrentes passarem pela janela (foi o defeito que a
 *     0027 veio matar nos contatos);
 *  2. **prazo obrigatório e no futuro** — proposta sem prazo vira badge
 *     permanente, que simula atenção e adia a decisão;
 *  3. **decisão datada** — status decidido sem `decided_at` é registro que não
 *     sabe dizer quando aconteceu, e é essa a pergunta da auditoria;
 *  4. **vocabulário fechado de campo** — o que entra aqui vira escrita em
 *     `contacts`;
 *  5. **LGPD**: anonimizar o contato apaga as propostas, por qualquer caminho.
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

const ORG = "f11a7e00-0000-4000-8000-000000000001";

async function criarContato(nome: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into contacts (organization_id, display_name, source) values ($1, $2, 'whatsapp') returning id`,
    [ORG, nome],
  );
  return rows[0]!.id;
}

async function propor(
  contactId: string,
  campo: string,
  valor: string,
  extras: Record<string, unknown> = {},
): Promise<string> {
  const base: Record<string, unknown> = {
    organization_id: ORG,
    contact_id: contactId,
    campo,
    valor_proposto: valor,
    expires_at: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
    ...extras,
  };
  const k = Object.keys(base);
  const { rows } = await pool.query<{ id: string }>(
    `insert into contact_field_proposals (${k.map((x) => `"${x}"`).join(",")})
     values (${k.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
    k.map((x) => base[x]),
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, 'org-fila-dado', 'Fila LTDA', 'Fila') on conflict (id) do nothing`,
    [ORG],
  );
});

afterAll(async () => {
  await pool.query("delete from organizations where id = $1", [ORG]);
  await pool.end();
});

describe("uma proposta viva por contato e campo — a idempotência é do BANCO", () => {
  it("a segunda proposta do MESMO campo é recusada pelo índice", async () => {
    // A IA vai ouvir o mesmo e-mail em dez mensagens seguidas. Sem esta trava, a
    // tela de quem decide vira uma coluna de repetições — e `where not exists`
    // no código NÃO substitui: é check-then-act, e dois turnos concorrentes
    // passam pela janela.
    const c = await criarContato("Repetidor Silva");
    await propor(c, "email", "primeiro@exemplo.com");
    await expect(propor(c, "email", "segundo@exemplo.com")).rejects.toThrow(
      /duplicate key|uq_contact_field_proposals_uma_viva/i,
    );
  });

  it("campos DIFERENTES do mesmo contato convivem", async () => {
    // "o cliente disse o e-mail e depois o telefone" é um caso normal, não um
    // conflito. A chave é (contato, campo), não só contato.
    const c = await criarContato("Dois Dados Souza");
    await propor(c, "email", "dois@exemplo.com");
    await expect(propor(c, "phone_number", "+5531988887777")).resolves.toBeTruthy();
  });

  it("depois de DECIDIDA, uma nova proposta do mesmo campo é permitida", async () => {
    // O índice é PARCIAL de propósito: o cliente pode corrigir o e-mail que ele
    // mesmo deu errado, e bloquear isso deixaria a correção sem caminho.
    const c = await criarContato("Corrigiu Depois");
    const id = await propor(c, "email", "errado@exemplo.com");
    await pool.query(
      "update contact_field_proposals set status = 'dismissed', decided_at = now() where id = $1",
      [id],
    );
    await expect(propor(c, "email", "certo@exemplo.com")).resolves.toBeTruthy();
  });

  it("o índice é por ORGANIZAÇÃO — o contato de outro tenant não interfere", async () => {
    // Controle do escopo: se o índice esquecesse `organization_id`, um tenant
    // conseguiria bloquear a fila de outro. (Contatos são de orgs diferentes, mas
    // a coluna está no índice e este caso a exercita.)
    const { rows } = await pool.query<{ n: string }>(
      `select count(*) as n from pg_indexes
        where indexname = 'uq_contact_field_proposals_uma_viva'
          and indexdef ilike '%organization_id%'`,
    );
    expect(rows[0]!.n, "o índice precisa incluir organization_id").toBe("1");
  });
});

describe("a proposta SEMPRE tem prazo, e a decisão sempre tem data", () => {
  it("prazo no passado é recusado — proposta não pode nascer vencida", async () => {
    const c = await criarContato("Nasceu Vencida");
    await expect(
      propor(c, "email", "vencida@exemplo.com", {
        expires_at: new Date(Date.now() - 3600_000).toISOString(),
      }),
    ).rejects.toThrow(/prazo_no_futuro|violates check/i);
  });

  it("decidir sem carimbar a data é recusado", async () => {
    const c = await criarContato("Sem Data");
    const id = await propor(c, "email", "semdata@exemplo.com");
    await expect(
      pool.query("update contact_field_proposals set status = 'accepted' where id = $1", [id]),
    ).rejects.toThrow(/decisao_datada|violates check/i);
  });

  it("voltar para pendente exige LIMPAR a data — o par não pode ficar incoerente", async () => {
    const c = await criarContato("Voltou Pendente");
    const id = await propor(c, "email", "voltou@exemplo.com");
    await pool.query(
      "update contact_field_proposals set status = 'accepted', decided_at = now() where id = $1",
      [id],
    );
    await expect(
      pool.query("update contact_field_proposals set status = 'pending' where id = $1", [id]),
    ).rejects.toThrow(/decisao_datada|violates check/i);
  });
});

describe("vocabulário fechado", () => {
  it("campo fora da lista é recusado — o que entra aqui vira escrita em contacts", async () => {
    const c = await criarContato("Campo Livre");
    await expect(propor(c, "cpf", "12345678900")).rejects.toThrow(/campo_check|violates check/i);
    await expect(propor(c, "is_platform_admin", "true")).rejects.toThrow(/campo_check|violates check/i);
  });

  it("status fora da lista é recusado", async () => {
    const c = await criarContato("Status Livre");
    const id = await propor(c, "email", "status@exemplo.com");
    await expect(
      pool.query(
        "update contact_field_proposals set status = 'talvez', decided_at = now() where id = $1",
        [id],
      ),
    ).rejects.toThrow(/status_check|violates check/i);
  });
});

describe("LGPD — anonimizar o contato apaga as propostas dele", () => {
  it("por QUALQUER caminho que anonimize, porque a trava é no estado", async () => {
    // PII sobrevivendo numa fila que ninguém lembraria de olhar seria o direito
    // de esquecimento furado por uma tabela nova. O gatilho está no FATO
    // (`is_anonymized` virou true), não num dos caminhos — aqui o UPDATE é
    // direto, sem passar pelo cascade nem pela rota, e mesmo assim limpa.
    const c = await criarContato("Vai Esquecer");
    await propor(c, "email", "esquecer@exemplo.com");

    const { rows: antes } = await pool.query<{ n: string }>(
      "select count(*) as n from contact_field_proposals where contact_id = $1",
      [c],
    );
    expect(antes[0]!.n, "controle: a proposta existe antes").toBe("1");

    await pool.query("update contacts set is_anonymized = true, anonymized_at = now() where id = $1", [c]);

    const { rows: depois } = await pool.query<{ n: string }>(
      "select count(*) as n from contact_field_proposals where contact_id = $1",
      [c],
    );
    expect(depois[0]!.n, "nenhuma PII pode sobreviver na fila").toBe("0");
  });

  it("apagar o contato leva as propostas junto (cascade da FK)", async () => {
    const c = await criarContato("Vai Sumir");
    await propor(c, "email", "sumir@exemplo.com");
    await pool.query("delete from contacts where id = $1", [c]);
    const { rows } = await pool.query<{ n: string }>(
      "select count(*) as n from contact_field_proposals where contact_id = $1",
      [c],
    );
    expect(rows[0]!.n).toBe("0");
  });
});

describe("isolamento entre organizações", () => {
  it("a tabela tem RLS ligada e policy de tenant", async () => {
    const { rows } = await pool.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where relname = 'contact_field_proposals'",
    );
    expect(rows[0]!.relrowsecurity, "RLS precisa estar LIGADA").toBe(true);

    const { rows: pol } = await pool.query<{ n: string }>(
      `select count(*) as n from pg_policy p join pg_class c on c.oid = p.polrelid
        where c.relname = 'contact_field_proposals'
          and pg_get_expr(p.polqual, p.polrelid) ilike '%fn_user_org_ids%'`,
    );
    expect(pol[0]!.n, "a policy precisa filtrar por fn_user_org_ids()").not.toBe("0");
  });

  it("`anon` não alcança a tabela", async () => {
    const { rows } = await pool.query<{ n: string }>(
      `select count(*) as n from information_schema.role_table_grants
        where table_name = 'contact_field_proposals' and grantee = 'anon'`,
    );
    expect(rows[0]!.n, "a anon key vai para o browser — nenhum grant aqui").toBe("0");
  });
});
