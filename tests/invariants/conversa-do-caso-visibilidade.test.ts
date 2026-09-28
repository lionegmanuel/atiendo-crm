/**
 * A CONVERSA DO CASO SÓ É LIDA POR QUEM PODE LER A CONVERSA — migration 0281.
 *
 * ## Por que este arquivo existe, e por que `rls-isolation` não basta
 *
 * `rls-isolation.test.ts` prova o eixo TENANT: a organização A não lê a linha da
 * organização B. Ele não prova — e não pode provar, porque semeia um usuário só
 * — o eixo que é a RAZÃO DE SER desta feature: dentro da MESMA organização, um
 * atendente que a RLS proíbe de ver aquela conversa também não lê o que a equipe
 * perguntou à IA sobre ela.
 *
 * O chat AMPLIA a superfície. A tela de casos já entregava título, resumo e
 * telefone a qualquer membro (`lerChamado` usa cliente privilegiado); o chat
 * entrega a CONVERSA INTEIRA lida pela IA, em prosa. Se a policy desta tabela
 * fosse só `organization_id`, a feature nova seria a maior porta aberta do
 * produto — e ninguém notaria, porque o vazamento se parece com uso normal.
 *
 * ## O que é medido, e com que régua
 *
 * Organização em `settings.visibility_mode = 'own'` (o modo mais estrito), com a
 * conversa ATRIBUÍDA ao atendente A:
 *
 *   · A (`agent`, dono da conversa)  → 1   — o dono lê o que ele mesmo perguntou
 *   · B (`agent`, não é o dono)      → 0   — O CASO QUE JUSTIFICA A FEATURE
 *   · gestor (`manager`)             → 1   — lê tudo por desenho (decisão do dono)
 *   · leitor (`viewer`)              → 0   — a policy exige `fn_role_at_least('agent')`
 *
 * As DUAS pontas de cada par importam. Só "B não lê" é satisfeito por uma tabela
 * vazia, por uma policy que nega a todos, e por um gate morto. Só "A lê" é
 * satisfeito pela policy sem recorte nenhum.
 *
 * ## Sabotagem prevista (§4.11 do plano)
 *
 * Trocar o `exists (… conversations … fn_can_view_conversation …)` da policy por
 * `true` tem de deixar VERMELHO o caso de B e o de `viewer` continuar VERDE (o
 * gate de papel é a outra metade, e ela não se mexe). Um conserto que só
 * removesse o `fn_role_at_least` deixaria `viewer` vermelho e B verde — as duas
 * metades são medidas separadas de propósito.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./psql-transporte";

// Namespace próprio (02810000-), como nos invariantes das ondas 1 e 2: a
// semente é idempotente E não colide com a de outro arquivo rodando em paralelo
// contra o mesmo banco.
const ORG = "02810000-0000-4000-8000-000000000001";
/** Dono da conversa. */
const ATENDENTE_A = "02810000-1111-4000-8000-000000000001";
/** Colega, mesmo papel, OUTRA conversa. É o caso que justifica a feature. */
const ATENDENTE_B = "02810000-1111-4000-8000-000000000002";
const GESTOR = "02810000-1111-4000-8000-000000000003";
const LEITOR = "02810000-1111-4000-8000-000000000004";
const SESSAO = "02810000-2222-4000-8000-000000000001";
const CONTATO = "02810000-3333-4000-8000-000000000001";
const CONVERSA = "02810000-4444-4000-8000-000000000001";
const CASO = "02810000-5555-4000-8000-000000000001";
const TURNO = "02810000-6666-4000-8000-000000000001";

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

