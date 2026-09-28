import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * O HISTÓRICO DE CAPTAÇÃO NÃO VAZA ENTRE ORGANIZAÇÕES — E TAMBÉM NÃO VAZA
 * PARA DENTRO DA PRÓPRIA ORGANIZAÇÃO.
 *
 * ═══ Por que um arquivo próprio, e não uma linha em rls-isolation.test.ts ═══
 *
 * Porque aquele molde não sabe medir gate de PAPEL. Ele semeia um usuário
 * `agent` por organização e prova duas coisas por tabela: zero linhas do
 * vizinho, e mais de zero linhas próprias (controle positivo). Numa tabela cuja
 * policy exige `manager`, o controle positivo falharia por acerto — e a
 * "correção" natural seria afrouxar a policy para caber no teste, que é
 * exatamente o defeito de trás para frente.
 *
 * ═══ O que este arquivo prova, e por que a terceira asserção é a que importa ═══
 *
 * `webhook_lead_captures.fields` guarda o formulário como a pessoa preencheu:
 * nome, telefone, e-mail e o que mais o site mandar. A policy de
 * `webhook_events_log` — a tabela que quase virou o histórico — é org-flat sem
 * gate de papel, então hoje qualquer `viewer` lê aquela PII direto pelo
 * PostgREST com a anon key + o JWT dele, mesmo com a rota HTTP exigindo
 * `manager`. A rota não é a única porta.
 *
 * Então não basta provar isolamento entre tenants: o caso do `viewer` é o que
 * distingue esta tabela daquela, e é ele que reprova se alguém "simplificar" a
 * policy para o padrão org-flat do resto do repo.
 *
 * Conectar como `postgres` mediria NADA (rolbypassrls = t). Aqui é `set role
 * authenticated` + `request.jwt.claims`, o mesmo caminho que a produção usa.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error(
    "TEST_DB_CONTAINER not set — rode esta suíte via `pnpm test:db` (scripts/test-db.sh)",
  );
}
const containerName: string = container;

function sql(script: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", containerName, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tA", "-f", "-"],
    { input: script, encoding: "utf8" },
  ).trim();
}

function countAs(userId: string, countQuery: string): number {
  const out = sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
    ${countQuery}
  `);
  const lines = out.split("\n");
  const last = lines[lines.length - 1];
  if (last === undefined || !/^\d+$/.test(last)) {
    throw new Error(`saída inesperada do psql: ${out}`);
  }
  return Number(last);
}

// UUIDs próprios (não os de rls-isolation) para os dois arquivos poderem rodar
// na mesma base sem disputar as mesmas linhas.
const ORG_A = "cccccccc-0000-4000-8000-00000000000a";
const ORG_B = "cccccccc-0000-4000-8000-00000000000b";
const MANAGER_A = "cccccccc-1111-4000-8000-00000000000a";
const VIEWER_A = "cccccccc-1111-4000-8000-00000000000c";
const MANAGER_B = "cccccccc-1111-4000-8000-00000000000b";

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${MANAGER_A}', 'captacao-mgr-a@invariant.test'),
      ('${VIEWER_A}',  'captacao-viewer-a@invariant.test'),
      ('${MANAGER_B}', 'captacao-mgr-b@invariant.test')
      on conflict (id) do nothing;

    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'captacao-inv-a', 'Captacao Invariant A', 'Captacao A'),
      ('${ORG_B}', 'captacao-inv-b', 'Captacao Invariant B', 'Captacao B')
      on conflict (id) do nothing;

    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${MANAGER_A}', '${ORG_A}', 'manager', now()),
      ('${VIEWER_A}',  '${ORG_A}', 'viewer',  now()),
      ('${MANAGER_B}', '${ORG_B}', 'manager', now())
      on conflict do nothing;

    -- Uma captação por organização, com PII sintética.
    insert into public.webhook_lead_captures
      (organization_id, source_name, outcome, captured_name, captured_phone, fields, remote_ip)
    select v.org, 'Landing do invariante', 'criado', 'Fulano Sintetico', '+5511900000000',
           '{"segmento":"clinica"}'::jsonb, '203.0.113.7'::inet
      from (values ('${ORG_A}'::uuid), ('${ORG_B}'::uuid)) as v(org)
     where not exists (
       select 1 from public.webhook_lead_captures w where w.organization_id = v.org
     );
  `);
});

describe("webhook_lead_captures — isolamento e gate de papel", () => {
  it("o manager da org A lê as captações da PRÓPRIA org (controle positivo)", () => {
    const proprias = countAs(
      MANAGER_A,
      `select count(*) from public.webhook_lead_captures where organization_id = '${ORG_A}';`,
    );
    expect(proprias).toBeGreaterThan(0);
  });

  it("o manager da org A lê ZERO captações da org B", () => {
    const vizinha = countAs(
      MANAGER_A,
      `select count(*) from public.webhook_lead_captures where organization_id = '${ORG_B}';`,
    );
    expect(vizinha).toBe(0);
  });

  it("o manager da org A não alcança nenhuma linha da tabela inteira além das suas", () => {
    // Sem filtro de organização: é assim que um cliente do PostgREST pediria a
    // tabela toda. O total visível tem que ser exatamente o das próprias.
    const total = countAs(MANAGER_A, `select count(*) from public.webhook_lead_captures;`);
    const proprias = countAs(
      MANAGER_A,
      `select count(*) from public.webhook_lead_captures where organization_id = '${ORG_A}';`,
    );
    expect(total).toBe(proprias);
  });

  it("o VIEWER da própria org não lê o formulário — é o que distingue esta tabela do arquivo forense", () => {
    const doViewer = countAs(
      VIEWER_A,
      `select count(*) from public.webhook_lead_captures where organization_id = '${ORG_A}';`,
    );
    expect(doViewer).toBe(0);
  });

  it("o manager da org B lê as dele (controle positivo do outro lado)", () => {
    const proprias = countAs(
      MANAGER_B,
      `select count(*) from public.webhook_lead_captures where organization_id = '${ORG_B}';`,
    );
    expect(proprias).toBeGreaterThan(0);
  });

  it("ninguém com sessão consegue ESCREVER: não há policy de insert", () => {
    // A escrita é do service role (a rota pública de captação), que bypassa RLS.
    // Um `authenticated` que consiga inserir aqui forjaria histórico de origem —
    // e origem é o que este histórico existe para responder.
    //
    // A prova é por CONTAGEM, não por capturar a mensagem do erro: `raise
    // notice` sai em stderr, e o `execFileSync` acima lê só stdout. A primeira
    // versão deste caso fazia isso e passava a impressão de medir — o teste
    // reprovou por instrumento cego, não por RLS frouxa. Contar a linha depois
    // não tem esse ponto cego: ou ela existe, ou não.
    sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${MANAGER_A}"}', false);
      do $$
      begin
        insert into public.webhook_lead_captures (organization_id, source_name, outcome)
          values ('${ORG_A}', 'forjada pela sessão', 'criado');
      exception when others then
        null; -- a recusa é o esperado; quem decide é a contagem abaixo
      end
      $$;
    `);

    // Conta como superusuário (reset role): se a linha entrou, ela está lá,
    // mesmo que a sessão que a inseriu não conseguisse relê-la.
    const forjadas = sql(`
      reset role;
      select count(*) from public.webhook_lead_captures where source_name = 'forjada pela sessão';
    `);
    expect(forjadas.split("\n").pop()).toBe("0");
  });
});
