/**
 * A chave que o provisionamento entrega ABRE o que promete, e a anterior
 * deixa de valer DE VERDADE — ou a auditoria não diz que deixou.
 *
 * Os dois defeitos que a revisão de segurança do #1244 achou moram aqui:
 *
 *  1. A chave nascia sem `mcp:read`/`mcp:write`, e todo consumidor de bearer
 *     `dsk_` cobra um dos dois: a organização nascia inoperável pela chave
 *     entregue para operá-la.
 *  2. A revogação da chave anterior descartava o erro da busca, descartava o
 *     retorno do UPDATE inteiro e auditava `token.revoked` incondicionalmente:
 *     com o UPDATE falhando, a chave antiga seguia aceita e o log append-only
 *     afirmava o contrário do banco.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Chamada = { tabela: string; metodo: string; args: unknown[] };

const h = vi.hoisted(() => ({
  chamadas: [] as Chamada[],
  anteriores: { data: [] as { id: string }[] | null, error: null as { message: string } | null },
  revogadas: { data: [] as { id: string }[] | null, error: null as { message: string } | null },
  auditadas: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/audit", () => ({
  audit: (linha: Record<string, unknown>) => {
    h.auditadas.push(linha);
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      let modo: "busca" | "revogacao" | "insercao" = "busca";
      const chain: Record<string, unknown> = {};
      const registra =
        (metodo: string) =>
        (...args: unknown[]) => {
          h.chamadas.push({ tabela, metodo, args });
          if (metodo === "update") modo = "revogacao";
          if (metodo === "insert") modo = "insercao";
          return chain;
        };
      for (const m of ["select", "eq", "is", "in", "contains", "update", "insert"]) {
        chain[m] = registra(m);
      }
      chain.single = async () => ({ data: { id: "tok-novo" }, error: null });
      chain.then = (ok: (v: unknown) => unknown) =>
        ok(modo === "revogacao" ? h.revogadas : modo === "busca" ? h.anteriores : { data: null, error: null });
      return chain;
    },
  }),
}));

const { rotateIntegrationApiKey } = await import("./api-key");
// O consumidor REAL dos escopos: é ele que decide a espécie do ator. Afirmar a
// lista sem passá-la por aqui provaria a lista, não o efeito dela.
const { deriveActor } = await import("@/lib/mcp/auth");

const ENTRADA = {
  organizationId: "org-1",
  createdBy: "user-1",
  integrationScope: "integration:clinicfx",
  name: "clinicfx (integração)",
  requestId: "req-1",
};

const inseridas = () =>
  h.chamadas.filter((c) => c.tabela === "api_tokens" && c.metodo === "insert");
const revogacoesAuditadas = () =>
  h.auditadas.filter((a) => a.action === "token.revoked").map((a) => a.resourceId);

beforeEach(() => {
  h.chamadas = [];
  h.auditadas = [];
  h.anteriores = { data: [], error: null };
  h.revogadas = { data: [], error: null };
});

describe("a chave abre o que promete", () => {
  // `toEqual` na lista INTEIRA, e não `arrayContaining`: o recorte é
  // deliberado, nos DOIS sentidos. Sem `mcp:read`/`mcp:write` a chave não abre
  // nada (todo consumidor de `dsk_` cobra um dos dois); com `role:manager` ou
  // `role:ai_operator` acrescentado sem querer, um parceiro EXTERNO ganharia
  // por provisionamento automático o que só deve sair de uma decisão humana na
  // tela de Chaves de API. Os dois erros reprovam aqui.
  it("nasce com mcp:read e mcp:write, e com o papel agent — nada além", async () => {
    await rotateIntegrationApiKey(ENTRADA);
    const [insercao] = inseridas();
    const scopes = (insercao?.args[0] as { scopes: string[] }).scopes;
    expect(scopes).toEqual(["mcp:read", "mcp:write", "role:agent", "integration:clinicfx"]);
  });

  // ⚠️ A AUSÊNCIA é afirmação, e `toEqual` acima já a cobre — este caso existe
  // para dizer POR QUÊ, e para que quem reintroduzir o escopo leia o motivo no
  // nome do teste que ficou vermelho. `deriveActor` escolhe a espécie do ator
  // pela presença de `actor:ai_agent`: com ele, a linha do tempo atribui à "IA"
  // o que um sistema parceiro fez, `crm_resume_agent` (uma das 46 de
  // `role:agent`) responde `resume_requires_person`, e o `run_id` do handoff
  // recebe o id do TOKEN. O parceiro é uma integração — `api_token`, a variante
  // que `lib/api/handlers/types.ts` criou para este caso.
  it("NÃO é um agente de IA: nenhum escopo `actor:` na chave da integração", async () => {
    await rotateIntegrationApiKey(ENTRADA);
    const scopes = (inseridas()[0]?.args[0] as { scopes: string[] }).scopes;
    expect(scopes.filter((s) => s.startsWith("actor:"))).toEqual([]);
    expect(deriveActor(scopes, "tok-novo")).toEqual({
      type: "api_token",
      id: "tok-novo",
      role: "agent",
    });
  });
});

describe("a chave anterior deixa de valer, ou a auditoria não diz que deixou", () => {
  it("a busca da anterior usa JSON em `scopes` (jsonb), não literal de array", async () => {
    await rotateIntegrationApiKey(ENTRADA);
    const busca = h.chamadas.find((c) => c.metodo === "contains");
    expect(busca?.args).toEqual(["scopes", JSON.stringify(["integration:clinicfx"])]);
  });

  it("revoga só o que ainda está viva e audita SÓ o que o banco devolveu", async () => {
    h.anteriores = { data: [{ id: "tok-a" }, { id: "tok-b" }], error: null };
    // `tok-b` foi revogada por outro caminho entre a leitura e a escrita.
    h.revogadas = { data: [{ id: "tok-a" }], error: null };

    await rotateIntegrationApiKey(ENTRADA);

    const depoisDoUpdate = h.chamadas.slice(h.chamadas.findIndex((c) => c.metodo === "update"));
    expect(depoisDoUpdate.some((c) => c.metodo === "is" && c.args[0] === "revoked_at")).toBe(true);
    expect(depoisDoUpdate.some((c) => c.metodo === "select")).toBe(true);
    expect(revogacoesAuditadas()).toEqual(["tok-a"]);
  });

  it("revogação que falha NÃO emite chave nova nem audita revogação", async () => {
    h.anteriores = { data: [{ id: "tok-a" }], error: null };
    h.revogadas = { data: null, error: { message: "timeout do pooler" } };

    await expect(rotateIntegrationApiKey(ENTRADA)).rejects.toThrow(/revogação da chave anterior falhou/);
    expect(revogacoesAuditadas()).toEqual([]);
    expect(inseridas()).toEqual([]);
  });

  it("busca da anterior que falha NÃO vira 'não há anterior'", async () => {
    h.anteriores = { data: null, error: { message: "PostgREST fora" } };

    await expect(rotateIntegrationApiKey(ENTRADA)).rejects.toThrow(/busca da chave anterior falhou/);
    expect(inseridas()).toEqual([]);
  });

  it("o ator da auditoria é a máquina, com o dono em metadata", async () => {
    await rotateIntegrationApiKey(ENTRADA);
    const criada = h.auditadas.find((a) => a.action === "token.created");
    expect(criada?.actorUserId).toBeNull();
    expect(criada?.requestId).toBe("req-1");
    expect((criada?.metadata as { owner_user_id: string }).owner_user_id).toBe("user-1");
  });
});
