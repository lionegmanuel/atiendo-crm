/**
 * O BRIEFING DA PASSAGEM SÓ É LIDO POR QUEM PODE LER A CONVERSA — migration 0291.
 *
 * ## Por que este arquivo existe, e por que `rls-isolation` não basta
 *
 * `rls-isolation.test.ts` prova o eixo TENANT: a organização A não lê a linha da
 * organização B. Ele não prova — e não pode, porque semeia um usuário só — os
 * outros dois eixos, que são a razão de esta tabela ter a policy que tem:
 *
 *   · dentro da MESMA organização, um atendente que a RLS proíbe de ver aquela
 *     conversa também não lê o briefing dela;
 *   · `authenticated` não ESCREVE, em nenhum papel.
 *
 * O briefing diz MAIS que a conversa. A conversa é o que as duas pessoas
 * disseram; o briefing é o que a IA CONCLUIU sobre o cliente — o que ela acha
 * que ele quer, o que ela já tentou, e a frase literal que ele escreveu quando
 * se irritou. Se a policy fosse só `organization_id`, a tabela nova seria a
 * maior porta aberta do produto, e o vazamento se pareceria com uso normal.
 *
 * ## O que é medido, e com que régua
 *
 * Organização em `settings.visibility_mode = 'own'` (o modo mais estrito), com a
 * conversa ATRIBUÍDA ao atendente A:
 *
 *   · A (`agent`, dono da conversa)  → 1   — controle positivo
 *   · B (`agent`, não é o dono)      → 0   — O CASO QUE JUSTIFICA A POLICY
 *   · gestor (`manager`)             → 1   — lê tudo por desenho (decisão do dono)
 *   · leitor (`viewer`)              → 0   — a policy exige `fn_role_at_least('agent')`
 *   · os quatro, INSERT/UPDATE/DELETE → erro de permissão
 *
 * As DUAS pontas de cada par importam. Só "B não lê" é satisfeito por tabela
 * vazia, por policy que nega a todos e por gate morto. Só "A lê" é satisfeito
 * pela policy sem recorte nenhum.
 *
 * ## Sabotagem prevista (§4.11 do plano)
 *
 * `grant insert on public.passagens_de_atendimento to authenticated` tem de
 * deixar VERMELHO só o caso de escrita — os quatro de leitura seguem verdes, e é
 * essa separação que prova que os dois eixos são medidos por casos diferentes.
 * Trocar o `exists (… fn_can_view_conversation …)` por `true` derruba o caso de
 * B e deixa o de `viewer` verde: a outra metade da policy não se mexe.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { motivoDoErro, sql } from "./psql-transporte";

// Namespace próprio (02910000-), como nos invariantes das ondas anteriores: a
// semente é idempotente E não colide com a de outro arquivo rodando contra o
// mesmo banco.
const ORG = "02910000-0000-4000-8000-000000000001";
/** Dono da conversa. */
const ATENDENTE_A = "02910000-1111-4000-8000-000000000001";
/** Colega, mesmo papel, sem a conversa. É o caso que justifica a policy. */
const ATENDENTE_B = "02910000-1111-4000-8000-000000000002";
const GESTOR = "02910000-1111-4000-8000-000000000003";
const LEITOR = "02910000-1111-4000-8000-000000000004";
const SESSAO = "02910000-2222-4000-8000-000000000001";
const CONTATO = "02910000-3333-4000-8000-000000000001";
const CONVERSA = "02910000-4444-4000-8000-000000000001";
const PASSAGEM = "02910000-7777-4000-8000-000000000001";

/**
 * O prefixo que põe a sessão no mesmo lugar em que o PostgREST põe a de um
 * usuário logado: papel `authenticated` + `request.jwt.claims`, que é o caminho
 * exato que `auth.uid()` e as policies de produção leem.
 */
function comoMembro(userId: string): string {
  return `set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);`;
}

function contaComoMembro(userId: string, consulta: string): number {
  const saida = sql(`${comoMembro(userId)}\n${consulta};`).trim();
  const ultima = saida.split("\n").at(-1) ?? "";
  if (!/^\d+$/.test(ultima)) throw new Error(`saída inesperada do psql: ${saida}`);
  return Number(ultima);
}

