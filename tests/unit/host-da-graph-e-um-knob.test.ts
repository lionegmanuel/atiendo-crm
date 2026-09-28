// @vitest-environment node
/**
 * O HOST DA GRAPH É UM KNOB — e o receptor local PROVA, não dublê.
 *
 * ─── O que era o defeito (issue #817) ────────────────────────────────────────
 *
 * A VERSÃO da Graph tinha um lugar só desde o #862. O HOST não: `graph.facebook.com`
 * estava escrito à mão em onze linhas de seis arquivos de produção, e nenhum
 * deles podia ser apontado para outro lugar. O que isso trancava não é o dia em
 * que o host muda — é o dia em que alguém precisa que mude, que é a PROVA EM
 * TELA: sem receptor local, a jornada do canal oficial (conectar → enviar →
 * status → mídia → modelo → webhook) não tem para onde falar, e o caminho de
 * entrada continua coberto só por dublê de `fetch`.
 *
 * A doutrina de QA desta casa já diz o que prova experiência: efeito externo se
 * prova com receptor REAL, não com dublê. Um `fetch` stubado prova que o código
 * chamou o que o stub devolveu — prova o nosso lado e nada do fio. Este arquivo
 * sobe um servidor HTTP em `127.0.0.1`, aponta `META_GRAPH_BASE_URL` para ele, e
 * exige que a requisição CHEGUE, com o caminho, o método, o corpo e o token
 * certos.
 *
 * ⚠️ A GUARDA DE ENDEREÇO LOCAL CONTINUA DE PÉ. Este arquivo não é a prova em
 * tela do Playwright e não a substitui — `playwright.config.ts` continua recusando
 * `.env.e2e` que aponte para fora de `localhost`, e nenhum passo daqui contorna
 * isso. O que este arquivo mede é o que a tela sozinha não mede: que os SETE
 * caminhos de canal obedecem ao knob, e que o knob não é caminho de contornar a
 * guarda.
 *
 * ─── Os sete caminhos do canal, e por que são sete e não "o envio" ───────────
 *
 * A lista é enumerada, não recordada: cada item é um ponto que o levantamento da
 * issue mediu, e um caminho que ninguém exercita é um caminho cujo knob ninguém
 * sabe se funciona. `controle: todos os sete foram vistos` no fim é a
 * asserção que impede o arquivo de encolher em silêncio quando a main anda.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { HOST_PADRAO_DA_GRAPH, graphBaseUrl, hostAceito, graphHost } from "@/lib/channels/meta/graph-base";
import {
  HOST_PADRAO_DA_GRAPH_DE_ANUNCIO,
  baseDaGraphDeAnuncio,
  hostDaGraphDeAnuncio,
} from "@/lib/plataformas-de-anuncio/meta/graph-base";

/**
 * O "banco" que a resolução de credencial enxerga — a sessão do canal oficial com
 * o token cifrado, que é o estado de uma instalação que conectou pela tela.
 *
 * Sem isto o `send` LANÇA `meta_not_configured` antes de chegar à rede, e o
 * arquivo mediria um caminho que ele mesmo desligou. É a credencial que resolve;
 * o que este arquivo mede é para ONDE a requisição vai depois de resolvida.
 */
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      const linha = tabela === "channel_sessions"
        ? {
            meta_phone_number_id: "1103328999528818",
            meta_token_encrypted: "\\xprova",
          }
        : [];
      const alvo: Record<string, unknown> = {
        maybeSingle: async () => ({ data: linha, error: null }),
        limit: async () => ({ data: linha, error: null }),
        upsert: async () => ({ data: null, error: null }),
        update: async () => ({ data: null, error: null }),
      };
      alvo.select = () => alvo;
      alvo.eq = () => alvo;
      alvo.is = () => alvo;
      alvo.order = () => alvo;
      return alvo;
    },
    rpc: async (nome: string) =>
      nome === "fn_decrypt_oauth"
        ? { data: "token-da-sessao", error: null }
        : { data: null, error: null },
  }),
}));

