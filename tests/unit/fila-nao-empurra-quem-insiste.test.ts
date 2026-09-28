import { describe, expect, it } from "vitest";

import { listConversationsHandler } from "@/app/api/v1/conversations/_handler";
import { esperaDaConversa } from "@/lib/inbox/comando-da-conversa";

/**
 * QUEM INSISTE NÃO DESCE NA FILA (issue #990).
 *
 * ─── O defeito, no cenário do relator ────────────────────────────────────────
 * A escreve 10h00. B escreve 10h05. A, sem resposta, escreve de novo às 10h10.
 * A Fila mostrava B NA FRENTE de A. Não é uma lista desordenada: é a pessoa que
 * mais está tentando ser atendida sendo a última a ser atendida — e explicada
 * pelo próprio código, porque a régua era `last_inbound_at`, a ÚLTIMA mensagem
 * do cliente, e essa coluna é reescrita a cada mensagem nova
 * (`fn_mark_conversation_message`). Insistir reiniciava a própria espera.
 *
 * ─── O que este arquivo mede, e o que ele NÃO mede ──────────────────────────
 * Duas coisas, e as duas sem Docker:
 *
 *   1. a RÉGUA — `awaiting_since` (migration 0267) guarda o começo da espera e
 *      não o fim dela, no cenário acima e nos dois casos de borda que decidem a
 *      coluna (a resposta do atendente, e uma saída fora de ordem);
 *   2. a ROTA — `listConversationsHandler` devolve A antes de B nesse cenário,
 *      ordenando pelo que ela PEDE ao banco — não pelo que o teste gostaria.
 *
 * O que NÃO mede: o SQL da 0267. O `CASE` que mantém a coluna é plpgsql e exige
 * Postgres; quem o prova é a suíte de invariantes, com Docker, no CI deste repo.
 * O espelho no topo deste arquivo existe para montar o cenário com os valores
 * que a 0267 produz — se ele e o SQL divergirem, a divergência aparece como o
 * cenário deixando de reproduzir o defeito, que é o pior que pode acontecer
 * aqui: um teste que passa por não testar nada.
 *
 * ─── Como o dublê ordena ────────────────────────────────────────────────────
 * O dublê de supabase da casa REGISTRA a ordem pedida. Aqui ele também a
 * APLICA: se a rota voltar a pedir `last_inbound_at` — a régua antiga —, os
 * dados de teste ordenam por ela e A cai para trás de B. Sem isso, o teste
 * continuaria verde com a rota pedindo qualquer coluna, que é exatamente a
 * classe de defeito que a #990 é.
 */

// ---------------------------------------------------------------------------
// A régua: espelho do ramo `awaiting_since` de `fn_mark_conversation_message`
// (migration 0267) — ver a nota acima sobre o alcance deste espelho.
// ---------------------------------------------------------------------------

interface Conversa {
  awaiting_since: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  last_message_at: string | null;
  service_closed_at: string | null;
}

const MENOS_INFINITO = Number.NEGATIVE_INFINITY;
const t = (iso: string | null): number => (iso === null ? MENOS_INFINITO : Date.parse(iso));
const iso = (ms: number): string | null =>
  ms === MENOS_INFINITO ? null : new Date(ms).toISOString();

/** O instante do cenário: `T("10:00")` → 2026-09-16T10:00:00.000Z */
const T = (hhmm: string): string => `2026-09-16T${hhmm}:00.000Z`;

function conversaVazia(): Conversa {
  return {
    awaiting_since: null,
    last_inbound_at: null,
    last_outbound_at: null,
    last_message_at: null,
    service_closed_at: null,
  };
}

function receber(conv: Conversa, direcao: "inbound" | "outbound", at: string): Conversa {
  const c = { ...conv };
  const p = t(at);
  const esperaAnterior = c.awaiting_since;
  const inicioDoAtendimento = t(c.service_closed_at);

  if (direcao === "inbound") {
    if (p <= t(c.last_outbound_at)) {
      // 1. Mensagem ATRASADA (escrita antes da última resposta): já respondida,
      //    não é espera — mantém o que havia.
      c.awaiting_since = esperaAnterior ?? iso(Math.max(t(c.last_inbound_at), p));
    } else if (
      t(esperaAnterior) > t(c.last_outbound_at) &&
      t(esperaAnterior) > inicioDoAtendimento
    ) {
      // 2. A espera guardada é de uma mensagem sem resposta deste atendimento:
      //    o cliente insistiu — fica o começo da espera, o mais ANTIGO dos dois.
      c.awaiting_since = iso(Math.min(t(esperaAnterior), p));
    } else {
      // 3. Não havia espera (tudo respondido), ou ela é de um atendimento já
      //    encerrado: a espera de agora começa nesta mensagem.
      c.awaiting_since = at;
    }
    c.last_inbound_at = iso(Math.max(t(c.last_inbound_at), p));
  } else {
    c.awaiting_since =
      esperaAnterior !== null && p < t(esperaAnterior)
        ? esperaAnterior
        : c.last_inbound_at;
    c.last_outbound_at = iso(Math.max(t(c.last_outbound_at), p));
  }
  c.last_message_at = iso(Math.max(t(c.last_message_at), p));
  return c;
}

