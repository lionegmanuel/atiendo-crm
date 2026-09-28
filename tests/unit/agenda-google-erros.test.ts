/**
 * A tabela de desfechos do Google — errá-la é o que produz sync que APAGA dado.
 *
 * O caso que dá nome ao arquivo: `410` significa coisas OPOSTAS conforme a
 * chamada. Ao apagar, é sucesso (o evento já não existe, que era o que
 * queríamos). Ao sincronizar, quer dizer que o `syncToken` morreu e é preciso
 * recomeçar do zero — ler isso como "evento sumiu" apagaria as linhas de uma
 * agenda inteira.
 */
import { describe, expect, it } from "vitest";

import {
  type DesfechoDoGoogle,
  type OperacaoNoGoogle,
  classificarErroDoGoogle,
  deveTentarDeNovo,
  estadoDaConexaoApos,
} from "@/lib/agenda/google/erros";

/** Erro no formato que `googleapis` levanta. */
function erroDoGoogle(status: number, reason?: string, extra: Record<string, unknown> = {}) {
  return {
    code: status,
    message: reason ?? "erro",
    errors: reason ? [{ reason, message: reason }] : [],
    ...extra,
  };
}

/** Erro no formato de quem usa `fetch` e embrulha a resposta. */
function erroDeFetch(status: number, reason?: string, headers?: Record<string, string>) {
  return {
    response: {
      status,
      headers,
      data: { error: { code: status, message: "erro", errors: reason ? [{ reason }] : [] } },
    },
  };
}

const desfecho = (erro: unknown, operacao: OperacaoNoGoogle): DesfechoDoGoogle =>
  classificarErroDoGoogle(erro, operacao).desfecho;

describe("classificarErroDoGoogle — o mesmo 410, dois desfechos opostos", () => {
  it("410 ao apagar é SUCESSO: o estado desejado já vale", () => {
    // Tratar como falha travaria o cancelamento do CRM para sempre por causa de
    // um evento que a pessoa já apagou na mão do lado de lá.
    expect(desfecho(erroDoGoogle(410), "apagar")).toBe("ja_esta_feito");
    expect(desfecho(erroDoGoogle(404), "apagar")).toBe("ja_esta_feito");
  });

  it("410 ao sincronizar manda RESSINCRONIZAR, não apagar nada", () => {
    expect(desfecho(erroDoGoogle(410), "sincronizar")).toBe("ressincronizar");
    expect(desfecho(erroDoGoogle(410), "listar")).toBe("ressincronizar");
  });

  it("410 ao atualizar é evento que sumiu", () => {
    expect(desfecho(erroDoGoogle(410), "atualizar")).toBe("evento_sumiu");
  });

  it("`fullSyncRequired` vale mais que a operação — é o Google nomeando a causa", () => {
    expect(desfecho(erroDoGoogle(410, "fullSyncRequired"), "atualizar")).toBe("ressincronizar");
  });
});

describe("classificarErroDoGoogle — o corpo CRU do Google, que e o que `res.json()` devolve", () => {
  // ⚠️ ESTE BLOCO GUARDA O ACHADO GRAVE DA REVISÃO FRIA. Este repo não tem
  // `googleapis` nas dependências, então quem escrever o cliente vai de
  // `fetch` — e o objeto natural de `await res.json()` é o corpo CRU,
  // `{ error: { code, message, errors[], status } }`. Ele não era reconhecido:
  // chegava sem status e sem motivo, caía no desfecho conservador
  // `transitorio`, e virava repetição infinita.
  const corpoCru = (status: number, reason: string, statusTexto?: string) => ({
    error: {
      code: status,
      message: "erro",
      errors: [{ domain: "global", reason, message: reason }],
      ...(statusTexto ? { status: statusTexto } : {}),
    },
  });

  it("403 de escopo no corpo cru dá o MESMO desfecho que embrulhado", () => {
    const cru = classificarErroDoGoogle(corpoCru(403, "insufficientPermissions", "PERMISSION_DENIED"), "criar");
    const embrulhado = classificarErroDoGoogle(erroDeFetch(403, "insufficientPermissions"), "criar");
    expect(cru.desfecho).toBe("sem_permissao");
    expect(cru.desfecho).toBe(embrulhado.desfecho);
    expect(cru.status).toBe(403);
    expect(deveTentarDeNovo(cru.desfecho)).toBe(false);
  });

  it("o pior caso: 410 fullSyncRequired no corpo cru NÃO pode virar 'tentar de novo'", () => {
    // Se virar, o worker repete a MESMA requisição com o MESMO syncToken morto,
    // recebe 410 de novo, para sempre — e a sincronização daquela agenda
    // congela em silêncio, porque cada tentativa parece falha passageira.
    const c = classificarErroDoGoogle(corpoCru(410, "fullSyncRequired"), "sincronizar");
    expect(c.desfecho).toBe("ressincronizar");
    expect(c.status).toBe(410);
    expect(c.motivo).toBe("fullsyncrequired");
  });

  it("410 fullSyncRequired no corpo cru, em operação de ESCRITA, não pode apagar linha", () => {
    // ⚠️ ESTA É A CÉLULA QUE O RAMO REDUNDANTE ESCONDIA. Nos casos acima o
    // desfecho certo chega por DOIS caminhos: o motivo (`fullsyncrequired`) e o
    // par status+operação (410 + sincronizar). Quebrar o extrator de motivo
    // deixava aqueles verdes no DESFECHO — só o campo `motivo` acusava.
    //
    // Com operação de escrita não há ramo redundante: sem o motivo, 410 cai em
    // `evento_sumiu`, que é o caminho que APAGA A LINHA. É a única célula em que
    // o extrator de motivo, sozinho, decide entre ressincronizar e apagar.
    for (const operacao of ["atualizar", "criar"] as const) {
      expect(desfecho(corpoCru(410, "fullSyncRequired"), operacao)).toBe("ressincronizar");
    }
    // Controle positivo: sem o motivo, a MESMA forma e o MESMO status caem no
    // desfecho perigoso — é isto que a asserção acima impede.
    expect(desfecho(corpoCru(410, "notFound"), "atualizar")).toBe("evento_sumiu");
  });

  it("401 no corpo cru pede reconexão", () => {
    expect(desfecho(corpoCru(401, "authError"), "listar")).toBe("reautenticar");
  });

  it("reconhece `statusCode`, que é como outros embrulhos de fetch nomeiam o status", () => {
    expect(desfecho({ statusCode: 429 }, "criar")).toBe("recuar");
    expect(desfecho({ statusCode: 503 }, "criar")).toBe("transitorio");
  });
});

