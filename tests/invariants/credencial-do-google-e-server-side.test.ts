/**
 * `platform_google_oauth` É SERVER-SIDE ONLY — E ISSO SE MEDE, NÃO SE DECLARA.
 *
 * ## O que se pagaria
 *
 * O `client_secret` do app OAuth é o que permite trocar códigos e refresh tokens
 * EM NOME DESTA INSTALAÇÃO — isto é, ler a agenda de todos os atendentes que
 * conectaram. E a anon key vai para o browser: uma tabela servida pelo PostgREST
 * e "protegida por policy" depende de a policy estar certa.
 *
 * O `supabase/baseline.sql` traz `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON
 * TABLES TO anon` e `... TO authenticated`, e eles valem para toda tabela criada
 * DEPOIS deles — isto é, para todo apêndice novo. **Tabela nova nasce
 * concedida.** Foi assim que a 0142 criou `org_guardrail_layers` exposta,
 * escrevendo "nenhuma função nova, então não há grant a revogar": leitura de uma
 * doutrina que fala de FUNÇÃO, aplicada a uma TABELA.
 *
 * ## Por que RLS-sem-policy NÃO basta sozinha
 *
 * Com RLS ligada e zero policies, `anon` e `authenticated` recebem ZERO LINHA —
 * parece seguro, e um teste que contasse linhas passaria mesmo SEM o revoke.
 * Por isso este arquivo mede **privilégio** (o que sobra no dia em que alguém
 * acrescentar "só uma policy de leitura") **e** comportamento (`permission
 * denied`, que é o que distingue "a policy barrou" de "o privilégio não
 * existe").
 *
 * ## O caso que só existe aqui
 *
 * `platform_branding` guarda nome, cor e logo — vazá-los é constrangedor. Aqui o
 * conteúdo é um SEGREDO, então há um caso a mais: a coluna cifrada não pode
 * voltar em claro nem para quem alcança a tabela pelo `service_role` sem passar
 * pela decifra. Ele prende a propriedade que a tela promete quando diz que a
 * chave "nunca volta a aparecer".
 *
 * Irmão declarado de `tests/invariants/marca-da-instalacao.test.ts`, que é o
 * molde — inclusive na razão de a tabela não entrar em `rls-isolation.test.ts`:
 * ela não é tenant-aware e não deve ser. A credencial é da INSTALAÇÃO.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { motivoDoErro, sql } from "./psql-transporte";

const TABELA = "platform_google_oauth";

/** Roda um comando sob outro papel e devolve o erro do Postgres, ou `null`. */
function erroSob(papel: string, comando: string): string | null {
  try {
    sql(`set role ${papel};\n${comando};\nreset role;`);
    return null;
  } catch (err) {
    return motivoDoErro(err);
  }
}

/**
 * Afirma que o Postgres RECUSOU o comando por privilégio.
 *
 * O modo de falha interessante é `erroSob` devolver `null`: o comando PASSOU.
 * Com RLS ligada e o grant de volta, `anon` recebe zero linhas SEM erro — e uma
 * asserção `toContain` sobre `null` reprova com uma mensagem que não diz nada
 * sobre a tabela ter ficado exposta.
 */
function esperaBarrado(papel: string, comando: string): void {
  const erro = erroSob(papel, comando);
  expect(erro, `\`${papel}\` executou "${comando}" SEM erro — a tabela está exposta`).not.toBeNull();
  expect(erro).toContain("permission denied");
}

function privilegiosDe(papel: string): string {
  return sql(`
    select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), 'NENHUM')
      from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name = '${TABELA}'
       and grantee = '${papel}';
  `).trim();
}

beforeAll(() => {
  // Banco compartilhado entre os arquivos desta suíte (`fileParallelism: false`).
  // Partir de estado conhecido é o que impede um caso de passar por causa de uma
  // fixture de rodada anterior.
  sql(`delete from public.${TABELA};`);

  // A CHAVE MESTRA DE CIFRA, sem a qual `fn_encrypt_oauth` levanta. O banco
  // efêmero do harness nasce sem ela, e é por isso que o caso da cifra reprovou
  // no CI: o teste foi escrito numa máquina onde o Docker estava caído e nunca
  // passou pelo harness.
  //
  // `on conflict do nothing`, e a escolha importa: `private.app_secrets` é
  // compartilhada, a mesma chave serve o conector de loja, e esta suíte roda no
  // MESMO banco que os outros arquivos. Sobrescrever aqui faria um teste
  // decidir o segredo dos outros; apagar no `afterAll` faria pior — quebraria
  // quem rodasse depois. Se já houver chave, ela vence.
  //
  // 44 caracteres: a função exige >= 32 e recusa abaixo disso.
  sql(`
    insert into private.app_secrets (name, value)
    values ('nuvemshop_oauth_key', 'chave-de-teste-do-harness-0201-nao-e-segredo')
    on conflict (name) do nothing;
  `);
});