describe("a régua da espera é o começo dela, não o fim (migration 0267)", () => {
  it("⭐ 10h00 · 10h05 · o cliente insiste às 10h10 — a espera dele continua sendo 10h00", () => {
    let a = conversaVazia();
    let b = conversaVazia();

    a = receber(a, "inbound", T("10:00"));
    b = receber(b, "inbound", T("10:05"));
    a = receber(a, "inbound", T("10:10"));

    // O que a Fila usava: a ÚLTIMA mensagem do cliente. É esta linha que fazia
    // A afundar — e é a razão de o defeito não ter sintoma nenhum.
    expect(a.last_inbound_at).toBe(T("10:10"));
    expect(b.last_inbound_at).toBe(T("10:05"));

    // A régua nova: quem espera desde antes vem primeiro.
    expect(a.awaiting_since).toBe(T("10:00"));
    expect(b.awaiting_since).toBe(T("10:05"));
    expect(t(a.awaiting_since)).toBeLessThan(t(b.awaiting_since));
  });

  it("a resposta do atendente encerra a espera — a bola volta para o cliente", () => {
    let a = conversaVazia();
    a = receber(a, "inbound", T("10:00"));
    a = receber(a, "inbound", T("10:10"));
    expect(a.awaiting_since).toBe(T("10:00"));

    a = receber(a, "outbound", T("10:12"));
    expect(a.awaiting_since).toBe(T("10:10"));

    // E o cliente volta a escrever: a espera recomeça AGORA — é o único momento
    // em que reiniciar está certo.
    a = receber(a, "inbound", T("10:20"));
    expect(a.awaiting_since).toBe(T("10:20"));
  });

  it("saída fora de ordem não responde a espera guardada", () => {
    let a = conversaVazia();
    a = receber(a, "inbound", T("10:00"));
    a = receber(a, "outbound", T("09:50"));
    expect(a.awaiting_since).toBe(T("10:00"));
  });

  it("mensagem atrasada do cliente não reabre espera já respondida", () => {
    let a = conversaVazia();
    a = receber(a, "inbound", T("10:00"));
    a = receber(a, "outbound", T("10:12"));
    expect(a.awaiting_since).toBe(T("10:00"));

    // Chega atrasada (escrita 10h05, entregue depois): já está respondida pela
    // saída das 10h12 — não é espera nova, e é por isso que a coluna não anda.
    a = receber(a, "inbound", T("10:05"));
    a = receber(a, "inbound", T("10:06"));
    expect(a.awaiting_since).toBe(T("10:00"));

    // A primeira mensagem escrita DEPOIS da resposta é que abre espera nova.
    a = receber(a, "inbound", T("10:15"));
    expect(a.awaiting_since).toBe(T("10:15"));
  });
});

// ---------------------------------------------------------------------------
// A rota: o cenário acima atravessando `listConversationsHandler`
// ---------------------------------------------------------------------------

interface OrdemPedida {
  coluna: string;
  opcoes: { ascending?: boolean; nullsFirst?: boolean } | undefined;
}

/**
 * Dublê que ordena DE VERDADE pela coluna pedida (e respeita `nullsFirst`).
 * Filtros implementados: `eq` e `in`, que são os que a aba Fila usa — os
 * demais são aceitos e ignorados de propósito, para o teste não virar um
 * simulador de PostgREST.
 */