describe("classificarErroDoGoogle — autorização", () => {
  it("401 pede reconexão", () => {
    expect(desfecho(erroDoGoogle(401), "listar")).toBe("reautenticar");
  });

  it("`invalid_grant` chega como 400 no endpoint de token, e ainda assim é reconexão", () => {
    // Quem classifica só por status lê isto como "requisição malformada" e
    // tenta de novo para sempre, com a agenda desconectada e ninguém avisado.
    expect(desfecho({ error: "invalid_grant", error_description: "Token has been expired" }, "token")).toBe(
      "reautenticar",
    );
    expect(desfecho(erroDeFetch(400, "invalid_grant"), "token")).toBe("reautenticar");
    // `googleapis` copia o motivo para `message` e deixa `errors` vazio.
    expect(desfecho({ message: "invalid_grant", code: 400, errors: [] }, "token")).toBe("reautenticar");
  });

  it("app OAuth errado NÃO manda o dono reconectar — reconectar não conserta", () => {
    // Mandar para a tela de consentimento aqui é um laço: ele autoriza, volta,
    // e falha de novo, porque o defeito é o client_secret da instalação.
    expect(desfecho({ error: "invalid_client" }, "token")).toBe("permanente");
    expect(desfecho({ error: "unauthorized_client" }, "token")).toBe("permanente");
    expect(desfecho({ error: "redirect_uri_mismatch" }, "token")).toBe("permanente");
  });

  it("403 sem cota é falta de permissão, não limite de uso", () => {
    // Calendário só de leitura entra aqui: nenhum retry resolve.
    expect(desfecho(erroDoGoogle(403, "forbiddenForNonOrganizer"), "criar")).toBe("sem_permissao");
    expect(desfecho(erroDoGoogle(403), "criar")).toBe("sem_permissao");
  });
});

describe("classificarErroDoGoogle — limite de uso", () => {
  it("429 e os 403 de cota mandam recuar", () => {
    expect(desfecho(erroDoGoogle(429), "criar")).toBe("recuar");
    expect(desfecho(erroDoGoogle(403, "rateLimitExceeded"), "criar")).toBe("recuar");
    expect(desfecho(erroDoGoogle(403, "userRateLimitExceeded"), "criar")).toBe("recuar");
    expect(desfecho(erroDoGoogle(403, "quotaExceeded"), "disponibilidade")).toBe("recuar");
    expect(desfecho(erroDoGoogle(403, "dailyLimitExceeded"), "disponibilidade")).toBe("recuar");
  });

  it("lê o `Retry-After` quando ele vem, e não inventa quando não vem", () => {
    expect(classificarErroDoGoogle(erroDeFetch(429, undefined, { "Retry-After": "30" }), "criar").esperarSegundos).toBe(
      30,
    );
    // Cabeçalho no formato `Headers`, que é o que `fetch` devolve de verdade.
    const comHeaders = { response: { status: 429, headers: new Headers({ "retry-after": "12" }) } };
    expect(classificarErroDoGoogle(comHeaders, "criar").esperarSegundos).toBe(12);
    // Data HTTP é ignorada de propósito: converter exigiria um relógio aqui.
    const comData = { response: { status: 429, headers: { "retry-after": "Wed, 26 Aug 2026 12:00:00 GMT" } } };
    expect(classificarErroDoGoogle(comData, "criar").esperarSegundos).toBeNull();
    expect(classificarErroDoGoogle(erroDoGoogle(429), "criar").esperarSegundos).toBeNull();
  });
});

