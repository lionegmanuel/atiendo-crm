/**
 * QUANDO ALGUÉM ASSUME A CONVERSA, A PASSAGEM SE FECHA SOZINHA — migration 0293.
 *
 * ## O que quebra sem isto, e por que o terceiro é o pior
 *
 * A `0291` criou `reconhecido_por` / `reconhecido_em` e ninguém os escrevia.
 * Três consequências:
 *
 *   1. o cartão da conversa fica para sempre em "esperando alguém assumir";
 *   2. o aviso da Central fica para sempre `open`;
 *   3. **e como o aviso deduplica por episódio ABERTO, a PRÓXIMA passagem
 *      daquela conversa não abre aviso nenhum** — o cliente pede um atendente de
 *      novo, e ninguém é avisado. O defeito atravessa a feature inteira.
 *
 * ## Por que o gatilho mora em `conversation_assignment_events`
 *
 * Porque os CINCO caminhos que trocam o dono de uma conversa (assumir,
 * transferir, liberar, devolver, rodízio) passam por `fn_conversation_assign`,
 * que insere a linha de auditoria na MESMA transação. Um gatilho ali cobre os
 * cinco — e o sexto que alguém escrever amanhã — sem tocar em rota nenhuma.
 *
 * ## O que este arquivo mede que o estático não mede
 *
 * O gatilho DISPARANDO. Ler o `create trigger` no baseline prova que o texto
 * está lá; só o banco prova que ele roda, que a guarda de estado recusa o evento
 * incoerente, e que a segunda passagem volta a abrir aviso depois do
 * reconhecimento — que é o defeito nº 3 acima.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { motivoDoErro, sql } from "./psql-transporte";

const ORG = "02930003-0000-4000-8000-000000000001";
const SESSAO = "02930003-2222-4000-8000-000000000001";
const CONTATO = "02930003-3333-4000-8000-000000000001";
/**
 * Um SEGUNDO contato, e a razão é uma armadilha do schema: há unique parcial
 * `(organization_id, contact_id, channel_session_id) where is_group = false` em
 * `conversations`. Duas conversas do MESMO contato no MESMO canal colidem — e,
 * com `on conflict do nothing` sem arbiter, a segunda some EM SILÊNCIO. Medido:
 * o caso da conversa vizinha reprovava com violação de FK porque a conversa
 * dela nunca tinha sido inserida.
 */
const OUTRO_CONTATO = "02930003-3333-4000-8000-000000000002";
const CONVERSA = "02930003-4444-4000-8000-000000000001";
const OUTRA_CONVERSA = "02930003-4444-4000-8000-000000000002";
const DONO = "02930003-5555-4000-8000-000000000001";
/**
 * Um membro `viewer` da MESMA organização. Ele existe porque a função é
 * `security definer` e está liberada para `authenticated`: o que impede um
 * membro qualquer de fechar passagem alheia é a guarda de PAPEL dentro dela,
 * e guarda sem caso é promessa. A exceção declarada em
 * `hardening-definer-varredura.test.ts` cita este arquivo como prova.
 */
const ESPECTADOR = "02930003-5555-4000-8000-000000000002";

function texto(consulta: string): string {
  return (sql(consulta).trim().split("\n").at(-1) ?? "").trim();
}

function valor(consulta: string): number {
  const saida = texto(consulta);
  if (!/^-?\d+$/.test(saida)) throw new Error(`saída inesperada do psql: ${saida}`);
  return Number(saida);
}

