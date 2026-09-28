import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O CRON DE RETENÇÃO DE MÍDIA AUDITA A RODADA QUE SÓ EXPURGOU, E DIZ QUANTAS
 * LINHAS SAÍRAM DA FILA (issue #1765).
 *
 * ─── O defeito, medido ──────────────────────────────────────────────────────
 *
 * A 0434 (#1739) passou a expurgar, no CORPO de
 * `fn_enfileirar_midia_vencida`, a linha `deleted` da RETENÇÃO com mais de 90
 * dias. O DELETE apaga linha de verdade e roda todo dia — e nenhuma contagem
 * sua chegava a lugar nenhum:
 *
 *   - a função devolvia só `{vencidas, orfas}`, então o cron somava
 *     `vencidas + orfas` e a sua condição de auditoria era
 *     `total.vencidas + total.orfas > 0`. A rodada que SÓ expurgou saía com as
 *     duas zeradas e **não auditava**: as linhas que saíram da fila ficavam
 *     sem rastro, e a linha `retention.sweep_run` que existia em outras
 *     rodadas não dizia quantas saíram.
 *
 * ─── Por que estes casos são de COMPORTAMENTO, e não de fonte ──────────────
 *
 * A forma da condição (`> 0`, `||`, `!== 0`) não prova a regra: `> 0 || true`
 * audita sempre — que é o defeito irmão que o
 * `cron-audita-so-quando-ha-efeito.test.ts` mede na CLASSE das rotas. O que
 * importa aqui é o número que a rota devolve por chamada, e ele só se mede
 * dirigindo a rota com o `rpc` dobrado. As duas direções são cobradas, porque
 * "parar de auditar" trocaria cegueira por ruído: a rodada vazia tem de
 * calar, e a que expurgou tem de falar.
 *
 * O laço de TANDAS merece atenção: `MAX_TANDAS` é 10, e o expurgo é livre de
 * `p_limite` — a segunda chamada da mesma rodada devolve `expurgadas: 0`
 * para ele. Se o expurgo entrasse na condição de PARADA, a rodada que ainda
 * tem 500 vencidas para enfileirar pararia depois da primeira tanda. O
 * último caso mede isso, porque é o modo de falha que a correção introduz.
 */
const SEGREDO = "segredo-de-cron-do-teste-1765";

vi.mock("@/lib/env", () => ({
  env: {
    INTERNAL_CRON_SECRET: SEGREDO,
    INTERNAL_SECRET: "",
    JOB_QUEUE_RETENTION_DAYS: "",
    AUDIT_LOG_RETENTION_DAYS: "",
  },
}));

const auditou = vi.fn();
vi.mock("@/lib/audit", () => ({ audit: (...args: unknown[]) => auditou(...args) }));

/** O que cada chamada do `rpc` devolve nesta rodada. */
let respostasRpc: Array<{ vencidas?: number; orfas?: number; expurgadas?: number }> = [];
let chamadasRpc = 0;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async () => {
      const r = respostasRpc[Math.min(chamadasRpc, respostasRpc.length - 1)] ?? {};
      chamadasRpc += 1;
      return { data: r, error: null };
    },
  }),
}));

function requisicaoAutorizada(): Parameters<
  typeof import("@/app/api/v1/cron/media-retention/route").GET
>[0] {
  // As rotas só leem `headers.get("authorization")`; montar um `NextRequest` de
  // verdade traria o runtime do Next para dentro de um teste que não o exercita.
  return { headers: new Headers({ authorization: `Bearer ${SEGREDO}` }) } as never;
}

async function chamarRota() {
  const { GET } = await import("@/app/api/v1/cron/media-retention/route");
  const resposta = await GET(requisicaoAutorizada());
  return resposta.json() as Promise<{ data: Record<string, number> }>;
}

/** A linha de `retention.sweep_run` da rodada, se houver. */
function linhaDaTrilha(): Record<string, number> | undefined {
  const chamada = auditou.mock.calls.at(-1)?.[0] as
    | { action?: string; metadata?: Record<string, number> }
    | undefined;
  if (chamada?.action !== "retention.sweep_run") return undefined;
  return chamada.metadata;
}

beforeEach(() => {
  auditou.mockClear();
  chamadasRpc = 0;
  respostasRpc = [{ vencidas: 0, orfas: 0, expurgadas: 0 }];
});

