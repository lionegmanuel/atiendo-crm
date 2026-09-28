/**
 * `platform_branding` É SERVER-SIDE ONLY — E ISSO SE MEDE, NÃO SE DECLARA.
 *
 * ## O que se pagaria
 *
 * O `supabase/baseline.sql` traz `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON
 * TABLES TO anon` (linha ~3972) e `... TO authenticated` (~3973), e eles valem
 * para toda tabela criada DEPOIS deles — isto é, para todo apêndice novo, e para
 * toda migration aplicada num projeto Supabase de verdade, onde a entrada em
 * `pg_default_acl` é gravada pelo bootstrap antes de qualquer SQL nosso.
 * **Tabela nova nasce concedida.**
 *
 * Foi assim que nasceu a vulnerabilidade que a 0143 consertou: a 0142 criou
 * `org_guardrail_layers` e escreveu "nenhuma função nova, então não há grant a
 * revogar" — leitura de uma doutrina (CLAUDE.md, migrations, item 9) que fala de
 * FUNÇÃO, aplicada a uma TABELA. Medido num pg17 do zero: um `viewer` desligava
 * a camada anti-jailbreak da organização pelo PostgREST, UPDATE 1 + INSERT 1.
 *
 * ## Por que RLS-sem-policy NÃO basta sozinha
 *
 * Com RLS ligada e zero policies, `anon` e `authenticated` recebem ZERO LINHA —
 * parece seguro, e o teste de comportamento passaria mesmo sem o revoke, se ele
 * medisse só "quantas linhas vieram". Por isso este arquivo mede **privilégio**
 * (o que sobra no dia em que alguém acrescentar "só uma policy de leitura") **e**
 * comportamento (`42501`, permission denied — que é o que distingue "a policy
 * barrou" de "o privilégio não existe").
 *
 * ## Por que a tabela não entra em `rls-isolation.test.ts`
 *
 * Ela não é tenant-aware: não tem `organization_id`, e não deve ter. É a marca
 * da INSTALAÇÃO — o que pinta o login e o e-mail de recuperação, superfícies
 * anteriores a qualquer organização. O caso "não tem organization_id" está aqui
 * embaixo, de propósito: quem acrescentar a coluna um dia precisa ser obrigado a
 * decidir sobre policies e sobre a entrada no `rls-isolation`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { motivoDoErro, sql } from "./psql-transporte";

const TABELA = "platform_branding";

/** Roda um SELECT sob outro papel e devolve o erro do Postgres, ou `null`. */
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
 * Existe em vez de um `expect(erroSob(...)).toContain(...)` cru porque o modo de
 * falha interessante é `erroSob` devolver `null`: o comando PASSOU. Com RLS
 * ligada e o grant de volta, `anon` recebe zero linhas SEM erro — e uma asserção
 * `toContain` sobre `null` reprova com "the given combination of arguments (null
 * and string) is invalid", que não diz nada sobre a tabela ter ficado exposta.
 * Medido: foi exatamente a mensagem que a sabotagem do `revoke` produziu.
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
  // Nenhum outro invariante toca esta tabela, mas partir de estado conhecido é o
  // que impede um caso de passar por causa de uma fixture de rodada anterior.
  sql(`delete from public.${TABELA};`);
});

afterAll(() => {
  sql(`delete from public.${TABELA};`);
});

describe("o PostgREST não serve a marca da instalação", () => {
  it("`anon` não tem privilégio NENHUM — o revoke da 0155 está no baseline", () => {
    expect(privilegiosDe("anon")).toBe("NENHUM");
  });

  it("`authenticated` também não tem — nenhuma tela lê isto pelo client de sessão", () => {
    // Aqui o revoke vai além do precedente da 0143 (que revogou só de `anon`):
    // quem lê esta tabela é o `app/layout.tsx`, no servidor, com o admin client.
    expect(privilegiosDe("authenticated")).toBe("NENHUM");
  });

  it("`service_role` CONTINUA com privilégio — controle positivo da sonda", () => {
    // Sem este caso, uma sonda medindo errado (nome de tabela trocado, schema
    // errado) devolveria NENHUM para todo mundo e os dois casos de cima
    // passariam por acidente. E é o privilégio que o admin client usa: se ele
    // sumir, a marca deixa de ser gravável e o produto degrada para o `.env`
    // sem ninguém entender por quê.
    const privilegios = privilegiosDe("service_role");
    expect(privilegios).toContain("SELECT");
    expect(privilegios).toContain("INSERT");
    expect(privilegios).toContain("UPDATE");
  });

  it("`anon` é BARRADO ao ler — permission denied, não zero linhas", () => {
    // O degrau de comportamento, e não só o de catálogo. A distinção importa:
    // com o grant de volta e a RLS ligada sem policy, `anon` receberia zero
    // linhas SEM erro — e um teste que contasse linhas passaria verde com a
    // tabela concedida.
    esperaBarrado("anon", `select id from public.${TABELA}`);
  });

  it("`authenticated` é BARRADO ao ler", () => {
    esperaBarrado("authenticated", `select id from public.${TABELA}`);
  });

  it("`authenticated` é BARRADO ao escrever", () => {
    esperaBarrado(
      "authenticated",
      `insert into public.${TABELA} (id, app_name) values (1, 'invasor')`,
    );
  });

  it("os papéis EXISTEM e o `set role` funciona — guarda de vacuidade", () => {
    // Se `set role anon` falhasse por outro motivo (papel inexistente), os três
    // casos acima "passariam" com um erro que não fala de privilégio nenhum.
    expect(erroSob("anon", "select 1")).toBeNull();
    expect(erroSob("authenticated", "select 1")).toBeNull();
  });
});

