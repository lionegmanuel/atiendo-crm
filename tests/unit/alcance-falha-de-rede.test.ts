/**
 * O sistema precisa distinguir "o endereço configurado não existe" de "o serviço
 * caiu" — em produção as duas causas produziam a MESMA frase ("confirme que o
 * container está no ar"), e o dono passou semanas reiniciando um container com
 * `restarts=0`.
 *
 * O que estes testes guardam é a DIFERENÇA, não o texto: cada caso confronta duas
 * causas opostas e exige que as respostas divirjam. Um teste que só afirmasse
 * "ENOTFOUND devolve a string X" passaria de novo se alguém colapsasse tudo numa
 * frase só — bastaria essa frase ser X.
 */
import { describe, expect, it } from "vitest";

import {
  alvoDe,
  classificarFalhaDeAlcance,
  explicarFalhaDeAlcance,
} from "@/lib/net/alcance";
import { wahaFriendlyError } from "@/lib/waha/client";

/** Como o undici entrega um DNS que não resolve: `code` só existe na causa. */
function fetchFailed(code: string): Error {
  const causa = Object.assign(new Error(`${code} the-host`), { code });
  return Object.assign(new TypeError("fetch failed"), { cause: causa });
}

/** Host com A e AAAA: cada tentativa vira um filho do AggregateError. */
function fetchFailedAgregado(...codes: string[]): Error {
  const agg = Object.assign(new AggregateError(codes.map((c) => Object.assign(new Error(c), { code: c }))), {
    code: undefined,
  });
  return Object.assign(new TypeError("fetch failed"), { cause: agg });
}

describe("classificarFalhaDeAlcance", () => {
  it("acha o código dentro de `cause` — ler só o erro de cima devolveria 'indeterminada' sempre", () => {
    // O controle da própria ferramenta: o erro de cima NÃO tem código, e a
    // mensagem dele é a mesma para todas as causas.
    const erro = fetchFailed("ENOTFOUND");
    expect((erro as { code?: string }).code).toBeUndefined();
    expect(erro.message).toBe("fetch failed");

    expect(classificarFalhaDeAlcance(erro)).toBe("endereco_nao_resolve");
  });

  it("desce por AggregateError (host com vários IPs)", () => {
    expect(classificarFalhaDeAlcance(fetchFailedAgregado("ECONNREFUSED", "ECONNREFUSED"))).toBe(
      "conexao_recusada",
    );
  });

  it("separa endereço inexistente de porta fechada — são ações opostas", () => {
    const dns = classificarFalhaDeAlcance(fetchFailed("ENOTFOUND"));
    const porta = classificarFalhaDeAlcance(fetchFailed("ECONNREFUSED"));
    expect(dns).toBe("endereco_nao_resolve");
    expect(porta).toBe("conexao_recusada");
    expect(dns).not.toBe(porta);
  });

  it("classifica host inalcançável e tempo esgotado", () => {
    expect(classificarFalhaDeAlcance(fetchFailed("EHOSTUNREACH"))).toBe("host_inalcancavel");
    expect(classificarFalhaDeAlcance(fetchFailed("UND_ERR_CONNECT_TIMEOUT"))).toBe("tempo_esgotado");
    // O timeout do próprio health check não tem `code` — só a mensagem.
    expect(classificarFalhaDeAlcance(new Error("timeout after 3000ms"))).toBe("tempo_esgotado");
  });

  it("aceita a mensagem já achatada, para os pontos que perderam o erro cru", () => {
    expect(classificarFalhaDeAlcance("getaddrinfo ENOTFOUND waha")).toBe("endereco_nao_resolve");
  });

  it("o que não sabe classificar vira 'indeterminada' — não uma causa plausível", () => {
    expect(classificarFalhaDeAlcance(new Error("algo completamente diferente"))).toBe("indeterminada");
    expect(classificarFalhaDeAlcance(null)).toBe("indeterminada");
    expect(classificarFalhaDeAlcance(undefined)).toBe("indeterminada");
  });

  it("não trava com `cause` cíclico", () => {
    const a = new Error("a") as Error & { cause?: unknown };
    const b = new Error("b") as Error & { cause?: unknown };
    a.cause = b;
    b.cause = a;
    expect(classificarFalhaDeAlcance(a)).toBe("indeterminada");
  });
});

describe("explicarFalhaDeAlcance", () => {
  it("cada causa produz uma frase distinta — nenhuma colapsa na do vizinho", () => {
    const frases = (
      [
        "endereco_nao_resolve",
        "conexao_recusada",
        "host_inalcancavel",
        "tempo_esgotado",
        "tls_recusado",
        "indeterminada",
      ] as const
    ).map((f) => explicarFalhaDeAlcance(f, "o WhatsApp (WAHA)"));
    expect(new Set(frases).size).toBe(frases.length);
  });

  it("endereço inexistente NÃO manda conferir o serviço — era esse o defeito", () => {
    const frase = explicarFalhaDeAlcance("endereco_nao_resolve", "o WhatsApp (WAHA)");
    expect(frase).toMatch(/configuração/i);
    expect(frase).not.toMatch(/container/i);
    expect(frase).not.toMatch(/no ar/i);
  });
});

describe("wahaFriendlyError", () => {
  it("endereço que não resolve e porta fechada param de dar a mesma resposta", () => {
    const dns = wahaFriendlyError(fetchFailed("ENOTFOUND"));
    const porta = wahaFriendlyError(fetchFailed("ECONNREFUSED"));
    expect(dns).not.toBe(porta);
    // A regressão que importa: DNS morto mandava reiniciar o container.
    expect(dns).not.toMatch(/container/i);
    expect(porta).toMatch(/porta|no ar/i);
  });

  it("erro que não é de rede continua chegando ao operador com o texto original", () => {
    expect(wahaFriendlyError(new Error("waha_422: session already exists"))).toContain(
      "waha_422: session already exists",
    );
  });
});

describe("alvoDe", () => {
  it("mostra protocolo, host e porta — e descarta caminho e query", () => {
    expect(alvoDe("https://waha.exemplo.com.br:3000/api/sessions?token=segredo")).toBe(
      "https://waha.exemplo.com.br:3000",
    );
    expect(alvoDe("http://waha:3000")).toBe("http://waha:3000");
    expect(alvoDe("https://exemplo.com/x")).toBe("https://exemplo.com");
  });

  it("endereço inválido não explode o health check", () => {
    expect(alvoDe("nao-e-uma-url")).toBe("(endereço inválido)");
  });
});
