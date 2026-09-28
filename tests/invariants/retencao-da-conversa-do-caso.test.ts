/**
 * O PISO DA RETENÇÃO DA CONVERSA DO CASO VALE PARA QUEM CHAMA — migration 0281.
 *
 * ## O que este arquivo mede que o estático não mede
 *
 * `tests/unit/retencao-todo-piso-tem-dono.test.ts` casa o par do TypeScript com
 * o TEXTO `greatest(coalesce(p_retencao_dias, 365), 90)` dentro do corpo da
 * função no `baseline.sql`. É uma prova de SÍMBOLO: ela não distingue um piso
 * que está escrito de um piso que está escrito e ignorado — bastaria alguém usar
 * `p_retencao_dias` cru na cláusula `where` logo abaixo para o texto continuar lá
 * e o piso não valer para nada.
 *
 * Aqui a função REAL roda contra linhas REAIS, e o que se mede é quem sobrou.
 *
 * ## Por que o piso importa mais que o default
 *
 * O default (365) protege quem nunca editou `.env`. O piso protege de quem
 * editou: `CASE_CHAT_RETENTION_DAYS=1`, digitado às 2h por alguém tentando
 * liberar espaço, apagaria a deliberação da semana passada sobre um caso ainda
 * aberto. E o piso mora DENTRO da função, não no TypeScript, porque só lá ele
 * vale para QUALQUER chamador — inclusive um `psql` na mão, que é exatamente o
 * que este arquivo faz para prová-lo.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./psql-transporte";

const ORG = "02810002-0000-4000-8000-000000000001";
const SESSAO = "02810002-2222-4000-8000-000000000001";
const CONTATO = "02810002-3333-4000-8000-000000000001";
const CONVERSA = "02810002-4444-4000-8000-000000000001";
const CASO = "02810002-5555-4000-8000-000000000001";

function valor(consulta: string): number {
  const saida = sql(consulta).trim().split("\n").at(-1) ?? "";
  if (!/^-?\d+$/.test(saida)) throw new Error(`saída inesperada do psql: ${saida}`);
  return Number(saida);
}

function quantasRestam(): number {
  return valor(
    `select count(*) from public.agent_case_chat_messages where organization_id = '${ORG}';`,
  );
}

/** Repõe a semente: N linhas com a idade pedida, em dias. */
function semear(quantas: number, idadeDias: number): void {
  sql(`
    delete from public.agent_case_chat_messages where organization_id = '${ORG}';
    insert into public.agent_case_chat_messages
      (organization_id, case_id, conversation_id, contact_id, turn_id, author_kind, body, created_at)
    select '${ORG}', '${CASO}', '${CONVERSA}', '${CONTATO}', gen_random_uuid(), 'human',
           'deliberação nº ' || i, now() - make_interval(days => ${idadeDias})
      from generate_series(1, ${quantas}) as i;
  `);
}

beforeAll(() => {
  sql(`
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG}', 'chat-0281-retencao', 'Chat 0281 Retencao', 'Chat 0281 Retencao')
      on conflict do nothing;
    do $seed$ begin
      insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
        values ('${SESSAO}', '${ORG}', 'chat-0281-retencao', '\\x00'::bytea);
    exception when unique_violation then null; end $seed$;
    insert into public.contacts (id, organization_id, display_name)
      values ('${CONTATO}', '${ORG}', 'Chat 0281 Retencao Contato') on conflict do nothing;
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status)
      values ('${CONVERSA}', '${ORG}', '${CONTATO}', '${SESSAO}', 'open') on conflict do nothing;
    insert into public.agent_cases (id, organization_id, conversation_id, title, summary, blocker)
      values ('${CASO}', '${ORG}', '${CONVERSA}', 'Caso da retenção', 'Resumo', 'Bloqueio')
      on conflict do nothing;
  `);
});