/** Uma passagem em aberto + o aviso `handoff` daquela conversa, como os motores os criam. */
function semear(conversa = CONVERSA): void {
  sql(`
    delete from public.passagens_de_atendimento where organization_id = '${ORG}';
    delete from public.agent_inbox_items where organization_id = '${ORG}';
    update public.conversations set assigned_to_user_id = null, assignee_kind = null
      where organization_id = '${ORG}';
    insert into public.passagens_de_atendimento
      (organization_id, contact_id, conversation_id, motor, origem, motivo_codigo, body)
      values ('${ORG}', '${CONTATO}', '${conversa}', 'engine', 'pedido_explicito',
              'requested_human', 'o briefing que quem assume le');
    insert into public.agent_inbox_items
      (organization_id, kind, severity, title, body, ref_kind, ref_id, status)
      values ('${ORG}', 'handoff', 'critical', 'assumir a conversa',
              'O cliente pediu para falar com uma pessoa', 'conversation', '${conversa}', 'open');
  `);
}

function reconhecidas(): number {
  return valor(
    `select count(*) from public.passagens_de_atendimento
      where organization_id = '${ORG}' and reconhecido_em is not null;`,
  );
}

function avisosAbertos(): number {
  return valor(
    `select count(*) from public.agent_inbox_items
      where organization_id = '${ORG}' and kind = 'handoff' and status = 'open';`,
  );
}

beforeAll(() => {
  sql(`
    -- So (id, email): o stub de auth.users do banco efemero
    -- (scripts/test-db.sh) NAO tem aud nem role -- quem os pede leva
    -- 'column aud of relation users does not exist', e o arquivo INTEIRO e
    -- pulado: o rodape diz '10 skipped', nao '10 failed'. Medido.
    -- (sem crase nesta prosa: o bloco inteiro e um template literal de JS.)
    insert into auth.users (id, email)
      values ('${DONO}',        'passagem-0293-dono@invariant.test'),
             ('${ESPECTADOR}',  'passagem-0293-viewer@invariant.test')
      on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG}', 'passagem-0293', 'Passagem 0293', 'Passagem 0293')
      on conflict do nothing;
    -- accepted_at, e nao status: a tabela nao tem coluna status, e e o
    -- accepted_at preenchido que fn_member_role_in_org le como membro ATIVO --
    -- sem ele, fn_conversation_assign recusa com assignee_not_eligible_member e
    -- o gatilho nunca chegaria a ser exercitado.
    -- (sem crase nesta prosa: o bloco inteiro e um template literal de JS.)
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${DONO}', '${ORG}', 'agent', now()),
             ('${ESPECTADOR}', '${ORG}', 'viewer', now()) on conflict do nothing;
    do $seed$ begin
      insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
        values ('${SESSAO}', '${ORG}', 'passagem-0293', '\\x00'::bytea);
    exception when unique_violation then null; end $seed$;
    insert into public.contacts (id, organization_id, display_name) values
      ('${CONTATO}',       '${ORG}', 'Passagem 0293 Contato'),
      ('${OUTRO_CONTATO}', '${ORG}', 'Passagem 0293 Vizinho')
      on conflict do nothing;
    -- Contatos DIFERENTES de propósito -- ver OUTRO_CONTATO.
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status)
      values ('${CONVERSA}',       '${ORG}', '${CONTATO}',       '${SESSAO}', 'open'),
             ('${OUTRA_CONVERSA}', '${ORG}', '${OUTRO_CONTATO}', '${SESSAO}', 'open')
      on conflict do nothing;
    -- CONTROLE DA SEMENTE: sem isto, uma conversa engolida pelo unique parcial
    -- faria o caso da vizinha reprovar por violacao de FK, e quem lesse o
    -- vermelho culparia o gatilho em vez do seed.
    do $chk$ begin
      if (select count(*) from public.conversations where organization_id = '${ORG}') < 2 then
        raise exception 'seed incompleto: as duas conversas precisam existir';
      end if;
    end $chk$;
  `);
});

beforeEach(() => semear());

