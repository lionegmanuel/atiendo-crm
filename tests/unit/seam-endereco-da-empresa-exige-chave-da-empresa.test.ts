/**
 * DECISÃO 22-a NO CAMINHO DO CHAT — endereço próprio exige chave própria.
 *
 * O painel de Provedores deixa quem administra UMA empresa apontar um ponto de
 * IA para um endereço próprio (`ai_purpose_bindings.base_url`). Quando essa
 * empresa não tem credencial ativa e validada, `resolveOrgLlmConfig` cai na
 * chave do `.env` — a que paga a conta de todas as empresas do servidor. O seam
 * chamava `factory(config.apiKey, model, decisao.baseUrl)` sem olhar de quem era
 * a chave: numa revenda, a chave do revendedor saía para um endereço que um
 * cliente dele escolheu.
 *
 * O caminho da imagem já recusava isso desde a v1.29.0
 * (`tests/unit/midia-base-url-do-binding.test.ts`). Este arquivo prova o mesmo
 * corte no seam por onde passam o turno do agente, os classificadores e o
 * ensaio — no único lugar que não mente: o argumento que chega à FÁBRICA do
 * provedor. Asserção sobre o retorno de `runModelCall` passaria mesmo com a
 * chave saindo.
 *
 * O CASO e o CONTROLE diferem numa variável só — a organização ter ou não a
 * credencial —, com o mesmo endereço, o mesmo ponto e a mesma chave no `.env`.
 */
import { describe, expect, it, vi } from "vitest";

// A decifragem não é o assunto: uma linha de credencial devolvida pelo banco
// vira esta chave. O que está sob teste é o que o seam faz com a ORIGEM dela.
vi.mock("@/lib/crypto/aes_gcm", () => ({
  byteaToBuffer: () => Buffer.from(""),
  decryptKey: () => "chave-da-empresa",
}));

import { prazoLegivel, RECUSA_A_PARTIR_DE } from "@/lib/agent-engine/edge/llm/prazo-do-endereco-proprio";
import {
  LlmEnderecoExigeChaveDaEmpresaError,
  TITULO_ENDERECO_SEM_CHAVE_DA_EMPRESA,
  TITULO_ENDERECO_SEM_CHAVE_PRAZO,
  normalizarErro,
  runModelCall,
} from "@/lib/agent-engine/edge/llm/run-model-call";

const ORG = "11111111-1111-4111-8111-111111111111";
const ENDERECO_DA_EMPRESA = "https://gateway.da-empresa.exemplo/v1";

interface Consulta {
  sql: string;
  params: unknown[];
}

/**
 * `pg.Pool` fingido. Responde por trecho de SQL, como o irmão
 * `seam-respeita-o-binding.test.ts`: se o seam trocar a consulta, o teste
 * quebra alto em vez de devolver `undefined` e cair no caminho padrão.
 */
function poolFalso(opts: {
  baseUrl: string | null;
  credentialId?: string | null;
  /** A organização tem credencial ativa e validada do provedor do ponto? */
  empresaTemCredencial: boolean;
  /** O INSERT do aviso na Central falha (banco recusou, tabela ausente…). */
  avisoFalha?: boolean;
}) {
  const consultas: Consulta[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    consultas.push({ sql, params });
    if (sql.includes("settings->'llm'")) {
      return {
        rows: [
          {
            llm: {
              provider: "anthropic",
              default_model: "claude-padrao-da-org",
              params: {},
              enabled_models: [],
            },
          },
        ],
      };
    }
    if (sql.includes("from ai_purpose_bindings")) {
      return {
        rows: [
          {
            purpose: "stage_classifier",
            provider: "openrouter",
            credential_id: opts.credentialId ?? null,
            model_id: "acme/classificador-1",
            base_url: opts.baseUrl,
            is_enabled: true,
          },
        ],
      };
    }
    if (sql.includes("from ai_provider_credentials")) {
      return {
        rows: opts.empresaTemCredencial
          ? [{ api_key_encrypted: "x", api_key_iv: "y", api_key_tag: "z" }]
          : [],
      };
    }
    if (sql.includes("insert into agent_inbox_items")) {
      if (opts.avisoFalha) throw new Error("relation agent_inbox_items does not exist");
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("insert into llm_calls")) {
      return { rows: [{ id: "call-1" }] };
    }
    return { rows: [] };
  });
  return { pool: { query } as never, consultas };
}