function fakeSupabase(linhas: Array<Record<string, unknown>>) {
  const ordensPedidas: OrdemPedida[] = [];

  const aplicar = (rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> => {
    const ordenadas = [...rows];
    for (const ordem of [...ordensPedidas].reverse()) {
      const { coluna, opcoes } = ordem;
      const sinal = opcoes?.ascending ? 1 : -1;
      const nullsFirst = opcoes?.nullsFirst ?? false;
      ordenadas.sort((x, y) => {
        const a = x[coluna];
        const b = y[coluna];
        if (a === b) return 0;
        if (a === null || a === undefined) return nullsFirst ? -1 : 1;
        if (b === null || b === undefined) return nullsFirst ? 1 : -1;
        return a < b ? -sinal : sinal;
      });
    }
    return ordenadas;
  };

  const client = {
    from: (tabela: string) => {
      let resultado: Array<Record<string, unknown>> =
        tabela === "conversations" ? [...linhas] : [];
      let teto = Number.POSITIVE_INFINITY;

      const cadeia: Record<string, unknown> = new Proxy(
        {},
        {
          get(_alvo, prop) {
            if (prop === "then") {
              return (ok: (v: unknown) => unknown) =>
                ok({ data: aplicar(resultado).slice(0, teto), error: null });
            }
            return (...args: unknown[]) => {
              if (prop === "eq") {
                const [coluna, valor] = args as [string, unknown];
                resultado = resultado.filter((r) => r[coluna] === valor);
              } else if (prop === "in") {
                const [coluna, valores] = args as [string, unknown[]];
                resultado = resultado.filter((r) => valores.includes(r[coluna]));
              } else if (prop === "order") {
                const [coluna, opcoes] = args as [string, OrdemPedida["opcoes"] | undefined];
                ordensPedidas.push({ coluna, opcoes });
              } else if (prop === "limit") {
                teto = args[0] as number;
              }
              return cadeia;
            };
          },
        },
      );
      return cadeia;
    },
  };

  return { client: client as never, ordensPedidas };
}

const ctx = {
  organization_id: "org-1",
  requestId: "req-1",
  actor: { type: "user" as const, id: "user-1" },
} as never;

/** A conversa como a 0267 a deixa depois do cenário: `awaiting_since` no começo. */
function linha(id: string, awaitingSince: string, lastInboundAt: string) {
  return {
    id,
    organization_id: "org-1",
    comando_da_conversa: "aguardando",
    awaiting_since: awaitingSince,
    last_inbound_at: lastInboundAt,
    last_message_at: lastInboundAt,
    last_outbound_at: null,
    created_at: T("09:00"),
  };
}

describe("a aba Fila devolve o cliente que insiste na frente", () => {
  it("⭐ A (espera desde 10h00) vem antes de B (espera desde 10h05)", async () => {
    // A entrou por último no banco de propósito: a ordem não pode vir da
    // inserção, tem de vir da espera.
    const { client, ordensPedidas } = fakeSupabase([
      linha("conv-b", T("10:05"), T("10:05")),
      linha("conv-a", T("10:00"), T("10:10")),
    ]);

    const r = await listConversationsHandler(
      client,
      ctx,
      { limit: 50, comando: ["aguardando"] } as never,
    );

    expect(r.conversations.map((c) => c.id)).toEqual(["conv-a", "conv-b"]);

    // A ordem que a rota PEDIU — é ela que o dublê aplicou acima. Sem esta
    // asserção, o caso passaria a medir o dublê em vez da rota.
    expect(ordensPedidas.map((o) => o.coluna)).toEqual(["awaiting_since", "id"]);
    const primeiraOrdem = ordensPedidas[0];
    if (primeiraOrdem === undefined) throw new Error("a rota não pediu ordem nenhuma");
    expect(primeiraOrdem.opcoes).toEqual({ ascending: true, nullsFirst: false });
  });

  it("a pílula e a hora do canto leem o MESMO instante que ordena a lista", async () => {
    const { client } = fakeSupabase([
      linha("conv-b", T("10:05"), T("10:05")),
      linha("conv-a", T("10:00"), T("10:10")),
    ]);

    const r = await listConversationsHandler(
      client,
      ctx,
      { limit: 50, comando: ["aguardando"] } as never,
    );

    const primeira = r.conversations[0];
    if (primeira === undefined) throw new Error("a Fila veio vazia");
    expect(primeira.id).toBe("conv-a");
    // `last_inbound_at` diria 10h10 — a linha mostraria "há 1 min" embaixo da
    // posição 1º de quem espera desde 10h00.
    expect(esperaDaConversa(primeira)).toBe(T("10:00"));
  });

  it("quem nunca recebeu mensagem do cliente vai para o fim, não para o topo", async () => {
    const { client } = fakeSupabase([
      { ...linha("conv-sem-mensagem", T("10:00"), T("10:00")), awaiting_since: null },
      linha("conv-b", T("10:05"), T("10:05")),
    ]);

    const r = await listConversationsHandler(
      client,
      ctx,
      { limit: 50, comando: ["aguardando"] } as never,
    );

    expect(r.conversations.map((c) => c.id)).toEqual(["conv-b", "conv-sem-mensagem"]);
  });

  it("a aba de atividade recente continua por última mensagem", async () => {
    const { client, ordensPedidas } = fakeSupabase([
      linha("conv-b", T("10:05"), T("10:05")),
      linha("conv-a", T("10:00"), T("10:10")),
    ]);

    const r = await listConversationsHandler(client, ctx, { limit: 50 } as never);

    expect(ordensPedidas.map((o) => o.coluna)).toEqual([
      "last_message_at",
      "id",
    ]);
    expect(r.conversations.map((c) => c.id)).toEqual(["conv-a", "conv-b"]);
  });
});