describe("classificarErroDoGoogle — passageiro e permanente", () => {
  it("5xx é passageiro", () => {
    for (const status of [500, 502, 503, 504]) {
      expect(desfecho(erroDoGoogle(status), "criar")).toBe("transitorio");
    }
  });

  it("falha de rede é passageira: o Google nunca respondeu", () => {
    expect(desfecho({ code: "ECONNRESET", message: "socket hang up" }, "criar")).toBe("transitorio");
    expect(desfecho(new Error("fetch failed"), "criar")).toBe("transitorio");
    expect(desfecho({ code: "ETIMEDOUT" }, "sincronizar")).toBe("transitorio");
  });

  it("400 sem motivo conhecido é permanente — repetir só gasta cota", () => {
    expect(desfecho(erroDoGoogle(400, "invalidParameter"), "criar")).toBe("permanente");
  });

  it("404 fora do apagar é evento que sumiu", () => {
    expect(desfecho(erroDoGoogle(404, "notFound"), "atualizar")).toBe("evento_sumiu");
  });
});

describe("classificarErroDoGoogle — o que a classificação devolve junto", () => {
  it("carrega status, motivo e uma frase para quem opera ler", () => {
    const c = classificarErroDoGoogle(erroDoGoogle(403, "rateLimitExceeded"), "criar");
    expect(c.status).toBe(403);
    expect(c.motivo).toBe("ratelimitexceeded");
    expect(c.mensagem).toContain("HTTP 403");
    expect(c.mensagem).toContain("ratelimitexceeded");
  });

  it("sem resposta do Google, a frase diz isso em vez de fingir um status", () => {
    const c = classificarErroDoGoogle({ code: "ECONNRESET" }, "criar");
    expect(c.status).toBeNull();
    expect(c.mensagem).toContain("sem resposta");
  });

  it("nunca lança, nem com entrada absurda", () => {
    for (const lixo of [null, undefined, "erro", 42, [], {}]) {
      expect(() => classificarErroDoGoogle(lixo, "criar")).not.toThrow();
    }
    // Sem nada para ler, o desfecho conservador é "tentar de novo" — não
    // "desistir" nem "mandar o dono reconectar".
    expect(desfecho(null, "criar")).toBe("transitorio");
  });
});

describe("estadoDaConexaoApos — o que o desfecho faz com a CONEXÃO", () => {
  it("cada desfecho diz o que fazer com a CONEXÃO, não só com a chamada", () => {
    expect(estadoDaConexaoApos("reautenticar")).toBe("token_expired");
    expect(estadoDaConexaoApos("sem_permissao")).toBe("scope_missing");
    expect(estadoDaConexaoApos("permanente")).toBe("error");
    expect(estadoDaConexaoApos("ja_esta_feito")).toBe("healthy");
  });

  it("limite de uso tem estado PRÓPRIO no banco, e não é `null`", () => {
    // `rate_limited` existe no CHECK da 0177. Enquanto o tipo daqui tinha só
    // quatro dos sete estados, o desfecho `recuar` não tinha para onde ir e
    // devolvia `null` — a conexão continuava marcada como saudável enquanto o
    // Google recusava, e a agenda seguia sendo contada como fonte confiável.
    expect(estadoDaConexaoApos("recuar")).toBe("rate_limited");
  });

  it("desfecho sobre um EVENTO não mexe no estado da conexão", () => {
    // Rebaixar a conexão porque um evento sumiu desligaria a agenda inteira
    // por causa de um caso isolado.
    expect(estadoDaConexaoApos("evento_sumiu")).toBeNull();
    expect(estadoDaConexaoApos("transitorio")).toBeNull();
    expect(estadoDaConexaoApos("ressincronizar")).toBeNull();
  });

});

describe("deveTentarDeNovo", () => {
  it("só repete o que muda com o tempo", () => {
    expect(deveTentarDeNovo("recuar")).toBe(true);
    expect(deveTentarDeNovo("transitorio")).toBe(true);
    expect(deveTentarDeNovo("ressincronizar")).toBe(true);
    // Repetir estes três esconde o pedido de socorro que deveria chegar a quem
    // opera, e ainda gasta cota.
    expect(deveTentarDeNovo("reautenticar")).toBe(false);
    expect(deveTentarDeNovo("sem_permissao")).toBe(false);
    expect(deveTentarDeNovo("permanente")).toBe(false);
    expect(deveTentarDeNovo("ja_esta_feito")).toBe(false);
    expect(deveTentarDeNovo("evento_sumiu")).toBe(false);
  });
});
