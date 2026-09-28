import { describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

/**
 * 0165 · o identificador do canal é único entre os canais ATIVOS.
 *
 * Cobrado no Postgres descartável que nasce do `supabase/baseline.sql` — o
 * arquivo que o self-hoster de fato aplica. Migration que existe só em
 * `migrations/` não chega a ele.
 *
 * ─── O que estas asserções protegem (issue #236) ────────────────────────────
 * `meta_phone_number_id` (0087) e `zernio_account_id` (0131) nasceram sem trava,
 * enquanto `waha_session_name` e `webhook_path_token` são UNIQUE desde o
 * snapshot. Três consultas de `lib/channels/` resolviam a sessão por esses
 * identificadores num client de service role (que bypassa RLS): com duas linhas
 * casando, `maybeSingle()` devolve `data: null` + `PGRST116` — os resolvedores
 * caíam no `.env` (mensagem saindo pela conta de OUTRA instalação) e a ingestão
 * do canal oficial descartava a mensagem recebida para as DUAS organizações.
 *
 * As asserções são de COMPORTAMENTO: "existe um índice chamado X" prova que
 * alguém escreveu o nome; o que o produto precisa é que a segunda linha seja
 * RECUSADA — e com o nome da trava no erro, senão "rejeitou" não distingue esta
 * trava de um CHECK, de uma FK ou da RLS.
 */

function novaOrg(slug: string): string {
  sql(`
    insert into public.organizations (slug, legal_name, display_name)
    values ('${slug}', 'inv 0165', 'inv 0165');
  `);
  return sql(`select id from public.organizations where slug = '${slug}'`).trim();
}

function insertSession(org: string, cols: Record<string, string>): string {
  const nomes = ["organization_id", "webhook_secret_encrypted", ...Object.keys(cols)];
  const vals = [`'${org}'`, `'\\x00'::bytea`, ...Object.values(cols)];
  return sql(`
    insert into public.channel_sessions (${nomes.join(", ")})
    values (${vals.join(", ")});
    select 'ok';
  `);
}

function erroDe(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    const err = e as { stderr?: Buffer | string; message?: string };
    return String(err.stderr ?? "") + String(err.message ?? "");
  }
  throw new Error("o INSERT passou — a trava não existe neste banco");
}

