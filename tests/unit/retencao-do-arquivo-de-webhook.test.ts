import { describe, expect, it, vi } from "vitest";

import { podarArquivoDeWebhooks } from "@/lib/channels/retencao-do-arquivo";

/**
 * A PODA NÃO PODE VIRAR O PROBLEMA QUE ELA RESOLVE.
 *
 * ─── O defeito que ela conserta ─────────────────────────────────────────────
 *
 * `webhook_events_log` nunca foi podado. Medido numa instalação real em
 * 20/08/2026: 468 MB de 545 MB do banco inteiro (86%), todas as 56.291 linhas
 * dos últimos 20 dias — ~23 MB/dia, sem teto, contra os 500 MB do plano
 * gratuito do Supabase.
 *
 * ─── Por que os casos são sobre o que ela NÃO faz ───────────────────────────
 *
 * Uma poda erra de três formas, e as três são caras de descobrir em produção:
 * apagando o que ainda serve, segurando a tabela em que todo webhook escreve,
 * ou escrevendo de novo o que já escreveu. Por isso quase todo caso aqui é um
 * limite, não um caminho feliz.
 *
 * A ORDEM do DELETE e o CANAL da falha não moram aqui: medidos em
 * `retencao-arquivo-webhooks-ordena-e-fala-a-falha.test.ts`, o arquivo criado
 * junto com o conserto do #1769.
 */

interface Chamada {
  tabela: string;
  op: string;
  valores?: Record<string, unknown>;
  ids?: string[];
}

/** Duble mínimo do client: registra o que foi pedido, devolve o que mandarem. */
function fakeAdmin(opts: { alvos?: { id: string }[]; apagadas?: { id: string }[] } = {}) {
  const chamadas: Chamada[] = [];
  const admin = {
    from(tabela: string) {
      const ctx: Chamada = { tabela, op: "" };
      const q: Record<string, unknown> = {
        select() { if (!ctx.op) ctx.op = "select"; return q; },
        is() { return q; },
        lt() { return q; },
        order() { return q; },
        in(_c: string, ids: string[]) { ctx.ids = ids; return q; },
        update(valores: Record<string, unknown>) { ctx.op = "update"; ctx.valores = valores; return q; },
        delete() { ctx.op = "delete"; return q; },
        limit() {
          chamadas.push(ctx);
          return ctx.op === "delete"
            ? Promise.resolve({ data: opts.apagadas ?? [], error: null })
            : Promise.resolve({ data: opts.alvos ?? [], error: null });
        },
        then(res: (v: unknown) => unknown) {
          chamadas.push(ctx);
          return Promise.resolve({ data: null, error: null }).then(res);
        },
      };
      return q;
    },
  };
  return { admin: admin as never, chamadas };
}

describe("a poda esvazia, mas não apaga o que ainda serve", () => {
  it("descarta as TRÊS colunas pesadas e nada mais", async () => {
    // São ~97% do peso. Esvaziar só uma delas deixaria o problema de pé, e
    // esvaziar uma quarta (provider, tipo, horário) mataria o índice forense —
    // que é a razão de esvaziar em vez de apagar.
    const { admin, chamadas } = fakeAdmin({ alvos: [{ id: "a" }, { id: "b" }] });
    await podarArquivoDeWebhooks(admin, { diasComCorpo: 7, diasParaApagar: 90 });

    const update = chamadas.find((c) => c.op === "update");
    expect(update?.valores).toMatchObject({ raw_body: null, payload_parsed: null, headers: null });
    expect(Object.keys(update?.valores ?? {}).sort()).toEqual(
      ["archived_at", "headers", "payload_parsed", "raw_body"],
    );
  });

  it("carimba `archived_at` — sem ele, NULL vira ambíguo", async () => {
    // NULL sem carimbo não distingue "a poda passou" de "o arquivo falhou ao
    // gravar". Quem investigar depois precisa saber qual dos dois foi.
    const { admin, chamadas } = fakeAdmin({ alvos: [{ id: "a" }] });
    await podarArquivoDeWebhooks(admin, { diasComCorpo: 7, diasParaApagar: 90 });
    expect(chamadas.find((c) => c.op === "update")?.valores?.archived_at).toBeTypeOf("string");
  });

  it("não escreve nada quando não há linha velha", async () => {
    // Rodando de minuto em minuto, o caso NORMAL é não ter trabalho. Uma poda
    // que escreve à toa é a mesma doença do worker que perguntava 4×/s.
    const { admin, chamadas } = fakeAdmin({ alvos: [] });
    const r = await podarArquivoDeWebhooks(admin, { diasComCorpo: 7, diasParaApagar: 90 });
    expect(r.esvaziadas).toBe(0);
    expect(chamadas.some((c) => c.op === "update")).toBe(false);
  });
});

describe("o lote é o que impede a poda de derrubar a entrada", () => {
  it("pede no MÁXIMO o tamanho do lote", async () => {
    const { admin } = fakeAdmin({ alvos: Array.from({ length: 3 }, (_, i) => ({ id: `x${i}` })) });
    const r = await podarArquivoDeWebhooks(admin, { diasComCorpo: 7, diasParaApagar: 90, lote: 3 });
    // Lote cheio = ainda há fila. É o sinal de que a varredura não alcançou o
    // regime estável — no primeiro dia são dezenas de milhares atrasadas.
    expect(r.temMais).toBe(true);
  });

  it("lote com folga significa fila vazia", async () => {
    const { admin } = fakeAdmin({ alvos: [{ id: "x" }] });
    const r = await podarArquivoDeWebhooks(admin, { diasComCorpo: 7, diasParaApagar: 90, lote: 500 });
    expect(r.temMais).toBe(false);
  });
});

describe("falha do banco na BUSCA não derruba a rodada", () => {
  it("erro ao escolher devolve zero, não lança", async () => {
    // Este cron roda ao lado dos que entregam mensagem. Uma exceção aqui não
    // pode virar 500 numa rota que o scheduler chama de minuto em minuto.
    //
    // O escopo deste caso é o PASSO 1, e ele é estreito de propósito: a busca
    // é idempotente e o mesmo lote volta a ser escolhido na rodada seguinte de
    // 5 em 5 minutos, enquanto o DELETE do passo 2 é a linha que some para
    // sempre. Por isso a falha da busca continua devolvendo zero — e a do
    // DELETE passou a SUBIR no #1769, com a mesma régua da poda irmã. Os dois
    // canais estão medidos em
    // `retencao-arquivo-webhooks-ordena-e-fala-a-falha.test.ts`.
    const admin = {
      from: () => ({
        select: () => ({ is: () => ({ lt: () => ({ order: () => ({
          limit: () => Promise.resolve({ data: null, error: { message: "timeout" } }),
        }) }) }) }),
      }),
    } as never;
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(podarArquivoDeWebhooks(admin, { diasComCorpo: 7, diasParaApagar: 90 }))
      .resolves.toMatchObject({ esvaziadas: 0, apagadas: 0 });
    aviso.mockRestore();
  });
});
