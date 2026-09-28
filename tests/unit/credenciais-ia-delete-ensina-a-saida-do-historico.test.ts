/**
 * A recusa do DELETE tem de ensinar a saída que EXISTE para quem tem histórico.
 *
 * O caso da issue #1142: a credencial é usada só por versões SUPERSEDED. A
 * contagem honesta (qualquer versão que referencie a chave) recusa a exclusão —
 * correto, é o que a FK `ON DELETE RESTRICT` faz —, mas a frase ensinava
 * "aponte essa versão para outra chave", e isso NÃO é possível numa versão fora
 * de rascunho: o trigger `fn_ai_agent_version_content_immutable`
 * (`supabase/baseline.sql`) recusa qualquer mudança de conteúdo, `credential_id`
 * inclusive, quando `old.status <> 'draft'`. O operador ficava sem saída
 * nenhuma: nem repontar, nem apagar, e a mensagem mandando fazer o impossível.
 *
 * O que existe para versão congelada é editar a credencial NO LUGAR (PATCH:
 * chave nova ou só o rótulo) — o id não muda, o vínculo das versões continua
 * válido. Repontar segue sendo a saída do RASCUNHO, e é isso que a frase diz
 * quando só há rascunho.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { DELETE } from "@/app/api/v1/ai/credentials/[id]/route";
import { versoesCongeladas, type VersaoQueBloqueia } from "@/lib/ai/credenciais/uso";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

const org = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";

type Resposta = { data?: unknown; error?: unknown };
type Fake = { from: (table: string) => unknown };

/** Chain mínimo que cobre select/filter/maybeSingle/single/delete e é thenable. */
function fakeAdmin(config: Record<string, Resposta>): Fake {
  return {
    from(table: string) {
      let op = "select";
      const respond = () => config[`${table}:${op}`] ?? config[table] ?? { data: null, error: null };
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        limit: () => chain,
        update: () => {
          op = "update";
          return chain;
        },
        insert: () => {
          op = "insert";
          return chain;
        },
        delete: () => {
          op = "delete";
          return chain;
        },
        maybeSingle: async () => respond(),
        single: async () => respond(),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(respond()).then(resolve),
      };
      return chain;
    },
  };
}

const cred = {
  id,
  organization_id: org,
  provider: "anthropic",
  label: "Produção",
  api_key_last4: "abcd",
};

function versao(over: { id?: string; status?: string; version_number?: number; nome?: string }) {
  return {
    id: over.id ?? "v1",
    credential_id: id,
    version_number: over.version_number ?? 1,
    status: over.status ?? "draft",
    ai_agents: {
      id: "a1",
      name: over.nome ?? "Atendimento",
      archived_at: null,
      published_version_id: null,
    },
  };
}

function invocar() {
  return DELETE(
    new NextRequest(`http://localhost/api/v1/ai/credentials/${id}`, { method: "DELETE" }),
    { params: Promise.resolve({ id }) },
  );
}

function comVersoes(versoes: unknown[]) {
  vi.mocked(createAdminClient).mockReturnValue(
    fakeAdmin({
      "ai_provider_credentials:select": { data: cred, error: null },
      "ai_agent_versions:select": { data: versoes, error: null },
    }) as unknown as ReturnType<typeof createAdminClient>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    org: { orgId: org, role: "admin", name: "Org" },
    user: { id: "actor", idioma: "pt-BR" },
  } as Awaited<ReturnType<typeof requireRole>>);
});

describe("versoesCongeladas", () => {
  const linha = (status: string | null): VersaoQueBloqueia => ({
    versionId: "v",
    versionNumber: 1,
    status,
    agentName: "A",
  });

  it("só rascunho é repontável; o resto é congelado", () => {
    const congeladas = versoesCongeladas([
      linha("draft"),
      linha("published"),
      linha("superseded"),
      linha("archived"),
      linha(null),
    ]);
    expect(congeladas.map((v) => v.status)).toEqual(["published", "superseded", "archived", null]);
  });

  it("status desconhecido conta como congelado (na dúvida, não ensina o impossível)", () => {
    expect(versoesCongeladas([linha("publicando")]).length).toBe(1);
  });
});

describe("DELETE /api/v1/ai/credentials/:id ensina a saída do histórico", () => {
  it("credencial usada só por versão superseded não manda repontar (é impossível): manda editar", async () => {
    comVersoes([versao({ id: "v3", version_number: 3, status: "superseded", nome: "Triagem" })]);

    const res = await invocar();
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error.code).toBe("credential_in_use");
    // Continua dizendo ONDE está o uso histórico.
    expect(body.error.message).toContain("1 versão de agente");
    expect(body.error.message).toContain("Triagem v3");
    expect(body.error.message).toContain("já saiu do rascunho");
    // E diz a saída REAL: editar a credencial no lugar (o id não muda).
    expect(body.error.message).toContain("Editar credencial");
    expect(body.error.message).toContain("não pode ser excluída enquanto esse histórico existir");
    // A instrução impossível para versão congelada não aparece mais.
    expect(body.error.message).not.toContain("Aponte essa versão para outra chave");
    expect(body.error.message).not.toContain("Aponte essas versões para outra chave");
    expect(body.error.details).toMatchObject({
      count: 1,
      immutable_count: 1,
      versions: [{ agent_name: "Triagem", version_number: 3, status: "superseded" }],
    });
    expect(audit).not.toHaveBeenCalled();
  });

  it("publicada também é congelada — não é só superseded", async () => {
    comVersoes([versao({ id: "v2", version_number: 2, status: "published", nome: "Atendimento" })]);

    const body = await (await invocar()).json();

    expect(body.error.message).toContain("Editar credencial");
    expect(body.error.message).not.toContain("Aponte essa versão para outra chave");
    expect(body.error.details.immutable_count).toBe(1);
  });

  it("rascunho junto de congelada: avisa que repontar o rascunho não desbloqueia", async () => {
    comVersoes([
      versao({ id: "v3", version_number: 3, status: "superseded", nome: "Triagem" }),
      versao({ id: "v2", version_number: 2, status: "draft", nome: "Atendimento" }),
    ]);

    const body = await (await invocar()).json();

    expect(body.error.message).toContain("2 versões de agente");
    expect(body.error.message).toContain("Triagem v3");
    expect(body.error.message).toContain("Atendimento v2");
    expect(body.error.message).toContain("Repontar a versão em rascunho não desbloqueia a exclusão");
    expect(body.error.message).toContain("Editar credencial");
    expect(body.error.message).not.toContain("Aponte essas versões para outra chave");
    expect(body.error.details).toMatchObject({ count: 2, immutable_count: 1 });
  });

  it("só rascunho segue ensinando a repontar — ali ela é mesmo possível", async () => {
    comVersoes([versao({ id: "v4", version_number: 4, status: "draft", nome: "Triagem" })]);

    const body = await (await invocar()).json();

    expect(body.error.message).toContain("Aponte essa versão para outra chave");
    expect(body.error.message).not.toContain("Editar credencial");
    expect(body.error.details.immutable_count).toBe(0);
  });
});