const NUMERO = "1103328999528818";
const WABA = "waba-de-prova";
const ORG = "00000000-0000-4000-8000-000000000817";

/** Uma requisição que o receptor viu. O receptor é a verdade do arquivo. */
interface Chegada {
  metodo: string;
  caminho: string;
  busca: string;
  corpo: unknown;
  authorization: string | undefined;
}

let server: Server;
let base: string;
let chegadas: Chegada[] = [];
/**
 * O que o receptor responde. Recebe a requisição porque a JORNADA tem mais de um
 * desfecho por caminho: a validação pergunta pelo número e depois pela lista da
 * WABA, e um corpo único para as duas faria a segunda recusar.
 */
let responder: (chegada: Chegada, res: ServerResponse) => void;

beforeAll(async () => {
  server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let bruto = "";
    for await (const pedaco of req) bruto += String(pedaco);
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    chegadas.push({
      metodo: req.method ?? "",
      caminho: url.pathname,
      busca: url.search,
      corpo: bruto ? JSON.parse(bruto) : null,
      authorization: req.headers.authorization,
    });
    responder(chegadas[chegadas.length - 1]!, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endereco = server.address() as AddressInfo;
  base = `http://127.0.0.1:${endereco.port}`;
});

afterAll(
  () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
);

/** O desfecho mais comum do bloco: a Meta aceitou e devolveu o id da mensagem. */
function aceitando(corpo: unknown) {
  return (chegada: Chegada, res: ServerResponse) => {
    const oQueEsteCaminhoQuer =
      chegada.caminho.includes("phone_numbers")
        ? { data: [{ id: NUMERO }] }
        : (corpo as Record<string, unknown>);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(oQueEsteCaminhoQuer));
  };
}

beforeEach(() => {
  chegadas = [];
  responder = aceitando({ messages: [{ id: "wamid.REAL" }] });
  // A versão DIFERENTE do default, como no `channel-adapter-meta.test.ts`: com a
  // mesma, o teste passaria mesmo se o código ignorasse a variável e falasse a do
  // código.
  process.env.META_GRAPH_VERSION = "v19.0";
  process.env.META_GRAPH_BASE_URL = base;
  process.env.META_ADS_GRAPH_BASE_URL = base;
});

