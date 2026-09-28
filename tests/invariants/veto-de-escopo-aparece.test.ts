import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { sincronizaEstagioDoAgente } from "@/lib/leads/agent-stage-sync";

import { pgComoSupabase } from "../pg-como-supabase";

/**
 * QUANDO O ASSISTENTE É VETADO, ALGUÉM FICA SABENDO (spec 17 passo 3).
 *
 * ═══ POR QUE ISTO É O CASO MAIS DELICADO DO PASSO ═══
 *
 * `fora_do_escopo` é estado LEGÍTIMO do produto — a regra funcionou. A tentação
 * era classificá-lo como "warn only", junto de `not_configured` e
 * `human_conflict`, e não avisar ninguém.
 *
 * Mas no dia 1 de cada assistente ele é **100% dos movimentos**. Um veto
 * silencioso em massa não se lê como proteção: lê-se como "a IA parou de
 * funcionar". Este é o item que decide se a feature parece cuidado ou parece bug.
 *
 * O que se congela aqui:
 *  1. o negócio fora do escopo NÃO é movido;
 *  2. o motivo é `fora_do_escopo` — distinto de `sem_negocio` e de
 *     `sem_mapeamento`, que mandariam o dono procurar no lugar errado;
 *  3. o negócio DENTRO do escopo continua sendo movido (senão o gate seria só
 *     um jeito caro de desligar a IA);
 *  4. chamador que não informa escopo segue como antes — migração não pode
 *     parar caminho que ainda não foi migrado.
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

const ORG = "7e707e00-0000-4000-8000-000000000001";
let contatoNoFunilDele = "";
let contatoNoFunilAlheio = "";
let funilDele = "";
let funilAlheio = "";

/** Um funil com duas etapas mapeadas para passos do agente. */
async function criarFunil(nome: string, slug: string): Promise<{ id: string; primeira: string }> {
  const { rows: p } = await pool.query<{ id: string }>(
    `insert into crm_pipelines (organization_id, name, slug, position) values ($1, $2, $3, 100) returning id`,
    [ORG, nome, slug],
  );
  const { rows: s1 } = await pool.query<{ id: string }>(
    `insert into crm_stages (organization_id, pipeline_id, name, slug, position, agent_stage_hint)
     values ($1, $2, 'Entrada', $3, 1, 'new') returning id`,
    [ORG, p[0]!.id, `entrada-${slug}`],
  );
  await pool.query(
    `insert into crm_stages (organization_id, pipeline_id, name, slug, position, agent_stage_hint)
     values ($1, $2, 'Qualificando', $3, 2, 'qualifying')`,
    [ORG, p[0]!.id, `qualif-${slug}`],
  );
  return { id: p[0]!.id, primeira: s1[0]!.id };
}

