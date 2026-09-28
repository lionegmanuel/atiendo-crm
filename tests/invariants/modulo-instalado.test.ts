/**
 * MÓDULO INSTALADO — D3 e D6 da ADR-0002 (migration 0340).
 *
 * D3: instalar um módulo NA INSTÂNCIA cria as tabelas dele na hora, pelo mesmo caminho já provado
 * das extensões (recibo, chave idempotente, `applied_now`, trava da atualização do núcleo).
 * D6: a atualização reaplica cada módulo instalado e, quando um falha, o marca `suspenso` E faz o
 * kit reportar erro — as duas coisas, que num comando só seriam contraditórias.
 *
 * Nenhum módulo real está na `main`: o mecanismo é provado com uma provisionadora de mentira,
 * escrita na forma que a D4 exige (sem parâmetro, `security definer`, só `service_role`, termina
 * em `fn_proteger_modulo_provisionado()`). Cada arquivo recebe um banco recém-clonado do baseline
 * (tests/db/banco-limpo-por-arquivo.ts), então o que se mede aqui é o `baseline.sql` do self-host.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { Pool, type Notification } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

if (!process.env.TEST_DB_PORT) throw new Error("TEST_DB_PORT ausente — execute pnpm test:db");
const pool = new Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT}/postgres`,
  max: 4,
});
const query = (text: string, values: unknown[] = []) => pool.query(text, values);

const plataforma = "e3400000-0000-4000-8000-000000000001";
const intruso = "e3400000-0000-4000-8000-000000000002";
const MODULO = "sondainst";
const TABELA = "sonda_inst_itens";

/**
 * A regra de erro benigno do kit, lida do PRÓPRIO kit — não copiada. Se alguém alargar a lista em
 * `_common.sh`, este arquivo mede contra a lista nova, e não contra a que existia quando foi escrito.
 */
const BENIGNOS = (() => {
  const fonte = readFileSync(path.join(process.cwd(), "hostgator-setup-kit/_common.sh"), "utf8");
  const achado = fonte.match(/^BASELINE_ERROS_BENIGNOS='([^']+)'/m);
  if (!achado?.[1]) throw new Error("BASELINE_ERROS_BENIGNOS não encontrado em hostgator-setup-kit/_common.sh");
  return new RegExp(achado[1], "i");
})();

/** O corpo de uma provisionadora bem-comportada. `falha` injeta o erro no lugar do schema. */
function provisionadora(corpo?: string): string {
  return `
    create or replace function public.fn_${MODULO}_provisionar()
    returns void language plpgsql security definer set search_path = public as $prov$
    begin
      ${
        corpo ??
        `create table if not exists public.${TABELA} (
           id uuid primary key default gen_random_uuid(),
           organization_id uuid not null references public.organizations(id) on delete cascade,
           total_cents bigint not null default 0
         );
         perform public.fn_proteger_modulo_provisionado();`
      }
    end $prov$;
    revoke execute on function public.fn_${MODULO}_provisionar() from public, anon, authenticated;
    grant execute on function public.fn_${MODULO}_provisionar() to service_role;`;
}

/** Chamada como o serviço do app faz: papel `service_role`, uma transação. */
async function instalar(operacao: string, modulo = MODULO, ator = plataforma): Promise<Record<string, unknown>> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("set local role service_role");
    const r = await c.query("select public.fn_modulo_instalar($1, $2, $3) as recibo", [ator, operacao, modulo]);
    await c.query("commit");
    return r.rows[0].recibo;
  } catch (erro) {
    await c.query("rollback");
    throw erro;
  } finally {
    c.release();
  }
}

async function estado(modulo = MODULO): Promise<{ estado: string; motivo_suspensao: string | null } | undefined> {
  const r = await query("select estado, motivo_suspensao from public.modulos_instalados where modulo = $1", [modulo]);
  return r.rows[0];
}

