import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GOV_ORG, GOV_SESSION, seedGov } from "./gov-helpers";

/**
 * A régua da Fila (`conversations.awaiting_since`, migration 0267, issue #990)
 * provada no Postgres do baseline — não no espelho em TypeScript de
 * `tests/unit/fila-nao-empurra-quem-insiste.test.ts`, cujo próprio docblock diz
 * que "quem o prova é a suíte de invariantes".
 *
 * A regra medida é a do COMENTÁRIO DA COLUNA, não a do código: "o instante da
 * mensagem do cliente mais antiga que ninguém respondeu ainda; quando não há
 * mensagem sem resposta, carrega last_inbound_at". Cada caso usa uma conversa
 * própria, para que um vermelho não arraste os seguintes.
 *
 * O backfill é lido do `supabase/baseline.sql` em disco (o bloco do apêndice da
 * 0267), e não copiado para cá: uma cópia continuaria verde com o apêndice
 * quebrado.
 *
 * O caso (f) reproduz a escrita que `app/api/v1/messages/_handler.ts` faz ao
 * enviar pelo CRM — um update direto das colunas, sem passar por
 * `fn_mark_conversation_message`. As colunas são LIDAS do handler (ver
 * `colunasDoEnvioPeloCrm`), pelo mesmo motivo do backfill: espelho copiado
 * envelhece calado, e este já envelheceu uma vez.
 */

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 3,
});

/**
 * UM CONTATO POR CONVERSA, e a razão é do schema: `uniq_conversations_1to1_per_contact_session`
 * só admite UMA conversa 1-a-1 por par (contato, sessão de canal). Reusar o
 * mesmo contato em todos os casos faz o segundo `insert` morrer com violação de
 * chave única — e o vermelho fala da fixture, não da regra que se quer provar.
 * Medido: com um contato só, 6 dos 7 casos caíam assim.
 */
const contatoInicial = randomUUID();
/** Âncora no passado (relógio do BANCO), para a fronteira de fechamento real ficar depois. */
let base: Date;

function t(minutos: number): string {
  return new Date(base.getTime() + minutos * 60_000).toISOString();
}

/** O contato da conversa corrente — cada caso ganha o seu (ver acima). */
let contact = contatoInicial;

async function novaConversa(): Promise<string> {
  const id = randomUUID();
  contact = randomUUID();
  await pool.query("insert into contacts(id,organization_id,display_name) values($1,$2,$3)", [
    contact,
    GOV_ORG,
    "Cliente da fila",
  ]);
  await pool.query(
    `insert into conversations(id,organization_id,contact_id,channel_session_id,status) values($1,$2,$3,$4,'open')`,
    [id, GOV_ORG, contact, GOV_SESSION],
  );
  return id;
}

async function mensagem(conv: string, direction: "inbound" | "outbound", at: string) {
  await pool.query(
    `insert into messages(id,organization_id,conversation_id,channel_session_id,contact_id,type,direction,status,sent_via,body,sent_at)
     values($1,$2,$3,$4,$5,'text',$6,'received','ai','Mensagem de teste',$7::timestamptz)`,
    [randomUUID(), GOV_ORG, conv, GOV_SESSION, contact, direction, at],
  );
}

/** Caminho do webhook: a mensagem gravada + `fn_mark_conversation_message`. */
async function marcar(conv: string, direction: "inbound" | "outbound", at: string) {
  await mensagem(conv, direction, at);
  await pool.query("select fn_mark_conversation_message($1,$2,'Mensagem de teste',$3::timestamptz)", [
    conv,
    direction,
    at,
  ]);
}

