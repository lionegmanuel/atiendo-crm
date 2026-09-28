import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Corrida entre o cron de fotos de perfil e a anonimização LGPD.
 *
 * O cron seleciona um lote de 25 e depois faz I/O de rede por contato (consulta o
 * canal, baixa a imagem, sobe para o bucket). Uma anonimização em escopo de tenant
 * percorre centenas de contatos e leva minutos. As duas se cruzam: o contato pode
 * virar anônimo DEPOIS de entrar no lote e ANTES da gravação.
 *
 * Sem guarda, o desfecho é o pior possível para uma auditoria — o rosto de quem
 * pediu remoção volta ao bucket e o ponteiro volta ao banco, e o filtro do SELECT
 * (`is_anonymized = false`) nunca mais escolhe aquele contato para corrigir.
 */

const CONTATO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CAMINHO = `${ORG}/avatars/${CONTATO}.jpg`;

/** Linhas devolvidas pelo UPDATE do carimbo: [] = nenhuma (contato anonimizado no meio). */
let linhasAfetadas: { id: string }[] = [];
const updatesContacts: { patch: Record<string, unknown>; filtros: Record<string, unknown> }[] = [];
const upsertsFila: Record<string, unknown>[] = [];
const uploads: string[] = [];

vi.mock("@/lib/env", () => ({
  env: { INTERNAL_CRON_SECRET: "segredo-de-teste", INTERNAL_SECRET: "segredo-de-teste" },
}));

vi.mock("@/lib/channels", () => ({
  DEFAULT_CHANNEL_PROVIDER: "waha",
  getAdapter: () => ({
    fetchProfilePictureUrl: async () => "https://cdn.exemplo.invalid/foto.jpg",
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => ({
      select: () => {
        const dados =
          tabela === "contacts"
            ? [{ id: CONTATO, organization_id: ORG, wa_identity: "phone:+5511999990000", avatar_storage_path: null }]
            : { waha_session_name: "sessao-de-teste", provider: "waha" };
        const proxy: Record<string, unknown> = new Proxy(
          {},
          {
            get(_t, prop) {
              if (prop === "then") {
                return (ok: (v: unknown) => unknown) => Promise.resolve({ data: dados, error: null }).then(ok);
              }
              if (prop === "maybeSingle") return async () => ({ data: dados, error: null });
              return () => proxy;
            },
          },
        );
        return proxy;
      },
      update: (patch: Record<string, unknown>) => {
        const filtros: Record<string, unknown> = {};
        const proxy: Record<string, unknown> = new Proxy(
          {},
          {
            get(_t, prop) {
              if (prop === "then") {
                return (ok: (v: unknown) => unknown) => {
                  updatesContacts.push({ patch, filtros });
                  return Promise.resolve({ data: linhasAfetadas, error: null }).then(ok);
                };
              }
              if (prop === "eq") {
                return (col: string, val: unknown) => {
                  filtros[col] = val;
                  return proxy;
                };
              }
              if (prop === "select") {
                return () => {
                  updatesContacts.push({ patch, filtros });
                  return Promise.resolve({ data: linhasAfetadas, error: null });
                };
              }
              return () => proxy;
            },
          },
        );
        return proxy;
      },
      upsert: async (payload: Record<string, unknown>) => {
        upsertsFila.push(payload);
        return { error: null };
      },
    }),
    storage: {
      from: () => ({
        upload: async (caminho: string) => {
          uploads.push(caminho);
          return { error: null };
        },
      }),
    },
  }),
}));

import { POST } from "@/app/api/v1/cron/contact-avatars/route";

beforeEach(() => {
  updatesContacts.length = 0;
  upsertsFila.length = 0;
  uploads.length = 0;
  linhasAfetadas = [{ id: CONTATO }];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })),
  );
});

function chamar(): Promise<Response> {
  return POST(
    new Request("http://localhost/api/v1/cron/contact-avatars", {
      method: "POST",
      headers: { authorization: "Bearer segredo-de-teste" },
    }) as never,
  );
}

describe("cron de fotos de perfil vs. anonimização", () => {
  it("a gravação da foto exige is_anonymized=false — não basta ter filtrado no SELECT", async () => {
    await chamar();

    const carimbo = updatesContacts.find((u) => u.patch.avatar_storage_path === CAMINHO);
    expect(carimbo, "o cron deveria gravar o caminho da foto").toBeDefined();
    expect(carimbo?.filtros).toMatchObject({
      id: CONTATO,
      organization_id: ORG,
      is_anonymized: false,
    });
  });

  it("anonimizado durante o download: não grava o ponteiro E devolve o arquivo à fila de redação", async () => {
    // O arquivo já subiu antes de descobrirmos a corrida. Bloquear só a gravação
    // deixaria o objeto no bucket sem ponteiro — órfão e invisível, pior que o
    // defeito original.
    linhasAfetadas = [];

    const resposta = await chamar();
    expect(resposta.status).toBe(200);

    expect(uploads).toContain(CAMINHO);
    expect(upsertsFila).toHaveLength(1);
    expect(upsertsFila[0]).toMatchObject({
      organization_id: ORG,
      bucket: "whatsapp-media",
      object_path: CAMINHO,
      status: "pending",
    });
  });
});
