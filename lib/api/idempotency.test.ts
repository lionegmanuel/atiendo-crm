/**
 * Idempotência de POST — o que o helper promete, e como ele fecha a corrida.
 *
 * O caso que dá sentido ao resto: no replay o efeito **não roda de novo**.
 * Um helper que devolvesse a resposta gravada mas executasse o efeito outra
 * vez passaria numa asserção de "mesma resposta" e ainda assim duplicaria a
 * criação — por isso a asserção é no call-site do efeito, não só no retorno.
 *
 * O caso (8) era a LIMITAÇÃO DECLARADA (as duas requisições simultâneas
 * executavam as duas) e virou o guarda da decisão no sentido oposto: agora ele
 * fica vermelho se alguém reabrir a corrida. Quem mexer no helper vai ler o
 * porquê aqui e no cabeçalho de `lib/api/idempotency.ts`.
 *
 * ═══ O DUBLÊ MENTE SE NÃO IMITAR DUAS COISAS DO POSTGRES ═══
 *
 * 1. O índice único `idempotency_keys_organization_id_key_endpoint_key` NÃO
 *    filtra por `expires_at`: a segunda gravação da mesma (org, key, endpoint)
 *    leva 23505 mesmo que a linha esteja vencida. É o que faz a retomada
 *    passar pela colisão e RELER a linha, em vez de executar por cima dela.
 * 2. `request_hash` é `bytea`. O PostgREST devolve o literal `\x…`; o driver
 *    `pg` devolve `Buffer`. Um dublê que devolvesse o hex cru mediria uma
 *    coluna que não existe — e foi exatamente por isso que a comparação
 *    errada passou: ver o caso (11).
 */

import { describe, expect, it, vi } from "vitest";

import {
  comIdempotencia,
  hashDaColuna,
  hashDoCorpo,
  hashLido,
  JANELA_DA_RESERVA_MS,
  TTL_MS,
} from "@/lib/api/idempotency";

const ORG = "a1b20000-0000-4000-8000-000000000001";
const CHAVE = "a1b20000-0000-4000-8000-000000000002";
const ENDPOINT = "/api/v1/message-templates";

type Linha = Record<string, unknown>;

type OpcoesDoDuble = {
  linhas?: Linha[];
  /** Se presente, a gravação falha com este erro (ex.: { code: "23505" }). */
  erroNoInsert?: { code?: string } | null;
  /**
   * Linhas que passam a existir no momento da colisão — simula o outro
   * escritor que gravou entre a nossa leitura e a nossa gravação. Sem isto o
   * caminho do 23505 só é exercitado pelo índice único do próprio dublê.
   */
  linhasAposColisao?: Linha[];
  /**
   * A tomada de posse não encontra a linha (outro escritor reescreveu a linha
   * vencida entre a leitura e a gravação): o `update` filtrado por `id` +
   * `expires_at` devolve zero linhas.
   */
  perdeuAPosse?: boolean;
};

/**
 * Dublê mínimo do builder do supabase-js, só com a cadeia que o helper usa:
 * `from().select().eq().eq().eq().gt().maybeSingle()`, `from().insert()`,
 * `from().update().eq()…select().maybeSingle()` e `from().update().eq()…`
 * (aguardado direto, sem `.select()`).
 *
 * Registra os filtros aplicados (`eqAplicados`, `gtAplicados`), as gravações
 * (`inseridos`, `atualizacoes`) e a ORDEM dos fatos (`eventos`) porque
 * asserção em efeito colateral isolado não prova o essencial: a reserva tem de
 * existir ANTES do efeito, e o recibo DEPOIS dele.
 */
