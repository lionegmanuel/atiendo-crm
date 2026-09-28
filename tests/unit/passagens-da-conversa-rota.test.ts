import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

/**
 * A ROTA QUE ALIMENTA O CARTÃO DA PASSAGEM — e por que ela lê com o client da
 * SESSÃO.
 *
 * ═══ O que está em jogo ═══
 *
 * A linha de `passagens_de_atendimento` carrega o que a IA concluiu sobre uma
 * pessoa: o que ela quer, o que já foi tentado, as palavras dela. A policy da
 * tabela (0291) exige TRÊS condições para ler — organização, papel `agent`+ e
 * `fn_can_view_conversation`. O service role bypassa RLS: uma leitura com admin
 * aqui entregaria o briefing de um atendimento que a política de visibilidade
 * não deixa a pessoa abrir. O link já é protegido; o TEXTO só é protegido se o
 * client for o da sessão.
 *
 * É exatamente o defeito que a Central tem e que esta entrega contornou pelo
 * outro lado (o corpo do aviso ficou curto, sem conversa). Repeti-lo aqui
 * desfaria aquilo.
 *
 * ═══ O que este arquivo NÃO prova ═══
 *
 * Que a RLS funciona — isso é `tests/invariants/passagem-isolamento-e-
 * visibilidade.test.ts`, contra um Postgres de verdade. Aqui se prova que a
 * rota ENTREGA a leitura ao client que tem RLS, que é a condição de aquilo
 * valer.
 */

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/users/nome-do-atendente", () => ({ nomesDosAtendentes: vi.fn() }));
const logError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/logger", () => ({
  logger: { error: logError, info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const ORG = "org-1";
const CONVERSA = "11111111-1111-4111-8111-111111111111";

type Linha = Record<string, unknown>;

interface Espiao {
  tabelas: string[];
  limites: number[];
  colunas: string[];
}

/**
 * Dublê que aplica `eq`, `order` e `limit`. Ignorá-los não seria simplificação:
 * um dublê que ignora `eq` deixa passar uma rota que lê a tabela inteira e a
 * asserção de isolamento fica verde sem medir nada.
 */
function bancoFalso(
  porTabela: Record<string, Linha[]>,
  opcoes: { erroEm?: string; espiao?: Espiao } = {},
) {
  const from = (tabela: string) => {
    opcoes.espiao?.tabelas.push(tabela);
    let rows = [...(porTabela[tabela] ?? [])];
    let limite = Infinity;
    const chain = {
      select: (cols?: string) => {
        if (cols) opcoes.espiao?.colunas.push(cols);
        return chain;
      },
      eq: (col: string, val: unknown) => ((rows = rows.filter((l) => l[col] === val)), chain),
      order: (col: string, o: { ascending: boolean }) => {
        rows = [...rows].sort(
          (x, y) => String(x[col]).localeCompare(String(y[col])) * (o.ascending ? 1 : -1),
        );
        return chain;
      },
      limit: (n: number) => {
        limite = n;
        opcoes.espiao?.limites.push(n);
        return chain;
      },
      maybeSingle: () =>
        Promise.resolve({
          data: opcoes.erroEm === tabela ? null : (rows[0] ?? null),
          error: opcoes.erroEm === tabela ? { message: "boom" } : null,
        }),
      then: (res: (v: unknown) => unknown) =>
        Promise.resolve({
          data: opcoes.erroEm === tabela ? null : rows.slice(0, limite),
          error: opcoes.erroEm === tabela ? { message: "boom" } : null,
        }).then(res),
    };
    return chain;
  };
  return { from } as never;
}

function passagem(over: Linha = {}): Linha {
  return {
    id: "p1",
    organization_id: ORG,
    conversation_id: CONVERSA,
    origem: "pedido_explicito",
    motivo_codigo: "requested_human",
    title: "desconto",
    body: "a narrativa",
    notes: "me passa pra uma pessoa",
    content: null,
    tentativas: [],
    cliente_avisado: true,
    aviso_motivo_codigo: null,
    caso_id: null,
    criado_em: "2026-09-18T10:00:00.000Z",
    reconhecido_em: null,
    reconhecido_por: null,
    ...over,
  };
}

async function chamaRota() {
  const { GET } = await import("@/app/api/v1/conversations/[id]/passagens/route");
  const res = await GET(new NextRequest(`http://x/api/v1/conversations/${CONVERSA}/passagens`), {
    params: Promise.resolve({ id: CONVERSA }),
  });
  return {
    status: res.status,
    body: (await res.json()) as { data?: Linha[]; error?: { code: string; message: string } },
  };
}

beforeEach(() => {
  logError.mockReset();
  vi.mocked(createAdminClient).mockReset();
  vi.mocked(nomesDosAtendentes).mockResolvedValue(new Map());
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: "u-eu", idioma: "pt-BR" },
    org: { orgId: ORG, name: "Org", role: "agent" },
  } as never);
});

