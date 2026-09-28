import { beforeAll, describe, expect, it } from "vitest";

import { GOV_ORG, GOV_MANAGER, GOV_SESSION, lastLine, seedGov, sql } from "./gov-helpers";

/**
 * O LAÇO DE RETORNO DA PASSAGEM — invariante 7 do sistema vivo (migration 0294).
 *
 * ## A pergunta que este arquivo guarda
 *
 * *Depois de a IA passar a conversa, o cliente precisou repetir o que já tinha
 * dito?* É a única medida que diz se o cartão da passagem serviu para alguma
 * coisa: se o briefing chegou a quem assumiu, a repetição cai; se não chegou,
 * ela não muda — e a feature é decoração cara.
 *
 * ## Por que aqui e não num unitário
 *
 * O número sai de uma agregação SQL que cruza `passagens_de_atendimento` com
 * `messages` duas vezes (antes e depois) e chama `fn_atrito_jaccard`. Um dublê
 * provaria que a rota chama a função; só o Postgres prova que a agregação
 * agrega — e o `tsc` não vigia nome de RPC (medido: um `rpc("fn_inexistente")`
 * passa no `--noEmit` sem uma linha de erro).
 *
 * ## A RÉGUA, que é fixa e é o que torna o número comparável
 *
 *   · limiar      = `p_repeticao_min` (0.7), o MESMO do índice de repergunta;
 *   · janela      = 24 h depois da passagem;
 *   · denominador = passagens em que o cliente VOLTOU A FALAR.
 *
 * O último item é o que impede o número bonito: contar como "não repetiu" a
 * passagem em que ninguém voltou a falar infla a medida para o lado que agrada.
 * Ausência de dado é `null` (calculado na borda, a partir do denominador zero),
 * nunca `0`.
 *
 * ⚠️ Sem crase nesta prosa nem nos comentários SQL abaixo: o bloco inteiro é um
 * template literal de JS, e uma crase dentro dele derruba o `tsc` com TS1005 —
 * lição já paga duas vezes nesta entrega.
 */

const ORG_VIZ = "b1b10000-0000-4000-8000-000000000001";
const SESSION_VIZ = "b1b10000-0000-4000-8000-0000000000ff";

/** Um contato por conversa: conversations tem unique (org, contato, sessao). */
const CT_REPETIU = "b1b11111-0000-4000-8000-000000000001";
const CT_MUDOU = "b1b11111-0000-4000-8000-000000000002";
const CT_CALADO = "b1b11111-0000-4000-8000-000000000003";
const CT_TARDE = "b1b11111-0000-4000-8000-000000000004";
const CT_VIZ = "b1b11111-0000-4000-8000-000000000005";

const CV_REPETIU = "b1b12222-0000-4000-8000-000000000001";
const CV_MUDOU = "b1b12222-0000-4000-8000-000000000002";
const CV_CALADO = "b1b12222-0000-4000-8000-000000000003";
const CV_TARDE = "b1b12222-0000-4000-8000-000000000004";
const CV_VIZ = "b1b12222-0000-4000-8000-000000000005";

/** Janela FIXA — nada depende de now(), então a fixture não envelhece. */
const DE = "2026-05-01T00:00:00Z";
const ATE = "2026-06-01T00:00:00Z";
const PASSAGEM_EM = "2026-05-10T12:00:00Z";

const FALA_ORIGINAL = "preciso trocar o produto que comprou com defeito na semana passada";
/** Quase igual: Jaccard acima de 0.7. */
const FALA_REPETIDA = "preciso trocar o produto que comprou com defeito na semana passada mesmo";
/** Outro vocabulário sobre o mesmo tema: abaixo do limiar, de propósito. */
const FALA_DIFERENTE = "qual horario voces abrem amanha";