const QUANTAS_PASSAGENS = `select count(*) from public.passagens_de_atendimento
   where organization_id = '${ORG}' and conversation_id = '${CONVERSA}'`;

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${ATENDENTE_A}', 'passagem-0291-a@invariant.test'),
      ('${ATENDENTE_B}', 'passagem-0291-b@invariant.test'),
      ('${GESTOR}',      'passagem-0291-gestor@invariant.test'),
      ('${LEITOR}',      'passagem-0291-leitor@invariant.test')
      on conflict do nothing;

    -- visibility_mode = 'own' é o modo mais estrito, e é o único em que o
    -- recorte por atendente aparece: em 'all' todo mundo lê, e em
    -- 'own_and_unassigned' (o default) uma conversa SEM dono é visível a todos.
    -- Medir no default seria medir o caso em que a policy não faz diferença.
    insert into public.organizations (id, slug, legal_name, display_name, settings)
      values ('${ORG}', 'passagem-0291', 'Passagem 0291 Invariant', 'Passagem 0291',
              '{"visibility_mode":"own"}'::jsonb)
      on conflict (id) do update set settings = excluded.settings;

    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${ATENDENTE_A}', '${ORG}', 'agent',   now()),
      ('${ATENDENTE_B}', '${ORG}', 'agent',   now()),
      ('${GESTOR}',      '${ORG}', 'manager', now()),
      ('${LEITOR}',      '${ORG}', 'viewer',  now())
      on conflict do nothing;

    -- DO + exception (não ON CONFLICT): channel_sessions tem unique DEFERRABLE
    -- (phone_per_org), que ON CONFLICT sem arbiter rejeita.
    do $seed$ begin
      insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
        values ('${SESSAO}', '${ORG}', 'passagem-0291', '\\x00'::bytea);
    exception when unique_violation then null; end $seed$;

    insert into public.contacts (id, organization_id, display_name)
      values ('${CONTATO}', '${ORG}', 'Passagem 0291 Contato')
      on conflict do nothing;

    -- A conversa tem DONO, e é isso que faz a medição existir.
    insert into public.conversations
        (id, organization_id, contact_id, channel_session_id, status, assigned_to_user_id)
      values ('${CONVERSA}', '${ORG}', '${CONTATO}', '${SESSAO}', 'open', '${ATENDENTE_A}')
      on conflict (id) do update set assigned_to_user_id = excluded.assigned_to_user_id;

    insert into public.passagens_de_atendimento
        (id, organization_id, contact_id, conversation_id, motor, origem, motivo_codigo,
         title, body, notes)
      select '${PASSAGEM}', '${ORG}', '${CONTATO}', '${CONVERSA}', 'engine',
             'pedido_explicito', 'requested_human',
             'quer falar com alguem sobre a cobranca',
             'Por que a IA passou: O cliente pediu para falar com uma pessoa',
             'isso esta errado, quero falar com uma pessoa'
       where not exists (select 1 from public.passagens_de_atendimento
                          where organization_id = '${ORG}' and id = '${PASSAGEM}');
  `);
});

describe("0291 — a passagem respeita a visibilidade da conversa", () => {
  it("CONTROLE DE VACUIDADE: a linha existe no banco", () => {
    // Sem isto, uma semente que não entrou faria TODAS as contagens abaixo
    // devolverem 0 — e o caso de B passaria afirmando "não vaza" sobre uma
    // tabela vazia, sem nunca ter provado que alguém LÊ.
    const total = sql(`${QUANTAS_PASSAGENS};`).trim().split("\n").at(-1);
    expect(Number(total), "a semente da passagem não entrou").toBe(1);
  });

  it("o DONO da conversa lê o briefing (controle positivo)", () => {
    expect(contaComoMembro(ATENDENTE_A, QUANTAS_PASSAGENS)).toBe(1);
  });

  it("o COLEGA que não vê a conversa NÃO lê o briefing", () => {
    // O caso que justifica a policy ter três condições em vez de uma. Um `agent`
    // do mesmo papel, da mesma organização, que a RLS de `conversations` proíbe
    // de ver aquele atendimento: ele não pode ler o que a IA concluiu sobre o
    // cliente, nem a frase literal que o cliente escreveu.
    expect(
      contaComoMembro(ATENDENTE_B, QUANTAS_PASSAGENS),
      "um atendente leu o briefing de uma conversa que a RLS lhe esconde",
    ).toBe(0);
  });

  it("o GESTOR lê — por desenho, não por acidente", () => {
    // `fn_can_view_conversation` devolve `true` para viewer/manager/admin. A
    // decisão é do dono do produto e está declarada; o caso existe para que
    // trocá-la seja uma edição VISÍVEL, e não um efeito colateral.
    expect(contaComoMembro(GESTOR, QUANTAS_PASSAGENS)).toBe(1);
  });

  it("o LEITOR não lê — a policy exige papel `agent` ou acima", () => {
    // A OUTRA metade da policy, medida separada: `fn_role_at_least('agent')`.
    // `viewer` passa por `fn_can_view_conversation` (ele lê tudo por desenho) e
    // é barrado aqui. Sem este caso, remover o gate de papel ficaria verde.
    expect(contaComoMembro(LEITOR, QUANTAS_PASSAGENS)).toBe(0);
  });

  it("nenhum dos quatro INSERE — quem escreve é o servidor", () => {
    // O `revoke all … from authenticated` da 0291. Sem ele, a policy de SELECT
    // seria a única coisa entre um membro e um INSERT forjado — e uma passagem
    // inventada diz que a IA desistiu de um atendimento que ela nunca tocou.
    for (const quem of [ATENDENTE_A, ATENDENTE_B, GESTOR, LEITOR]) {
      let erro: string | null = null;
      try {
        sql(`${comoMembro(quem)}
          insert into public.passagens_de_atendimento
            (organization_id, contact_id, conversation_id, motor, origem, motivo_codigo, body)
          values ('${ORG}', '${CONTATO}', '${CONVERSA}', 'engine', 'pedido_explicito',
                  'requested_human', 'forjado');`);
      } catch (err) {
        erro = motivoDoErro(err);
      }
      expect(erro, `${quem} inseriu na tabela SEM erro — a escrita está exposta`).not.toBeNull();
      expect(erro).toContain("permission denied");
    }
  });

  it("nenhum dos quatro ALTERA nem APAGA — o fato não se reescreve", () => {
    // UPDATE e DELETE têm caso próprio porque são a outra metade do estrago: um
    // membro que não pode inventar uma passagem, mas pode APAGAR a dele, apaga o
    // registro de que a IA precisou de ajuda naquele atendimento. E um que pode
    // dar UPDATE marca `reconhecido_por` como se alguém tivesse assumido.
    for (const quem of [ATENDENTE_A, GESTOR]) {
      for (const comando of [
        `update public.passagens_de_atendimento set body = 'reescrito'
           where organization_id = '${ORG}' and id = '${PASSAGEM}';`,
        `delete from public.passagens_de_atendimento
           where organization_id = '${ORG}' and id = '${PASSAGEM}';`,
      ]) {
        let erro: string | null = null;
        try {
          sql(`${comoMembro(quem)}\n${comando}`);
        } catch (err) {
          erro = motivoDoErro(err);
        }
        expect(erro, `${quem} executou "${comando.slice(0, 40)}…" sem erro`).not.toBeNull();
        expect(erro).toContain("permission denied");
      }
    }
    // E a linha continua lá, com o texto original: um `delete` que falhasse por
    // outra razão (policy sem linha visível, por exemplo) devolveria "DELETE 0"
    // em vez de erro, e o caso acima é quem distingue as duas coisas.
    const sobrou = sql(
      `select count(*) from public.passagens_de_atendimento where id = '${PASSAGEM}';`,
    )
      .trim()
      .split("\n")
      .at(-1);
    expect(Number(sobrou)).toBe(1);
  });

  it("o CHECK de coerência recusa `reconhecido_por` sem `reconhecido_em`", () => {
    // "Alguém assumiu, mas não se sabe quando" é um estado que o produto não
    // modela: o tempo até alguém assumir é a medida que diz se a fila humana
    // funciona. O contrário — `reconhecido_em` sem `reconhecido_por` — É
    // legítimo (a conversa voltou ao automático sem ninguém assumir), e o caso
    // abaixo prova que ele passa, senão a constraint estaria proibindo demais.
    let erro: string | null = null;
    try {
      sql(`update public.passagens_de_atendimento
             set reconhecido_por = '${ATENDENTE_A}', reconhecido_em = null
           where id = '${PASSAGEM}';`);
    } catch (err) {
      erro = motivoDoErro(err);
    }
    expect(erro, "o banco aceitou dono sem data de reconhecimento").not.toBeNull();
    expect(erro).toContain("passagens_reconhecimento_coerente");

    sql(`update public.passagens_de_atendimento
           set reconhecido_por = null, reconhecido_em = now() where id = '${PASSAGEM}';
         update public.passagens_de_atendimento
           set reconhecido_por = null, reconhecido_em = null where id = '${PASSAGEM}';`);
  });

  it("o CHECK de `tentativas` recusa o que não é lista", () => {
    // O cartão itera sobre `tentativas`. Um objeto ou uma string ali viraria
    // erro de renderização dentro da conversa — a tela que quem assume abre.
    let erro: string | null = null;
    try {
      sql(`update public.passagens_de_atendimento
             set tentativas = '{"o_que":"isto nao e uma lista"}'::jsonb
           where id = '${PASSAGEM}';`);
    } catch (err) {
      erro = motivoDoErro(err);
    }
    expect(erro, "o banco aceitou `tentativas` que não é array").not.toBeNull();
    expect(erro).toContain("tentativas");
  });
});