async function linha(conv: string) {
  const r = await pool.query(
    "select awaiting_since,last_inbound_at,last_outbound_at,service_closed_at from conversations where id=$1",
    [conv],
  );
  return r.rows[0] as {
    awaiting_since: Date | null;
    last_inbound_at: Date | null;
    last_outbound_at: Date | null;
    service_closed_at: Date | null;
  };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function blocoDeBackfillDoApendice(): string {
  const baseline = readFileSync(path.resolve(__dirname, "../../supabase/baseline.sql"), "utf8");
  const marco = baseline.indexOf("(migration 0267) ----");
  expect(marco, "apêndice da 0267 não encontrado no baseline.sql").toBeGreaterThan(-1);
  const inicio = baseline.indexOf("update public.conversations c", marco);
  const fim = baseline.indexOf("create or replace function public.fn_mark_conversation_message", marco);
  expect(inicio).toBeGreaterThan(marco);
  expect(fim).toBeGreaterThan(inicio);
  return baseline.slice(inicio, fim);
}

/**
 * As colunas que o envio pelo CRM grava são LIDAS de
 * `app/api/v1/messages/_handler.ts`, não copiadas para cá — pelo mesmo motivo do
 * backfill acima, e com a mesma história: a cópia ficou parada na versão
 * anterior ao commit `771fd719c` (issue #990), que passou a gravar
 * `awaiting_since`. O vermelho que isso produziu falava do espelho, e lia-se
 * como defeito do produto.
 *
 * Coluna nova no handler sem tradução aqui é ERRO, nunca omissão silenciosa:
 * espelho que ignora o que não conhece volta a ser cópia.
 */
function colunasDoEnvioPeloCrm(): string[] {
  const fonte = readFileSync(
    path.resolve(__dirname, "../../app/api/v1/messages/_handler.ts"),
    "utf8",
  );
  const marco = fonte.indexOf("const conversationUpdate");
  expect(marco, "`conversationUpdate` não existe mais em _handler.ts").toBeGreaterThan(-1);
  const inicio = fonte.indexOf("} = {", marco);
  expect(inicio, "objeto literal de `conversationUpdate` não encontrado").toBeGreaterThan(marco);

  const colunas: string[] = [];
  let profundidade = 0;
  for (const bruta of fonte.slice(inicio + 4).split("\n")) {
    const linha = bruta.replace(/\/\/.*$/, "");
    if (profundidade === 1) {
      const nome = /^\s*([a-z_]+):/.exec(linha)?.[1];
      if (nome) colunas.push(nome);
    }
    profundidade += (linha.match(/[{[(]/g)?.length ?? 0) - (linha.match(/[}\])]/g)?.length ?? 0);
    if (profundidade === 0 && colunas.length > 0) break;
  }
  expect(colunas.length, "nenhuma coluna lida de `conversationUpdate`").toBeGreaterThan(0);
  return colunas;
}

/** O envio pelo CRM, com os valores que o handler daria a cada coluna que ele escreve. */
async function enviarPeloCrm(conv: string, instante: string) {
  const antes = await linha(conv);
  const valores: Record<string, unknown> = {
    last_outbound_at: instante,
    last_message_at: instante,
    last_message_preview: "resposta pelo CRM",
    unread_count_for_assignee: 0,
    // O handler grava `c.last_inbound_at` — o valor LIDO antes do update.
    awaiting_since: antes.last_inbound_at,
  };
  const colunas = colunasDoEnvioPeloCrm();
  expect(
    colunas.filter((c) => !(c in valores)),
    "_handler.ts passou a escrever coluna que este espelho não sabe traduzir",
  ).toEqual([]);
  await pool.query(
    `update conversations set ${colunas.map((c, i) => `${c} = $${i + 2}`).join(", ")} where id = $1`,
    [conv, ...colunas.map((c) => valores[c])],
  );
}

beforeAll(async () => {
  seedGov();
  await pool.query("insert into contacts(id,organization_id,display_name) values($1,$2,$3)", [
    contact,
    GOV_ORG,
    "Fila espera",
  ]);
  const r = await pool.query("select date_trunc('minute', now() - interval '6 hours') as base");
  base = r.rows[0].base;
});

afterAll(async () => {
  await pool.end();
});

describe("awaiting_since — a espera não recomeça a cada mensagem do cliente (0267)", () => {
  it("(a) insistência: inbound 10h00 marca 10h00; inbound 10h10 mantém 10h00", async () => {
    const conv = await novaConversa();
    await marcar(conv, "inbound", t(0));
    expect(iso((await linha(conv)).awaiting_since)).toBe(t(0));
    await marcar(conv, "inbound", t(10));
    const l = await linha(conv);
    expect(iso(l.last_inbound_at)).toBe(t(10));
    expect(iso(l.awaiting_since)).toBe(t(0));
  });

  it("(b) outbound pela função responde tudo: volta a last_inbound_at; inbound seguinte recomeça", async () => {
    const conv = await novaConversa();
    await marcar(conv, "inbound", t(0));
    await marcar(conv, "inbound", t(10));
    await marcar(conv, "outbound", t(15));
    expect(iso((await linha(conv)).awaiting_since)).toBe(t(10));
    await marcar(conv, "inbound", t(20));
    expect(iso((await linha(conv)).awaiting_since)).toBe(t(20));
  });

  it("(c) inbound atrasado (sent_at < last_outbound_at) não reabre a espera", async () => {
    const conv = await novaConversa();
    await marcar(conv, "inbound", t(0));
    await marcar(conv, "outbound", t(15));
    const antes = (await linha(conv)).awaiting_since;
    expect(iso(antes)).toBe(t(0));
    await marcar(conv, "inbound", t(12));
    const l = await linha(conv);
    // Não reabre: a espera guardada não passa a ser a mensagem atrasada nem
    // qualquer instante posterior à resposta. (O valor exato — o 10h00 que já
    // estava lá, e não o last_inbound_at 10h12 que a letra do comentário da
    // coluna pediria — fica registrado no relatório da triagem, não aqui.)
    expect(l.awaiting_since!.getTime()).toBeLessThanOrEqual(l.last_outbound_at!.getTime());
    expect(iso(l.awaiting_since)).not.toBe(t(12));
  });

  it("(d) fronteira: atendimento fechado depois da espera — o próximo inbound recomeça", async () => {
    const conv = await novaConversa();
    await marcar(conv, "inbound", t(0));
    await marcar(conv, "outbound", t(15));
    await marcar(conv, "inbound", t(20));
    expect(iso((await linha(conv)).awaiting_since)).toBe(t(20));
    await pool.query("select * from fn_service_status($1,$2,'closed',null)", [GOV_ORG, conv]);
    const fechado = await linha(conv);
    expect(fechado.service_closed_at).not.toBeNull();
    expect(fechado.service_closed_at!.getTime()).toBeGreaterThan(new Date(t(20)).getTime());
    const depois = (
      await pool.query("select clock_timestamp() + interval '1 minute' as at")
    ).rows[0].at as Date;
    await marcar(conv, "inbound", depois.toISOString());
    expect(iso((await linha(conv)).awaiting_since)).toBe(depois.toISOString());
  });

  it("(e) backfill do apêndice: min dos inbound sem resposta; respondida herda last_inbound_at; reaplicar é no-op", async () => {
    const bloco = blocoDeBackfillDoApendice();

    // Esperando: in 10h00, out 10h05, in 10h10, in 10h20 → começo da espera 10h10.
    const esperando = await novaConversa();
    await mensagem(esperando, "inbound", t(0));
    await mensagem(esperando, "outbound", t(5));
    await mensagem(esperando, "inbound", t(10));
    await mensagem(esperando, "inbound", t(20));
    // Respondida: in 10h00, out 10h05 → não há espera, carrega last_inbound_at.
    const respondida = await novaConversa();
    await mensagem(respondida, "inbound", t(0));
    await mensagem(respondida, "outbound", t(5));
    // Nunca respondida, com atendimento fechado 9h30 no meio: in 9h00, in 9h40 → 9h40.
    const fechada = await novaConversa();
    await mensagem(fechada, "inbound", t(-60));
    await mensagem(fechada, "inbound", t(-20));

    await pool.query(
      `update conversations set
         last_inbound_at = case id when $1::uuid then $4::timestamptz when $2::uuid then $5::timestamptz else $6::timestamptz end,
         last_outbound_at = case id when $1::uuid then $7::timestamptz when $2::uuid then $7::timestamptz else null end,
         service_closed_at = case id when $3::uuid then $8::timestamptz else null end,
         awaiting_since = null
       where id in ($1,$2,$3)`,
      [esperando, respondida, fechada, t(20), t(0), t(-20), t(5), t(-30)],
    );

    await pool.query(bloco);
    expect(iso((await linha(esperando)).awaiting_since)).toBe(t(10));
    expect(iso((await linha(respondida)).awaiting_since)).toBe(t(0));
    expect(iso((await linha(fechada)).awaiting_since)).toBe(t(-20));

    const segunda = (await pool.query(bloco)) as unknown as pg.QueryResult[];
    expect(segunda.map((r) => r.rowCount)).toEqual([0, 0]);
    expect(iso((await linha(esperando)).awaiting_since)).toBe(t(10));
  });

  it("(f) envio pelo CRM (update direto do _handler, sem a função) responde tudo: volta a last_inbound_at", async () => {
    const conv = await novaConversa();
    await marcar(conv, "inbound", t(0));
    await marcar(conv, "inbound", t(10));
    await mensagem(conv, "outbound", t(15));
    await enviarPeloCrm(conv, t(15));
    const l = await linha(conv);
    expect(iso(l.last_outbound_at)).toBe(t(15));
    expect(iso(l.awaiting_since)).toBe(iso(l.last_inbound_at));
  });

  it("(f2) depois do envio pelo CRM, o inbound seguinte recomeça a espera", async () => {
    const conv = await novaConversa();
    await marcar(conv, "inbound", t(0));
    await marcar(conv, "inbound", t(10));
    await enviarPeloCrm(conv, t(15));
    await marcar(conv, "inbound", t(20));
    expect(iso((await linha(conv)).awaiting_since)).toBe(t(20));
  });
});