function atritoComo(userId: string, org: string): Record<string, Record<string, number | null>> {
  const out = sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
    select public.fn_atrito_metrics('${org}'::uuid, '${DE}'::timestamptz, '${ATE}'::timestamptz);
  `);
  return JSON.parse(lastLine(out));
}

/**
 * Semeia UMA conversa com fala antes da passagem, a passagem, e (talvez) uma
 * fala depois. Tudo em texto, para a semente ser lida como a história que ela é.
 */
function cenario(input: {
  contato: string;
  conversa: string;
  nome: string;
  falaDepois: string | null;
  depoisEm?: string;
}): string {
  const depois =
    input.falaDepois === null
      ? ""
      : `insert into public.messages
           (organization_id, conversation_id, channel_session_id, contact_id, type,
            direction, status, sent_via, body, sent_at)
         values ('${GOV_ORG}', '${input.conversa}', '${GOV_SESSION}', '${input.contato}', 'text',
                 'inbound', 'received', 'ai', '${input.falaDepois}',
                 '${input.depoisEm ?? "2026-05-10T13:00:00Z"}');`;
  return `
    insert into public.contacts (id, organization_id, display_name)
      values ('${input.contato}', '${GOV_ORG}', '${input.nome}');
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status)
      values ('${input.conversa}', '${GOV_ORG}', '${input.contato}', '${GOV_SESSION}', 'open');
    -- A fala ANTES: e o cliente teve resposta no meio, senao ela nao seria o que
    -- a passagem deixou para tras.
    insert into public.messages
      (organization_id, conversation_id, channel_session_id, contact_id, type,
       direction, status, sent_via, body, sent_at)
    values ('${GOV_ORG}', '${input.conversa}', '${GOV_SESSION}', '${input.contato}', 'text',
            'inbound', 'received', 'ai', '${FALA_ORIGINAL}', '2026-05-10T11:00:00Z');
    insert into public.passagens_de_atendimento
      (organization_id, contact_id, conversation_id, motor, origem, motivo_codigo, body, criado_em)
    values ('${GOV_ORG}', '${input.contato}', '${input.conversa}', 'engine', 'pedido_explicito',
            'requested_human', 'a narrativa da passagem', '${PASSAGEM_EM}');
    ${depois}
  `;
}

beforeAll(() => {
  seedGov();
  // Limpeza antes, e na ordem inversa das FKs: fixture antiga de outra corrida
  // mascara o que esta mede.
  sql(`
    delete from public.passagens_de_atendimento
     where conversation_id in ('${CV_REPETIU}','${CV_MUDOU}','${CV_CALADO}','${CV_TARDE}','${CV_VIZ}');
    delete from public.messages
     where conversation_id in ('${CV_REPETIU}','${CV_MUDOU}','${CV_CALADO}','${CV_TARDE}','${CV_VIZ}');
    delete from public.conversations
     where id in ('${CV_REPETIU}','${CV_MUDOU}','${CV_CALADO}','${CV_TARDE}','${CV_VIZ}');
    delete from public.contacts
     where id in ('${CT_REPETIU}','${CT_MUDOU}','${CT_CALADO}','${CT_TARDE}','${CT_VIZ}');
    delete from public.channel_sessions where id = '${SESSION_VIZ}';
    delete from public.organizations where id = '${ORG_VIZ}';
  `);

  sql(
    cenario({
      contato: CT_REPETIU,
      conversa: CV_REPETIU,
      nome: "Repetiu",
      falaDepois: FALA_REPETIDA,
    }),
  );
  sql(
    cenario({
      contato: CT_MUDOU,
      conversa: CV_MUDOU,
      nome: "Mudou de assunto",
      falaDepois: FALA_DIFERENTE,
    }),
  );
  sql(cenario({ contato: CT_CALADO, conversa: CV_CALADO, nome: "Calado", falaDepois: null }));
  // Fala 30 h depois: fora da janela de 24 h. Sem este cenario, alargar a janela
  // no SQL passaria despercebido.
  sql(
    cenario({
      contato: CT_TARDE,
      conversa: CV_TARDE,
      nome: "Voltou tarde",
      falaDepois: FALA_REPETIDA,
      depoisEm: "2026-05-11T18:00:00Z",
    }),
  );

  // A VIZINHA, com o cenario que MAIS conta: se o escopo vazar, o numero dela
  // aparece no painel desta organizacao.
  sql(`
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG_VIZ}', 'atrito-passagem-viz', 'Vizinha Passagem', 'Vizinha');
    insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
      values ('${SESSION_VIZ}', '${ORG_VIZ}', 'atrito-passagem-viz', '\\x00'::bytea);
    insert into public.contacts (id, organization_id, display_name)
      values ('${CT_VIZ}', '${ORG_VIZ}', 'Contato Vizinho');
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status)
      values ('${CV_VIZ}', '${ORG_VIZ}', '${CT_VIZ}', '${SESSION_VIZ}', 'open');
    insert into public.messages
      (organization_id, conversation_id, channel_session_id, contact_id, type,
       direction, status, sent_via, body, sent_at)
    values ('${ORG_VIZ}', '${CV_VIZ}', '${SESSION_VIZ}', '${CT_VIZ}', 'text',
            'inbound', 'received', 'ai', '${FALA_ORIGINAL}', '2026-05-10T11:00:00Z');
    insert into public.messages
      (organization_id, conversation_id, channel_session_id, contact_id, type,
       direction, status, sent_via, body, sent_at)
    values ('${ORG_VIZ}', '${CV_VIZ}', '${SESSION_VIZ}', '${CT_VIZ}', 'text',
            'inbound', 'received', 'ai', '${FALA_REPETIDA}', '2026-05-10T13:00:00Z');
    insert into public.passagens_de_atendimento
      (organization_id, contact_id, conversation_id, motor, origem, motivo_codigo, body, criado_em)
    values ('${ORG_VIZ}', '${CT_VIZ}', '${CV_VIZ}', 'engine', 'pedido_explicito',
            'requested_human', 'a narrativa da vizinha', '${PASSAGEM_EM}');
  `);

  // CONTROLE DA SEMENTE: sem isto, um insert engolido por unique parcial (o
  // defeito que custou um diagnostico errado na onda 10) faria os casos abaixo
  // medirem uma fixture menor do que a escrita, em silencio.
  const plantadas = lastLine(
    sql(
      `select count(*) from public.passagens_de_atendimento
        where conversation_id in ('${CV_REPETIU}','${CV_MUDOU}','${CV_CALADO}','${CV_TARDE}','${CV_VIZ}');`,
    ),
  ).trim();
  if (plantadas !== "5") {
    throw new Error(`a semente plantou ${plantadas} passagens, e deveriam ser 5`);
  }
});

describe("fn_atrito_metrics — repetição depois da passagem", () => {
  const metrics = () => atritoComo(GOV_MANAGER, GOV_ORG).cliente!;

  it("CONTROLE DE VACUIDADE: as duas chaves existem no payload", () => {
    // Sem isto, uma função sem as chaves devolveria `undefined` e todo
    // `toBe(...)` abaixo falharia por motivo errado — ou, pior, um `toBeNull`
    // passaria por ausência.
    const c = metrics();
    expect(Object.keys(c)).toContain("repeticao_pos_passagem");
    expect(Object.keys(c)).toContain("passagens_medidas");
  });

  it("o cliente que repetiu quase a mesma frase CONTA", () => {
    expect(metrics().repeticao_pos_passagem).toBe(1);
  });

  it("quem voltou com OUTRO assunto não conta como repetição", () => {
    // O falso positivo é o risco caro: acusar repetição onde a pessoa mudou de
    // tema faria o painel dizer que o briefing não serviu quando ele serviu.
    // Três conversas entram no denominador (repetiu, mudou, voltou tarde? não —
    // a tardia fica FORA) e só uma no numerador.
    const c = metrics();
    expect(c.repeticao_pos_passagem).toBe(1);
    expect(c.passagens_medidas).toBe(2);
  });

  it("sem fala nova depois, a passagem fica FORA do denominador", () => {
    // Contá-la como "não repetiu" inflaria o número para o lado bonito: ninguém
    // repetiu porque ninguém falou, não porque o briefing funcionou.
    const c = metrics();
    expect(c.passagens_medidas).toBe(2);
  });

  it("fala 30h depois está FORA da janela de 24h — a régua é fixa", () => {
    // O cenário "voltou tarde" repete a MESMA frase do cenário que conta. Se a
    // janela for alargada, o denominador vai a 3 e o numerador a 2 — este caso
    // é o que denuncia.
    const c = metrics();
    expect(c.passagens_medidas).toBe(2);
    expect(c.repeticao_pos_passagem).toBe(1);
  });

  it("a passagem da organização VIZINHA não entra na conta desta", () => {
    // `fn_atrito_metrics` é SECURITY INVOKER, e a policy da tabela exige
    // organização + papel + visibilidade da conversa. Promovê-la a DEFINER
    // "para simplificar" faria este caso vermelhar antes de virar vazamento.
    const c = metrics();
    expect(c.passagens_medidas).toBe(2);
  });

  it("organização sem passagem nenhuma devolve ZERO no denominador — e a borda o traduz em `—`", () => {
    // Zero aqui é a contagem honesta; quem transforma em ausência é
    // `razao()` em `lib/metrics/atrito.ts`, que devolve `null` para denominador
    // zero. Os dois lados precisam existir: contar `null` no SQL impediria
    // distinguir "ninguém repetiu" de "ninguém voltou a falar".
    const out = sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${GOV_MANAGER}"}', false);
      select public.fn_atrito_metrics('${GOV_ORG}'::uuid,
        '2026-01-01T00:00:00Z'::timestamptz, '2026-02-01T00:00:00Z'::timestamptz);
    `);
    const c = (JSON.parse(lastLine(out)) as Record<string, Record<string, number>>).cliente!;
    expect(c.passagens_medidas).toBe(0);
    expect(c.repeticao_pos_passagem).toBe(0);
  });
});
