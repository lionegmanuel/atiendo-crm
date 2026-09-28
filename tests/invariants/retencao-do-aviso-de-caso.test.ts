/**
 * O EXPURGO DO REGISTRO DE ENTREGA TEM PISO E TEM LIMITE — migration 0292.
 *
 * ## O que este arquivo mede que o estático não mede
 *
 * `tests/unit/retencao-todo-piso-tem-dono.test.ts` casa o par do TypeScript com
 * o TEXTO `greatest(coalesce(p_retencao_dias, 180), 30)` dentro do corpo da
 * função no `baseline.sql`. É prova de SÍMBOLO: ela não distingue um piso que
 * está escrito de um piso que está escrito e IGNORADO — bastaria usar
 * `p_retencao_dias` cru na cláusula `where` logo abaixo para o texto continuar
 * lá e o piso não valer para nada.
 *
 * Aqui a função REAL roda contra linhas REAIS, e o que se mede é quem sobrou.
 *
 * ## Por que o piso desta tabela é o mais baixo dos seis (30, e não 90)
 *
 * Os 90 dias da auditoria e da passagem existem para o knob não virar apagador
 * de RASTRO LEGAL. Aqui o rastro é operacional e a linha não guarda texto
 * nenhum (só um resumo criptográfico do corpo): o que o piso protege é o
 * incidente em apuração — "por que a equipe não foi avisada na semana passada?"
 * é pergunta de dias, e um mês é o mínimo em que ela ainda se faz.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./psql-transporte";

const ORG = "02920002-0000-4000-8000-000000000001";
const SESSAO = "02920002-2222-4000-8000-000000000001";
const CONTATO = "02920002-3333-4000-8000-000000000001";
const CONVERSA = "02920002-4444-4000-8000-000000000001";
const CASO = "02920002-5555-4000-8000-000000000001";

function valor(consulta: string): number {
  const saida = sql(consulta).trim().split("\n").at(-1) ?? "";
  if (!/^-?\d+$/.test(saida)) throw new Error(`saída inesperada do psql: ${saida}`);
  return Number(saida);
}

function quantasRestam(): number {
  return valor(
    `select count(*) from public.entregas_de_aviso_de_caso where organization_id = '${ORG}';`,
  );
}

/**
 * Repõe a semente: N linhas com a idade pedida.
 *
 * A `unique (organization_id, case_id, destino)` obriga um DESTINO distinto por
 * linha — é a mesma chave que dá a idempotência do envio, e semear com destino
 * repetido faria `generate_series` estourar `23505` em vez de medir retenção.
 */
function semear(quantas: number, idadeDias: number): void {
  sql(`
    delete from public.entregas_de_aviso_de_caso where organization_id = '${ORG}';
    insert into public.entregas_de_aviso_de_caso
      (organization_id, case_id, destino, channel_session_id, status, created_at)
    select '${ORG}', '${CASO}', '+55319' || lpad(i::text, 8, '0'), '${SESSAO}', 'enviado',
           now() - make_interval(days => ${idadeDias})
      from generate_series(1, ${quantas}) as i;
  `);
}

beforeAll(() => {
  sql(`
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG}', 'aviso-0292-retencao', 'Aviso 0292 Retencao', 'Aviso 0292 Retencao')
      on conflict do nothing;
    do $seed$ begin
      insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
        values ('${SESSAO}', '${ORG}', 'aviso-0292-retencao', '\\x00'::bytea);
    exception when unique_violation then null; end $seed$;
    insert into public.contacts (id, organization_id, display_name)
      values ('${CONTATO}', '${ORG}', 'Aviso 0292 Retencao Contato') on conflict do nothing;
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status)
      values ('${CONVERSA}', '${ORG}', '${CONTATO}', '${SESSAO}', 'open') on conflict do nothing;
    insert into public.agent_cases (id, organization_id, conversation_id, status, source, title, summary, blocker)
      values ('${CASO}', '${ORG}', '${CONVERSA}', 'awaiting_human', 'agent', 'Aviso 0292 Retencao Caso', 'resumo do caso', 'o que travou')
      on conflict do nothing;
  `);
});

describe("0292 — fn_expurgar_avisos_de_caso_vencidos", () => {
  it("CONTROLE POSITIVO: a função existe e devolve inteiro", () => {
    // Sem isto, uma função ausente faria os casos de "não apagou" passarem por
    // vacuidade — zero apagados é verdade quando nada roda.
    expect(valor(`select public.fn_expurgar_avisos_de_caso_vencidos(180, 100)`)).toBeGreaterThanOrEqual(0);
  });

  it("apaga o que passou dos 180 dias e NÃO toca no que é recente", () => {
    semear(3, 400);
    sql(`
      insert into public.entregas_de_aviso_de_caso
        (organization_id, case_id, destino, channel_session_id, status, created_at)
      values ('${ORG}', '${CASO}', '+5531900000999', '${SESSAO}', 'enviado', now() - interval '10 days');
    `);
    // Se a regra fosse só "apagar", as quatro sairiam juntas. É o corte por
    // idade que este caso mede, e a linha recente é o controle dele.
    expect(valor(`select public.fn_expurgar_avisos_de_caso_vencidos(null, 1000)`)).toBe(3);
    expect(quantasRestam()).toBe(1);
  });

  it("O PISO VALE PARA QUEM CHAMA: pedir 1 dia não apaga o que tem 10", () => {
    semear(2, 10);
    // 10 dias já passou de 1 e não passou de 30 — com o piso ignorado, as duas
    // sairiam. É a única medição que distingue "o piso está escrito" de "o piso
    // está em vigor", e ela vale para QUALQUER chamador, inclusive um `psql`.
    expect(
      valor(`select public.fn_expurgar_avisos_de_caso_vencidos(1, 1000)`),
      "o piso de 30 dias foi ignorado — o knob do operador virou apagador de rastro recente",
    ).toBe(0);
    expect(quantasRestam()).toBe(2);
  });

  it("O LOTE É RESPEITADO: 5 vencidas com limite 2 apagam 2", () => {
    semear(5, 400);
    // O cron chama em lotes para o lock não ser sentido por quem está usando o
    // sistema. Um `limit` decorativo apagaria as cinco de uma vez e o laço do
    // cron nunca saberia — o tempo de lock cresce com o backlog.
    expect(valor(`select public.fn_expurgar_avisos_de_caso_vencidos(180, 2)`)).toBe(2);
    expect(quantasRestam()).toBe(3);
  });

  it("apaga a ENTREGA e não o caso — o atendimento sobrevive à poda do aviso", () => {
    semear(2, 400);
    valor(`select public.fn_expurgar_avisos_de_caso_vencidos(180, 1000)`);
    expect(
      valor(`select count(*) from public.agent_cases where id = '${CASO}'`),
      "o expurgo do registro de entrega levou o caso junto",
    ).toBe(1);
  });
});