describe("GET /api/v1/conversations/[id]/passagens", () => {
  it("devolve as passagens daquela conversa, em ordem cronológica", async () => {
    vi.mocked(createClient).mockResolvedValue(
      bancoFalso({
        conversations: [{ id: CONVERSA, organization_id: ORG }],
        passagens_de_atendimento: [
          passagem({ id: "p2", criado_em: "2026-09-18T11:00:00.000Z" }),
          passagem({ id: "p1", criado_em: "2026-09-18T10:00:00.000Z" }),
        ],
      }),
    );

    const { status, body } = await chamaRota();

    expect(status).toBe(200);
    expect(body.data?.map((l) => l.id)).toEqual(["p1", "p2"]);
  });

  it("a leitura dos DADOS usa o client da sessão — o admin não toca a tabela", async () => {
    // A policy da tabela é o que faz `visibility_mode` valer para o TEXTO.
    // `createAdminClient` bypassa RLS; se ele aparecer aqui, o briefing de um
    // atendimento de outra pessoa é entregue a qualquer `agent` da organização.
    const espiao: Espiao = { tabelas: [], limites: [], colunas: [] };
    vi.mocked(createClient).mockResolvedValue(
      bancoFalso(
        {
          conversations: [{ id: CONVERSA, organization_id: ORG }],
          passagens_de_atendimento: [passagem()],
        },
        { espiao },
      ),
    );

    await chamaRota();

    expect(espiao.tabelas).toContain("passagens_de_atendimento");
    expect(vi.mocked(createAdminClient)).not.toHaveBeenCalled();
  });

  it("conversa de outra organização devolve 404, e não uma lista vazia", async () => {
    // Lista vazia com 200 diria "esta conversa não teve passagem nenhuma" sobre
    // uma conversa que não é desta organização — vazando a existência dela.
    vi.mocked(createClient).mockResolvedValue(
      bancoFalso({
        conversations: [{ id: CONVERSA, organization_id: "org-2" }],
        passagens_de_atendimento: [passagem()],
      }),
    );

    const { status, body } = await chamaRota();

    expect(status).toBe(404);
    expect(body.error?.code).toBe("not_found");
  });

  it("papel abaixo de `agent` nem chega ao banco", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: "forbidden", message: "não" } }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    } as never);
    const chamouOBanco = vi.fn();
    vi.mocked(createClient).mockImplementation((() => {
      chamouOBanco();
      return Promise.resolve(bancoFalso({}));
    }) as never);

    const { status } = await chamaRota();

    expect(status).toBe(403);
    expect(chamouOBanco).not.toHaveBeenCalled();
  });

  it("há teto de linhas — uma conversa patológica não devolve a tabela inteira", async () => {
    const espiao: Espiao = { tabelas: [], limites: [], colunas: [] };
    vi.mocked(createClient).mockResolvedValue(
      bancoFalso(
        {
          conversations: [{ id: CONVERSA, organization_id: ORG }],
          passagens_de_atendimento: [passagem()],
        },
        { espiao },
      ),
    );

    await chamaRota();

    expect(espiao.limites.length).toBeGreaterThan(0);
    expect(Math.max(...espiao.limites)).toBeLessThanOrEqual(50);
  });

  it("o nome de quem assumiu é resolvido, e vem junto da linha", async () => {
    vi.mocked(nomesDosAtendentes).mockResolvedValue(new Map([["u-joana", "Joana"]]));
    vi.mocked(createClient).mockResolvedValue(
      bancoFalso({
        conversations: [{ id: CONVERSA, organization_id: ORG }],
        passagens_de_atendimento: [
          passagem({ reconhecido_em: "2026-09-18T11:00:00.000Z", reconhecido_por: "u-joana" }),
        ],
      }),
    );

    const { status, body } = await chamaRota();

    expect(status).toBe(200);
    expect(body.data?.[0]?.reconhecido_por_nome).toBe("Joana");
  });

  it("sem nome resolvido a linha ainda diz que HÁ dono — o nome é cortesia", async () => {
    // Self-host sem service role devolve mapa vazio, por decisão declarada em
    // `lib/users/nome-do-atendente.ts`. Cair para `reconhecido_por: null` aqui
    // faria o cartão ler a passagem como DEVOLVIDA ao automático.
    vi.mocked(nomesDosAtendentes).mockResolvedValue(new Map());
    vi.mocked(createClient).mockResolvedValue(
      bancoFalso({
        conversations: [{ id: CONVERSA, organization_id: ORG }],
        passagens_de_atendimento: [
          passagem({ reconhecido_em: "2026-09-18T11:00:00.000Z", reconhecido_por: "u-joana" }),
        ],
      }),
    );

    const { body } = await chamaRota();

    expect(body.data?.[0]?.reconhecido_por).toBe("u-joana");
    expect(body.data?.[0]?.reconhecido_por_nome).toBeNull();
  });

  it("erro do banco vira 500 sem devolver a mensagem crua", async () => {
    vi.mocked(createClient).mockResolvedValue(
      bancoFalso(
        {
          conversations: [{ id: CONVERSA, organization_id: ORG }],
          passagens_de_atendimento: [passagem()],
        },
        { erroEm: "passagens_de_atendimento" },
      ),
    );

    const { status, body } = await chamaRota();

    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("boom");
    expect(logError).toHaveBeenCalled();
  });
});
