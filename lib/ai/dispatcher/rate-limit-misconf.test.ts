/**
 * O TETO POR CONTA NÃO PODE MORRER QUANDO O REDIS RECUSA SÓ ESCRITA.
 *
 * ## Por que este arquivo existe (issue #185)
 *
 * `checkRateLimit` e `peekRateLimit` discordavam sobre ONDE o contador mora. O
 * primeiro cai para a memória quando a **escrita** falha; o segundo só caía se a
 * **leitura** lançasse. Existe um estado real em que o Redis recusa escrita e
 * atende leitura — `MISCONF`, quando a persistência falha (disco cheio, permissão
 * do `/data`, cota estourada). É o caso que @vagnerdearaujo relatou no Docker
 * Desktop do Windows, e não é exclusivo dele: qualquer disco cheio produz o mesmo.
 *
 * Nesse estado o `incr` caía para a memória, o `get` respondia 200 com a chave
 * ausente, e o peek devolvia **0** com o contador real vivo na memória.
 *
 * O que morria era o teto por CONTA de `lib/auth/rate-limit.ts` — o único que
 * barra força bruta distribuída por muitos IPs, e que o comentário de lá declara
 * "NÃO configurável" exatamente por ser o último recurso. Ele parava de barrar
 * **em silêncio**: sem exceção, sem log de erro, sem tela diferente.
 *
 * ## O caso perigoso é o PARCIAL, não o Redis fora
 *
 * Com o Redis totalmente inalcançável as duas trilhas caem juntas para a memória
 * e o teto sobrevive por processo. Por isso o primeiro teste aqui é o do MISCONF,
 * e o segundo é o controle que prova que a suíte distingue os dois estados: um
 * teste que só cobrisse "Redis fora" passaria com o defeito dentro.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Redis que ACEITA leitura e RECUSA escrita — o estado MISCONF. */
const misconf = {
  get: vi.fn(async () => null),
  incr: vi.fn(async () => {
    throw new Error("MISCONF Redis is configured to save RDB snapshots, but ...");
  }),
  expire: vi.fn(async () => 1),
};

/** Redis inteiramente fora — as duas trilhas falham juntas. */
const morto = {
  get: vi.fn(async () => {
    throw new Error("fetch failed");
  }),
  incr: vi.fn(async () => {
    throw new Error("fetch failed");
  }),
  expire: vi.fn(async () => 1),
};

let atual: typeof misconf | typeof morto = misconf;

vi.mock("@upstash/redis", () => ({
  Redis: class {
    get = (...a: unknown[]) => atual.get(...(a as []));
    incr = (...a: unknown[]) => atual.incr(...(a as []));
    expire = (...a: unknown[]) => atual.expire(...(a as []));
  },
}));

vi.mock("@/lib/env", () => ({
  env: {
    UPSTASH_REDIS_REST_URL: "https://redis-de-teste.example",
    UPSTASH_REDIS_REST_TOKEN: "token-de-teste",
  },
}));

describe("peekRateLimit sob Redis que recusa escrita (MISCONF)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("enxerga o contador que o incr foi obrigado a guardar na memória", async () => {
    atual = misconf;
    const { checkRateLimit, peekRateLimit } = await import("./rate-limit");

    // 3 tentativas falhadas: o `incr` estoura e cai para a memória.
    for (let i = 0; i < 3; i++) await checkRateLimit("auth:login:id:sonda", 5, 300);

    // Guarda de vacuidade: se o mock parar de simular o MISCONF, o `incr` não
    // teria falhado e o teste passaria medindo outra coisa.
    expect(misconf.incr, "o incr precisa ter sido tentado e recusado").toHaveBeenCalled();
    expect(misconf.get, "o get ainda não foi chamado neste ponto").not.toHaveBeenCalled();

    // ANTES do conserto: 0 — o `get` responde "chave ausente" e o peek acreditava
    // nele, com 3 na memória. É o que desligava o teto por conta.
    expect(await peekRateLimit("auth:login:id:sonda", 300)).toBe(3);
  });

  it("o teto por conta volta a barrar: 6ª tentativa bloqueada, não a enésima", async () => {
    atual = misconf;
    const { checkRateLimit, peekRateLimit } = await import("./rate-limit");
    const TETO = 5;

    // Reproduz o laço de `signInWithPassword`: consulta ANTES de chamar o
    // provedor, incrementa só quando a senha erra.
    const bloqueios: boolean[] = [];
    for (let i = 0; i < 10; i++) {
      bloqueios.push((await peekRateLimit("auth:login:id:vitima", 300)) >= TETO);
      await checkRateLimit("auth:login:id:vitima", TETO, 300);
    }

    // Medido contra a pilha real (@upstash/redis -> serverless-redis-http ->
    // redis:7-alpine com o /data sem permissão), teto 5: MISCONF dava
    // [false x10] e o Redis saudável, [false x5, true x5].
    expect(bloqueios).toEqual([false, false, false, false, false, true, true, true, true, true]);
  });

  it("CONTROLE: com o Redis inteiro fora o teto já funcionava — o buraco era o estado PARCIAL", async () => {
    atual = morto;
    const { checkRateLimit, peekRateLimit } = await import("./rate-limit");
    const TETO = 5;

    const bloqueios: boolean[] = [];
    for (let i = 0; i < 10; i++) {
      bloqueios.push((await peekRateLimit("auth:login:id:controle", 300)) >= TETO);
      await checkRateLimit("auth:login:id:controle", TETO, 300);
    }

    // Este caso passava ANTES do conserto. Ele está aqui para que ninguém
    // credite ao conserto uma proteção que já existia — e para que um futuro
    // refactor que quebre o caminho "Redis fora" seja pego.
    expect(bloqueios).toEqual([false, false, false, false, false, true, true, true, true, true]);
  });
});
