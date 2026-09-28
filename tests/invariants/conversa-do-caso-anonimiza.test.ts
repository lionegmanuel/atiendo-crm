/**
 * ANONIMIZAR UM CONTATO APAGA O QUE A EQUIPE PERGUNTOU À IA SOBRE ELE — 0281.
 *
 * ## Prova de COMPORTAMENTO, não de símbolo
 *
 * `lgpd-cascata-alcanca-quem-guarda-pessoa.test.ts` passa a cobrar esta tabela
 * sozinho (ela tem FK para `contacts` e coluna `body`), e
 * `cascata-lgpd-nao-encolhe.test.ts` guarda o NOME dela na lista da cascata. Os
 * dois medem que o passo EXISTE. Nenhum mede que ele FUNCIONA — um `update`
 * com o predicado errado casa zero linhas, a função devolve sucesso, a contagem
 * por tabela fecha em zero e o SLA de D+15 é marcado como cumprido com o texto
 * legível. É o modo de falha que o épico inteiro existe para fechar, e ele é
 * mudo dos dois lados.
 *
 * Aqui a cascata REAL roda contra uma semente REAL, e o que se mede é o depois.
 *
 * ## Por que a idempotência tem caso próprio
 *
 * `app/api/v1/cron/data-retention` roda `varrerRedacoesIncompletas` TODO DIA, e
 * ela chama esta mesma função de novo para contato já anonimizado. Se o passo
 * não filtrasse `redacted_at is null`, o carimbo de QUANDO o texto foi apagado
 * seria reescrito a cada rodada — e a resposta a "quando cumprimos o pedido
 * dele?" passaria a ser "hoje", para sempre, em qualquer auditoria.
 *
 * ## Por que existe um VIZINHO na semente
 *
 * Um passo com o predicado largo demais (sem `contact_id`, ou sem
 * `organization_id`) apagaria a deliberação sobre OUTRAS pessoas e ficaria verde
 * em todos os casos de "o texto do titular sumiu". O vizinho é o que distingue
 * "apagou o certo" de "apagou".
 */
import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./psql-transporte";

// Namespace próprio, distinto do de `conversa-do-caso-visibilidade.test.ts`:
// aquele arquivo AFIRMA que a linha dele é legível, e este anonimiza a sua.
// Compartilhar contato faria um derrubar o outro conforme a ordem da suíte.
const ORG = "02810001-0000-4000-8000-000000000001";
const SESSAO = "02810001-2222-4000-8000-000000000001";
const ALVO = "02810001-3333-4000-8000-000000000001";
const VIZINHO = "02810001-3333-4000-8000-000000000002";
const CONVERSA_ALVO = "02810001-4444-4000-8000-000000000001";
const CONVERSA_VIZINHO = "02810001-4444-4000-8000-000000000002";
const CASO_ALVO = "02810001-5555-4000-8000-000000000001";
const CASO_VIZINHO = "02810001-5555-4000-8000-000000000002";
const TURNO_ALVO = "02810001-6666-4000-8000-000000000001";
const TURNO_VIZINHO = "02810001-6666-4000-8000-000000000002";

const PERGUNTA = "O cliente Fulano de Tal já tinha pedido isso antes?";
const RESPOSTA = "Sim — Fulano pediu o mesmo desconto em março.";

/** A última linha da saída do psql, que é o valor da última consulta. */
function valor(consulta: string): string {
  return sql(consulta).trim().split("\n").at(-1) ?? "";
}

function campo(turnId: string, coluna: string): string {
  return valor(
    `select coalesce(${coluna}::text, '<null>') from public.agent_case_chat_messages
      where organization_id = '${ORG}' and turn_id = '${turnId}' and author_kind = 'human';`,
  );
}

let antes: { pergunta: string; resposta: string; vizinho: string };
let retorno: string;
let carimboDaPrimeiraRodada: string;

