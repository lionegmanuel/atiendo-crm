/**
 * O RETRATO DA INSTALAÇÃO — a peça que decide o que o wizard afirma.
 *
 * Ela não tinha teste, e o defeito que este arquivo nasceu para fechar é
 * exatamente do tipo que só aparece com o cronômetro na mão: a consulta filtrava
 * `validated_at is not null`, então uma organização que ACABAVA de cadastrar a
 * chave era lida como se não tivesse nenhuma. A validação roda em segundo plano,
 * então essa janela existe SEMPRE — quem cola a chave no wizard cai nela.
 *
 * O que a pessoa via, medido percorrendo o wizard num tenant fresco: colava a
 * chave, e a tela respondia "Não consegui testar o crédito" e "Falta a chave da
 * inteligência artificial". As duas frases mandam cadastrar de novo o que já
 * está lá.
 */
import { describe, expect, it } from "vitest";

import { lerRetratoDaInstalacao } from "@/lib/instalacao/retrato";

type Linha = Record<string, unknown>;

/**
 * Um dobro do client que responde por TABELA e respeita os filtros que o retrato
 * usa — sem isso um caso "passa" por o dobro devolver a mesma linha para toda
 * consulta, que é o teste que nunca vermelheia.
 */
function clientFalso(tabelas: Record<string, Linha[]>) {
  function consulta(nome: string) {
    let linhas = [...(tabelas[nome] ?? [])];
    const api: Record<string, unknown> = {
      select: () => api,
      order: () => api,
      eq: (col: string, val: unknown) => {
        linhas = linhas.filter((l) => l[col] === val);
        return api;
      },
      is: (col: string, val: unknown) => {
        linhas = linhas.filter((l) => (val === null ? l[col] == null : l[col] === val));
        return api;
      },
      not: (col: string, _op: string, val: unknown) => {
        linhas = linhas.filter((l) => (val === null ? l[col] != null : l[col] !== val));
        return api;
      },
      // `limit` é encadeável: o retrato usa `.limit(1).maybeSingle()` num lugar
      // e `.limit(5)` seguido de `await` noutro.
      limit: (n: number) => {
        linhas = linhas.slice(0, n);
        return api;
      },
      maybeSingle: () => Promise.resolve({ data: linhas[0] ?? null, error: null }),
    };
    // `await` direto na consulta (sem limit/maybeSingle) também resolve.
    (api as { then: unknown }).then = (r: (v: unknown) => unknown) =>
      r({ data: linhas, error: null });
    return api;
  }
  return { from: (nome: string) => consulta(nome) } as never;
}

const ORG = "11111111-1111-4111-8111-111111111111";

function tabelas(credenciais: Linha[]): Record<string, Linha[]> {
  return {
    organizations: [
      { id: ORG, display_name: "Minha Empresa", settings: { llm: { provider: "anthropic" } } },
    ],
    ai_provider_credentials: credenciais,
    ai_models: [
      { provider: "anthropic", model_id: "claude-sonnet-5", is_default_for_provider: true, deprecated_at: null },
    ],
    crm_pipelines: [{ organization_id: ORG, id: "f1", name: "Pedidos", is_default: true, is_archived: false }],
  };
}

const CRED = {
  organization_id: ORG,
  provider: "anthropic",
  is_active: true,
  id: "c1",
  label: "Chave do onboarding",
  api_key_last4: "ygAA",
};

const SEM_AMBIENTE = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" };

describe("o retrato da instalação", () => {
  it("credencial confirmada é a chave da organização", async () => {
    const r = await lerRetratoDaInstalacao({
      supabase: clientFalso(tabelas([{ ...CRED, validated_at: "2026-08-13T00:00:00Z" }])),
      orgId: ORG,
      ambiente: SEM_AMBIENTE,
    });
    expect(r.inteligencia.origemDaChave).toBe("org");
    expect(r.inteligencia.chaveEmVerificacao).toBe(false);
    expect(r.inteligencia.chaveDaOrg?.final).toBe("ygAA");
    // O `id` existe porque a prova de saldo precisa DECIFRAR a chave.
    expect(r.inteligencia.chaveDaOrg?.id).toBe("c1");
  });

  it("credencial recém-cadastrada NÃO é 'nenhuma' — está sendo conferida", async () => {
    // O defeito. `validated_at` nulo é o estado normal nos primeiros segundos, e
    // colapsá-lo em "nenhuma" faz a tela mandar cadastrar de novo o que já está
    // lá.
    const r = await lerRetratoDaInstalacao({
      supabase: clientFalso(tabelas([{ ...CRED, validated_at: null }])),
      orgId: ORG,
      ambiente: SEM_AMBIENTE,
    });
    expect(r.inteligencia.chaveEmVerificacao).toBe(true);
    // E a precedência não muda: o turno não consegue usar credencial que o
    // provedor ainda não confirmou, então ela não vira `origemDaChave: "org"`.
    expect(r.inteligencia.origemDaChave).not.toBe("org");
  });

  it("sem credencial nenhuma, a chave da instalação vale", async () => {
    const r = await lerRetratoDaInstalacao({
      supabase: clientFalso(tabelas([])),
      orgId: ORG,
      ambiente: { ...SEM_AMBIENTE, ANTHROPIC_API_KEY: "sk-ant-xxx" },
    });
    expect(r.inteligencia.origemDaChave).toBe("instalacao");
    expect(r.inteligencia.chaveEmVerificacao).toBe(false);
  });

  it("sem chave em lugar nenhum, o retrato admite", async () => {
    const r = await lerRetratoDaInstalacao({
      supabase: clientFalso(tabelas([])),
      orgId: ORG,
      ambiente: SEM_AMBIENTE,
    });
    expect(r.inteligencia.origemDaChave).toBe("nenhuma");
    expect(r.inteligencia.chaveEmVerificacao).toBe(false);
    expect(r.inteligencia.prontaParaPublicar).toBe(false);
  });

  it("credencial de OUTRO provedor não conta como a chave desta instalação", async () => {
    // O provedor sai de `settings.llm.provider` — quem escolheu Anthropic no
    // instalador e tem uma chave OpenAI cadastrada continua sem chave para o
    // provedor que o agente vai usar.
    const r = await lerRetratoDaInstalacao({
      supabase: clientFalso(
        tabelas([{ ...CRED, provider: "openai", validated_at: "2026-08-13T00:00:00Z" }]),
      ),
      orgId: ORG,
      ambiente: SEM_AMBIENTE,
    });
    expect(r.inteligencia.origemDaChave).toBe("nenhuma");
    expect(r.inteligencia.chaveEmVerificacao).toBe(false);
  });

  it("credencial desativada não conta, nem como 'em verificação'", async () => {
    const r = await lerRetratoDaInstalacao({
      supabase: clientFalso(tabelas([{ ...CRED, is_active: false, validated_at: null }])),
      orgId: ORG,
      ambiente: SEM_AMBIENTE,
    });
    expect(r.inteligencia.chaveEmVerificacao).toBe(false);
    expect(r.inteligencia.origemDaChave).toBe("nenhuma");
  });

  it("o nome placeholder do instalador é reconhecido como 'ainda sem nome'", async () => {
    const r = await lerRetratoDaInstalacao({
      supabase: clientFalso(tabelas([])),
      orgId: ORG,
      ambiente: SEM_AMBIENTE,
    });
    expect(r.empresa.aindaSemNomeProprio).toBe(true);
  });
});
