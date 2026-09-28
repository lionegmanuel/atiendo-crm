import { beforeAll, describe, expect, it } from "vitest";

import {
  GOV_AGENT_A,
  GOV_AGENT_B,
  GOV_ORG,
  GOV_SESSION,
  countAs,
  lastLine,
  seedGov,
  sql,
} from "./gov-helpers";

/**
 * Migration 0173 — ASSUMIR CALA O ATENDIMENTO AUTOMÁTICO.
 *
 * ## O defeito que este arquivo vigia
 *
 * Medido no HEAD 927dfa51: `lib/agent-engine/` nunca lê `assignee_kind` nem
 * `assigned_to_user_id` (`grep -rn` → rc=1) e `fn_conversation_assign` nunca
 * tocava `bot_silenced_until`. Um atendente clicava "Assumir" e o automático
 * seguia respondendo o MESMO cliente — dois atores na mesma conversa. O guard
 * existe desde a decisão G3-02 e só o worker LEGADO o implementa; o motor
 * moderno regrediu.
 *
 * O conserto mora na função de atribuição justamente porque `bot_silenced_until`
 * é o gate que o motor JÁ lê — nenhuma linha do motor mudou. Isso é o que faz o
 * comportamento ser invisível para qualquer teste de TypeScript: ele vive numa
 * função PL/pgSQL. Sem este arquivo, a peça central da entrega não tinha guarda
 * nenhuma, e um `create or replace` futuro a apagaria em silêncio.
 *
 * ## Os três braços, e por que cada um é um caso separado
 *
 * O braço do rodízio é o mais fácil de apagar sem perceber e o mais caro: o
 * trigger `trg_conversation_routing_requested` dispara em TODA conversa nova e o
 * worker roda de 1 em 1 minuto, então uma org em `round_robin` que passe a calar
 * na atribuição fica sem atendimento automático nenhum — na PRIMEIRA mensagem da
 * vida de cada cliente, numa tela de configuração que não menciona IA.
 */
const CMD_CONTACT = "dddddddd-3333-4000-8000-000000000009";
const CMD_CONV = "dddddddd-4444-4000-8000-000000000009";

/** O valor CRU da coluna — `infinity` não é uma data, é um literal do Postgres. */
function silencioDaConversa(): string {
  return lastLine(
    sql(
      `select coalesce(bot_silenced_until::text, '(null)')
         from public.conversations where id = '${CMD_CONV}';`,
    ),
  );
}

function atribuirComo(userId: string, args: string): number {
  return countAs(
    userId,
    `select count(*) from public.fn_conversation_assign(
       '${GOV_ORG}'::uuid, '${CMD_CONV}'::uuid, ${args})`,
  );
}

beforeAll(() => {
  seedGov();
  sql(`
    insert into public.contacts (id, organization_id, display_name)
      values ('${CMD_CONTACT}', '${GOV_ORG}', 'Contato do comando')
      on conflict do nothing;
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status)
      values ('${CMD_CONV}', '${GOV_ORG}', '${CMD_CONTACT}', '${GOV_SESSION}', 'open')
      on conflict do nothing;
  `);
});