beforeAll(async () => {
  for (const id of [plataforma, intruso]) {
    await query("insert into auth.users(id, email) values ($1, $2) on conflict (id) do nothing", [id, `${id}@invariant.test`]);
  }
  await query(
    `insert into public.platform_admins(user_id, granted_by, scope, mfa_required, reason)
     values ($1, $1, 'full', false, 'Teste de módulo instalado')
     on conflict (user_id) do update set revoked_at = null, scope = 'full'`,
    [plataforma],
  );
});

afterAll(async () => {
  await pool.end();
});

describe("superfície: quem alcança o quê", () => {
  it("fn_modulo_instalar é só de service_role; reaplicar e conferir não são de ninguém", async () => {
    const r = await query(`
      select p.proname,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
             has_function_privilege('service_role', p.oid, 'execute') as service_role,
             p.prosecdef
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('fn_modulo_instalar', 'fn_reaplicar_modulos_instalados', 'fn_conferir_modulos_instalados')
       order by p.proname`);
    expect(r.rows).toEqual([
      { proname: "fn_conferir_modulos_instalados", anon: false, authenticated: false, service_role: false, prosecdef: false },
      { proname: "fn_modulo_instalar", anon: false, authenticated: false, service_role: true, prosecdef: true },
      { proname: "fn_reaplicar_modulos_instalados", anon: false, authenticated: false, service_role: false, prosecdef: false },
    ]);
  });

  it("modulos_instalados nasce com RLS e sem privilégio para anon nem authenticated", async () => {
    const r = await query(`
      select c.relrowsecurity,
             has_table_privilege('anon', c.oid, 'select, insert, update, delete') as anon,
             has_table_privilege('authenticated', c.oid, 'select, insert, update, delete') as authenticated
        from pg_class c where c.oid = 'public.modulos_instalados'::regclass`);
    expect(r.rows[0]).toEqual({ relrowsecurity: true, anon: false, authenticated: false });
  });

  it("instalação nova não tem módulo, e as duas chamadas do rodapé do baseline são no-op", async () => {
    expect((await query("select count(*)::int as n from public.modulos_instalados")).rows[0].n).toBe(0);
    await query("select public.fn_reaplicar_modulos_instalados()");
    await query("select public.fn_conferir_modulos_instalados()");
  });
});