describe("0293 — o gatilho de reconhecimento", () => {
  it("CONTROLE POSITIVO: a semente nasce aberta nos dois lados", () => {
    // Sem isto, um gatilho que apagasse tudo passaria nos casos seguintes por
    // vacuidade: zero abertas é verdade quando não há nada.
    expect(reconhecidas()).toBe(0);
    expect(avisosAbertos()).toBe(1);
  });

  it("assumir a conversa marca a passagem E resolve o aviso", () => {
    sql(
      `select public.fn_conversation_assign('${ORG}', '${CONVERSA}', '${DONO}', 'claim', null, false);`,
    );
    expect(reconhecidas()).toBe(1);
    expect(
      texto(`select coalesce(reconhecido_por::text, '<null>')
               from public.passagens_de_atendimento where organization_id = '${ORG}';`),
    ).toBe(DONO);
    expect(avisosAbertos(), "o aviso ficaria aberto para sempre").toBe(0);
  });

  it("LIBERAR (to_user_id null) NÃO marca — ninguém assumiu", () => {
    // Soltar a conversa devolve o problema à fila; a passagem continua sendo
    // demanda viva. Quem fecha o episódio sem dono é `fn_passagem_devolvida`.
    sql(
      `select public.fn_conversation_assign('${ORG}', '${CONVERSA}', '${DONO}', 'claim', null, false);
       delete from public.passagens_de_atendimento where organization_id = '${ORG}';
       insert into public.passagens_de_atendimento
         (organization_id, contact_id, conversation_id, motor, origem, motivo_codigo, body)
         values ('${ORG}', '${CONTATO}', '${CONVERSA}', 'engine', 'pedido_explicito',
                 'requested_human', 'segunda passagem');
       select public.fn_conversation_assign('${ORG}', '${CONVERSA}', null, 'release', null, false);`,
    );
    expect(reconhecidas()).toBe(0);
  });

  it("o gatilho só alcança a conversa DAQUELE evento", () => {
    sql(`
      insert into public.passagens_de_atendimento
        (organization_id, contact_id, conversation_id, motor, origem, motivo_codigo, body)
        values ('${ORG}', '${OUTRO_CONTATO}', '${OUTRA_CONVERSA}', 'crm', 'sentimento',
                'low_sentiment', 'passagem de outra conversa');
    `);
    sql(
      `select public.fn_conversation_assign('${ORG}', '${CONVERSA}', '${DONO}', 'claim', null, false);`,
    );
    expect(
      valor(`select count(*) from public.passagens_de_atendimento
               where organization_id = '${ORG}' and conversation_id = '${OUTRA_CONVERSA}'
                 and reconhecido_em is null;`),
      "reconheceu a passagem de uma conversa que ninguém assumiu",
    ).toBe(1);
  });

  it("INSERT direto com estado incoerente não marca nada", () => {
    // A segunda camada. A `0279` já fechou o INSERT direto por `authenticated`;
    // esta guarda fecha a INSTÂNCIA também para quem escreve com a service key:
    // uma linha de auditoria que diga "fulano assumiu" quando a conversa não
    // está com fulano marcaria como assumida uma passagem que ninguém assumiu, e
    // o aviso sumiria da lista de quem precisa agir.
    sql(`
      insert into public.conversation_assignment_events
        (organization_id, conversation_id, from_user_id, to_user_id, changed_by, reason)
        values ('${ORG}', '${CONVERSA}', null, '${DONO}', null, 'claim');
    `);
    expect(reconhecidas()).toBe(0);
    expect(avisosAbertos()).toBe(1);
  });

  it("depois do reconhecimento, a passagem SEGUINTE nasce aberta de novo", () => {
    // O defeito nº 3 do cabeçalho: sem o reconhecimento, o aviso aberto bloqueia
    // o próximo, e o cliente que pede um atendente de novo não gera aviso nenhum.
    sql(
      `select public.fn_conversation_assign('${ORG}', '${CONVERSA}', '${DONO}', 'claim', null, false);`,
    );
    expect(avisosAbertos()).toBe(0);
    sql(`
      insert into public.passagens_de_atendimento
        (organization_id, contact_id, conversation_id, motor, origem, motivo_codigo, body)
        values ('${ORG}', '${CONTATO}', '${CONVERSA}', 'engine', 'pedido_explicito',
                'requested_human', 'ele pediu de novo');
      insert into public.agent_inbox_items
        (organization_id, kind, severity, title, body, ref_kind, ref_id, status)
        values ('${ORG}', 'handoff', 'critical', 'assumir a conversa',
                'O cliente pediu para falar com uma pessoa', 'conversation', '${CONVERSA}', 'open');
    `);
    expect(avisosAbertos(), "o segundo pedido do cliente nasceu invisível").toBe(1);
    expect(
      valor(`select count(*) from public.passagens_de_atendimento
               where organization_id = '${ORG}' and reconhecido_em is null;`),
    ).toBe(1);
  });
});