describe("0165 · a colisão de identificador é impossível, não improvável", () => {
  it("duas ORGANIZAÇÕES não podem ter o mesmo meta_phone_number_id ativo", () => {
    const a = novaOrg(`inv-0165-meta-a-${Date.now()}`);
    const b = novaOrg(`inv-0165-meta-b-${Date.now()}`);
    insertSession(a, { provider: `'meta_cloud'`, meta_phone_number_id: `'0165-pn'` });

    const erro = erroDe(() =>
      insertSession(b, { provider: `'meta_cloud'`, meta_phone_number_id: `'0165-pn'` }),
    );
    expect(erro).toContain("channel_sessions_meta_phone_number_id_ativo_unique");
  });

  it("duas ORGANIZAÇÕES não podem ter o mesmo zernio_account_id ativo", () => {
    const a = novaOrg(`inv-0165-zer-a-${Date.now()}`);
    const b = novaOrg(`inv-0165-zer-b-${Date.now()}`);
    insertSession(a, { provider: `'zernio'`, zernio_account_id: `'0165-acc'` });

    const erro = erroDe(() =>
      insertSession(b, { provider: `'zernio'`, zernio_account_id: `'0165-acc'` }),
    );
    expect(erro).toContain("channel_sessions_zernio_account_id_ativo_unique");
  });

  it("a MESMA organização também não repete o identificador", () => {
    // O escopo da trava é a INSTALAÇÃO, não a organização, e é de propósito: o
    // identificador é do provider, e uma conta atende um canal só. Escopá-la por
    // organização deixaria a colisão cross-tenant — que É o defeito — de pé.
    const org = novaOrg(`inv-0165-mesma-${Date.now()}`);
    insertSession(org, { provider: `'meta_cloud'`, meta_phone_number_id: `'0165-mesma'` });

    const erro = erroDe(() =>
      insertSession(org, { provider: `'meta_cloud'`, meta_phone_number_id: `'0165-mesma'` }),
    );
    expect(erro).toContain("channel_sessions_meta_phone_number_id_ativo_unique");
  });

  it("canal ARQUIVADO libera o identificador — senão excluir e reconectar trava", () => {
    // Precedente da 0107: trava total transformava "excluí e vou reconectar o
    // mesmo número" em 23505 na linha nova, e o canal ficava sem identificador.
    // Este é o caso que obriga o índice a ser PARCIAL, e é por isso que o código
    // filtra `archived_at is null` — a trava só garante o que ela recorta.
    const org = novaOrg(`inv-0165-arq-${Date.now()}`);
    insertSession(org, {
      provider: `'meta_cloud'`,
      meta_phone_number_id: `'0165-arq'`,
      archived_at: `now()`,
    });
    // `lastLine`, não a saída inteira: com `-tA` o psql ainda imprime a etiqueta
    // `INSERT 0 1` no stdout, e comparar o texto todo reprovava um INSERT que
    // tinha passado. O `select 'ok'` no fim do script é o sinal de que ele
    // chegou ao fim sem `ON_ERROR_STOP` derrubar nada.
    expect(
      lastLine(insertSession(org, { provider: `'meta_cloud'`, meta_phone_number_id: `'0165-arq'` })),
    ).toBe("ok");
  });

  it("a busca escopada devolve a linha da organização certa, e só ela", () => {
    // O predicado EXATO que `lib/channels/*/credentials.ts` e `meta/ingest.ts`
    // passam a usar: organização + identificador + ativo. Com a trava acima, os
    // dois identificadores iguais só coexistem se um deles estiver arquivado —
    // e é justamente aí que o recorte tem de continuar exato.
    const a = novaOrg(`inv-0165-busca-a-${Date.now()}`);
    const b = novaOrg(`inv-0165-busca-b-${Date.now()}`);
    insertSession(a, {
      provider: `'meta_cloud'`,
      meta_phone_number_id: `'0165-busca'`,
      archived_at: `now()`,
    });
    insertSession(b, { provider: `'meta_cloud'`, meta_phone_number_id: `'0165-busca'` });

    const naOrgB = sql(`select organization_id from public.channel_sessions
                         where organization_id = '${b}'
                           and meta_phone_number_id = '0165-busca'
                           and archived_at is null`);
    expect(naOrgB).toBe(b);

    // E a organização A — dona da linha ARQUIVADA — não recebe a linha de B.
    expect(
      sql(`select count(*) from public.channel_sessions
            where organization_id = '${a}'
              and meta_phone_number_id = '0165-busca'
              and archived_at is null`),
    ).toBe("0");
  });
});

describe("0165 · o recorte do índice é o mesmo que o código consulta", () => {
  for (const [coluna, indice] of [
    ["meta_phone_number_id", "channel_sessions_meta_phone_number_id_ativo_unique"],
    ["zernio_account_id", "channel_sessions_zernio_account_id_ativo_unique"],
  ] as const) {
    it(`${indice} é ÚNICO e parcial em archived_at is null`, () => {
      // Vale como asserção estrutural (as de comportamento estão acima) porque a
      // migration só é auto-curativa enquanto o predicado for este: um índice
      // TOTAL quebraria o reconectar-o-mesmo-número da 0107, e um índice
      // não-único passaria os INSERTs sem ninguém perceber até a próxima
      // credencial sair pela conta errada.
      const def = sql(`select indexdef from pg_indexes
                        where schemaname = 'public' and indexname = '${indice}'`);
      expect(def).toContain("CREATE UNIQUE INDEX");
      expect(def).toContain(`(${coluna})`);
      expect(def).toContain("archived_at IS NULL");
    });
  }
});
