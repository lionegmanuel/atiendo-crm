import { describe, expect, it, vi } from "vitest";

import { decidirPreGoLiveDoCanalViaSupabase } from "./consulta-pre-go-live";

function adminStub(resposta: { data: unknown; error: { message: string } | null }) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(resposta)),
  };
  return { client: { from: vi.fn(() => chain) } as never, chain };
}

const input = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  channelSessionId: "22222222-2222-4222-8222-222222222222",
  contactPhoneNumber: "+5585987654321",
};

describe("decidirPreGoLiveDoCanalViaSupabase", () => {
  it("não interfere num canal aberto ou num allowlist legado", async () => {
    for (const metadata of [{}, { ai_gate: "allowlist" }]) {
      const { client } = adminStub({ data: { metadata }, error: null });
      await expect(decidirPreGoLiveDoCanalViaSupabase(client, input)).resolves.toMatchObject({
        ativo: false,
        permite: true,
      });
    }
  });

  it("permite o testador e barra outro número", async () => {
    const metadata = {
      ai_gate: "allowlist",
      ai_gate_mode: "pre_go_live",
      ai_test_phone_numbers: [input.contactPhoneNumber],
    };
    const { client } = adminStub({ data: { metadata }, error: null });
    await expect(decidirPreGoLiveDoCanalViaSupabase(client, input)).resolves.toMatchObject({
      ativo: true,
      permite: true,
      motivo: "numero_de_teste",
    });

    const segundo = adminStub({ data: { metadata }, error: null }).client;
    await expect(
      decidirPreGoLiveDoCanalViaSupabase(segundo, {
        ...input,
        contactPhoneNumber: "+5585987654000",
      }),
    ).resolves.toMatchObject({
      ativo: true,
      permite: false,
      motivo: "fora_da_lista_de_teste",
    });
  });

  it("filtra canal por organização e falha fechado quando não consegue ler", async () => {
    const { client, chain } = adminStub({ data: null, error: { message: "indisponível" } });
    await expect(decidirPreGoLiveDoCanalViaSupabase(client, input)).rejects.toThrow(/indisponível/);
    expect(chain.eq).toHaveBeenCalledWith("organization_id", input.organizationId);
    expect(chain.eq).toHaveBeenCalledWith("id", input.channelSessionId);
  });
});
