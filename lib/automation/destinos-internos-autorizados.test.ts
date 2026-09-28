import { lookup } from "node:dns/promises";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  destinosInternosAutorizados,
  entradaDeDestinoValida,
  esquecerDestinosInternos,
  estadoDosDestinosInternos,
  motivoDaRecusaDeDestino,
} from "./destinos-internos-autorizados";

/**
 * A régua de destino da instalação, depois da decisão 22-d (#1004).
 *
 * A primeira versão desta válvula (PR #1055) morava só no `.env`, dispensava
 * TODAS as guardas de uma vez e decidia por NOME. O escopo corrigido de 17/09
 * mudou as três coisas, e é isso que estes casos prendem:
 *
 *   - a lista mora no BANCO, e o `.env` é o piso de quem nunca usou a tela;
 *   - ela dispensa SÓ a recusa por endereço interno — esquema e `https` em
 *     produção continuam recusando um endereço listado;
 *   - ela vale SÓ para destino configurado pela INSTALAÇÃO;
 *   - quem decide é o endereço RESOLVIDO, nunca o nome.
 */

/** O `.env` — aqui, o PISO, não a fonte. */
const pisoDoEnv = vi.hoisted(() => ({ valor: "" }));
vi.mock("@/lib/env", () => ({
  env: {
    get IA_DESTINOS_INTERNOS_PERMITIDOS() {
      return pisoDoEnv.valor;
    },
  },
}));