beforeAll(() => {
  sql(`
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG}', 'chat-0281-lgpd', 'Chat 0281 LGPD', 'Chat 0281 LGPD')
      on conflict do nothing;
    do $seed$ begin
      insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
        values ('${SESSAO}', '${ORG}', 'chat-0281-lgpd', '\\x00'::bytea);
    exception when unique_violation then null; end $seed$;
    insert into public.contacts (id, organization_id, display_name) values
      ('${ALVO}',    '${ORG}', 'Fulano de Tal'),
      ('${VIZINHO}', '${ORG}', 'Beltrano Vizinho')
      on conflict do nothing;
    -- Um contato por conversa: uniq_conversations_1to1_per_contact_session
    -- admite UMA conversa 1:1 por (org, contato, sessão).
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status) values
      ('${CONVERSA_ALVO}',    '${ORG}', '${ALVO}',    '${SESSAO}', 'open'),
      ('${CONVERSA_VIZINHO}', '${ORG}', '${VIZINHO}', '${SESSAO}', 'open')
      on conflict do nothing;
    insert into public.agent_cases (id, organization_id, conversation_id, title, summary, blocker) values
      ('${CASO_ALVO}',    '${ORG}', '${CONVERSA_ALVO}',    'Caso do alvo',    'Resumo', 'Bloqueio'),
      ('${CASO_VIZINHO}', '${ORG}', '${CONVERSA_VIZINHO}', 'Caso do vizinho', 'Resumo', 'Bloqueio')
      on conflict do nothing;
    insert into public.agent_case_chat_messages
        (organization_id, case_id, conversation_id, contact_id, turn_id, author_kind, body)
      select * from (values
        ('${ORG}'::uuid, '${CASO_ALVO}'::uuid, '${CONVERSA_ALVO}'::uuid, '${ALVO}'::uuid,
         '${TURNO_ALVO}'::uuid, 'human', '${PERGUNTA}'),
        ('${ORG}'::uuid, '${CASO_ALVO}'::uuid, '${CONVERSA_ALVO}'::uuid, '${ALVO}'::uuid,
         '${TURNO_ALVO}'::uuid, 'ai', '${RESPOSTA}'),
        ('${ORG}'::uuid, '${CASO_VIZINHO}'::uuid, '${CONVERSA_VIZINHO}'::uuid, '${VIZINHO}'::uuid,
         '${TURNO_VIZINHO}'::uuid, 'human', 'A deliberação sobre o vizinho continua legível.')
      ) as s(organization_id, case_id, conversation_id, contact_id, turn_id, author_kind, body)
       where not exists (select 1 from public.agent_case_chat_messages
                          where organization_id = '${ORG}' and turn_id = '${TURNO_ALVO}');
  `);

  // GUARDA DE BANCO SUJO. Numa segunda rodada contra o MESMO container, o
  // retrato "antes" já sai anonimizado e todo caso de "o texto estava legível"
  // falharia com uma mensagem que não fala de defeito nenhum.
  const jaAnonimo = valor(`select is_anonymized from public.contacts where id = '${ALVO}';`);
  if (jaAnonimo !== "f") {
    throw new Error(
      `o contato da semente já está anonimizado (is_anonymized=${jaAnonimo}) — este arquivo ` +
        "precisa de um banco recém-aplicado. Rode `pnpm test:db`, que sobe container novo.",
    );
  }

  antes = {
    pergunta: campo(TURNO_ALVO, "body"),
    resposta: valor(
      `select coalesce(body, '<null>') from public.agent_case_chat_messages
        where organization_id = '${ORG}' and turn_id = '${TURNO_ALVO}' and author_kind = 'ai';`,
    ),
    vizinho: campo(TURNO_VIZINHO, "body"),
  };

  // A FUNÇÃO REAL, não um `update is_anonymized` à mão: o atalho seria barrado
  // pela constraint `contacts_anonymized_locked` e, pior, provaria um caminho
  // que a produção nunca percorre.
  retorno = valor(
    `select public.fn_lgpd_cascade_redact_contact('${ORG}', '${ALVO}', gen_random_uuid());`,
  );
  carimboDaPrimeiraRodada = campo(TURNO_ALVO, "redacted_at");
});

describe("0281 — a cascata de LGPD alcança a conversa do caso", () => {
  it("CONTROLE DE VACUIDADE: o texto estava legível ANTES", () => {
    // Sem isto, uma semente que não entrou faria "o corpo virou null" passar
    // sobre uma linha inexistente — verde por não haver o que apagar.
    expect(antes.pergunta).toBe(PERGUNTA);
    expect(antes.resposta).toBe(RESPOSTA);
    expect(antes.vizinho).toContain("vizinho continua legível");
  });

  it("a cascata CONTOU a tabela no `counts` que vai para a auditoria", () => {
    // Passo que não existe não aparece no `counts`: a chave ausente é a prova
    // de que o passo sumiu, e esse jsonb é o que entra no metadata de
    // `lgpd.redact_executed` — a linha que responde ao titular.
    const contagens = JSON.parse(retorno) as {
      already_anonymized: boolean;
      counts: Record<string, number>;
    };
    expect(contagens.already_anonymized).toBe(false);
    expect(
      contagens.counts.agent_case_chat_messages,
      "a cascata não contou `agent_case_chat_messages` — o passo saiu da função",
    ).toBe(2);
  });

  it("a pergunta e a resposta viram null, e o carimbo é preenchido", () => {
    expect(campo(TURNO_ALVO, "body")).toBe("<null>");
    expect(
      valor(`select coalesce(body, '<null>') from public.agent_case_chat_messages
              where organization_id = '${ORG}' and turn_id = '${TURNO_ALVO}' and author_kind = 'ai';`),
    ).toBe("<null>");
    expect(carimboDaPrimeiraRodada).not.toBe("<null>");
  });

  it("a LINHA fica de pé — o que se apaga é o texto, não a operação", () => {
    // Apagar a linha inteira ficaria verde no caso acima e tiraria da
    // organização a resposta a "quanto a equipe deliberou sobre este caso".
    const linhas = valor(
      `select count(*) from public.agent_case_chat_messages
        where organization_id = '${ORG}' and case_id = '${CASO_ALVO}';`,
    );
    expect(Number(linhas)).toBe(2);
    expect(campo(TURNO_ALVO, "author_kind")).toBe("human");
  });

  it("o VIZINHO não é tocado — o predicado recorta pelo titular", () => {
    // Um `update` sem `contact_id` (ou sem `organization_id`) apagaria a
    // deliberação sobre outras pessoas e ficaria verde em tudo acima.
    expect(campo(TURNO_VIZINHO, "body")).toContain("vizinho continua legível");
    expect(campo(TURNO_VIZINHO, "redacted_at")).toBe("<null>");
  });

  it("rodar de novo é NO-OP: o carimbo não se mexe", () => {
    // O cron diário chama a função outra vez para contato já anonimizado. Sem o
    // `redacted_at is null` no `where`, a resposta a "quando cumprimos o pedido
    // dele?" passaria a ser "hoje", todo dia, em qualquer auditoria.
    sql(`select public.fn_lgpd_cascade_redact_contact('${ORG}', '${ALVO}', gen_random_uuid());`);
    expect(campo(TURNO_ALVO, "redacted_at")).toBe(carimboDaPrimeiraRodada);
  });
});
