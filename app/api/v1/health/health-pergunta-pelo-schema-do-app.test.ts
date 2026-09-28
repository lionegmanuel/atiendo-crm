import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * GET /api/v1/health — o ping do banco pergunta pelo schema QUE O APP USA.
 *
 * ## A classe de defeito
 *
 * O check do Supabase é um `fetch` cru contra `/rest/v1/organizations`. Sem
 * cabeçalho de schema, o PostgREST resolve no schema DEFAULT do projeto — o
 * primeiro da lista "Exposed schemas" —, e que ele seja `public` é costume de
 * projeto recém-criado, não garantia da plataforma.
 *
 * Medido numa VPS real em 17/09/2026: o projeto Supabase já servia outras
 * aplicações e tinha um schema próprio à frente de `public` na lista. O ping
 * procurava `<outro>.organizations`, recebia
 *
 *   404 {"code":"PGRST205","message":"Could not find the table ... in the schema cache"}
 *
 * e a rota declarava `supabase: down`, `status: unhealthy` — com o CRM
 * atendendo, o login renderizando e as tabelas todas de pé em `public`, onde o
 * app de fato lê.
 *
 * ## Por que não é alarme falso de pouca importância
 *
 * `hostgator-setup-kit/update.sh` termina em `wait_app_healthy`, e o código de
 * saída diferente de zero é justamente o sinal que o `agent.sh` usa para
 * REVERTER para a imagem anterior. Uma atualização bem-sucedida era desfeita
 * por causa de uma configuração de painel que o CRM não controla — e o dono
 * veria a versão voltar sozinha, sem erro nenhum no app.
 *
 * ## A régua
 *
 * Nenhum client do CRM declara `db.schema` (`lib/supabase/*.ts`), então o
 * supabase-js usa o default dele, `public`, e manda `Accept-Profile: public`
 * em toda leitura. A sonda de saúde tem de perguntar pelo MESMO schema — senão
 * ela mede um banco que o app não usa, e o veredito dela não fala do app.
 */

const URL_DO_PROJETO = "https://projeto-do-cliente.supabase.co";

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: URL_DO_PROJETO,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "chave-anon-de-teste",
    SUPABASE_SERVICE_ROLE_KEY: "chave-de-teste",
    UPSTASH_REDIS_REST_URL: "https://redis-de-teste.exemplo",
    UPSTASH_REDIS_REST_TOKEN: "token-de-teste",
    INTERNAL_CRON_SECRET: "segredo-interno-de-teste-com-tamanho-suficiente",
    INTERNAL_SECRET: "",
  },
}));

function pedido(): NextRequest {
  return new NextRequest("https://crm.exemplo.com.br/api/v1/health");
}

/** Cabeçalhos com que o ping do Supabase saiu, ou null se ele não saiu. */
function cabecalhosDoPingDoBanco(chamadas: Parameters<typeof fetch>[]): Headers | null {
  for (const [entrada, init] of chamadas) {
    const alvo = typeof entrada === "string" ? entrada : String(entrada);
    if (alvo.startsWith(URL_DO_PROJETO)) return new Headers(init?.headers);
  }
  return null;
}

describe("GET /api/v1/health — o ping do banco declara o schema", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("manda Accept-Profile: public, o mesmo schema que o supabase-js do app usa", async () => {
    const chamadas: Parameters<typeof fetch>[] = [];
    vi.stubGlobal("fetch", (...args: Parameters<typeof fetch>) => {
      chamadas.push(args);
      return Promise.resolve(new Response("[]", { status: 200 }));
    });

    const { GET } = await import("./route");
    await GET(pedido());

    const headers = cabecalhosDoPingDoBanco(chamadas);
    expect(headers, "o ping do Supabase não chegou a sair").not.toBeNull();
    // Sem esta linha o PostgREST resolve no schema default do PROJETO, que não
    // é escolha do CRM. É esta asserção que falha quando o cabeçalho some.
    expect(headers?.get("Accept-Profile")).toBe("public");
  });

  it("não declara o banco caído quando é o schema default do projeto que é outro", async () => {
    // O 404 exato que um projeto com outro schema à frente devolve. Antes do
    // conserto, ESTE corpo chegava com o app inteiro funcionando ao lado.
    vi.stubGlobal("fetch", (entrada: string | URL | Request, init?: RequestInit) => {
      const alvo = typeof entrada === "string" ? entrada : String(entrada);
      if (!alvo.startsWith(URL_DO_PROJETO)) {
        return Promise.resolve(new Response("{}", { status: 200 }));
      }
      const pediuPublic = new Headers(init?.headers).get("Accept-Profile") === "public";
      return Promise.resolve(
        pediuPublic
          ? new Response("[]", { status: 200 })
          : new Response(
              JSON.stringify({
                code: "PGRST205",
                message: "Could not find the table 'outro.organizations' in the schema cache",
              }),
              { status: 404 },
            ),
      );
    });

    const { GET } = await import("./route");
    const { data } = await (await GET(pedido())).json();

    expect(data.checks.supabase.status).toBe("ok");
  });
});