function duble(opcoes: OpcoesDoDuble = {}) {
  const linhas: Linha[] = [...(opcoes.linhas ?? [])];
  const eventos: string[] = [];
  const inseridos: Linha[] = [];
  const atualizacoes: Array<{ patch: Linha; filtros: Array<[string, unknown]> }> = [];
  const eqAplicados: Array<[string, unknown]> = [];
  const gtAplicados: Array<[string, unknown]> = [];
  let seq = 0;

  const casa = (
    linha: Linha,
    filtros: Array<[string, unknown]>,
    maiorQue: [string, unknown] | null,
  ): boolean =>
    filtros.every(([coluna, valor]) => String(linha[coluna]) === String(valor)) &&
    (maiorQue ? String(linha[maiorQue[0]]) > String(maiorQue[1]) : true);

  const selecao = () => {
    const filtros: Array<[string, unknown]> = [];
    let maiorQue: [string, unknown] | null = null;
    const builder = {
      select: () => builder,
      eq: (coluna: string, valor: unknown) => {
        eqAplicados.push([coluna, valor]);
        filtros.push([coluna, valor]);
        return builder;
      },
      gt: (coluna: string, valor: unknown) => {
        gtAplicados.push([coluna, valor]);
        maiorQue = [coluna, valor];
        return builder;
      },
      maybeSingle: async () => ({
        data: linhas.find((l) => casa(l, filtros, maiorQue)) ?? null,
        error: null,
      }),
    };
    return builder;
  };

  const gravacao = (patch: Linha) => {
    const filtros: Array<[string, unknown]> = [];
    const aplicar = (): Linha[] => {
      const alvos = linhas.filter((l) => casa(l, filtros, null));
      for (const alvo of alvos) Object.assign(alvo, patch);
      return alvos;
    };
    const builder = {
      eq: (coluna: string, valor: unknown) => {
        filtros.push([coluna, valor]);
        return builder;
      },
      select: () => builder,
      maybeSingle: async () => {
        atualizacoes.push({ patch, filtros: [...filtros] });
        // `.select("id")` é a forma da TOMADA DE POSSE: quem lê o retorno está
        // perguntando "esta linha ainda era minha?" — e por isso o desfecho
        // depende dele.
        if (opcoes.perdeuAPosse) return { data: null, error: null };
        const alvos = aplicar();
        return { data: alvos[0] ? { id: alvos[0].id } : null, error: null };
      },
      // Sem `.select()`, o PostgREST devolve `{ data: null }` — é o que a
      // gravação do recibo terminal recebe, e ela não olha o retorno.
      then: (aoResolver?: ((v: unknown) => unknown) | null) => {
        atualizacoes.push({ patch, filtros: [...filtros] });
        eventos.push("recibo");
        aplicar();
        return Promise.resolve({ data: null, error: null }).then(aoResolver ?? ((v) => v));
      },
    };
    return builder;
  };

  const insercao = (linha: Linha) => {
    const gravar = async () => {
      eventos.push("reserva");
      if (opcoes.erroNoInsert) {
        if (opcoes.erroNoInsert.code === "23505" && opcoes.linhasAposColisao) {
          linhas.push(...opcoes.linhasAposColisao);
        }
        return { data: null, error: opcoes.erroNoInsert };
      }
      // O índice único é sobre (organization_id, key, endpoint) e NÃO olha
      // `expires_at`: linha vencida também colide — como no Postgres.
      const colide = linhas.some(
        (l) =>
          l.organization_id === linha.organization_id &&
          l.key === linha.key &&
          l.endpoint === linha.endpoint,
      );
      if (colide) {
        return {
          data: null,
          error: {
            code: "23505",
            message: "duplicate key value violates unique constraint",
          },
        };
      }
      inseridos.push(linha);
      linhas.push({ ...linha, id: `linha-${++seq}` });
      return { data: null, error: null };
    };
    const builder = {
      select: () => builder,
      single: gravar,
      maybeSingle: gravar,
      then: (aoResolver?: ((v: unknown) => unknown) | null) =>
        gravar().then(aoResolver ?? ((v) => v)),
    };
    return builder;
  };

  return {
    db: {
      from: (tabela: string) =>
        tabela === "idempotency_keys"
          ? { select: () => selecao(), insert: (l: Linha) => insercao(l), update: (p: Linha) => gravacao(p) }
          : {},
    },
    inseridos,
    atualizacoes,
    eventos,
    eqAplicados,
    gtAplicados,
  };
}

const RELOGIO = () => new Date("2026-09-14T00:00:00.000Z");
const RESERVA_VIVA = new Date(RELOGIO().getTime() + JANELA_DA_RESERVA_MS).toISOString();
const RECIBO_VALIDO = new Date(RELOGIO().getTime() + TTL_MS).toISOString();
const RECIBO_VENCIDO = new Date(RELOGIO().getTime() - 1).toISOString();

