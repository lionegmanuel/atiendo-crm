import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O ERRO DO `getUser()` É REGISTRADO — E O NÃO-ERRO NÃO É.
 *
 * ## O defeito original
 *
 * `loadAuthUser` desestruturava só `data: { user }` e jogava o `error` fora. Como
 * `user: null` significa TANTO "não está logado" (estado normal) QUANTO "não deu
 * para perguntar" (GoTrue fora do ar, rede, token ilegível), uma falha transitória
 * virava, no log, uma pessoa simplesmente deslogada — indistinguível do normal.
 *
 * A ação segue certa e não muda: sem usuário confirmado, `null` → login. Falhar
 * FECHADO na ação é o desfecho seguro. O que estava errado era falhar fechado
 * também na INFORMAÇÃO.
 *
 * ## O segundo defeito, que o conserto do primeiro quase introduziu
 *
 * `if (error) logger.error(...)` parece a correção óbvia e é uma armadilha:
 * `getUser()` **devolve erro no caminho normal**. Sem cookie de sessão,
 * `GoTrueClient._getUser` nem chega a falar com o servidor — retorna
 * `AuthSessionMissingError` (status 400). E como este projeto **não tem
 * `middleware.ts`** (o gate de `/app/*` é o próprio `app/app/layout.tsx`, que
 * chama esta função), TODO visitante deslogado passa por aqui sem sessão.
 *
 * Sem o filtro, o log de erro se enche de tráfego anônimo e a linha diagnóstica
 * — a razão de o PR existir — fica indistinguível do ruído. Seria a mesma fusão
 * de estados de antes, mudada de lado.
 *
 * ## Por que os dois casos, e não só um
 *
 * Um teste que só exercitasse o incidente passaria com `if (error)` puro, que é
 * justamente o código defeituoso. O par é o que prende o comportamento: registra
 * o que é incidente, cala no que é estado normal.
 */

interface RespostaGetUser {
  data: { user: unknown };
  error: { name?: string; message: string; status?: number; code?: string } | null;
}

const resposta: { atual: RespostaGetUser } = {
  atual: { data: { user: null }, error: null },
};

const erros: { msg: string; ctx: unknown }[] = [];

vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); } }));
vi.mock("@/lib/logger", () => ({
  logger: {
    error: (msg: string, ctx: unknown) => erros.push({ msg, ctx }),
    warn: () => {},
    info: () => {},
    debug: () => {},
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => resposta.atual },
    from: () => {
      throw new Error("não deveria consultar tabela sem usuário");
    },
  }),
}));

const { loadAuthUser, ehSessaoAusente } = await import("@/lib/auth/server");

beforeEach(() => {
  erros.length = 0;
  resposta.atual = { data: { user: null }, error: null };
});

describe("loadAuthUser — o erro do getUser deixa rastro", () => {
  it("falha transitória do GoTrue REGISTRA, com a classe e o código", async () => {
    resposta.atual = {
      data: { user: null },
      error: {
        name: "AuthRetryableFetchError",
        code: "over_request_rate_limit",
        message: "fetch failed",
        status: 503,
      },
    };

    expect(await loadAuthUser()).toBeNull(); // a ação não muda: falha fechado
    expect(erros).toHaveLength(1);
    expect(erros[0]!.msg).toMatch(/getUser falhou/);
    // Sem estes campos a linha não diagnostica nada — seria um "algo deu errado"
    // que manda investigar do zero, que é o custo que o conserto veio evitar.
    // `name` é o que separa rede (AuthRetryableFetchError) de token ilegível
    // (AuthApiError); as chaves são as mesmas do log irmão da própria função.
    expect(erros[0]!.ctx).toMatchObject({
      name: "AuthRetryableFetchError",
      code: "over_request_rate_limit",
      status: 503,
      message: "fetch failed",
    });
  });

  it("visitante SEM SESSÃO não registra nada — é o estado normal, não incidente", async () => {
    // O que o @supabase/auth-js 2.112.1 devolve com cookie store vazio, medido:
    //   user  = null
    //   error = AuthSessionMissingError: Auth session missing! (status=400)
    resposta.atual = {
      data: { user: null },
      error: { name: "AuthSessionMissingError", message: "Auth session missing!", status: 400 },
    };

    expect(await loadAuthUser()).toBeNull();
    expect(
      erros,
      "deslogado é o caminho normal de /app/*: logar como erro afoga a linha diagnóstica em tráfego anônimo",
    ).toEqual([]);
  });

  it("sem erro nenhum também não registra", async () => {
    resposta.atual = { data: { user: null }, error: null };

    expect(await loadAuthUser()).toBeNull();
    expect(erros).toEqual([]);
  });
});

describe("ehSessaoAusente — o predicado, isolado", () => {
  it("reconhece a sessão ausente pelo nome", () => {
    expect(ehSessaoAusente({ name: "AuthSessionMissingError" })).toBe(true);
  });

  it("não engole erro de rede nem de token", () => {
    expect(ehSessaoAusente({ name: "AuthRetryableFetchError" })).toBe(false);
    expect(ehSessaoAusente({ name: "AuthApiError" })).toBe(false);
  });

  it("tolera ausência de erro sem lançar", () => {
    expect(ehSessaoAusente(null)).toBe(false);
    expect(ehSessaoAusente(undefined)).toBe(false);
    expect(ehSessaoAusente({})).toBe(false);
  });
});