/** A coluna `platform_settings.internal_destinations`, como o banco a devolve. */
const banco = vi.hoisted(() => ({
  lista: null as string[] | null,
  erro: null as { code: string; message: string } | null,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            banco.erro
              ? { data: null, error: banco.erro }
              : { data: { internal_destinations: banco.lista }, error: null },
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

/** A resolução de DNS que o guarda de IP paga — aqui, controlada. */
const dns = vi.hoisted(() => ({ resposta: [] as Array<{ address: string; family: number }> }));
vi.mock("node:dns/promises", () => {
  const lookup = vi.fn(async () => dns.resposta);
  // O default é obrigatório: sem ele o vitest recusa o mock na coleta.
  return { lookup, default: { lookup } };
});

const lookupMock = vi.mocked(lookup);

beforeEach(() => {
  vi.clearAllMocks();
  // O memo mora em `globalThis` e tem TTL de 30s: sem isto, o primeiro caso
  // que lê a lista decide a lista de todos os outros, e a suíte fica verde por
  // motivo nenhum.
  esquecerDestinosInternos();
  pisoDoEnv.valor = "";
  banco.lista = null;
  banco.erro = null;
  dns.resposta = [{ address: "93.184.216.34", family: 4 }];
});

describe("de onde vem a lista: o banco manda, o .env é piso (#1004, item 1)", () => {
  it("sem tela usada e sem .env, não há autorização nenhuma", async () => {
    await expect(destinosInternosAutorizados()).resolves.toEqual([]);
  });

  it("sem tela usada, vale o .env — e a tela diz que é ele que está valendo", async () => {
    pisoDoEnv.valor = " 10.1.2.7 , 10.9.0.0/16 ";

    await expect(destinosInternosAutorizados()).resolves.toEqual(["10.1.2.7", "10.9.0.0/16"]);
    esquecerDestinosInternos();
    await expect(estadoDosDestinosInternos()).resolves.toMatchObject({
      lista: ["10.1.2.7", "10.9.0.0/16"],
      vemDoPiso: true,
    });
  });

  it("o que a tela gravou vence o .env, inclusive para ESVAZIAR", async () => {
    pisoDoEnv.valor = "10.1.2.7";
    banco.lista = [];

    await expect(destinosInternosAutorizados()).resolves.toEqual([]);
    esquecerDestinosInternos();
    // O ponto inteiro de distinguir `null` de `{}`: sem isso, o dono não
    // conseguiria revogar pela tela o que o arquivo do servidor autorizou.
    await expect(estadoDosDestinosInternos()).resolves.toMatchObject({ vemDoPiso: false });
  });

  it("banco mudo não reabre o .env: vale o último valor lido com sucesso", async () => {
    pisoDoEnv.valor = "10.1.2.7";
    banco.lista = [];
    await expect(destinosInternosAutorizados()).resolves.toEqual([]);

    banco.erro = { code: "57P01", message: "conexão caiu" };
    esquecerMemoMantendoOConhecido();
    await expect(destinosInternosAutorizados()).resolves.toEqual([]);
  });
});

describe("os seis casos da decisão 22-d (#1004, item 7)", () => {
  it("1. interno NÃO listado → recusa", async () => {
    banco.lista = [];

    await expect(motivoDaRecusaDeDestino("http://10.1.2.7:8080/v1", "instalacao")).resolves.toBe(
      "unsafe_url:private_host",
    );
  });

  it("2. listado, e configurado pela INSTALAÇÃO → passa", async () => {
    banco.lista = ["10.1.0.0/16"];

    await expect(motivoDaRecusaDeDestino("http://10.1.2.7:8080/v1", "instalacao")).resolves.toBeNull();
  });

  it("3. listado, mas configurado por uma ORGANIZAÇÃO → recusa", async () => {
    banco.lista = ["10.1.0.0/16"];

    // Mesmíssimo endereço do caso 2. Só muda quem o escolheu — e é isso que a
    // decisão 22-d diz: "a empresa continua sem poder apontar para dentro".
    await expect(motivoDaRecusaDeDestino("http://10.1.2.7:8080/v1", "organizacao")).resolves.toBe(
      "unsafe_url:private_host",
    );
  });

  it("4. listado, mas com esquema ou protocolo que as guardas recusam → recusa", async () => {
    banco.lista = ["10.1.0.0/16", "0.0.0.0/0"];

    // A lista dispensa a recusa por endereço interno, e SÓ ela.
    await expect(motivoDaRecusaDeDestino("file:///etc/passwd", "instalacao")).resolves.toBe(
      "unsafe_url:scheme",
    );
    await expect(motivoDaRecusaDeDestino("gopher://10.1.2.7/v1", "instalacao")).resolves.toBe(
      "unsafe_url:scheme",
    );
    // `https` em produção: o endereço está na lista e mesmo assim não passa.
    const antes = process.env.NODE_ENV;
    vi.stubEnv("NODE_ENV", "production");
    try {
      await expect(motivoDaRecusaDeDestino("http://10.1.2.7:8080/v1", "instalacao")).resolves.toBe(
        "unsafe_url:https_required",
      );
    } finally {
      vi.stubEnv("NODE_ENV", antes ?? "test");
    }
    // Literal IPv6 também segue recusado — a lista não tem como declará-lo.
    await expect(motivoDaRecusaDeDestino("http://[::1]:8080/v1", "instalacao")).resolves.toBe(
      "unsafe_url:ipv6_literal",
    );
  });

  it("5. NOME listado que resolve para endereço fora da lista → recusa", async () => {
    // O nome em si nem entra na lista (a validação o recusa); o que se compara
    // é o IP. Aqui o operador liberou a faixa certa e o nome resolve para OUTRA.
    banco.lista = ["10.1.0.0/16"];
    dns.resposta = [{ address: "10.9.9.9", family: 4 }];

    await expect(
      motivoDaRecusaDeDestino("https://coletor.interno.exemplo/v1", "instalacao"),
    ).resolves.toBe("unsafe_url:private_ip");
    expect(lookupMock, "decidiu pelo nome, sem resolver").toHaveBeenCalled();
  });

  it("6. nome que resolve para DENTRO da faixa listada passa — e meia resolução não passa", async () => {
    banco.lista = ["10.1.0.0/16"];
    dns.resposta = [{ address: "10.1.2.3", family: 4 }];
    await expect(
      motivoDaRecusaDeDestino("https://coletor.interno.exemplo/v1", "instalacao"),
    ).resolves.toBeNull();

    // Um nome que resolve para dentro E para fora é a assinatura do rebinding:
    // meia autorização num destino é o jeito mais barato de furar a lista.
    esquecerDestinosInternos();
    dns.resposta = [
      { address: "10.1.2.3", family: 4 },
      { address: "10.9.9.9", family: 4 },
    ];
    await expect(
      motivoDaRecusaDeDestino("https://coletor.interno.exemplo/v1", "instalacao"),
    ).resolves.toBe("unsafe_url:private_ip");
  });
});

describe("controles: a lista não é coringa e não engole o que já funcionava", () => {
  it("endereço público segue passando dos dois lados, com lista ou sem", async () => {
    banco.lista = [];
    await expect(
      motivoDaRecusaDeDestino("https://api.groq.com/openai/v1", "organizacao"),
    ).resolves.toBeNull();
    esquecerDestinosInternos();
    banco.lista = ["10.1.0.0/16"];
    await expect(
      motivoDaRecusaDeDestino("https://api.groq.com/openai/v1", "instalacao"),
    ).resolves.toBeNull();
  });

  it("entrada fora do formato não vira autorização — e NOME nunca é entrada válida", () => {
    expect(entradaDeDestinoValida("10.1.2.7")).toBe(true);
    expect(entradaDeDestinoValida("10.1.0.0/16")).toBe(true);
    expect(entradaDeDestinoValida("coletor.interno.exemplo")).toBe(false);
    expect(entradaDeDestinoValida("*")).toBe(false);
    expect(entradaDeDestinoValida("10.1.2.7:11434")).toBe(false);
    expect(entradaDeDestinoValida("https://10.1.2.7")).toBe(false);
    expect(entradaDeDestinoValida("10.1.0.0/33")).toBe(false);
    expect(entradaDeDestinoValida("[::1]")).toBe(false);
  });

  it("lista suja no banco não abre a rede: o que não é faixa é ignorado", async () => {
    // Nem o nome que está escrito lá autoriza o que ele resolve, nem a faixa
    // com prefixo impossível autoriza o que ela pareceria cobrir.
    banco.lista = ["coletor.interno.exemplo", "*", "10.1.0.0/33"];
    dns.resposta = [{ address: "10.1.2.3", family: 4 }];

    await expect(
      motivoDaRecusaDeDestino("https://coletor.interno.exemplo/v1", "instalacao"),
    ).resolves.toBe("unsafe_url:private_ip");
    await expect(motivoDaRecusaDeDestino("http://10.1.2.3:8080/v1", "instalacao")).resolves.toBe(
      "unsafe_url:private_host",
    );
  });

  it("endereço ilegível é recusa, não autorização", async () => {
    banco.lista = ["10.1.0.0/16"];

    await expect(motivoDaRecusaDeDestino("isso não é um endereço", "instalacao")).resolves.toBe(
      "unsafe_url:invalid",
    );
  });
});

/**
 * Apaga só o memo de TTL, preservando o "último valor conhecido" — que é o
 * estado real de um processo vivo cujo banco acabou de cair.
 */
function esquecerMemoMantendoOConhecido(): void {
  (globalThis as { __memoDosDestinosInternos?: unknown }).__memoDosDestinosInternos = undefined;
}
