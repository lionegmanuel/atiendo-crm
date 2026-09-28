import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { ingestMetaInbound } from "@/lib/channels/meta/ingest";
import type { InboundMessageEvent } from "@/lib/channels/meta/webhook";

/**
 * A ORGANIZAÇÃO dona de uma mensagem recebida vem do TOKEN, não do corpo.
 *
 * ─── O defeito, e por que ele não era brando (issue #236) ───────────────────
 * `sessionByPhoneNumberId` filtrava só por `meta_phone_number_id` — um valor do
 * CORPO do webhook — num client de service role, que bypassa RLS. O comentário
 * logo acima dela dizia "nunca confiamos no corpo para escolher organização
 * (regra dura de tenancy)", e a consulta fazia exatamente isso.
 *
 * Com duas organizações usando o mesmo número (configuração LEGÍTIMA: agência,
 * migração de conta entre organizações), `maybeSingle()` casa duas linhas e
 * devolve `data: null` com `error PGRST116` — medido contra
 * @supabase/postgrest-js 2.112.1. O `error` era DESCARTADO, então o desfecho era
 * `no_session`, a rota respondia **200**, e a mensagem que o cliente acabou de
 * mandar sumia para as DUAS organizações, com log e sem erro visível.
 *
 * Os casos abaixo cobram as duas metades separadas, porque elas pedem ações
 * diferentes do operador: "não achei a sessão" e "não consegui perguntar".
 */

const EVENTO: InboundMessageEvent = {
  kind: "inbound_message",
  wabaId: "waba-1",
  phoneNumberId: "111",
  externalId: "wamid.TESTE236",
  from: "5531998966398",
  profileName: "Cliente",
  sentAt: new Date("2026-08-20T12:00:00.000Z"),
  type: "text",
  text: "oi",
  // Obrigatório no tipo, e não opcional: `null` é o estado normal de mensagem
  // de texto. Deixá-lo de fora fazia o typecheck reprovar (TS2741).
  media: null,
};

interface Consulta {
  tabela: string;
  filtros: Record<string, unknown>;
}

type Resposta = { data: unknown; error: { code: string; message: string } | null };

/**
 * Client de mentira que REGISTRA os filtros e RESPONDE EM FUNÇÃO DELES.
 *
 * Registrar em vez de só devolver dados é o ponto: o que este arquivo precisa
 * provar é POR QUAIS COLUNAS a sessão foi procurada — um stub que devolvesse a
 * linha certa passaria verde mesmo com o filtro de organização removido.
 *
 * E responder em função dos filtros é o que torna o caso do clone sem a
 * migration 0106 honesto: um banco sem a coluna recusa a consulta que a
 * FILTRA e aceita a que não filtra. Um stub que devolve o mesmo erro nas duas
 * passadas testaria um banco que não existe.
 */
function adminFalso(responder: (filtros: Record<string, unknown>) => Resposta) {
  const consultas: Consulta[] = [];
  const from = (tabela: string) => {
    const filtros: Record<string, unknown> = {};
    const alvo: Record<string, unknown> = {
      select: () => alvo,
      eq: (coluna: string, valor: unknown) => {
        filtros[coluna] = valor;
        return alvo;
      },
      is: (coluna: string, valor: unknown) => {
        filtros[coluna] = valor;
        return alvo;
      },
      in: (coluna: string, valor: unknown) => {
        filtros[coluna] = valor;
        return alvo;
      },
      limit: () => alvo,
      insert: () => alvo,
      maybeSingle: async () => {
        consultas.push({ tabela, filtros });
        return responder(filtros);
      },
    };
    return alvo;
  };
  return {
    consultas,
    client: { from, rpc: async () => ({ data: null, error: null }) } as unknown as SupabaseClient,
  };
}

const VAZIO: Resposta = { data: null, error: null };

const ORG_DO_TOKEN = "11111111-0000-4000-8000-000000000001";

describe("ingestão do canal oficial — a organização vem do token", () => {
  it("procura a sessão pela ORGANIZAÇÃO e pelo número, e só entre as ativas", () => {
    const { client, consultas } = adminFalso(() => VAZIO);
    return ingestMetaInbound(client, EVENTO, { organizationId: ORG_DO_TOKEN }).then(() => {
      expect(consultas[0]?.tabela).toBe("channel_sessions");
      expect(consultas[0]?.filtros).toEqual({
        organization_id: ORG_DO_TOKEN,
        meta_phone_number_id: "111",
        archived_at: null,
      });
    });
  });

  it("número que a organização não administra é no_session — e nada é gravado", async () => {
    const { client, consultas } = adminFalso(() => VAZIO);
    const r = await ingestMetaInbound(client, EVENTO, { organizationId: ORG_DO_TOKEN });
    expect(r).toEqual({ status: "no_session" });
    // Uma consulta só: a de sessão. Não chegou a tocar contato nem mensagem.
    expect(consultas.map((c) => c.tabela)).toEqual(["channel_sessions"]);
  });

  it("consulta que FALHA vira `failed` com o motivo, nunca `no_session`", async () => {
    // PGRST116 é literalmente o que o PostgREST devolve quando duas linhas casam
    // — o desfecho da colisão que a migration 0165 passa a tornar impossível. Um
    // clone que ainda não aplicou a trava tem de FALHAR ALTO em vez de descartar
    // a mensagem em silêncio com HTTP 200.
    const { client, consultas } = adminFalso(() => ({
      data: null,
      error: { code: "PGRST116", message: "Results contain 2 rows, ... requires 1 row" },
    }));
    const r = await ingestMetaInbound(client, EVENTO, { organizationId: ORG_DO_TOKEN });
    expect(r.status).toBe("failed");
    expect(r.status === "failed" && r.reason).toContain("PGRST116");
    expect(consultas.map((c) => c.tabela)).toEqual(["channel_sessions"]);
  });

  it("42703 (clone sem a migration 0106) NÃO é falha: repete sem o recorte", async () => {
    // A tolerância à coluna ausente é o caminho de quem subiu o código sem a
    // migration de arquivamento. Tratá-la como erro derrubaria a ingestão de um
    // clone inteiro — e é justamente o caso em que a mensagem PRECISA entrar.
    const { client, consultas } = adminFalso((filtros) =>
      "archived_at" in filtros
        ? {
            data: null,
            error: {
              code: "42703",
              message: "column channel_sessions_1.archived_at does not exist",
            },
          }
        : VAZIO,
    );
    const r = await ingestMetaInbound(client, EVENTO, { organizationId: ORG_DO_TOKEN });
    expect(r).toEqual({ status: "no_session" });
    // Duas passadas: com o recorte (que falhou) e sem ele. A segunda mantém o
    // filtro de organização — perder o escopo no fallback seria trocar um
    // defeito de schema por um vazamento entre organizações.
    expect(consultas).toHaveLength(2);
    expect(consultas[1]?.filtros).toEqual({
      organization_id: ORG_DO_TOKEN,
      meta_phone_number_id: "111",
    });
  });
});