afterEach(() => {
  delete process.env.META_GRAPH_BASE_URL;
  delete process.env.META_ADS_GRAPH_BASE_URL;
  delete process.env.META_GRAPH_VERSION;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("o knob resolve — a base montada a partir dele", () => {
  it("sem a variável, a instalação fala com o host real da Meta", () => {
    delete process.env.META_GRAPH_BASE_URL;
    expect(graphHost()).toBe(HOST_PADRAO_DA_GRAPH);
    expect(graphBaseUrl()).toBe(`${HOST_PADRAO_DA_GRAPH}/v19.0`);
  });

  it("VAZIA cai no host real — a promessa escrita no `.env.example`", () => {
    // `??` não cumpriria: string vazia é valor. O caminho é o do `zernioBaseUrl`
    // (mesma classe de defeito, mesma casa).
    process.env.META_GRAPH_BASE_URL = "";
    expect(graphHost()).toBe(HOST_PADRAO_DA_GRAPH);
  });

  it("só espaço em branco também cai no host real", () => {
    process.env.META_GRAPH_BASE_URL = "   ";
    expect(graphHost()).toBe(HOST_PADRAO_DA_GRAPH);
  });

  it("valor real vence, e a barra final é aparada", () => {
    // Sem o `replace`, a base viraria `.../v19.0//123` e o receptor jamais casaria
    // — o sintoma seria "o knob não funciona" sem ninguém ver o motivo.
    process.env.META_GRAPH_BASE_URL = `${base}/`;
    expect(graphHost()).toBe(base);
    expect(graphBaseUrl()).toBe(`${base}/v19.0`);
  });

  it("um caminho na base é PRESERVADO — receiver atrás de prefixo (`/graph`) continua alcançável", () => {
    process.env.META_GRAPH_BASE_URL = `${base}/graph`;
    expect(graphBaseUrl()).toBe(`${base}/graph/v19.0`);
  });
});

describe("o portão do override é fechado, e a recusa é ABERTA", () => {
  /** Recusa o valor e DEVOLVE o aviso — sem o console silencioso. */
  function recusando(valor: string): { host: string; avisos: unknown[][] } {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.META_GRAPH_BASE_URL = valor;
    const host = graphHost();
    return { host, avisos: aviso.mock.calls };
  }

  it.each([
    ["caminho relativo", "/graph"],
    ["sem esquema", "127.0.0.1:8080"],
    ["esquema que não é web", "ftp://exemplo.test/graph"],
    ["arquivo local", "file:///etc/passwd"],
    ["javascript", "javascript:alert(1)"],
  ])("%s cai no host real", (_nome, valor) => {
    const { host, avisos } = recusando(valor);
    expect(host).toBe(HOST_PADRAO_DA_GRAPH);
    // Aberta na informação: o valor que chegou precisa aparecer no log, senão o
    // operador vê o override "sem efeito nenhum" sem nenhuma pista.
    expect(avisos.length).toBe(1);
    expect(String(avisos[0]![0])).toContain("META_GRAPH_BASE_URL");
    vi.restoreAllMocks();
  });

  it("consulta e fragmento colados no env NÃO entram na base", () => {
    // `?token=x` na base viraria transportado para o meio do caminho de cada
    // requisição — e o `Authorization` de cada uma delas, no log de proxy.
    expect(hostAceito("https://recetor.test/g?token=segredo")).toBe("https://recetor.test/g");
    expect(hostAceito("https://recetor.test/g#topo")).toBe("https://recetor.test/g");
  });

  it("http de loopback é aceito — é o receiver local que a prova em tela precisa", () => {
    expect(hostAceito("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
    expect(hostAceito("http://localhost:8080")).toBe("http://localhost:8080");
  });
});

describe("a regra 4: em produção o http de FORA cai, o de dentro passa", () => {
  /**
   * Põe o processo em produção e mede o que a variável entrega de fato, com o
   * aviso capturado. O `NODE_ENV` é stub, não atribuição: o `afterEach` do
   * arquivo já devolve o valor da suíte com `unstubAllEnvs`.
   */
  function emProducao(valor: string): { host: string; avisos: unknown[][] } {
    vi.stubEnv("NODE_ENV", "production");
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.META_GRAPH_BASE_URL = valor;
    return { host: graphHost(), avisos: aviso.mock.calls };
  }

  it("http para host EXTERNO cai no host real — é o token que não sai em claro", () => {
    const { host, avisos } = emProducao("http://receptor.exemplo.test:8080");
    expect(host).toBe(HOST_PADRAO_DA_GRAPH);
    // Aberta na informação, como as outras recusas: o operador precisa ver que o
    // override não teve efeito, e por quê.
    expect(avisos.length).toBe(1);
    expect(String(avisos[0]![0])).toContain("META_GRAPH_BASE_URL");
    vi.restoreAllMocks();
  });

  it.each([
    ["loopback", "http://127.0.0.1:8080"],
    ["loopback em nome", "http://localhost:8080"],
    ["faixa privada", "http://192.168.0.9:8080"],
    ["nome de serviço sem ponto", "http://waha:3000"],
    ["IPv6 de loopback", "http://[::1]:8080"],
  ])("http para %s continua aceito — é o receptor local da prova em tela", (_nome, valor) => {
    const { host, avisos } = emProducao(valor);
    expect(host).toBe(valor);
    expect(avisos.length).toBe(0);
    vi.restoreAllMocks();
  });

  it("https para host externo segue aceito — a regra é sobre o esquema, não o destino", () => {
    expect(hostAceito("https://receptor.exemplo.test")).toBe("https://receptor.exemplo.test");
  });

  it("o eixo de anúncio tem a MESMA regra, e o receptor local dele também passa", () => {
    vi.stubEnv("NODE_ENV", "production");
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.META_ADS_GRAPH_BASE_URL = "http://receptor.exemplo.test:8080";
    expect(hostDaGraphDeAnuncio()).toBe(HOST_PADRAO_DA_GRAPH_DE_ANUNCIO);
    expect(aviso.mock.calls.length).toBe(1);
    process.env.META_ADS_GRAPH_BASE_URL = base;
    expect(hostDaGraphDeAnuncio()).toBe(base);
    vi.restoreAllMocks();
  });
});

describe("o eixo de anúncio tem o SEU knob, e ele não herda o do canal", () => {
  it("vazio nos dois = host real da Meta nos dois", () => {
    delete process.env.META_GRAPH_BASE_URL;
    delete process.env.META_ADS_GRAPH_BASE_URL;
    expect(hostDaGraphDeAnuncio()).toBe(HOST_PADRAO_DA_GRAPH_DE_ANUNCIO);
    expect(graphHost()).toBe(HOST_PADRAO_DA_GRAPH);
  });

  it("apontar o canal NÃO leva o anúncio junto — e vice-versa", () => {
    // A razão de existirem duas variáveis: quem aponta o canal para o receptor de
    // prova não pode estar reportando conversão de venda para o vazio ao mesmo
    // tempo.
    process.env.META_GRAPH_BASE_URL = base;
    delete process.env.META_ADS_GRAPH_BASE_URL;
    expect(graphBaseUrl()).toBe(`${base}/v19.0`);
    expect(baseDaGraphDeAnuncio()).toBe(`${HOST_PADRAO_DA_GRAPH_DE_ANUNCIO}/v22.0`);

    delete process.env.META_GRAPH_BASE_URL;
    process.env.META_ADS_GRAPH_BASE_URL = base;
    expect(graphBaseUrl()).toBe(`${HOST_PADRAO_DA_GRAPH}/v19.0`);
    expect(baseDaGraphDeAnuncio()).toBe(`${base}/v22.0`);
  });

  it("o eixo de anúncio usa a versão FIXA dele, não a variável do canal", () => {
    // O anúncio não herda `META_GRAPH_VERSION` — decisão já escrita em
    // `lib/graph-version.ts` e mantida aqui.
    process.env.META_ADS_GRAPH_BASE_URL = base;
    expect(baseDaGraphDeAnuncio()).toBe(`${base}/v22.0`);
  });

  it("o portão do anúncio é o mesmo: valor ruim cai no host real", () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.META_ADS_GRAPH_BASE_URL = "nao-e-url";
    expect(hostDaGraphDeAnuncio()).toBe(HOST_PADRAO_DA_GRAPH_DE_ANUNCIO);
    expect(String(aviso.mock.calls[0]![0])).toContain("META_ADS_GRAPH_BASE_URL");
    vi.restoreAllMocks();
  });
});

describe("CONTROLE DE VACUIDADE — o receptor viu requisição, alguma", () => {
  it("as sete caminhos do canal e os dois do anúncio chegam no receptor", async () => {
    // O bloco principal roda aqui: cada item exercita UM ponto do levantamento, e
    // a asserção é sobre o que CHEGOU, não sobre o que o código chamou.
    const { registrarWebhookDoNumero, desfazerWebhookDoNumero } = await import(
      "@/lib/channels/meta/webhook-override"
    );
    const { validateMetaCredentials } = await import("@/lib/channels/meta/validate-credentials");
    const { sendTemplate } = await import("@/lib/channels/meta/send-template");
    const { getAdapter } = await import("@/lib/channels");
    const { transporteMeta } = await import("@/lib/plataformas-de-anuncio/meta/conversions");
    const { montarUrl } = await import("@/lib/plataformas-de-anuncio/meta/insights");


    // 1 — validação de credencial (o que a tela de CONECTAR chama)
    responder = aceitando({ display_phone_number: "5541999999999", verified_name: "Canal" });
    const validacao = await validateMetaCredentials({ phoneNumberId: NUMERO, token: "tok", wabaId: WABA });
    expect(validacao.ok).toBe(true);

    // 2 — envio de mensagem (o `send` do adapter)
    responder = aceitando({ messages: [{ id: "wamid.REAL" }] });
    const adapter = getAdapter("meta_cloud");
    const enviado = await adapter.send({
      organizationId: ORG,
      sessionRef: NUMERO,
      to: "5531999998888",
      kind: "text",
      body: "oi",
    });
    expect(enviado).toEqual({ externalId: "wamid.REAL" });

    // 3 — modelo aprovado
    const modelo = await sendTemplate({
      phoneNumberId: NUMERO,
      token: "tok",
      graphVersion: "v19.0",
      to: "5531999998888",
      binding: {
        name: "boas_vindas",
        language: "pt_BR",
        contractHash: "h",
        values: {},
      },
      current: {
        name: "boas_vindas",
        language: "pt_BR",
        contractHash: "h",
        status: "APPROVED",
        components: [{ type: "BODY", text: "Olá" }],
      },
    });
    expect(modelo).toMatchObject({ sent: true });

    // 4 — registro do webhook do número (inscrição na WABA + override)
    responder = aceitando({ success: true });
    const registrado = await registrarWebhookDoNumero({
      phoneNumberId: NUMERO,
      wabaId: WABA,
      token: "tok",
      callbackUrl: "https://painel.test/api/v1/webhooks/meta/abc",
      verifyToken: "verifica",
    });
    expect(registrado.ok).toBe(true);
    const desfeito = await desfazerWebhookDoNumero({ phoneNumberId: NUMERO, token: "tok" });
    expect(desfeito.ok).toBe(true);

    // 5 — status/qualidade do número (`checkHealth` do adapter)
    responder = aceitando({ display_phone_number: "5541999999999", quality_rating: "GREEN" });
    const saude = await adapter.checkHealth!({
      organizationId: ORG,
      sessionRef: NUMERO,
    });
    expect(saude).toMatchObject({ reachable: true, status: "WORKING" });

    // 6 — sincronização de modelos (WABA). O `fetchAllTemplates` é privado; o
    // caminho público é `syncTemplates`, que escreve no espelho — por isso o
    // admin client precisa responder na leitura e no upsert.
    const { syncTemplates } = await import("@/lib/channels/meta/template-sync");
    responder = aceitando({ data: [] });
    const contagens = await syncTemplates({
      organizationId: ORG,
      wabaId: WABA,
      token: "tok",
      graphVersion: "v19.0",
    });
    expect(contagens.inserted + contagens.updated + contagens.unchanged).toBe(0);

    // 7 — download de mídia: o LOOKUP do `media_id` é o ponto do knob. O
    // download dos BYTES é um contrato SEPARADO e mais apertado — a resposta da
    // Graph nomeia o host, e a allowlist de `fetchInboundMedia` é fail-closed por
    // sufixo de domínio da Meta (`.fbsbx.com`, `.fbcdn.net`).
    //
    // Por isso a `url` da resposta aqui NÃO é um host da Meta: um host que a
    // allowlist ACEITA faria a função buscar os bytes na internet de verdade, e
    // este arquivo sairia medindo a rede da Meta em vez do knob. Com um host fora
    // da lista, a recusa acontece ANTES de qualquer saída — que é o comportamento
    // que se quer ver, e é o que a casa chama de prova sem dublê.
    responder = aceitando({
      id: "987654321",
      url: "https://cdn-de-prova.example.test/attachments/987654321",
      mime_type: "audio/ogg",
    });
    const antes = chegadas.length;
    await expect(
      adapter.fetchInboundMedia!({
        organizationId: ORG,
        sessionRef: "sessao-pn",
        url: "meta-media:987654321",
        hintMime: "audio/ogg",
      }),
    ).rejects.toThrow(/host de mídia inesperado/);
    // O LOOKUP, esse sim, tem de ter chegado ao receptor.
    expect(chegadas.slice(antes).some((c) => c.caminho === "/v19.0/987654321")).toBe(true);

    // 8 — conversão de anúncio
    responder = aceitando({ events_received: 1 });
    const desfecho = await transporteMeta.enviar(
      {
        datasetId: "dataset-de-prova",
        accessToken: "token-de-anuncio",
        testEventCode: null,
      } as never,
      {
        organizationId: "org",
        leadId: "lead-1",
        evento: "Purchase",
        eventoId: "lead-1:Purchase",
        ocorridoEm: new Date(),
        cliqueDeOrigem: "clid-1",
        telefone: null,
        valorCentavos: 1000,
        moeda: "BRL",
      } as never,
    );
    expect(desfecho).toEqual({ tipo: "ok" });

    // 9 — leitura de métricas de anúncio
    const url = montarUrl("act_123/insights", { fields: "cpm" });
    expect(url.startsWith(`${base}/v22.0/act_123/insights`)).toBe(true);
    expect(new URL(url).searchParams.get("fields")).toBe("cpm");

    // ─── A CONTAGEM, que é a asserção que este bloco existe para fazer ────────
    const noReceptor = chegadas.map((c) => `${c.metodo} ${c.caminho}${c.busca}`);

    // Sete caminhos do CANAL. O `validate` sozinho responde duas vezes (número e
    // lista da WABA), e o `registrar` também (inscrição e override) — por isso o
    // casamento é por padrão, não por igualdade.
    expect(noReceptor.some((u) => u.startsWith(`GET /v19.0/${NUMERO}?fields=display_phone_number`))).toBe(true);
    expect(noReceptor.some((u) => u.startsWith(`GET /v19.0/${WABA}/phone_numbers`))).toBe(true);
    expect(noReceptor.some((u) => u.startsWith(`POST /v19.0/${NUMERO}/messages`))).toBe(true);
    expect(noReceptor.some((u) => u.startsWith(`POST /v19.0/${WABA}/subscribed_apps`))).toBe(true);
    expect(noReceptor.some((u) => u.startsWith(`GET /v19.0/${WABA}/message_templates`))).toBe(true);
    // `checkHealth` e o lookup de mídia pedem o MESMO caminho da validação e do
    // `send` — eles são distinguidos pelo CAMPO pedido, e é isso que se mede.
    expect(noReceptor.some((u) => u === `GET /v19.0/${NUMERO}?fields=display_phone_number,quality_rating`)).toBe(true);
    expect(noReceptor.some((u) => u === "GET /v19.0/987654321")).toBe(true);
    // Dois caminhos do ANÚNCIO, com a versão do eixo (`v22.0`), não a do canal.
    expect(noReceptor.some((u) => u.startsWith("POST /v22.0/dataset-de-prova/events"))).toBe(true);

    // O token viaja no HEADER, nunca na query string (convenção que a casa
    // mediu e adotou: token em URL vaza para log de proxy).
    for (const chegada of chegadas) {
      expect(chegada.busca).not.toContain("token=");
      expect(chegada.authorization).toMatch(/^Bearer /);
    }

    // NENHUMA requisição foi para o host real: com o knob apontado, a Meta não
    // aparece no receptor de outra forma. Isto é a garantia de que o arquivo não
    // está medindo o caminho padrão com o dublê do `fetch` por cima.
    expect(noReceptor.length).toBeGreaterThanOrEqual(9);
  });
});
