import { execFileSync } from "node:child_process";

import { beforeAll, describe, expect, it } from "vitest";

/**
 * A ZONA DE PERIGO APAGA UMA ORGANIZAÇÃO QUE JÁ ENVIOU RESPOSTA REVISADA.
 *
 * O defeito (issue #949) não dava erro: `ai_reply_drafts.message_id` nasceu na
 * 0227 sem ação de exclusão, então o PRIMEIRO delete da Zona de perigo
 * (`messages`, a primeira raiz de `RAIZES_DO_APAGAMENTO`) era recusado pelo
 * banco com `23503 ... violates foreign key constraint
 * "ai_reply_drafts_message_id_fkey"` — e o operador via o reset falhar sem
 * causa visível, com NADA apagado.
 *
 * As duas metades importam igualmente, e é por isso que este arquivo tem os
 * dois sentidos:
 *   1. apagar a organização leva a resposta revisada junto (o que a tela
 *      promete);
 *   2. apagar uma MENSAGEM por motivo alheio à resposta (o eco do gateway em
 *      `fn_*` no baseline, a exclusão de mensagem avulsa pela UI) NÃO pode
 *      levar a resposta — `on delete cascade` passaria no caso 1 e apagaria
 *      histórico por causa de um ponteiro no caso 2. É a doutrina escrita na
 *      irmã de `messages.reply_to_message_id` (v. 14759 do baseline): "apagar
 *      a citada não pode levar junto a resposta, que é conteúdo próprio".
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db`");
const containerName: string = container;

function sql(script: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", containerName, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tA", "-f", "-"],
    { input: script, encoding: "utf8" },
  ).trim();
}

const ORG = "94900000-0000-4000-8000-000000000001";
const VIZINHA = "94900000-0000-4000-8000-000000000002";
const DONO = "94900000-1111-4000-8000-000000000001";

type Semente = {
  org: string;
  sess: string;
  sessEco: string;
  contato: string;
  conversa: string;
  conversa2: string;
  msgAlvo: string;
  msgEco: string;
  agente: string;
  versao: string;
};

function semear(org: string, tag: string): Semente {
  const s: Semente = {
    org,
    sess: `94900000-0000-4000-8000-0000000000${tag}`,
    sessEco: `94900000-bbbb-4000-8000-0000000000${tag}`,
    contato: `94900000-2222-4000-8000-0000000000${tag}`,
    conversa: `94900000-3333-4000-8000-0000000000${tag}`,
    conversa2: `94900000-4444-4000-8000-0000000000${tag}`,
    msgAlvo: `94900000-5555-4000-8000-0000000000${tag}`,
    msgEco: `94900000-6666-4000-8000-0000000000${tag}`,
    agente: `94900000-7777-4000-8000-0000000000${tag}`,
    versao: `94900000-8888-4000-8000-0000000000${tag}`,
  };

  sql(`
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${org}', 'zona-${tag}', 'Zona de perigo ${tag}', 'Zona ${tag}')
      on conflict (id) do nothing;
    insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
      values ('${s.sess}', '${org}', 'zona-${tag}', '\\x00'::bytea),
             ('${s.sessEco}', '${org}', 'zona-eco-${tag}', '\\x00'::bytea)
      on conflict (id) do nothing;
    insert into public.contacts (id, organization_id, display_name)
      values ('${s.contato}', '${org}', 'Cliente da zona de perigo') on conflict (id) do nothing;
    -- As duas conversas são do MESMO contato, então precisam de canais
    -- diferentes: \`uniq_conversations_1to1_per_contact_session\` é único em
    -- (organization_id, contact_id, channel_session_id) para \`is_group=false\`,
    -- e o \`on conflict (id)\` abaixo não cobre colisão nesse índice — o INSERT
    -- estouraria 23505 aqui no \`beforeAll\` e o arquivo inteiro seria pulado.
    insert into public.conversations (id, organization_id, contact_id, channel_session_id)
      values ('${s.conversa}', '${org}', '${s.contato}', '${s.sess}'),
             ('${s.conversa2}', '${org}', '${s.contato}', '${s.sessEco}')
      on conflict (id) do nothing;
  `);

  // Mensagem + rascunho revisado com a fronteira canônica que a 0227 exige
  // como NOT NULL, no formato de tests/invariants/rls-isolation.test.ts
  // (fn_service_begin dá o jsonb; a mensagem é inserida por nós, como lá).
  const boundary = sql(`select public.fn_service_begin('${org}', '${s.contato}')::text;`);

  sql(`
    insert into public.ai_agents (id, organization_id, name, system_prompt, operation_mode)
      values ('${s.agente}', '${org}', 'Assistente da zona', 'prompt', 'assisted') on conflict (id) do nothing;
    insert into public.ai_agent_versions
      (id, organization_id, agent_id, version_number, system_prompt, provider, model, channel_session_id, status)
      values ('${s.versao}', '${org}', '${s.agente}', 1, 'prompt', 'anthropic', 'zona-test', '${s.sess}', 'published')
      on conflict (id) do nothing;
    update public.ai_agents set published_version_id = '${s.versao}'
      where organization_id = '${org}' and id = '${s.agente}';
  `);

  // Duas mensagens: uma é a que a resposta revisada usa (`message_id`), a
  // outra representa o eco do aparelho do operador que o gateway apaga por
  // deduplicação (v. `fn_reply_record_receipt`, baseline 21770).
  sql(`
    insert into public.messages (id, organization_id, conversation_id, channel_session_id, contact_id, type, direction, body)
      values ('${s.msgAlvo}', '${org}', '${s.conversa}', '${s.sess}', '${s.contato}', 'text', 'outbound', 'resposta enviada'),
             ('${s.msgEco}', '${org}', '${s.conversa2}', '${s.sessEco}', '${s.contato}', 'text', 'outbound', 'eco do gateway');
    insert into public.ai_reply_drafts
      (id, organization_id, conversation_id, contact_id, agent_id, agent_version_id, channel_session_id,
       service_boundary, context_revision, operation_revision, status, original_body, approved_body, message_id)
      select '94900000-9999-4000-8000-0000000000${tag}', '${org}', '${s.conversa}', '${s.contato}',
             '${s.agente}', '${s.versao}', '${s.sess}', '${boundary}'::jsonb,
             c.reply_context_revision, a.operation_revision, 'approved', 'texto da IA',
             'texto revisado pelo humano', '${s.msgAlvo}'
        from public.conversations c, public.ai_agents a
       where c.organization_id = '${org}' and c.id = '${s.conversa}'
         and a.organization_id = '${org}' and a.id = '${s.agente}'
         and not exists (select 1 from public.ai_reply_drafts d where d.organization_id = '${org}');
    insert into public.ai_reply_drafts
      (id, organization_id, conversation_id, contact_id, agent_id, agent_version_id, channel_session_id,
       service_boundary, context_revision, operation_revision, status, original_body, approved_body, message_id)
      select '94900000-aaaa-4000-8000-0000000000${tag}', '${org}', '${s.conversa2}', '${s.contato}',
             '${s.agente}', '${s.versao}', '${s.sessEco}', '${boundary}'::jsonb,
             c.reply_context_revision + 1, a.operation_revision, 'approved', 'texto da IA',
             'resposta revisada do eco', '${s.msgEco}'
        from public.conversations c, public.ai_agents a
       where c.organization_id = '${org}' and c.id = '${s.conversa2}'
         and a.organization_id = '${org}' and a.id = '${s.agente}'
         and not exists (select 1 from public.ai_reply_drafts d where d.organization_id = '${org}' and d.message_id = '${s.msgEco}');
  `);

  return s;
}

let A: Semente;
let B: Semente;

beforeAll(() => {
  A = semear(ORG, "01");
  B = semear(VIZINHA, "02");
});

function contar(org: string, tabela: string, onde = ""): number {
  return Number(sql(`select count(*) from public.${tabela} where organization_id = '${org}' ${onde};`));
}

describe("apagar dados operacionais alcança quem já enviou resposta revisada", () => {
  it("ANTES: a resposta revisada está ligada à mensagem (controle positivo)", () => {
    expect(contar(ORG, "ai_reply_drafts", "and message_id is not null")).toBe(2);
    expect(contar(ORG, "messages")).toBe(2);
  });

  it("apagar a MENSAGEM por motivo alheio à resposta NÃO leva a resposta revisada", () => {
    // O caminho de deduplicação de eco do gateway (v. 21770 do baseline) e a
    // exclusão de mensagem avulsa pela UI apagam `messages` sem relação com a
    // resposta. Com `on delete cascade` este `it` seria o vermelho: sobraria
    // zero. Com `set null`, some o ponteiro e fica o conteúdo.
    sql(`delete from public.messages where organization_id = '${ORG}' and id = '${A.msgEco}';`);
    expect(contar(ORG, "ai_reply_drafts")).toBe(2);
    expect(
      sql(`select approved_body from public.ai_reply_drafts
            where organization_id = '${ORG}' and id = '94900000-aaaa-4000-8000-000000000001';`),
    ).toBe("resposta revisada do eco");
    expect(
      sql(`select coalesce(message_id::text, '<null>') from public.ai_reply_drafts
            where organization_id = '${ORG}' and id = '94900000-aaaa-4000-8000-000000000001';`),
    ).toBe("<null>");
  });

  it("a Zona de perigo apaga as seis raízes e a resposta revisada vai junto", () => {
    // A MESMA ordem de `lib/settings/apagar-dados-operacionais.ts`. A primeira
    // linha é a que a issue #949 relata recusada pelo banco (23503) quando
    // existia rascunho apontando para a mensagem.
    sql(`delete from public.messages where organization_id = '${ORG}';`);
    sql(`delete from public.conversations where organization_id = '${ORG}';`);
    sql(`delete from public.calendar_appointments where organization_id = '${ORG}';`);
    sql(`delete from public.orders where organization_id = '${ORG}';`);
    sql(`delete from public.crm_leads where organization_id = '${ORG}';`);
    sql(`delete from public.contacts where organization_id = '${ORG}';`);

    for (const tabela of ["messages", "conversations", "calendar_appointments", "orders", "crm_leads", "contacts"]) {
      expect(`${tabela}=${contar(ORG, tabela)}`).toBe(`${tabela}=0`);
    }
    // O rascunho não é raiz: quem o leva é o cascade da conversa. Se ele
    // sobrevivesse, a tela teria apagado a conversa e mantido texto privado.
    expect(contar(ORG, "ai_reply_drafts")).toBe(0);
  });

  it("a organização vizinha fica intacta", () => {
    expect(contar(VIZINHA, "messages")).toBe(2);
    expect(contar(VIZINHA, "ai_reply_drafts", "and message_id is not null")).toBe(2);
  });
});