describe("0173 — o comando da conversa muda o silêncio do automático", () => {
  it("o ponto de partida é automático ATIVO (controle)", () => {
    // Sem esta asserção, um `infinity` no caso seguinte não distinguiria "o claim
    // calou" de "já estava calado desde o seed".
    expect(silencioDaConversa()).toBe("(null)");
  });

  it("claim CALA o automático: bot_silenced_until vira 'infinity'", () => {
    expect(atribuirComo(GOV_AGENT_A, `'${GOV_AGENT_A}'::uuid, 'claim', null::uuid, true`)).toBe(1);
    expect(silencioDaConversa()).toBe("infinity");
  });

  it("transfer MANTÉM o automático calado: quem recebe também está no comando", () => {
    expect(
      atribuirComo(GOV_AGENT_A, `'${GOV_AGENT_B}'::uuid, 'transfer', null::uuid, false`),
    ).toBe(1);
    expect(silencioDaConversa()).toBe("infinity");
  });

  it("release DEVOLVE o comando: o silêncio é limpo", () => {
    expect(
      atribuirComo(GOV_AGENT_B, `null::uuid, 'release', '${GOV_AGENT_B}'::uuid, true`),
    ).toBe(1);
    expect(silencioDaConversa()).toBe("(null)");
  });

  it("routing NÃO mexe no silêncio — distribuir não é assumir", () => {
    // O caso que impede a regressão cara. Se este virar 'infinity', toda org em
    // round_robin perde o atendimento automático inteiro, porque o trigger
    // enfileira TODA conversa nova e o worker atribui em ≤1 min.
    expect(silencioDaConversa()).toBe("(null)");
    expect(
      atribuirComo(GOV_AGENT_A, `'${GOV_AGENT_A}'::uuid, 'routing', null::uuid, false`),
    ).toBe(1);
    expect(silencioDaConversa()).toBe("(null)");
  });

  it("release NÃO desfaz uma ESCALAÇÃO — só solta o silêncio que um humano pôs", () => {
    // O DEFEITO QUE ESTE CASO EXISTE PARA IMPEDIR, e ele já esteve aqui:
    // a primeira versão limpava `bot_silenced_until` em TODO release, com a
    // justificativa de que "quem escalou também gravou contacts.force_human".
    // Medido, é FALSO para `triggerHandoff` — o escalador do MCP
    // `crm_request_human_handoff`, do handler de sentimento, do worker legado e do
    // teto de gasto (`grep -n force_human lib/ai/handoff/orchestrator.ts` → rc=1).
    // Nesses caminhos o silêncio é a ÚNICA trava, e apagá-la fazia o robô voltar a
    // responder um cliente que pediu uma pessoa: dois atores no mesmo cliente, na
    // direção OPOSTA à do defeito original.
    //
    // O discriminador é `last_handoff_at`: uma escalação o carimba, um humano
    // assumindo não.
    sql(`update public.conversations
            set bot_silenced_until = 'infinity',
                last_handoff_at = now(),
                last_handoff_reason = 'legal_mention',
                assigned_to_user_id = null,
                assignee_kind = null,
                status = 'pending'
          where id = '${CMD_CONV}';`);

    // Uma pessoa assume o caso escalado…
    expect(atribuirComo(GOV_AGENT_A, `'${GOV_AGENT_A}'::uuid, 'claim', null::uuid, false`)).toBe(1);
    expect(silencioDaConversa()).toBe("infinity");

    // …vê que não é com ela, e libera. O silêncio da ESCALAÇÃO tem de sobreviver.
    expect(
      atribuirComo(GOV_AGENT_A, `null::uuid, 'release', '${GOV_AGENT_A}'::uuid, true`),
    ).toBe(1);
    expect(silencioDaConversa()).toBe("infinity");

    // O CONTROLE: sem o carimbo de escalação, o mesmo release limpa. Sem esta
    // metade, um `infinity` acima passaria por "a função nunca limpa nada".
    sql(`update public.conversations
            set last_handoff_at = null, last_handoff_reason = null
          where id = '${CMD_CONV}';`);
    expect(atribuirComo(GOV_AGENT_A, `'${GOV_AGENT_A}'::uuid, 'claim', null::uuid, false`)).toBe(1);
    expect(
      atribuirComo(GOV_AGENT_A, `null::uuid, 'release', '${GOV_AGENT_A}'::uuid, true`),
    ).toBe(1);
    expect(silencioDaConversa()).toBe("(null)");
  });

  it("routing também não LIMPA um silêncio que já existia", () => {
    // O outro lado do mesmo braço: a conversa que o automático escalou
    // (silêncio 'infinity' + force_human) não pode ser destravada por um rodízio
    // que só queria escolher um atendente.
    sql(`update public.conversations
            set bot_silenced_until = 'infinity'
          where id = '${CMD_CONV}';`);
    expect(
      atribuirComo(GOV_AGENT_A, `'${GOV_AGENT_B}'::uuid, 'routing', null::uuid, false`),
    ).toBe(1);
    expect(silencioDaConversa()).toBe("infinity");
  });
});