describe("o contrato do schema", () => {
  it("RLS está LIGADA", () => {
    const ligada = sql(`
      select relrowsecurity from pg_class
       where oid = 'public.${TABELA}'::regclass;
    `).trim();
    expect(ligada).toBe("t");
  });

  it("e tem ZERO policies — é a forma explícita de dizer 'ninguém pelo PostgREST'", () => {
    // Uma policy aparecendo aqui não é melhoria: seria a decisão "esta tabela
    // passa a ser servida" tomada sem ninguém declarar. Quem precisar disso um
    // dia tem de mexer NESTE caso e explicar.
    const quantas = sql(`
      select count(*) from pg_policies
       where schemaname = 'public' and tablename = '${TABELA}';
    `).trim();
    expect(quantas).toBe("0");
  });

  it("NÃO é tenant-aware, e isso é decisão", () => {
    // A marca da INSTALAÇÃO pinta o login e o e-mail de recuperação — telas
    // anteriores a qualquer organização. Se `organization_id` aparecer aqui, a
    // tabela passa a precisar de policies e de linha no `rls-isolation.test.ts`,
    // e este caso é o que obriga essa conversa a acontecer.
    const tem = sql(`
      select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = '${TABELA}'
         and column_name = 'organization_id';
    `).trim();
    expect(tem).toBe("0");
  });

  it("é SINGLETON — a segunda linha é recusada pelo banco, não pela disciplina", () => {
    sql(`insert into public.${TABELA} (id, app_name) values (1, 'primeira');`);
    let erro: string | null = null;
    try {
      sql(`insert into public.${TABELA} (id, app_name) values (2, 'segunda');`);
    } catch (err) {
      erro = motivoDoErro(err);
    }
    expect(erro).toContain("platform_branding_singleton");
    sql(`delete from public.${TABELA};`);
  });

  it("`accent_hex` só aceita `#rrggbb` minúsculo — ou NULL", () => {
    // O CHECK é a razão pela qual a semeadura NORMALIZA antes de gravar: duas
    // grafias da mesma cor no banco fariam a pergunta "mudou?" mentir, e `#FFF`
    // cru derrubaria o INSERT com um 23514 que ninguém saberia ler.
    sql(`delete from public.${TABELA};`);
    sql(`insert into public.${TABELA} (id, accent_hex) values (1, '#ff00aa');`);
    sql(`update public.${TABELA} set accent_hex = null where id = 1;`);

    for (const ruim of ["#FFF", "#FFFFFF", "#ff00a", "ff00aa", "azul", "#ff00aa;"]) {
      let erro: string | null = null;
      try {
        sql(`update public.${TABELA} set accent_hex = '${ruim}' where id = 1;`);
      } catch (err) {
        erro = motivoDoErro(err);
      }
      expect(erro, `deveria recusar ${JSON.stringify(ruim)}`).toContain(
        "platform_branding_accent_hex",
      );
    }
    sql(`delete from public.${TABELA};`);
  });

  it("o trigger de `updated_at` está no lugar, uma vez só", () => {
    // "Uma vez só" porque o apêndice do baseline é RE-APLICADO no `update.sh` de
    // todo clone: um bloco que criasse o trigger sem `drop trigger if exists`
    // deixaria rastro na segunda aplicação.
    const quantos = sql(`
      select count(*) from pg_trigger
       where tgrelid = 'public.${TABELA}'::regclass
         and tgname = 'trg_platform_branding_touch'
         and not tgisinternal;
    `).trim();
    expect(quantos).toBe("1");
  });

  it("e ele de fato CARIMBA — existir não é funcionar", () => {
    sql(`delete from public.${TABELA};`);
    sql(`insert into public.${TABELA} (id, app_name) values (1, 'antes');`);
    const antes = sql(`select updated_at from public.${TABELA} where id = 1;`).trim();
    // O UPDATE em `sql()` SEPARADO de propósito: no mesmo script, o psql imprime
    // a tag de comando ("UPDATE 1") antes do resultado do select, e a asserção
    // compararia contra `"UPDATE 1\nt"`. Instrumento que mistura as duas saídas
    // reprova o banco certo — medido, foi o que aconteceu na primeira rodada.
    sql(`update public.${TABELA} set app_name = 'depois' where id = 1;`);
    // A comparação é feita PELO BANCO, contra o carimbo que o banco escreveu.
    // Comparar com um `Date.now()` do processo de teste seria confrontar dois
    // relógios diferentes por uma diferença medida em milissegundos.
    const maisNovo = sql(
      `select (select updated_at from public.${TABELA} where id = 1) > '${antes}'::timestamptz;`,
    ).trim();
    expect(maisNovo).toBe("t");
    sql(`delete from public.${TABELA};`);
  });
});