describe("0293 — fn_passagem_devolvida", () => {
  it("fecha o episódio SEM dono: `reconhecido_em` sim, `reconhecido_por` não", () => {
    expect(valor(`select public.fn_passagem_devolvida('${ORG}', '${CONVERSA}');`)).toBe(1);
    expect(
      texto(`select coalesce(reconhecido_por::text, '<null>')
               from public.passagens_de_atendimento where organization_id = '${ORG}';`),
      "devolver ao automático não dá dono a ninguém",
    ).toBe("<null>");
    expect(reconhecidas()).toBe(1);
    expect(avisosAbertos()).toBe(0);
  });

  it("é idempotente: a segunda chamada fecha zero e não reescreve o carimbo", () => {
    sql(`select public.fn_passagem_devolvida('${ORG}', '${CONVERSA}');`);
    const antes = texto(
      `select reconhecido_em::text from public.passagens_de_atendimento where organization_id = '${ORG}';`,
    );
    expect(valor(`select public.fn_passagem_devolvida('${ORG}', '${CONVERSA}');`)).toBe(0);
    expect(
      texto(
        `select reconhecido_em::text from public.passagens_de_atendimento where organization_id = '${ORG}';`,
      ),
      "o carimbo foi reescrito — a hora do fechamento é um fato, não um relógio",
    ).toBe(antes);
  });

  it("não atravessa a organização", () => {
    // Guarda de tenancy na própria função: ela é `security definer` e roda com
    // os privilégios do dono, então o filtro de organização é a única barreira.
    expect(
      valor(`select public.fn_passagem_devolvida('00000000-0000-4000-8000-000000000999', '${CONVERSA}');`),
    ).toBe(0);
    expect(reconhecidas()).toBe(0);
  });

  it("um `viewer` da própria organização NÃO fecha a passagem", () => {
    // A função é executável por `authenticated` de propósito (a rota de devolver
    // ao automático usa o client de sessão). Quem separa um `agent` de um
    // `viewer` é a guarda de papel DENTRO dela — e é este caso que a mede.
    let erro: string | null = null;
    try {
      sql(`set role authenticated;
           select set_config('request.jwt.claims', '{"sub":"${ESPECTADOR}"}', false);
           select public.fn_passagem_devolvida('${ORG}', '${CONVERSA}');`);
    } catch (err) {
      erro = motivoDoErro(err);
    }
    expect(erro, "um viewer fechou a passagem — a guarda de papel não pegou").not.toBeNull();
    expect(erro).toContain("caller_not_authorized_for_org");
    expect(reconhecidas(), "a linha foi tocada mesmo com o erro").toBe(0);
  });

  it("NÃO é executável por `anon` — a chave anônima vai para o browser", () => {
    let erro: string | null = null;
    try {
      sql(`set role anon;
           select public.fn_passagem_devolvida('${ORG}', '${CONVERSA}');`);
    } catch (err) {
      erro = motivoDoErro(err);
    }
    expect(erro, "a função está exposta como RPC pela anon key").not.toBeNull();
    expect(erro).toContain("permission denied");
  });
});
