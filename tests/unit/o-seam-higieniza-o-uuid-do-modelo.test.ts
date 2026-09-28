import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O SEAM HIGIENIZA — não basta a função saber.
 *
 * ═══ Por que este arquivo existe, separado do irmão ═════════════════════════
 *
 * `uuid-de-modelo-nao-vira-filtro.test.ts` prova uma propriedade de
 * `higienizarUuidsDeAterro`: dado o schema e o payload, ela apaga a chave certa.
 * Isso é verdade e é insuficiente — porque uma função correta que ninguém chama
 * não protege nada.
 *
 * Medido, não suposto: sabotei o ingresso (`lib/ai/runtime/tools.ts`, trocando
 * `higiene.limpos` de volta pelos args crus) e os SETE casos do arquivo irmão
 * ficaram verdes. É o modo de falha que o repo já catalogou — guarda que mede a
 * função e não o call site.
 *
 * Aqui a asserção é sobre a CADEIA INTEIRA: monta a ferramenta como o turno do
 * agente a monta (`pickToolsFromMcp`), executa com a sentinela que o modelo
 * mandou em produção, e lê o que chegou lá no fim — na COLETA, que é quem faz a
 * consulta. Se qualquer elo do caminho parar de higienizar, este caso cai.
 *
 * ═══ O caso real que ele reproduz ═══════════════════════════════════════════
 *
 *     crm_find_free_slots { event_type_slug: "hof-e-botox",
 *                           owner_user_id: "00000000-0000-0000-0000-000000000000" }
 *
 * Com o zerado passando, `params.ownerUserId ?? tipo.default_owner_user_id`
 * escolhe o zerado, a jornada de um usuário que não existe volta vazia, e o
 * agente conclui que a agenda não foi publicada. A paciente ficou sem consulta.
 */

const NIL = "00000000-0000-0000-0000-000000000000";
const BOM = "fb8061a5-27c0-4b13-9728-833b8f06828a";

// A coleta é o FIM da cadeia: é ela quem recebe o `ownerUserId` e consulta a
// jornada. Espiá-la aqui é o que torna a asserção sobre o caminho, e não sobre
// a função de higiene.
vi.mock("@/lib/agenda/consulta", async (original) => {
  const real = await original<typeof import("@/lib/agenda/consulta")>();
  return { ...real, horariosLivresDaOrg: vi.fn() };
});
// O audit escreve no Supabase e não é o objeto desta medição.
vi.mock("@/lib/mcp/audit", () => ({ auditMcpToolCall: vi.fn().mockResolvedValue(undefined) }));

const { horariosLivresDaOrg } = await import("@/lib/agenda/consulta");
const { pickToolsFromMcp } = await import("@/lib/ai/runtime/tools");

function montarTurno() {
  return pickToolsFromMcp({
    toolIds: ["crm_find_free_slots"],
    auth: {
      organizationId: "org-1",
      role: "ai_operator",
      scopes: ["mcp:read", "mcp:write"],
      actor: { type: "ai_agent", id: "ag-1", role: "ai_operator" },
      apiTokenId: "tok-1",
    },
    ctx: {
      organizationId: "org-1",
      role: "ai_operator",
      actor: { type: "ai_agent", id: "ag-1", role: "ai_operator" },
      apiTokenId: "tok-1",
      requestId: "req-1",
    },
    supabase: {} as never,
    pipelineIds: null,
    handoffToolEnabled: false,
  } as never);
}

async function executarComOwner(owner: string): Promise<Record<string, unknown> | undefined> {
  vi.mocked(horariosLivresDaOrg).mockResolvedValue({
    ok: true,
    slots: [],
    fusoDaRegra: "America/Sao_Paulo",
    publicouHorarios: true,
    fusoSuposto: false,
    fontesDefasadas: [],
    agendaExternaNuncaLida: false,
  } as never);

  const tools = montarTurno();
  const alvo = tools["crm_find_free_slots"] as unknown as {
    execute: (a: unknown) => Promise<unknown>;
  };
  expect(alvo, "pickToolsFromMcp não montou crm_find_free_slots").toBeTruthy();

  await alvo.execute({ event_type_slug: "hof-e-botox", dias_a_frente: 7, owner_user_id: owner });

  // O 3º argumento da coleta é o objeto de parâmetros — é lá que o dono chega.
  return vi.mocked(horariosLivresDaOrg).mock.calls[0]?.[2] as Record<string, unknown> | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("o seam do agente higieniza o uuid inventado pelo modelo", () => {
  it("o uuid de aterro NÃO chega à consulta — o dono do tipo volta a valer", async () => {
    const params = await executarComOwner(NIL);

    expect(params, "a coleta não chegou a ser chamada").toBeTruthy();
    // `null` é o que o handler passa quando a chave não veio, e é o que faz
    // `?? tipo.default_owner_user_id` escolher o dono real do atendimento.
    expect(params?.ownerUserId).toBeNull();
    expect(params?.ownerUserId).not.toBe(NIL);
  });

  it("um dono LEGÍTIMO atravessa intacto — a higiene não come dado bom", async () => {
    // O controle. Sem ele, uma higiene que apagasse `owner_user_id` sempre
    // satisfaria o caso acima e quebraria o agendamento com dono escolhido.
    const params = await executarComOwner(BOM);

    expect(params?.ownerUserId).toBe(BOM);
  });
});