/** Registry que registra os TRÊS argumentos da fábrica — a base_url é o terceiro. */
function registrySpiao() {
  const chamadas: Array<{ provider: string; apiKey: string; modelId: string; baseUrl: string | undefined }> = [];
  const fabrica = (provider: string) => (apiKey: string, modelId: string, baseUrl?: string) => {
    chamadas.push({ provider, apiKey, modelId, baseUrl });
    return {
      specificationVersion: "v3",
      provider,
      modelId,
      doGenerate: async () => ({
        content: [{ type: "text", text: "ok" }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      }),
    } as never;
  };
  return {
    chamadas,
    registry: { anthropic: fabrica("anthropic"), openai: fabrica("openai"), openrouter: fabrica("openrouter") },
  };
}

/** A instalação TEM a chave da OpenRouter no `.env` em todos os casos. */
const cfg = {
  anthropicApiKey: "chave-anthropic-da-instalacao",
  openrouterApiKey: "chave-openrouter-da-instalacao",
  cacheTtl: "1h" as const,
};

/**
 * O RELÓGIO É EXPLÍCITO EM TODO CASO, e isso é o assunto desde 19/09/2026.
 *
 * A recusa passou a ter DEGRAU: até `RECUSA_A_PARTIR_DE` a chamada segue com
 * aviso e data; a partir dela, recusa. Um teste que não declara o instante
 * mediria "o dia em que a suíte rodou" — verde hoje, vermelho no dia do corte,
 * sem ninguém ter mudado nada. Os casos de RECUSA abaixo passam uma data
 * DEPOIS do prazo; os de aviso, uma ANTES.
 */
const DEPOIS_DO_PRAZO = new Date("2026-11-01T00:00:00.000Z");
const ANTES_DO_PRAZO = new Date("2026-09-20T00:00:00.000Z");

async function chamar(opts: Parameters<typeof poolFalso>[0] & { agora?: Date }) {
  const { pool, consultas } = poolFalso(opts);
  const { registry, chamadas } = registrySpiao();
  const execucao = runModelCall(
    pool,
    cfg,
    { tenantId: ORG, purpose: "stage_classifier", messages: [{ role: "user", content: "oi" }] },
    { registry, agora: opts.agora ?? DEPOIS_DO_PRAZO },
  );
  return { execucao, consultas, chamadas };
}

const avisosNaCentral = (consultas: Consulta[]) =>
  consultas.filter((c) => c.sql.includes("insert into agent_inbox_items"));
const falhasGravadas = (consultas: Consulta[]) =>
  consultas.filter((c) => c.sql.includes("insert into llm_calls") && c.sql.includes("'erro'"));

describe("endereço da empresa + chave da INSTALAÇÃO: a chave não sai", () => {
  it("recusa antes da fábrica, com erro tipado", async () => {
    const { execucao, chamadas } = await chamar({ baseUrl: ENDERECO_DA_EMPRESA, empresaTemCredencial: false });

    await expect(execucao).rejects.toBeInstanceOf(LlmEnderecoExigeChaveDaEmpresaError);
    // O ponto de verdade: a fábrica NUNCA recebeu a chave da instalação, com
    // ou sem o endereço.
    expect(chamadas).toHaveLength(0);
  });

  it("abre aviso na Central com a instrução, e o corpo não vaza a URL inteira", async () => {
    const { execucao, consultas } = await chamar({
      baseUrl: "https://usuario:segredo@gateway.da-empresa.exemplo/v1?token=abc123",
      empresaTemCredencial: false,
    });
    await execucao.catch(() => undefined);

    const avisos = avisosNaCentral(consultas);
    expect(avisos).toHaveLength(1);
    const [org, titulo, corpo] = avisos[0]!.params as [string, string, string];
    expect(org).toBe(ORG);
    expect(titulo).toBe(TITULO_ENDERECO_SEM_CHAVE_DA_EMPRESA);
    expect(avisos[0]!.sql).toContain("'critical'");
    // A dedup: uma rajada de conversas não pode virar uma rajada de avisos.
    expect(avisos[0]!.sql).toContain("not exists");
    expect(corpo).toContain("cadastre a chave da empresa em Agente de IA › Provedores");
    expect(corpo).toContain("tire o endereço próprio");
    expect(corpo).toContain("gateway.da-empresa.exemplo");
    // Quem lê a Central é a equipe inteira: usuário, senha e token da URL não
    // podem ir parar ali.
    expect(corpo).not.toContain("segredo");
    expect(corpo).not.toContain("abc123");
  });

  it("grava a recusa em llm_calls com código próprio, para a tela de Execuções explicar", async () => {
    const { execucao, consultas } = await chamar({ baseUrl: ENDERECO_DA_EMPRESA, empresaTemCredencial: false });
    await execucao.catch(() => undefined);

    const falhas = falhasGravadas(consultas);
    expect(falhas).toHaveLength(1);
    expect(falhas[0]!.params).toContain("endereco_exige_chave_da_empresa");
    expect(normalizarErro(new LlmEnderecoExigeChaveDaEmpresaError()).error_code).toBe(
      "endereco_exige_chave_da_empresa",
    );
  });

  it("a credencial ESCOLHIDA no ponto, se revogada, também cai na chave da instalação — e é recusada", async () => {
    // O degrau menos óbvio da escada: `credential_id` preenchido, mas a linha
    // não está mais ativa/validada. O resolvedor não lança — cai no `.env`.
    const { execucao, chamadas } = await chamar({
      baseUrl: ENDERECO_DA_EMPRESA,
      credentialId: "22222222-2222-4222-8222-222222222222",
      empresaTemCredencial: false,
    });

    await expect(execucao).rejects.toBeInstanceOf(LlmEnderecoExigeChaveDaEmpresaError);
    expect(chamadas).toHaveLength(0);
  });

  it("aviso que não abre NÃO destrava a chamada", async () => {
    const { execucao, chamadas } = await chamar({
      baseUrl: ENDERECO_DA_EMPRESA,
      empresaTemCredencial: false,
      avisoFalha: true,
    });

    await expect(execucao).rejects.toBeInstanceOf(LlmEnderecoExigeChaveDaEmpresaError);
    expect(chamadas).toHaveLength(0);
  });

  it("não é veto `terminal`: a fila tenta de novo, e quem corrigir a tempo tem a conversa respondida", () => {
    // `terminal` faz a fila CANCELAR o job sem retry — só é seguro com a escolta
    // de handoff que o orçamento tem e esta recusa não tem.
    expect((new LlmEnderecoExigeChaveDaEmpresaError() as { terminal?: unknown }).terminal).toBeUndefined();
  });
});

describe("os controles — o que continua funcionando", () => {
  it("mesmo endereço com a credencial DA EMPRESA: chama normalmente, com o endereço", async () => {
    const { execucao, chamadas, consultas } = await chamar({
      baseUrl: ENDERECO_DA_EMPRESA,
      empresaTemCredencial: true,
    });

    await expect(execucao).resolves.toBeDefined();
    expect(chamadas).toEqual([
      {
        provider: "openrouter",
        apiKey: "chave-da-empresa",
        modelId: "acme/classificador-1",
        baseUrl: ENDERECO_DA_EMPRESA,
      },
    ]);
    expect(avisosNaCentral(consultas)).toHaveLength(0);
  });

  it("sem endereço próprio, a chave da instalação segue valendo no endpoint padrão", async () => {
    // A regra é sobre o ENDEREÇO. Uma trava que recusasse toda chave da
    // instalação derrubaria toda instalação de uma empresa só — o caso comum.
    const { execucao, chamadas, consultas } = await chamar({ baseUrl: null, empresaTemCredencial: false });

    await expect(execucao).resolves.toBeDefined();
    expect(chamadas).toEqual([
      {
        provider: "openrouter",
        apiKey: "chave-openrouter-da-instalacao",
        modelId: "acme/classificador-1",
        baseUrl: undefined,
      },
    ]);
    expect(avisosNaCentral(consultas)).toHaveLength(0);
  });
});

/**
 * A VIRADA DO PRAZO — a decisão (d) do dono (19/09/2026, doc 40).
 *
 * Recusar no instante da atualização obrigaria quem opera a agir ANTES de
 * atualizar, o que é major pela régua de versionamento, e major só sai quando
 * ele pedir. Então a mudança entra em dois tempos, e é ESTE arquivo que prova a
 * virada — com o relógio injetado, porque senão ela nunca é exercitada e o dia
 * do corte vira surpresa em produção.
 */
describe("o degrau do prazo", () => {
  it("ANTES da data: a chamada SEGUE — ninguém precisa agir para atualizar", async () => {
    const { execucao, chamadas } = await chamar({
      baseUrl: ENDERECO_DA_EMPRESA,
      empresaTemCredencial: false,
      agora: ANTES_DO_PRAZO,
    });

    await expect(execucao).resolves.toBeDefined();
    // E ela sai mesmo — com a chave da instalação, que é o residual declarado
    // desta janela: o dono escolheu avisar antes de quebrar.
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]!.baseUrl).toBe(ENDERECO_DA_EMPRESA);
  });

  it("ANTES da data: o aviso na Central traz a DATA ABSOLUTA, não 'em 30 dias'", async () => {
    const { execucao, consultas } = await chamar({
      baseUrl: ENDERECO_DA_EMPRESA,
      empresaTemCredencial: false,
      agora: ANTES_DO_PRAZO,
    });
    await execucao;

    const avisos = avisosNaCentral(consultas);
    expect(avisos).toHaveLength(1);
    const [, titulo, corpo] = avisos[0]!.params as [string, string, string];
    // Título PRÓPRIO: dizer "recusou" seria falso enquanto a chamada segue.
    expect(titulo).toBe(TITULO_ENDERECO_SEM_CHAVE_PRAZO);
    expect(titulo).toContain(prazoLegivel());
    expect(corpo).toContain(prazoLegivel());
    expect(corpo).toContain("A chamada SEGUIU desta vez");
    // Quem lê o alerta três semanas depois precisa saber o DIA.
    expect(corpo, "contagem relativa envelhece na tela").not.toMatch(/em \d+ dias/);
  });

  it("ANTES da data: NÃO grava falha em llm_calls — a chamada não falhou", async () => {
    const { execucao, consultas } = await chamar({
      baseUrl: ENDERECO_DA_EMPRESA,
      empresaTemCredencial: false,
      agora: ANTES_DO_PRAZO,
    });
    await execucao;

    expect(falhasGravadas(consultas)).toHaveLength(0);
  });

  it("DEPOIS da data: recusa, sem ninguém ter reaberto o assunto", async () => {
    const { execucao, chamadas } = await chamar({
      baseUrl: ENDERECO_DA_EMPRESA,
      empresaTemCredencial: false,
      agora: DEPOIS_DO_PRAZO,
    });

    await expect(execucao).rejects.toBeInstanceOf(LlmEnderecoExigeChaveDaEmpresaError);
    expect(chamadas).toHaveLength(0);
  });

  it("no INSTANTE exato do prazo já recusa — a borda é do lado seguro", async () => {
    const { execucao } = await chamar({
      baseUrl: ENDERECO_DA_EMPRESA,
      empresaTemCredencial: false,
      agora: new Date(RECUSA_A_PARTIR_DE),
    });

    await expect(execucao).rejects.toBeInstanceOf(LlmEnderecoExigeChaveDaEmpresaError);
  });

  it("empresa COM chave própria não é tocada pelo prazo, nos dois lados da data", async () => {
    for (const agora of [ANTES_DO_PRAZO, DEPOIS_DO_PRAZO]) {
      const { execucao, chamadas, consultas } = await chamar({
        baseUrl: ENDERECO_DA_EMPRESA,
        empresaTemCredencial: true,
        credentialId: "cred-1",
        agora,
      });
      await expect(execucao).resolves.toBeDefined();
      expect(chamadas).toHaveLength(1);
      expect(avisosNaCentral(consultas)).toHaveLength(0);
    }
  });
});