afterAll(() => {
  sql(`delete from public.${TABELA};`);
});

describe("o PostgREST não serve a credencial do Google da instalação", () => {
  it("`anon` não tem privilégio NENHUM", () => {
    expect(privilegiosDe("anon")).toBe("NENHUM");
  });

  it("`authenticated` também não tem — nenhuma tela lê isto pelo client de sessão", () => {
    // Quem lê é `lib/agenda/google/config.ts`, no servidor, com o admin client.
    expect(privilegiosDe("authenticated")).toBe("NENHUM");
  });

  it("`service_role` CONTINUA com privilégio — controle positivo da sonda", () => {
    // Sem este caso, uma sonda medindo errado (nome de tabela trocado, schema
    // errado) devolveria NENHUM para todo mundo e os dois casos de cima
    // passariam por acidente. E é o privilégio que a server action usa: se ele
    // sumir, a credencial deixa de ser gravável e o produto degrada para o
    // `.env` sem ninguém entender por quê.
    const privilegios = privilegiosDe("service_role");
    expect(privilegios).toContain("SELECT");
    expect(privilegios).toContain("INSERT");
    expect(privilegios).toContain("UPDATE");
  });

  it("`anon` é BARRADO ao ler — permission denied, não zero linhas", () => {
    esperaBarrado("anon", `select id from public.${TABELA}`);
  });

  it("`authenticated` é BARRADO ao ler", () => {
    esperaBarrado("authenticated", `select id from public.${TABELA}`);
  });

  it("`authenticated` é BARRADO ao escrever", () => {
    esperaBarrado(
      "authenticated",
      `insert into public.${TABELA} (id, client_id) values (1, 'invasor.apps.googleusercontent.com')`,
    );
  });

  it("a RLS está LIGADA — o segundo degrau, para o dia em que o grant voltar", () => {
    const ligada = sql(`
      select relrowsecurity from pg_class
       where oid = 'public.${TABELA}'::regclass;
    `).trim();
    expect(ligada, "RLS desligada: o revoke vira a única defesa").toBe("t");
  });

  it("não há policy nenhuma — servir esta tabela nunca foi a intenção", () => {
    const quantas = sql(`
      select count(*) from pg_policies
       where schemaname = 'public' and tablename = '${TABELA}';
    `).trim();
    expect(
      quantas,
      "alguém criou policy: a tabela passa a ser SERVIDA, e o segredo do app OAuth " +
        "fica atrás de uma regra em vez de atrás da ausência de privilégio",
    ).toBe("0");
  });
});

describe("o segredo é gravado cifrado, e volta pela decifra", () => {
  it("a coluna é bytea e o que se grava NÃO se lê em claro", () => {
    // A propriedade que a tela promete quando diz que a chave "nunca volta a
    // aparecer". Sem este caso, gravar em texto puro passaria por todos os
    // outros — eles medem QUEM alcança a tabela, não O QUE está lá dentro.
    const segredo = "GOCSPX-segredo-de-teste-0201";
    sql(`
      insert into public.${TABELA} (id, client_id, client_secret_encrypted)
      values (1, 'teste.apps.googleusercontent.com', public.fn_encrypt_oauth('${segredo}'))
      on conflict (id) do update set client_secret_encrypted = excluded.client_secret_encrypted;
    `);

    const cru = sql(
      `select encode(client_secret_encrypted, 'escape') from public.${TABELA} where id = 1;`,
    );
    expect(
      cru.includes(segredo),
      "o segredo está legível na coluna — fn_encrypt_oauth não foi aplicada",
    ).toBe(false);

    const decifrado = sql(
      `select public.fn_decrypt_oauth(client_secret_encrypted) from public.${TABELA} where id = 1;`,
    ).trim();
    expect(decifrado, "a decifra não devolveu o que foi gravado — o par não fecha").toBe(segredo);
  });

  it("o singleton é singleton — não dá para ter duas credenciais de instalação", () => {
    // Duas linhas fariam a leitura por `.eq("id", 1)` continuar funcionando e a
    // segunda virar dado morto que ninguém enxerga — pior que erro.
    const erro = (() => {
      try {
        sql(`insert into public.${TABELA} (id, client_id) values (2, 'segunda');`);
        return null;
      } catch (err) {
        return motivoDoErro(err);
      }
    })();
    expect(erro, "aceitou uma segunda linha: o CHECK do singleton não está no baseline").not.toBeNull();
  });
});