const QUANTAS_LINHAS_DO_CASO = `select count(*) from public.agent_case_chat_messages
   where organization_id = '${ORG}' and case_id = '${CASO}'`;

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${ATENDENTE_A}', 'chat-0281-a@invariant.test'),
      ('${ATENDENTE_B}', 'chat-0281-b@invariant.test'),
      ('${GESTOR}',      'chat-0281-gestor@invariant.test'),
      ('${LEITOR}',      'chat-0281-leitor@invariant.test')
      on conflict do nothing;

    -- visibility_mode = 'own' é o modo mais estrito, e é o único em que o
    -- recorte por atendente aparece: em 'all' todo mundo lê, e em
    -- 'own_and_unassigned' (o default) uma conversa SEM dono é visível a todos.
    -- Medir no default seria medir o caso em que a policy não faz diferença.
    insert into public.organizations (id, slug, legal_name, display_name, settings)
      values ('${ORG}', 'chat-0281', 'Chat 0281 Invariant', 'Chat 0281',
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
        values ('${SESSAO}', '${ORG}', 'chat-0281', '\\x00'::bytea);
    exception when unique_violation then null; end $seed$;

    insert into public.contacts (id, organization_id, display_name)
      values ('${CONTATO}', '${ORG}', 'Chat 0281 Contato')
      on conflict do nothing;

    -- A conversa tem DONO, e é isso que faz a medição existir.
    insert into public.conversations
        (id, organization_id, contact_id, channel_session_id, status, assigned_to_user_id)
      values ('${CONVERSA}', '${ORG}', '${CONTATO}', '${SESSAO}', 'open', '${ATENDENTE_A}')
      on conflict (id) do update set assigned_to_user_id = excluded.assigned_to_user_id;

    insert into public.agent_cases (id, organization_id, conversation_id, title, summary, blocker)
      values ('${CASO}', '${ORG}', '${CONVERSA}', 'Desconto acima da política',
              'O cliente pede 20%', 'A política permite 10%')
      on conflict do nothing;

    insert into public.agent_case_chat_messages
        (organization_id, case_id, conversation_id, contact_id, turn_id, author_kind, body)
      select '${ORG}', '${CASO}', '${CONVERSA}', '${CONTATO}', '${TURNO}', 'human',
             'Por que a IA não resolveu sozinha?'
       where not exists (select 1 from public.agent_case_chat_messages
                          where organization_id = '${ORG}' and turn_id = '${TURNO}');
  `);
});

describe("0281 — o chat do caso respeita a visibilidade da conversa", () => {
  it("CONTROLE DE VACUIDADE: a linha existe no banco", () => {
    // Sem isto, uma semente que não entrou faria TODAS as contagens abaixo
    // devolverem 0 — e o caso de B passaria afirmando "não vaza" sobre uma
    // tabela vazia, sem nunca ter provado que alguém LÊ.
    const total = sql(QUANTAS_LINHAS_DO_CASO + ";").trim().split("\n").at(-1);
    expect(Number(total), "a semente do chat do caso não entrou").toBe(1);
  });

  it("o DONO da conversa lê o que a equipe perguntou (controle positivo)", () => {
    expect(contaComoMembro(ATENDENTE_A, QUANTAS_LINHAS_DO_CASO)).toBe(1);
  });

  it("o COLEGA que não vê a conversa NÃO lê a conversa do caso", () => {
    // O caso que justifica a feature existir com cuidado. Um `agent` do mesmo
    // papel, da mesma organização, que a RLS de `conversations` proíbe de ver
    // aquele atendimento: ele não pode ler o que a IA contou sobre ele aqui.
    expect(
      contaComoMembro(ATENDENTE_B, QUANTAS_LINHAS_DO_CASO),
      "um atendente leu a deliberação sobre uma conversa que a RLS lhe esconde",
    ).toBe(0);
  });

  it("o GESTOR lê — por desenho, não por acidente", () => {
    // `fn_can_view_conversation` devolve `true` para viewer/manager/admin. A
    // decisão é do dono do produto e está declarada; o caso existe para que
    // trocá-la seja uma edição VISÍVEL, e não um efeito colateral.
    expect(contaComoMembro(GESTOR, QUANTAS_LINHAS_DO_CASO)).toBe(1);
  });

  it("o LEITOR não lê — a policy exige papel `agent` ou acima", () => {
    // A OUTRA metade da policy, medida separada: `fn_role_at_least('agent')`.
    // `viewer` passa por `fn_can_view_conversation` (ele lê tudo por desenho) e
    // é barrado aqui. Sem este caso, remover o gate de papel ficaria verde.
    expect(contaComoMembro(LEITOR, QUANTAS_LINHAS_DO_CASO)).toBe(0);
  });

  it("nenhum dos quatro escreve na tabela — quem escreve é o servidor", () => {
    // O `revoke all … from authenticated` da 0281. Sem ele, a policy de SELECT
    // seria a única coisa entre um membro e um INSERT forjado, e uma pergunta
    // inventada na deliberação de um caso é uma mentira com cara de registro.
    for (const quem of [ATENDENTE_A, ATENDENTE_B, GESTOR, LEITOR]) {
      let erro: string | null = null;
      try {
        sql(`${comoMembro(quem)}
          insert into public.agent_case_chat_messages
            (organization_id, case_id, conversation_id, contact_id, turn_id, author_kind, body)
          values ('${ORG}', '${CASO}', '${CONVERSA}', '${CONTATO}', gen_random_uuid(), 'human', 'forjado');`);
      } catch (err) {
        erro = `${err instanceof Error ? err.message : String(err)}${
          typeof (err as { stderr?: unknown }).stderr === "string"
            ? (err as { stderr: string }).stderr
            : ""
        }`;
      }
      expect(erro, `${quem} inseriu na tabela SEM erro — a escrita está exposta`).not.toBeNull();
      expect(erro).toContain("permission denied");
    }
  });
});