describe("media-retention — a contagem do expurgo chega à trilha (0435)", () => {
  it("a rodada que SÓ expurgou AUDITA e diz quantas linhas saíram da fila", () => {
    // O caso que hoje não audita: nada vencida, nada órfão, duas linhas de
    // fila expurgadas. Antes da 0435 esta rodada saía com `vencidas + orfas =
    // 0` e nenhuma linha na trilha.
    respostasRpc = [{ vencidas: 0, orfas: 0, expurgadas: 2 }];

    return chamarRota().then((corpo) => {
      expect(auditou).toHaveBeenCalledTimes(1);
      expect(corpo.data).toMatchObject({ vencidas: 0, orfas: 0, expurgadas: 2 });
      // E a metadata diz o essencial: quantas linhas SAÍRAM DA FILA.
      expect(linhaDaTrilha()).toMatchObject({ origem: "media-retention", expurgadas: 2 });
    });
  });

  it("rodada sem nada a fazer continua calada (a direção que não pode se perder)", () => {
    // Se a contagem do expurgo tivesse virado «audita sempre», este seria o
    // caso que regride: batida diária numa tabela append-only.
    respostasRpc = [{ vencidas: 0, orfas: 0, expurgadas: 0 }];

    return chamarRota().then((corpo) => {
      expect(auditou).not.toHaveBeenCalled();
      expect(corpo.data).toMatchObject({ vencidas: 0, orfas: 0, expurgadas: 0 });
    });
  });

  it("a rodada que enfileira continua auditando, e agora também diz o que expurgou", () => {
    respostasRpc = [{ vencidas: 3, orfas: 1, expurgadas: 5 }];

    return chamarRota().then((corpo) => {
      expect(auditou).toHaveBeenCalledTimes(1);
      expect(corpo.data).toMatchObject({ vencidas: 3, orfas: 1, expurgadas: 5 });
      expect(linhaDaTrilha()).toMatchObject({ vencidas: 3, orfas: 1, expurgadas: 5 });
    });
  });

  it("a contagem é SOMADA entre as tandas, e a última tanda que enfileirou decide a rodada", () => {
    // Três chamadas: a primeira e a segunda enfileiram 500 (tanda cheia, o
    // laço continua), a terceira enfileira 4 e expurga 7 — e é a sua que
    // fecha a rodada. A soma no acumulado é o que o operador lê.
    respostasRpc = [
      { vencidas: 500, orfas: 0, expurgadas: 0 },
      { vencidas: 500, orfas: 0, expurgadas: 3 },
      { vencidas: 4, orfas: 0, expurgadas: 7 },
    ];

    return chamarRota().then((corpo) => {
      expect(corpo.data).toMatchObject({ vencidas: 1004, orfas: 0, expurgadas: 10, tandas: 3 });
      expect(linhaDaTrilha()).toMatchObject({ vencidas: 1004, expurgadas: 10, tandas: 3 });
    });
  });

  it("o expurgo NÃO interrompe o laço: a tanda que enfileira continua enfileirando", () => {
    // O expurgo é livre de `p_limite`: na segunda chamada da MESMA rodada ele
    // já devolve 0. Se ele entrasse na condição de parada (`vencidas < TANDA &&
    // orfas < TANDA` virando também `expurgadas < TANDA`), uma instalação com
    // mais de 500 vencidas pararia depois da primeira tanda e levaria dez
    // rodadas para enfileirar o que cabia numa.
    respostasRpc = [
      { vencidas: 500, orfas: 0, expurgadas: 4 },
      { vencidas: 12, orfas: 0, expurgadas: 0 },
    ];

    return chamarRota().then((corpo) => {
      expect(chamadasRpc).toBe(2);
      expect(corpo.data).toMatchObject({ vencidas: 512, expurgadas: 4, tandas: 2 });
    });
  });

  it("uma função antiga (sem a chave `expurgadas`) não quebra a rodada", () => {
    // A 0435 pode ainda não ter rodado no banco de uma instalação que não
    // atualizou: a leitura tem de tolerar a chave ausente, como já tolerava
    // as outras duas. Com o `?? 0`, a rodada segue e a de vencidas audita
    // normalmente.
    respostasRpc = [{ vencidas: 1, orfas: 0 }];

    return chamarRota().then((corpo) => {
      expect(corpo.data).toMatchObject({ vencidas: 1, orfas: 0, expurgadas: 0 });
      expect(auditou).toHaveBeenCalledTimes(1);
    });
  });
});