async function criarContatoComNegocio(nome: string, funil: { id: string; primeira: string }): Promise<string> {
  const { rows: c } = await pool.query<{ id: string }>(
    `insert into contacts (organization_id, display_name, source) values ($1, $2, 'whatsapp') returning id`,
    [ORG, nome],
  );
  await pool.query(
    `insert into crm_leads (organization_id, pipeline_id, stage_id, contact_id, title, status)
     values ($1, $2, $3, $4, $5, 'open')`,
    [ORG, funil.id, funil.primeira, c[0]!.id, `Negócio de ${nome}`],
  );
  return c[0]!.id;
}

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, 'org-veto-escopo', 'Veto LTDA', 'Veto') on conflict (id) do nothing`,
    [ORG],
  );
  const dele = await criarFunil("Suporte - IA", "suporte-ia");
  const alheio = await criarFunil("Comercial - Andrea", "comercial-andrea");
  funilDele = dele.id;
  funilAlheio = alheio.id;
  contatoNoFunilDele = await criarContatoComNegocio("Cliente do Suporte", dele);
  contatoNoFunilAlheio = await criarContatoComNegocio("Cliente da Andrea", alheio);
});

afterAll(async () => {
  await pool.query("delete from organizations where id = $1", [ORG]);
  await pool.end();
});

describe("o negócio de um funil que o assistente NÃO cuida", () => {
  it("controle: o cenário tem dois funis com etapas mapeadas", async () => {
    // Sem mapeamento, o motivo seria `sem_mapeamento` e o teste passaria por
    // um caminho que não é o que se quer medir.
    const { rows } = await pool.query<{ n: string }>(
      "select count(*) as n from crm_stages where organization_id = $1 and agent_stage_hint is not null",
      [ORG],
    );
    expect(Number(rows[0]!.n)).toBe(4);
  });

  it("NÃO é movido, e o motivo é `fora_do_escopo`", async () => {
    const r = await sincronizaEstagioDoAgente(db, {
      organizationId: ORG,
      contactId: contatoNoFunilAlheio,
      passo: "qualifying",
      escopoDeFunis: [funilDele], // cuida do Suporte, não do Comercial
    });
    expect(r.moveu).toBe(false);
    expect(r.motivo).toBe("fora_do_escopo");
  });

  it("o motivo NÃO é `sem_negocio` — o negócio existe, o que falta é permissão", async () => {
    // Filtrar os candidatos pelo escopo ANTES de rotear produziria
    // `sem_negocio`, e o dono leria "esse cliente não tem negócio aberto" —
    // falso, e manda procurar no lugar errado.
    const r = await sincronizaEstagioDoAgente(db, {
      organizationId: ORG,
      contactId: contatoNoFunilAlheio,
      passo: "qualifying",
      escopoDeFunis: [funilDele],
    });
    expect(r.motivo).not.toBe("sem_negocio");
    expect(r.motivo).not.toBe("sem_mapeamento");
    // E aponta QUAL negócio, para o aviso poder linkar.
    expect(r.leadId).toBeTruthy();
  });

  it("com escopo VAZIO o motivo é o mesmo, mas o detalhe distingue os dois casos", async () => {
    // "nenhum funil liberado" e "funil de outro time" pedem ações diferentes de
    // quem lê o aviso: marcar um funil, ou não fazer nada.
    const r = await sincronizaEstagioDoAgente(db, {
      organizationId: ORG,
      contactId: contatoNoFunilAlheio,
      passo: "qualifying",
      escopoDeFunis: [],
    });
    expect(r.motivo).toBe("fora_do_escopo");
    expect(r.detalhe).toMatch(/nenhum funil liberado/i);
  });
});

describe("o negócio de um funil que ele CUIDA", () => {
  it("continua sendo movido — senão o gate seria só um jeito caro de desligar a IA", async () => {
    const r = await sincronizaEstagioDoAgente(db, {
      organizationId: ORG,
      contactId: contatoNoFunilDele,
      passo: "qualifying",
      escopoDeFunis: [funilDele],
    });
    expect(r.moveu, `esperava mover, veio ${JSON.stringify(r)}`).toBe(true);
    expect(r.stageName).toBe("Qualificando");
  });

  it("e o card FICOU na etapa nova — a prova é o estado, não o retorno", async () => {
    const { rows } = await pool.query<{ name: string }>(
      `select s.name from crm_leads l join crm_stages s on s.id = l.stage_id
        where l.organization_id = $1 and l.contact_id = $2`,
      [ORG, contatoNoFunilDele],
    );
    expect(rows[0]!.name).toBe("Qualificando");
  });
});

describe("migração", () => {
  it("chamador que NÃO informa escopo segue como antes", async () => {
    // `undefined` ≠ `[]`. Tratar "não informado" como "vazio" pararia todo
    // caminho ainda não migrado, em silêncio — que é exatamente o modo de falha
    // que o backfill da 0125 existe para evitar do outro lado.
    const { rows: c } = await pool.query<{ id: string }>(
      `insert into contacts (organization_id, display_name, source) values ($1, 'Sem Escopo', 'whatsapp') returning id`,
      [ORG],
    );
    const { rows: s } = await pool.query<{ id: string }>(
      "select id from crm_stages where pipeline_id = $1 and agent_stage_hint = 'new'",
      [funilAlheio],
    );
    await pool.query(
      `insert into crm_leads (organization_id, pipeline_id, stage_id, contact_id, title, status)
       values ($1, $2, $3, $4, 'Negócio legado', 'open')`,
      [ORG, funilAlheio, s[0]!.id, c[0]!.id],
    );

    const r = await sincronizaEstagioDoAgente(db, {
      organizationId: ORG,
      contactId: c[0]!.id,
      passo: "qualifying",
      // escopoDeFunis ausente de propósito
    });
    expect(r.moveu, "sem escopo informado, o comportamento antigo continua").toBe(true);
  });
});
