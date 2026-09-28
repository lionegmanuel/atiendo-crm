import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { pgComoSupabase } from "../pg-como-supabase";

/**
 * O TELEFONE DESCOBERTO QUE JÁ É DE OUTRO CONTATO (migration 0122).
 *
 * ═══ O QUE ESTE ARQUIVO PROTEGE ═══
 *
 * A 0122 passou a GRAVAR, num contato nascido `@lid`, o telefone que vem em
 * `_data.key.remoteJidAlt`. `contacts` tem DUAS constraints únicas que essa
 * escrita pode violar de uma vez: `uniq_contacts_org_phone` e
 * `uniq_contacts_org_wa_identity` (a identidade é GERADA e o telefone tem
 * precedência sobre o lid). Nenhuma das duas é nova — o que é novo é existir um
 * caminho que escreve `phone_number` num contato que já existia.
 *
 * `fn_upsert_wa_contact` procura em DUAS etapas e a ordem é a armadilha:
 *
 *   1. por `wa_lid`  — a correlação do WhatsApp;
 *   2. por `phone_number` — só se a etapa 1 não achou nada.
 *
 * Quando a etapa 1 ACHA, a etapa 2 nunca roda. Se o telefone que chegou no
 * payload pertence a um TERCEIRO contato (o cliente que veio de import, de
 * formulário ou de pedido da loja), o `update` da etapa 3 colide — e a função
 * estoura em vez de devolver um id.
 *
 * ═══ POR QUE ISTO É CARO, E NÃO UM CASO DE BORDA ═══
 *
 * É exatamente a população que a 0122 mira: 22 dos 31 contatos ativos da
 * produção são `lid:` sem telefone, e o próximo webhook de cada um deles passa a
 * carregar o número. Basta que UM desses números já esteja no CRM por outro
 * caminho para a conversa daquela pessoa parar de entrar.
 *
 * E para o dono do negócio é INVISÍVEL: `lib/waha/ingest.ts` transforma o erro
 * da RPC em `return null` (linha ~344) e o chamador faz `if (!contactId) return`
 * (linha ~459). O webhook responde 200, o WAHA considera entregue, e a mensagem
 * do cliente não existe em lugar nenhum — falha-em-verde na borda mais cara de
 * um CRM de atendimento.
 *
 * ═══ POR QUE MERECE CATRACA ═══
 *
 * O caminho novo (etapa 1 acha, telefone é de outro) é o ÚNICO que a suíte do
 * PR não percorre: `tests/invariants/telefone-do-lid.test.ts` cobre o gêmeo
 * quando a etapa 1 NÃO acha (o lid é novo), que é o caso que funciona. Os dois
 * primeiros casos daqui são controle positivo — se eles ficarem vermelhos, o
 * instrumento (org, fixture, RPC) morreu e os outros dois não medem nada.
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

const ORG = "c0115a00-0000-4000-8000-000000000001";

async function upsert(kind: "phone" | "lid", phone: string | null, lid: string | null, chatId: string, notify: string | null): Promise<string> {
  const { rows } = await pool.query<{ fn_upsert_wa_contact: string }>(
    "select public.fn_upsert_wa_contact($1, $2, $3, $4, $5, $6)",
    [ORG, kind, phone, lid, chatId, notify],
  );
  return rows[0]!.fn_upsert_wa_contact;
}

async function criarPorTelefone(nome: string, telefone: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into contacts (organization_id, display_name, phone_number, source)
     values ($1, $2, $3, 'manual') returning id`,
    [ORG, nome, telefone],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, 'org-colisao-lid', 'Colisao LTDA', 'Colisao') on conflict (id) do nothing`,
    [ORG],
  );
});

afterAll(async () => {
  await pool.query("delete from organizations where id = $1", [ORG]);
  await pool.end();
});

describe("controle positivo — o instrumento está vivo", () => {
  it("telefone INÉDITO entra no contato @lid que já existia", async () => {
    // Sem gêmeo por telefone, a etapa 3 grava e a identidade migra de `lid:` para
    // `phone:` sem colidir com ninguém. É o caso feliz que a 0122 desenhou.
    const lid = "60100000000001";
    const primeiro = await upsert("lid", null, lid, `${lid}@lid`, "Inedito Silva");
    const segundo = await upsert("lid", "+5531900010001", lid, `${lid}@lid`, null);
    expect(segundo, "tem de ser o MESMO contato").toBe(primeiro);
    const { rows } = await pool.query<{ phone_number: string | null; wa_identity: string | null }>(
      "select phone_number, wa_identity from contacts where id = $1",
      [primeiro],
    );
    expect(rows[0]!.phone_number).toBe("+5531900010001");
    expect(rows[0]!.wa_identity).toBe("phone:+5531900010001");
  });

  it("lid INÉDITO cujo telefone já existe funde no contato do telefone", async () => {
    // Aqui a etapa 1 não acha nada e a etapa 2 roda: é o caminho que o teste do
    // PR já cobre, e que funciona. Ele está aqui para separar "a etapa 2
    // existe" de "a etapa 2 é alcançável", que são coisas diferentes.
    const existente = await criarPorTelefone("Veio do Pedido", "+5531900010002");
    const doWhats = await upsert("lid", "+5531900010002", "60100000000002", "60100000000002@lid", "Zap do Pedido");
    expect(doWhats).toBe(existente);
  });
});

describe("o telefone descoberto pertence a OUTRO contato", () => {
  it("a RPC devolve um id em vez de estourar", async () => {
    // ORDEM DOS FATOS, e ela é a que a produção tem hoje:
    //   1. a pessoa escreveu do WhatsApp em modo privacidade -> contato só com lid;
    //   2. a MESMA pessoa já estava no CRM por número (import/pedido/formulário);
    //   3. o webhook seguinte traz `remoteJidAlt` e o número é o do item 2.
    //
    // A etapa 1 da função acha pelo lid, a etapa 2 (por telefone) nunca roda, e
    // o `update` colide. Nada aqui é hipotético: é a combinação que a própria
    // migration diz querer resolver ("a pessoa que já existia por número deixa
    // de virar um segundo contato").
    const lid = "60100000000003";
    const doLid = await upsert("lid", null, lid, `${lid}@lid`, "Privacidade Souza");
    const doImport = await criarPorTelefone("Souza da Planilha", "+5531900010003");
    expect(doLid, "precondição: são dois contatos distintos").not.toBe(doImport);

    await expect(
      upsert("lid", "+5531900010003", lid, `${lid}@lid`, "Privacidade Souza"),
      "descobrir o telefone não pode derrubar a ingestão da mensagem",
    ).resolves.toBeTruthy();
  });

  it("pelo caminho que o ingest usa, o erro vira mensagem PERDIDA e não erro visível", async () => {
    // `lib/waha/ingest.ts` chama isto por `admin.rpc(...)`, e trata assim:
    //     if (error) { console.error(...); return null; }   // ~linha 344
    //     if (!contactId) return;                           // ~linha 459
    // O webhook devolve 200 e a mensagem do cliente não é gravada. Este caso
    // mede o SEAM real (o mesmo adaptador que o PR escreveu para exercitar
    // código de app contra Postgres), não uma reescrita da consulta ao lado.
    const lid = "60100000000004";
    await upsert("lid", null, lid, `${lid}@lid`, "Perdida Lima");
    await criarPorTelefone("Lima da Planilha", "+5531900010004");

    const admin = pgComoSupabase(pool);
    const { data, error } = await admin.rpc("fn_upsert_wa_contact" as never, {
      p_org: ORG,
      p_kind: "lid",
      p_phone: "+5531900010004",
      p_lid: lid,
      p_chat_id: `${lid}@lid`,
      p_notify: "Perdida Lima",
    } as never);

    expect(error, `a RPC devolveu erro — o ingest descartaria a mensagem: ${error?.message ?? ""}`).toBeNull();
    expect(data, "sem contact_id o ingest faz `return` e a mensagem some").toBeTruthy();
  });
});