const CORPO = { title: "Boas-vindas" };
const hashDoCorpoPadrao = hashDoCorpo(CORPO);
const expiraReserva = new Date(RELOGIO().getTime() + JANELA_DA_RESERVA_MS).toISOString();
const expiraRecibo = new Date(RELOGIO().getTime() + TTL_MS).toISOString();

/** Recibo terminal, como ele VOLTA da coluna `bytea`. */
function recibo(over: Partial<Linha> = {}): Linha {
  return {
    id: "linha-fixture",
    organization_id: ORG,
    key: CHAVE,
    endpoint: ENDPOINT,
    request_hash: hashDaColuna(hashDoCorpoPadrao),
    status_code: 201,
    response_body: { id: "t1" },
    expires_at: RECIBO_VALIDO,
    ...over,
  };
}

/** Reserva: `status_code` e `response_body` nulos, com prazo curto. */
function reserva(over: Partial<Linha> = {}): Linha {
  return recibo({ status_code: null, response_body: null, expires_at: RESERVA_VIVA, ...over });
}

function entrada(d: ReturnType<typeof duble>, executar: () => Promise<{ resposta: unknown; status: number }>) {
  return {
    db: d.db as never,
    organizationId: ORG,
    endpoint: ENDPOINT,
    chave: CHAVE,
    corpo: CORPO,
    executar,
    agora: RELOGIO,
  };
}