describe("D3 — instalar cria as tabelas na hora", () => {
  beforeAll(async () => {
    await query(provisionadora());
  });

  it("recusa quem não é admin de plataforma, sem efeito nenhum", async () => {
    await expect(instalar(randomUUID(), MODULO, intruso)).rejects.toThrow("extension_forbidden");
    expect(await estado()).toBeUndefined();
    expect((await query("select to_regclass($1) as t", [`public.${TABELA}`])).rows[0].t).toBeNull();
  });

  it("recusa nome fora do formato e módulo cuja provisionadora não existe", async () => {
    await expect(instalar(randomUUID(), "Financeiro; drop table x")).rejects.toThrow("extension_invalid_input");
    const op = randomUUID();
    await expect(instalar(op, "naoexiste")).rejects.toThrow("extension_module_unknown");
    expect(await estado("naoexiste")).toBeUndefined();
    expect((await query("select count(*)::int as n from public.extension_operations where id = $1", [op])).rows[0].n).toBe(0);
  });

  it("recusa durante a atualização do núcleo", async () => {
    const run = (await query("insert into public.system_update_runs(requested_by) values ($1) returning id", [plataforma])).rows[0].id;
    const op = randomUUID();
    try {
      await expect(instalar(op)).rejects.toThrow("extension_core_update_in_progress");
      // Sem efeito medido pelo recibo DESTE pedido — e não pelo registro do módulo, que outro
      // caso pode ter preenchido: a sabotagem do ator mostrou esse acoplamento de ordem.
      expect((await query("select count(*)::int as n from public.extension_operations where id = $1", [op])).rows[0].n).toBe(0);
    } finally {
      await query("delete from public.system_update_runs where id = $1", [run]);
    }
  });

  it("instala: a tabela nasce protegida, o módulo fica ativo, o recibo é de plataforma e o PostgREST é avisado", async () => {
    const ouvinte = await pool.connect();
    const avisos: Notification[] = [];
    ouvinte.on("notification", (n) => avisos.push(n));
    await ouvinte.query("listen pgrst");
    const op = randomUUID();
    try {
      const recibo = await instalar(op);
      expect(recibo).toMatchObject({ id: op, kind: "module_install", status: "completed", name: MODULO, organization_id: null, applied_now: true });

      // O aviso chega no commit; dá um instante para o evento atravessar a conexão.
      for (let i = 0; i < 50 && !avisos.some((a) => a.payload === "reload schema"); i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(avisos.map((a) => a.payload)).toContain("reload schema");
    } finally {
      await ouvinte.query("unlisten pgrst");
      ouvinte.release();
    }

    const tabela = (
      await query(`
        select c.relrowsecurity,
               has_table_privilege('anon', c.oid, 'select') as anon,
               (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
          from pg_class c where c.oid = to_regclass($1)`, [`public.${TABELA}`])
    ).rows[0];
    expect(tabela).toEqual({ relrowsecurity: true, anon: false, policies: expect.any(Number) });
    expect(tabela.policies).toBeGreaterThan(0);
    expect(await estado()).toEqual({ estado: "ativo", motivo_suspensao: null });
  });

  it("repetir a mesma chave devolve o mesmo recibo sem reaplicar; a mesma chave com outro módulo é conflito", async () => {
    const op = randomUUID();
    const primeiro = await instalar(op);
    const segundo = await instalar(op);
    expect(segundo.applied_now).toBe(false);
    expect(segundo.id).toBe(primeiro.id);
    await expect(instalar(op, "outromodulo")).rejects.toThrow("extension_idempotency_conflict");
  });
});

describe("D6 — reaplicar na atualização falha alto", () => {
  beforeAll(async () => {
    await query(provisionadora());
    const existe = await estado();
    if (!existe) await instalar(randomUUID());
  });

  it("falha do módulo marca suspenso SEM relançar, e a conferência seguinte é o ERROR que o kit não engole", async () => {
    // O pior texto possível: o erro original casa com a lista de benignos do kit.
    await query(provisionadora(`raise exception 'relation "${TABELA}" already exists';`));

    // Comando 1 — como o kit o aplica, sozinho e confirmado: não pode falhar.
    await query("do $f$ begin perform public.fn_reaplicar_modulos_instalados(); end $f$");
    const suspenso = await estado();
    expect(suspenso?.estado).toBe("suspenso");
    expect(suspenso?.motivo_suspensao).toMatch(/already exists/);

    // Comando 2 — separado. Ele falha, e a marca do comando 1 continua de pé.
    let mensagem = "";
    await query("do $f$ begin perform public.fn_conferir_modulos_instalados(); end $f$").catch((e: Error) => {
      mensagem = e.message;
    });
    expect(mensagem).toContain(MODULO);
    expect(BENIGNOS.test(mensagem)).toBe(false);
    expect((await estado())?.estado).toBe("suspenso");
  });

  it("disputa de trava NÃO suspende: relança com o texto que faz o kit aplicar de novo", async () => {
    await query(provisionadora());
    await query("select public.fn_reaplicar_modulos_instalados()");
    expect((await estado())?.estado).toBe("ativo");

    await query(provisionadora(`raise exception using errcode = '40P01', message = 'deadlock detected';`));
    await expect(query("select public.fn_reaplicar_modulos_instalados()")).rejects.toThrow(/deadlock detected/);
    expect((await estado())?.estado).toBe("ativo");
  });

  it("provisionadora que sumiu da versão nova também suspende", async () => {
    await query(`drop function public.fn_${MODULO}_provisionar()`);
    await query("select public.fn_reaplicar_modulos_instalados()");
    expect(await estado()).toMatchObject({ estado: "suspenso", motivo_suspensao: expect.stringContaining("não existe") });
  });

  it("consertada a provisionadora, a próxima reaplicação reativa e a conferência fica muda", async () => {
    await query(provisionadora());
    await query("select public.fn_reaplicar_modulos_instalados()");
    expect(await estado()).toEqual({ estado: "ativo", motivo_suspensao: null });
    await query("select public.fn_conferir_modulos_instalados()");
  });
});
