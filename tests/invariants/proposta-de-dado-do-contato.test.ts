import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import {
  proporDadoDoContato,
  valorAceitavel,
  vencePropostasDeDado,
} from "@/lib/contacts/proposta-de-dado";

import { pgComoSupabase } from "../pg-como-supabase";

/**
 * O QUE A IA PODE PROPOR — e, sobretudo, o que ela NÃO pode.
 *
 * `contact_field_proposals` guarda a linha; `proporDadoDoContato` decide se ela
 * chega a existir. **Recusar cedo é o trabalho principal aqui**: proposta que não
 * deveria ter nascido custa atenção humana, e atenção gasta com ruído é o que
 * transforma uma fila de confirmação num botão que todo mundo aprova sem ler.
 *
 * Roda a FUNÇÃO contra Postgres real porque cada recusa depende do estado — o
 * contato existe? está anonimizado? o valor já é o que está gravado? já há
 * proposta viva? Nenhuma dessas perguntas se responde com mock.
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

const ORG = "9a0b7e00-0000-4000-8000-000000000001";

async function criarContato(campos: Record<string, unknown> = {}): Promise<string> {
  const base: Record<string, unknown> = {
    organization_id: ORG,
    display_name: "Alvo da Proposta",
    source: "whatsapp",
    ...campos,
  };
  const k = Object.keys(base);
  const { rows } = await pool.query<{ id: string }>(
    `insert into contacts (${k.map((x) => `"${x}"`).join(",")})
     values (${k.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
    k.map((x) => base[x]),
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, 'org-proposta', 'Proposta LTDA', 'Proposta') on conflict (id) do nothing`,
    [ORG],
  );
});

afterAll(async () => {
  await pool.query("delete from organizations where id = $1", [ORG]);
  await pool.end();
});

describe("a proposta NASCE, e não toca o cadastro", () => {
  it("cria a linha na fila e deixa `contacts` INTACTO — é o ponto da decisão", async () => {
    const c = await criarContato({ email: null });
    const r = await proporDadoDoContato(db, {
      organizationId: ORG,
      contactId: c,
      campo: "email",
      valor: "cliente@exemplo.com.br",
      trecho: "meu email é cliente@exemplo.com.br",
    });

    expect(r.criada, `esperava criar, veio ${JSON.stringify(r)}`).toBe(true);
    if (!r.criada) return;

    const { rows: contato } = await pool.query<{ email: string | null }>(
      "select email from contacts where id = $1",
      [c],
    );
    expect(contato[0]!.email, "a IA NÃO grava — quem grava é a confirmação").toBeNull();

    const { rows: prop } = await pool.query<{
      campo: string;
      valor_proposto: string;
      valor_anterior: string | null;
      trecho: string | null;
      status: string;
    }>("select campo, valor_proposto, valor_anterior, trecho, status from contact_field_proposals where id = $1", [
      r.id,
    ]);
    expect(prop[0]!.status).toBe("pending");
    expect(prop[0]!.valor_proposto).toBe("cliente@exemplo.com.br");
    // O `trecho` é o que permite CONFERIR em vez de acreditar.
    expect(prop[0]!.trecho).toContain("cliente@exemplo.com.br");
  });

  it("guarda o valor ANTERIOR desde o nascimento — é o `from` da L-06", async () => {
    // Capturado agora, e não na confirmação, para que a decisão seja tomada com
    // os dois lados à vista — e para que continue existindo se o valor mudar
    // entre a proposta e a decisão.
    const c = await criarContato({ email: "antigo@exemplo.com" });
    const r = await proporDadoDoContato(db, {
      organizationId: ORG,
      contactId: c,
      campo: "email",
      valor: "novo@exemplo.com",
    });
    expect(r.criada).toBe(true);
    if (!r.criada) return;
    expect(r.valorAnterior).toBe("antigo@exemplo.com");
  });

  it("normaliza o e-mail antes de guardar", async () => {
    const c = await criarContato();
    const r = await proporDadoDoContato(db, {
      organizationId: ORG,
      contactId: c,
      campo: "email",
      valor: "  MAIUSCULO@Exemplo.COM  ",
    });
    expect(r.criada).toBe(true);
    if (!r.criada) return;
    const { rows } = await pool.query<{ valor_proposto: string }>(
      "select valor_proposto from contact_field_proposals where id = $1",
      [r.id],
    );
    expect(rows[0]!.valor_proposto).toBe("maiusculo@exemplo.com");
  });
});

describe("o que a IA NÃO consegue propor", () => {
  it("contato ANONIMIZADO — L-04, exceção 'Nenhuma'", async () => {
    // Quem exerceu o direito ao esquecimento não recebe dado de volta pela
    // porta dos fundos. Recusado ANTES de a linha existir; o gatilho da 0123
    // cobre o outro lado (anonimizar depois de a proposta já existir).
    const c = await criarContato({ is_anonymized: true, anonymized_at: new Date().toISOString() });
    const r = await proporDadoDoContato(db, {
      organizationId: ORG,
      contactId: c,
      campo: "email",
      valor: "volta@exemplo.com",
    });
    expect(r.criada).toBe(false);
    if (r.criada) return;
    expect(r.motivo).toBe("contato_anonimizado");
  });

  it("valor IGUAL ao que já está gravado — não há decisão a tomar", async () => {
    // Sem esta recusa, o cliente repetir o próprio e-mail encheria a fila de
    // propostas que confirmam o que já é verdade, e cada uma custaria a atenção
    // de alguém.
    const c = await criarContato({ email: "mesmo@exemplo.com" });
    const r = await proporDadoDoContato(db, {
      organizationId: ORG,
      contactId: c,
      campo: "email",
      valor: "MESMO@exemplo.com", // diferente na forma, igual no conteúdo
    });
    expect(r.criada).toBe(false);
    if (r.criada) return;
    expect(r.motivo).toBe("valor_igual_ao_atual");
  });

  it("segunda proposta do mesmo campo — a idempotência vem do BANCO", async () => {
    const c = await criarContato();
    await proporDadoDoContato(db, { organizationId: ORG, contactId: c, campo: "email", valor: "um@exemplo.com" });
    const r = await proporDadoDoContato(db, {
      organizationId: ORG,
      contactId: c,
      campo: "email",
      valor: "dois@exemplo.com",
    });
    expect(r.criada).toBe(false);
    if (r.criada) return;
    // 23505 traduzido, não engolido: o chamador precisa distinguir "já existe"
    // de "falhou", e o modelo precisa saber que não deve tentar de novo.
    expect(r.motivo).toBe("ja_existe_proposta");
  });

  it("contato de OUTRA organização não é alcançável", async () => {
    const { rows } = await pool.query<{ id: string }>(
      `insert into organizations (id, slug, legal_name, display_name)
       values (gen_random_uuid(), 'org-vizinha-proposta', 'Vizinha', 'Vizinha') returning id`,
    );
    const outraOrg = rows[0]!.id;
    const { rows: c } = await pool.query<{ id: string }>(
      `insert into contacts (organization_id, display_name, source) values ($1, 'Do Vizinho', 'manual') returning id`,
      [outraOrg],
    );

    const r = await proporDadoDoContato(db, {
      organizationId: ORG, // a org do chamador
      contactId: c[0]!.id, // o contato do vizinho
      campo: "email",
      valor: "vizinho@exemplo.com",
    });
    expect(r.criada, "não pode propor dado no contato de outro tenant").toBe(false);
    if (r.criada) return;
    expect(r.motivo).toBe("contato_nao_encontrado");

    await pool.query("delete from organizations where id = $1", [outraOrg]);
  });

  it("contato inexistente", async () => {
    const r = await proporDadoDoContato(db, {
      organizationId: ORG,
      contactId: "9a0b7e00-0000-4000-8000-0000000000ff",
      campo: "email",
      valor: "fantasma@exemplo.com",
    });
    expect(r.criada).toBe(false);
    if (r.criada) return;
    expect(r.motivo).toBe("contato_nao_encontrado");
  });
});

describe("validação de forma — modesta de propósito", () => {
  it("recusa o que claramente não é o campo", () => {
    expect(valorAceitavel("email", "isso não é email")).toBe(false);
    expect(valorAceitavel("email", "sem@ponto")).toBe(false);
    expect(valorAceitavel("phone_number", "123")).toBe(false);
    expect(valorAceitavel("name", "99999")).toBe(false);
    expect(valorAceitavel("email", "")).toBe(false);
  });

  it("aceita o que tem forma válida", () => {
    expect(valorAceitavel("email", "a@b.co")).toBe(true);
    expect(valorAceitavel("phone_number", "+55 31 98888-7777")).toBe(true);
    expect(valorAceitavel("name", "Ana Maria")).toBe(true);
  });

  it("valida FORMA, não veracidade — e isso é declarado, não esquecido", () => {
    // Um e-mail sintaticamente válido pode ser mentira, e nenhuma regex resolve
    // isso. Quem resolve é a pessoa que confirma. Prometer mais aqui daria falsa
    // segurança a quem aprova — que é o oposto do que a fila existe para fazer.
    expect(valorAceitavel("email", "presidente@planalto.gov.br")).toBe(true);
  });

  it("o critério do e-mail é o MESMO do CHECK do banco", async () => {
    // Divergir faria a proposta ser aceita aqui e explodir na confirmação, com
    // o erro aparecendo para quem não causou. Este caso compara os dois.
    const candidatos = ["a@b.co", "sem-arroba.com", "sem@ponto", "ok@dominio.com.br"];
    for (const v of candidatos) {
      const { rows } = await pool.query<{ ok: boolean }>(
        `select ($1 ~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$') as ok`,
        [v],
      );
      expect(valorAceitavel("email", v), `divergência em "${v}"`).toBe(rows[0]!.ok);
    }
  });
});

describe("o VENCIMENTO — porque prazo que ninguém cobre é pior que prazo nenhum", () => {
  /** Cria uma proposta já vencida, driblando o CHECK de prazo no futuro. */
  async function propostaVencida(contactId: string, campo = "email"): Promise<string> {
    const r = await proporDadoDoContato(db, {
      organizationId: ORG,
      contactId,
      campo: campo as "email",
      valor: campo === "email" ? `venceu.${Date.now()}@exemplo.com` : "Nome Vencido",
    });
    if (!r.criada) throw new Error(`setup falhou: ${JSON.stringify(r)}`);
    // O CHECK `prazo_no_futuro` compara com `proposed_at` — empurrar os DOIS
    // para trás mantém a linha coerente e simula uma proposta feita há dias.
    await pool.query(
      `update contact_field_proposals
          set proposed_at = now() - interval '10 days', expires_at = now() - interval '3 days'
        where id = $1`,
      [r.id],
    );
    return r.id;
  }

  it("fecha a proposta que passou do prazo, e a decisão fica DATADA", async () => {
    // Vencer É uma decisão — a do relógio, na ausência da humana. O CHECK
    // `decisao_datada` exige a data, e é ela que responde "quando isso saiu da
    // tela de alguém?".
    const c = await criarContato();
    const id = await propostaVencida(c);

    const r = await vencePropostasDeDado(db, ORG, new Date());
    expect(r.vencidas).toBe(1);

    const { rows } = await pool.query<{ status: string; decided_at: string | null }>(
      "select status, decided_at from contact_field_proposals where id = $1",
      [id],
    );
    expect(rows[0]!.status).toBe("expired");
    expect(rows[0]!.decided_at, "vencer sem data seria registro que não sabe quando").not.toBeNull();
  });

  it("NÃO toca proposta dentro do prazo", async () => {
    // O contrário do defeito seria pior que ele: fechar cedo tira da tela algo
    // que a pessoa ainda ia decidir.
    const c = await criarContato();
    const r0 = await proporDadoDoContato(db, {
      organizationId: ORG,
      contactId: c,
      campo: "email",
      valor: "no.prazo@exemplo.com",
    });
    expect(r0.criada).toBe(true);
    if (!r0.criada) return;

    await vencePropostasDeDado(db, ORG, new Date());
    const { rows } = await pool.query<{ status: string }>(
      "select status from contact_field_proposals where id = $1",
      [r0.id],
    );
    expect(rows[0]!.status).toBe("pending");
  });

  it("o vencimento LIBERA o campo para uma proposta nova", async () => {
    // O índice único é parcial (`where status='pending'`), então fechar a
    // vencida devolve o caminho: o cliente pode dizer o e-mail de novo, e a
    // segunda tentativa não fica presa pela primeira que ninguém decidiu.
    const c = await criarContato();
    await propostaVencida(c);
    await vencePropostasDeDado(db, ORG, new Date());

    const nova = await proporDadoDoContato(db, {
      organizationId: ORG,
      contactId: c,
      campo: "email",
      valor: "segunda.vez@exemplo.com",
    });
    expect(nova.criada, "depois de vencer, o campo volta a aceitar proposta").toBe(true);
  });

  it("abre UM aviso na Central para o lote, não um por proposta", async () => {
    // Cinquenta avisos idênticos são o mesmo ruído que a fila existe para
    // evitar. E o item é reusado se já houver um aberto — item que se duplica a
    // cada tick é a praga que ele evitaria.
    await pool.query("delete from agent_inbox_items where organization_id = $1", [ORG]);
    const c1 = await criarContato();
    const c2 = await criarContato();
    await propostaVencida(c1);
    await propostaVencida(c2);

    const r = await vencePropostasDeDado(db, ORG, new Date());
    expect(r.vencidas).toBe(2);
    expect(r.itensDeCaixa, "um item para o lote").toBe(1);

    const { rows } = await pool.query<{ n: string; kind: string; severity: string }>(
      `select count(*) as n, min(kind) as kind, min(severity) as severity
         from agent_inbox_items where organization_id = $1 and kind = 'contact_proposal_expired'`,
      [ORG],
    );
    expect(rows[0]!.n).toBe("1");
    // `info`, não `warn`: nada quebrou. Tratar isto como falha ensinaria a
    // ignorar os avisos que SÃO falha.
    expect(rows[0]!.severity).toBe("info");
  });

  it("um segundo lote NÃO duplica o aviso aberto", async () => {
    const c3 = await criarContato();
    await propostaVencida(c3);
    await vencePropostasDeDado(db, ORG, new Date());

    const { rows } = await pool.query<{ n: string }>(
      `select count(*) as n from agent_inbox_items
        where organization_id = $1 and kind = 'contact_proposal_expired' and status = 'open'`,
      [ORG],
    );
    expect(rows[0]!.n, "o aviso aberto é reusado").toBe("1");
  });

  it("sem nada vencido, não abre aviso nenhum", async () => {
    // Aviso que aparece sem motivo ensina a ignorar a Central.
    await pool.query("delete from agent_inbox_items where organization_id = $1", [ORG]);
    const r = await vencePropostasDeDado(db, ORG, new Date());
    expect(r.vencidas).toBe(0);
    expect(r.itensDeCaixa).toBe(0);
  });

  it("não vence proposta de OUTRA organização", async () => {
    const { rows: o } = await pool.query<{ id: string }>(
      `insert into organizations (id, slug, legal_name, display_name)
       values (gen_random_uuid(), 'org-vizinha-vencimento', 'Vizinha', 'Vizinha') returning id`,
    );
    const outra = o[0]!.id;
    const { rows: c } = await pool.query<{ id: string }>(
      `insert into contacts (organization_id, display_name, source) values ($1, 'Do Vizinho', 'manual') returning id`,
      [outra],
    );
    // ⚠️ Nasce com prazo NO FUTURO e só depois é empurrada para trás. O trigger
    // `fn_carimba_proposta_de_dado` sobrescreve `proposed_at := now()` no
    // INSERT (por desenho: instantes comparados entre si vêm do mesmo relógio),
    // então um INSERT com prazo passado viola o CHECK antes de existir.
    const { rows: p } = await pool.query<{ id: string }>(
      `insert into contact_field_proposals
         (organization_id, contact_id, campo, valor_proposto, expires_at)
       values ($1, $2, 'email', 'vizinho@exemplo.com', now() + interval '7 days')
       returning id`,
      [outra, c[0]!.id],
    );
    await pool.query(
      `update contact_field_proposals
          set proposed_at = now() - interval '10 days', expires_at = now() - interval '3 days'
        where id = $1`,
      [p[0]!.id],
    );

    await vencePropostasDeDado(db, ORG, new Date());

    const { rows: depois } = await pool.query<{ status: string }>(
      "select status from contact_field_proposals where id = $1",
      [p[0]!.id],
    );
    expect(depois[0]!.status, "o vencimento é por organização").toBe("pending");

    await pool.query("delete from organizations where id = $1", [outra]);
  });
});