describe("0281 — fn_expurgar_conversa_do_caso_vencida", () => {
  it("CONTROLE POSITIVO: a função existe e devolve inteiro", () => {
    // Sem isto, uma função ausente faria os casos de "não apagou" passarem por
    // vacuidade — zero apagados é verdade quando nada roda.
    expect(valor(`select public.fn_expurgar_conversa_do_caso_vencida(365, 100)`)).toBeGreaterThanOrEqual(0);
  });

  it("apaga o que passou dos 365 dias e NÃO toca no que é recente", () => {
    semear(3, 400);
    sql(`
      insert into public.agent_case_chat_messages
        (organization_id, case_id, conversation_id, contact_id, turn_id, author_kind, body, created_at)
      select '${ORG}', '${CASO}', '${CONVERSA}', '${CONTATO}', gen_random_uuid(), 'human',
             'recente', now() - interval '10 days';
    `);
    // Se a regra fosse só "apagar", as quatro sairiam juntas. É o corte por
    // idade que este caso mede, e a linha recente é o controle dele.
    expect(valor(`select public.fn_expurgar_conversa_do_caso_vencida(null, 1000)`)).toBe(3);
    expect(quantasRestam()).toBe(1);
  });

  it("O PISO VALE PARA QUEM CHAMA: pedir 1 dia não apaga o que tem 30", () => {
    // ⚠️ A idade da fixture é o que este caso mede, e a primeira versão errava a
    // conta: ela semeava 30 dias? NÃO — semeava 100, que JÁ passou do piso de
    // 90, e então o expurgo apagava as duas CORRETAMENTE enquanto o teste lia
    // aquilo como "o piso foi ignorado". A linha tem de ser mais nova que o
    // piso: 30 dias passou de 1 (o que o chamador pediu) e não passou de 90 (o
    // que o piso impõe). É a única medição que distingue "o piso está escrito"
    // de "o piso está em vigor".
    semear(2, 30);
    expect(
      valor(`select public.fn_expurgar_conversa_do_caso_vencida(1, 1000)`),
      "o piso de 90 dias foi ignorado — o knob do operador virou apagador de rastro recente",
    ).toBe(0);
    expect(quantasRestam()).toBe(2);
  });

  it("o piso NÃO impede o expurgo legítimo (a recíproca)", () => {
    // Sem este caso, uma função que nunca apagasse nada passaria no anterior. O
    // que se quer é o piso elevando o número do operador, não o expurgo morto.
    semear(2, 120);
    expect(valor(`select public.fn_expurgar_conversa_do_caso_vencida(1, 1000)`)).toBe(2);
    expect(quantasRestam()).toBe(0);
  });

  it("o LOTE é respeitado — o cron drena em rodadas, não de uma vez", () => {
    // Um DELETE grande num banco de cliente trava a tabela, e o tempo do lock
    // cresce com o backlog. O laço de `app/api/v1/cron/data-retention` conta com
    // o lote incompleto para saber que a ponta velha acabou.
    semear(5, 400);
    expect(valor(`select public.fn_expurgar_conversa_do_caso_vencida(365, 2)`)).toBe(2);
    expect(quantasRestam()).toBe(3);
    expect(valor(`select public.fn_expurgar_conversa_do_caso_vencida(365, 2)`)).toBe(2);
    expect(valor(`select public.fn_expurgar_conversa_do_caso_vencida(365, 2)`)).toBe(1);
    expect(quantasRestam()).toBe(0);
  });

  it("`anon` e `authenticated` NÃO executam a função", () => {
    // Função nova em `public` nasce EXPOSTA pelas DUAS origens (o
    // `ALTER DEFAULT PRIVILEGES … TO anon` do baseline e o grant implícito a
    // PUBLIC). Um expurgo alcançável pela anon key — que vai para o browser —
    // seria um apagador de rastro à disposição de qualquer visitante.
    const permissoes = sql(`
      select coalesce(string_agg(grantee, ',' order by grantee), '<nenhum>')
        from information_schema.role_routine_grants
       where routine_schema = 'public'
         and routine_name = 'fn_expurgar_conversa_do_caso_vencida'
         and privilege_type = 'EXECUTE';
    `)
      .trim()
      .split("\n")
      .at(-1);
    expect(permissoes, "sonda cega: nenhum grant lido da função").not.toBe("");
    expect(permissoes).not.toContain("anon");
    expect(permissoes).not.toContain("authenticated");
    expect(permissoes).toContain("service_role");
  });
});
