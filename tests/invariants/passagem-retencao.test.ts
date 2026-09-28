/**
 * O EXPURGO DA PASSAGEM TEM PISO E TEM LIMITE — migration 0291.
 *
 * ## O que este arquivo mede que o estático não mede
 *
 * `tests/unit/retencao-todo-piso-tem-dono.test.ts` casa o par do TypeScript com
 * o TEXTO `greatest(coalesce(p_retencao_dias, 1825), 90)` dentro do corpo da
 * função no `baseline.sql`. É prova de SÍMBOLO: ela não distingue um piso que
 * está escrito de um piso que está escrito e IGNORADO — bastaria usar
 * `p_retencao_dias` cru na cláusula `where` logo abaixo para o texto continuar
 * lá e o piso não valer para nada.
 *
 * Aqui a função REAL roda contra linhas REAIS, e o que se mede é quem sobrou.
 *
 * ## A guarda que só esta tabela tem
 *
 * `fn_expurgar_passagens_vencidas` só apaga linha com `reconhecido_em is not
 * null`. Uma passagem em aberto é uma pessoa esperando resposta que ninguém
 * assumiu: apagá-la por idade seria o expurgo virando esquecedor de pendência, e
 * o único registro de que alguém ficou sem resposta sumiria junto. É a diferença
 * entre esta função e as outras cinco do cron, e por isso ela tem caso próprio —
 * com a recíproca ao lado, senão uma função que nunca apagasse nada passaria.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./psql-transporte";

const ORG = "02910002-0000-4000-8000-000000000001";
const SESSAO = "02910002-2222-4000-8000-000000000001";
const CONTATO = "02910002-3333-4000-8000-000000000001";
const CONVERSA = "02910002-4444-4000-8000-000000000001";

function valor(consulta: string): number {
  const saida = sql(consulta).trim().split("\n").at(-1) ?? "";
  if (!/^-?\d+$/.test(saida)) throw new Error(`saída inesperada do psql: ${saida}`);
  return Number(saida);
}

function quantasRestam(): number {
  return valor(
    `select count(*) from public.passagens_de_atendimento where organization_id = '${ORG}';`,
  );
}

/** Repõe a semente: N linhas com a idade pedida, reconhecidas ou não. */
function semear(quantas: number, idadeDias: number, reconhecida: boolean): void {
  sql(`
    delete from public.passagens_de_atendimento where organization_id = '${ORG}';
    insert into public.passagens_de_atendimento
      (organization_id, contact_id, conversation_id, motor, origem, motivo_codigo,
       body, criado_em, reconhecido_em)
    select '${ORG}', '${CONTATO}', '${CONVERSA}', 'engine', 'pedido_explicito',
           'requested_human', 'briefing nº ' || i,
           now() - make_interval(days => ${idadeDias}),
           ${reconhecida ? `now() - make_interval(days => ${idadeDias})` : "null"}
      from generate_series(1, ${quantas}) as i;
  `);
}

beforeAll(() => {
  sql(`
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG}', 'passagem-0291-retencao', 'Passagem 0291 Retencao', 'Passagem 0291 Retencao')
      on conflict do nothing;
    do $seed$ begin
      insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
        values ('${SESSAO}', '${ORG}', 'passagem-0291-retencao', '\\x00'::bytea);
    exception when unique_violation then null; end $seed$;
    insert into public.contacts (id, organization_id, display_name)
      values ('${CONTATO}', '${ORG}', 'Passagem 0291 Retencao Contato') on conflict do nothing;
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status)
      values ('${CONVERSA}', '${ORG}', '${CONTATO}', '${SESSAO}', 'open') on conflict do nothing;
  `);
});

describe("0291 — fn_expurgar_passagens_vencidas", () => {
  it("CONTROLE POSITIVO: a função existe e devolve inteiro", () => {
    // Sem isto, uma função ausente faria os casos de "não apagou" passarem por
    // vacuidade — zero apagados é verdade quando nada roda.
    expect(valor(`select public.fn_expurgar_passagens_vencidas(1825, 100)`)).toBeGreaterThanOrEqual(0);
  });

  it("apaga o que passou dos 1825 dias e NÃO toca no que é recente", () => {
    semear(3, 2000, true);
    sql(`
      insert into public.passagens_de_atendimento
        (organization_id, contact_id, conversation_id, motor, origem, motivo_codigo,
         body, criado_em, reconhecido_em)
      values ('${ORG}', '${CONTATO}', '${CONVERSA}', 'engine', 'pedido_explicito',
              'requested_human', 'recente', now() - interval '10 days', now());
    `);
    // Se a regra fosse só "apagar", as quatro sairiam juntas. É o corte por
    // idade que este caso mede, e a linha recente é o controle dele.
    expect(valor(`select public.fn_expurgar_passagens_vencidas(null, 1000)`)).toBe(3);
    expect(quantasRestam()).toBe(1);
  });

  it("PASSAGEM NÃO RECONHECIDA NUNCA É APAGADA, em nenhuma idade", () => {
    // A guarda que só esta função tem. Dez anos de idade, o dobro da retenção
    // pedida — e ela fica, porque ninguém assumiu aquele atendimento. Sem esta
    // linha no `where`, o expurgo apagaria a única evidência de que alguém falou
    // com a empresa e não recebeu resposta.
    semear(4, 3650, false);
    expect(
      valor(`select public.fn_expurgar_passagens_vencidas(90, 1000)`),
      "o expurgo apagou passagem que ninguém reconheceu — uma pendência sumiu do sistema",
    ).toBe(0);
    expect(quantasRestam()).toBe(4);
  });

  it("O PISO VALE PARA QUEM CHAMA: pedir 1 dia não apaga o que tem 30", () => {
    semear(2, 30, true);
    // 30 dias já passou de 1 e não passou de 90 — com o piso ignorado, as duas
    // sairiam. É a única medição que distingue "o piso está escrito" de "o piso
    // está em vigor".
    expect(
      valor(`select public.fn_expurgar_passagens_vencidas(1, 1000)`),
      "o piso de 90 dias foi ignorado — o knob do operador virou apagador de rastro recente",
    ).toBe(0);
    expect(quantasRestam()).toBe(2);
  });

  it("o piso NÃO impede o expurgo legítimo (a recíproca)", () => {
    // Sem este caso, uma função que nunca apagasse nada passaria nos dois
    // anteriores. O que se quer é o piso elevando o número do operador, não o
    // expurgo morto.
    semear(2, 120, true);
    expect(valor(`select public.fn_expurgar_passagens_vencidas(1, 1000)`)).toBe(2);
    expect(quantasRestam()).toBe(0);
  });

  it("o LOTE é respeitado — o cron drena em rodadas, não de uma vez", () => {
    // Um DELETE grande num banco de cliente trava a tabela, e o tempo do lock
    // cresce com o backlog. O laço de `app/api/v1/cron/data-retention` conta com
    // o lote incompleto para saber que a ponta velha acabou.
    semear(5, 2000, true);
    expect(valor(`select public.fn_expurgar_passagens_vencidas(1825, 2)`)).toBe(2);
    expect(quantasRestam()).toBe(3);
    expect(valor(`select public.fn_expurgar_passagens_vencidas(1825, 2)`)).toBe(2);
    expect(valor(`select public.fn_expurgar_passagens_vencidas(1825, 2)`)).toBe(1);
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
         and routine_name = 'fn_expurgar_passagens_vencidas'
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