describe("comIdempotencia", () => {
  it("(1) sem recibo: RESERVA antes do efeito, recibo terminal na MESMA linha depois", async () => {
    const d = duble();
    const executar = vi.fn(async () => {
      d.eventos.push("efeito");
      return { resposta: { id: "t1" }, status: 201 };
    });

    const desfecho = await comIdempotencia(entrada(d, executar));

    expect(desfecho).toEqual({ tipo: "executou", resposta: { id: "t1" }, status: 201 });
    expect(executar).toHaveBeenCalledTimes(1);
    // A ordem é o conserto: sem a reserva ANTES, a segunda requisição não tem
    // contra o que colidir e o efeito acontece duas vezes.
    expect(d.eventos).toEqual(["reserva", "efeito", "recibo"]);
    expect(d.inseridos).toHaveLength(1);
    expect(d.inseridos[0]).toMatchObject({
      organization_id: ORG,
      key: CHAVE,
      endpoint: ENDPOINT,
      // `bytea`: o literal `\x…`, não o hex cru (ver o caso (11)).
      request_hash: hashDaColuna(hashDoCorpoPadrao),
      status_code: null,
      response_body: null,
      expires_at: expiraReserva,
    });
    // O recibo é gravado na MESMA linha, com o hash como trava: só quem
    // reservou com aquele corpo pode fechar a chave.
    expect(d.atualizacoes).toHaveLength(1);
    expect(d.atualizacoes[0]!.patch).toEqual({
      status_code: 201,
      response_body: { id: "t1" },
      expires_at: expiraRecibo,
    });
    expect(d.atualizacoes[0]!.filtros).toEqual([
      ["organization_id", ORG],
      ["key", CHAVE],
      ["endpoint", ENDPOINT],
      ["request_hash", hashDaColuna(hashDoCorpoPadrao)],
    ]);
  });

  it("(2) mesma chave e mesmo corpo: replay, sem reexecutar e sem gravar de novo", async () => {
    const d = duble({ linhas: [recibo()] });
    const executar = vi.fn(async () => ({ resposta: { id: "DUPLICADO" }, status: 201 }));

    const desfecho = await comIdempotencia(entrada(d, executar));

    expect(desfecho).toEqual({ tipo: "replay", resposta: { id: "t1" }, status: 201 });
    expect(executar).not.toHaveBeenCalled();
    expect(d.inseridos).toHaveLength(0);
    expect(d.atualizacoes).toHaveLength(0);
  });

  it("(3) o MESMO recibo pelo driver `pg` (Buffer) também é replay, não conflito", async () => {
    // Os dois transportes do repo leem a mesma coluna `bytea`: o PostgREST
    // devolve `\x…`, o `pg` devolve os 32 bytes. Comparar com o hex cru erra
    // os DOIS, e o erro é silencioso: todo replay vira 409 conflito.
    const bytes = Buffer.from(hashDoCorpoPadrao, "hex");
    const d = duble({ linhas: [recibo({ request_hash: bytes })] });
    const executar = vi.fn(async () => ({ resposta: { id: "DUPLICADO" }, status: 201 }));

    const desfecho = await comIdempotencia(entrada(d, executar));

    expect(desfecho).toEqual({ tipo: "replay", resposta: { id: "t1" }, status: 201 });
    expect(executar).not.toHaveBeenCalled();
  });

  it("(4) mesma chave e corpo diferente: conflito, sem reexecutar e sem sobrescrever", async () => {
    const d = duble({ linhas: [recibo()] });
    const executar = vi.fn(async () => ({ resposta: { id: "t2" }, status: 201 }));

    const desfecho = await comIdempotencia({
      ...entrada(d, executar),
      corpo: { title: "Outro assunto" },
    });

    expect(desfecho).toEqual({ tipo: "conflito" });
    expect(executar).not.toHaveBeenCalled();
    expect(d.inseridos).toHaveLength(0);
  });

  it("(5) filtro de validade e de tenant vão para o BANCO, não para o código depois", async () => {
    // Sem asserção no filtro aplicado, apagar o `.gt("expires_at", …)` ou um
    // `.eq("organization_id", …)` passaria verde — e o helper leria recibo
    // vencido, ou de outra organização.
    const d = duble();
    await comIdempotencia(entrada(d, async () => ({ resposta: {}, status: 201 })));

    expect(d.gtAplicados).toEqual([["expires_at", RELOGIO().toISOString()]]);
    expect(d.eqAplicados).toEqual([
      ["organization_id", ORG],
      ["key", CHAVE],
      ["endpoint", ENDPOINT],
    ]);
  });

  it("(6) recibo VENCIDO não conta: a linha vencida é reescrita como reserva e o efeito roda", async () => {
    const d = duble({ linhas: [recibo({ expires_at: RECIBO_VENCIDO })] });
    const executar = vi.fn(async () => {
      d.eventos.push("efeito");
      return { resposta: { id: "t2" }, status: 201 };
    });

    const desfecho = await comIdempotencia(entrada(d, executar));

    expect(desfecho).toEqual({ tipo: "executou", resposta: { id: "t2" }, status: 201 });
    expect(executar).toHaveBeenCalledTimes(1);
    // A tomada de posse grava a reserva NOVA filtrada por `id` + o
    // `expires_at` LIDO — o bilhete que impede roubar a reserva de quem chegou
    // entre a leitura e esta gravação.
    const posse = d.atualizacoes[0]!;
    expect(posse.patch).toEqual({
      request_hash: hashDaColuna(hashDoCorpoPadrao),
      status_code: null,
      response_body: null,
      expires_at: expiraReserva,
    });
    expect(posse.filtros).toEqual([
      ["id", "linha-fixture"],
      ["expires_at", RECIBO_VENCIDO],
    ]);
  });

  it("(7) reserva VIVA em curso: `em_curso`, sem reexecutar — o efeito não fica trancado, e não roda 2x", async () => {
    // É o coração do conserto: a segunda requisição com a MESMA chave e o
    // mesmo corpo encontra a reserva da primeira e não executa nada.
    const d = duble({ linhas: [reserva()] });
    const executar = vi.fn(async () => ({ resposta: { id: "t2" }, status: 201 }));

    const desfecho = await comIdempotencia(entrada(d, executar));

    expect(desfecho).toEqual({ tipo: "em_curso" });
    expect(executar).not.toHaveBeenCalled();
    expect(d.inseridos).toHaveLength(0);
  });

  it("(8) duas requisições SIMULTÂNEAS com a mesma chave: o efeito acontece UMA vez", async () => {
    // Este caso era a limitação declarada (as duas executavam). Agora ele é o
    // guarda da decisão: fica vermelho no dia em que alguém reabrir a corrida
    // — e é aí que quem mexeu vai ler o porquê no cabeçalho do helper.
    const d = duble();
    const executar = vi.fn(async () => {
      await Promise.resolve();
      return { resposta: { id: "x" }, status: 201 };
    });

    const desfechos = await Promise.all([
      comIdempotencia(entrada(d, executar)),
      comIdempotencia(entrada(d, executar)),
    ]);

    expect(executar).toHaveBeenCalledTimes(1);
    expect(d.inseridos).toHaveLength(1);
    expect(desfechos.map((x) => x.tipo).sort()).toEqual(["em_curso", "executou"]);
  });

  it("(9) colisão em que o outro tomou posse entre a leitura e a gravação: `em_curso`", async () => {
    // A tomada de posse é otimista de propósito: se a linha vencida foi
    // reescrita por outro no meio do caminho, o `update` filtrado não acha
    // nada e o efeito NÃO roda. Executar aqui duplicaria.
    const d = duble({
      linhas: [recibo({ expires_at: RECIBO_VENCIDO })],
      perdeuAPosse: true,
    });
    const executar = vi.fn(async () => ({ resposta: { id: "t2" }, status: 201 }));

    const desfecho = await comIdempotencia(entrada(d, executar));

    expect(desfecho).toEqual({ tipo: "em_curso" });
    expect(executar).not.toHaveBeenCalled();
  });

  it("(10) colisão 23505 com recibo VIVO aparecendo na gravação: relê e classifica, em vez de 500", async () => {
    // Aqui o outro escritor só aparece NO INSERT — a primeira leitura não vê
    // nada. É o caminho que dá o 23505 do índice único de verdade.
    const d = duble({ erroNoInsert: { code: "23505" }, linhasAposColisao: [recibo()] });
    const executar = vi.fn(async () => ({ resposta: { id: "t2" }, status: 201 }));

    const desfecho = await comIdempotencia(entrada(d, executar));

    expect(executar).not.toHaveBeenCalled();
    expect(desfecho).toEqual({ tipo: "replay", resposta: { id: "t1" }, status: 201 });
  });

  it("(11) reserva que NÃO gravou por erro de transporte: o efeito roda mesmo assim", async () => {
    // Sem piora em relação ao que existia: erro que não é colisão não bloqueia
    // o efeito. Devolver erro aqui faria o cliente retentar e duplicar.
    const d = duble({ erroNoInsert: { code: "08006" } });
    const desfecho = await comIdempotencia(
      entrada(d, async () => ({ resposta: { id: "t1" }, status: 201 })),
    );
    expect(desfecho).toEqual({ tipo: "executou", resposta: { id: "t1" }, status: 201 });
  });

  it("(12) efeito que LANÇA libera a chave: o erro propaga e a retentativa executa", async () => {
    // O contrato de quem chama (`message-templates/route.ts`) é que falha
    // propaga sem deixar rastro. Com a reserva viva, a retentativa com a
    // mesma chave receberia `em_curso` por 60s de algo que já não acontece.
    const d = duble();
    const falha = new Error("Erro ao criar template.");

    await expect(
      comIdempotencia(entrada(d, async () => { throw falha; })),
    ).rejects.toBe(falha);

    // A reserva vence AGORA, filtrada pela mesma trava do recibo terminal.
    expect(d.atualizacoes).toHaveLength(1);
    expect(d.atualizacoes[0]!.patch).toEqual({ expires_at: RELOGIO().toISOString() });
    expect(d.atualizacoes[0]!.filtros).toEqual([
      ["organization_id", ORG],
      ["key", CHAVE],
      ["endpoint", ENDPOINT],
      ["request_hash", hashDaColuna(hashDoCorpoPadrao)],
    ]);

    const executar = vi.fn(async () => ({ resposta: { id: "t1" }, status: 201 }));
    const retentativa = await comIdempotencia(entrada(d, executar));

    expect(retentativa).toEqual({ tipo: "executou", resposta: { id: "t1" }, status: 201 });
    expect(executar).toHaveBeenCalledTimes(1);
  });
});

describe("a fronteira da coluna `bytea` (request_hash)", () => {
  it("(1) `hashDaColuna` é o literal que o PostgREST grava e devolve", () => {
    expect(hashDaColuna("abc123")).toBe("\\xabc123");
  });

  it("(2) `hashLido` normaliza os dois transportes e recusa o resto", () => {
    expect(hashLido("\\xABCDEF")).toBe("abcdef");
    expect(hashLido("abcdef")).toBe("abcdef");
    expect(hashLido(Buffer.from("abcdef", "hex"))).toBe("abcdef");
    // Desconhecido NÃO vira replay: devolve null, e null não casa com hash
    // nenhum — erra para o lado do conflito, nunca do replay indevido.
    expect(hashLido({ inesperado: true })).toBeNull();
    expect(hashLido(null)).toBeNull();
  });
});
