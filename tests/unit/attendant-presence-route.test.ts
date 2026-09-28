/**
 * O SINAL DE PRESENÇA ESCREVE UMA COLUNA — E SÓ UMA.
 *
 * ─── Por que este arquivo é o coração da issue #996 ───────────────────────
 *
 * O defeito original era de MODELAGEM: a mesma coluna (`is_available`) carregava
 * duas coisas ao mesmo tempo — "eu me declarei de plantão" (decisão, que dura) e
 * "meu navegador está vivo" (presença, que expira). A varredura de presença
 * escrevia por cima da decisão, e a chave de plantão se desligava sozinha ~15
 * min depois de ligada, em toda instalação.
 *
 * Agora a presença mora em `last_heartbeat_at` e a decisão em `is_available`. A
 * separação só vale alguma coisa se for ESTRUTURAL — um comentário pedindo
 * cuidado não impede ninguém de acrescentar um campo ao payload. Então o caso
 * "o sinal escreve um campo, e só ele" prende o CONJUNTO EXATO de chaves
 * enviadas ao banco, e os dois casos seguintes prendem as duas portas por onde a
 * presença poderia voltar a mexer na decisão:
 *
 *   1. um `is_available` acrescentado ao payload (o defeito do #720 de volta);
 *   2. um `user_id` vindo do CORPO, que deixaria a presença de uma pessoa ser
 *      escrita — e a decisão dela mexida — por outra.
 *
 * Sabotagem medida (reverta a linha, o teste cai): acrescentar
 * `is_available: false` ao payload derruba o primeiro caso; trocar
 * `authUser.id` pelo `user_id` do corpo derruba o segundo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { ROLE_RANK, type AuthUser, type Role } from "@/lib/auth/types";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { audit } from "@/lib/audit";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

const ORG = "22222222-2222-4222-8222-222222222222";
const ANA = "11111111-1111-4111-8111-111111111111";
const BRUNO = "99999999-9999-4999-8999-999999999999";

/** O que o cliente mandou para o banco, capturado na fronteira. */
interface Escrita {
  tabela: string;
  payload: Record<string, unknown>;
  onConflict: string | undefined;
}

/**
 * Dublê do supabase user-scoped: registra o payload do upsert e devolve a linha
 * como o PostgREST devolveria.
 */
function fazerSupabase(linhaJaExiste = false) {
  const escritas: Escrita[] = [];
  const client = {
    from: (tabela: string) => ({
      // A rota lê antes de gravar para saber se esta é a PRIMEIRA batida — a que
      // insere a linha e acorda o roteamento. O dublê devolve o que o banco
      // devolveria nos dois estados: linha ausente (primeira) ou presente.
      select: () => {
        const q = {
          eq: () => q,
          maybeSingle: async () => ({
            data: linhaJaExiste ? { user_id: ANA } : null,
            error: null,
          }),
        };
        return q;
      },
      upsert: (payload: Record<string, unknown>, opts?: { onConflict?: string }) => {
        escritas.push({ tabela, payload, onConflict: opts?.onConflict });
        return {
          select: () => ({
            single: async () => ({
              data: {
                user_id: payload.user_id ?? null,
                last_heartbeat_at: payload.last_heartbeat_at ?? null,
              },
              error: null,
            }),
          }),
        };
      },
    }),
  };
  return { escritas, client };
}

async function comSupabase(linhaJaExiste = false) {
  const { createClient } = await import("@/lib/supabase/server");
  const dublê = fazerSupabase(linhaJaExiste);
  vi.mocked(createClient).mockResolvedValue(
    dublê.client as unknown as Awaited<ReturnType<typeof createClient>>,
  );
  return dublê;
}

function sessao(papel: Role, id: string = ANA) {
  const user: AuthUser = {
    id,
    email: "ana@example.com",
    full_name: "Ana",
    avatar_url: null,
    is_platform_admin: false,
    idioma: "pt-BR" as const,
    organizations: [{ organization_id: ORG, organization_name: "Org", role: papel }],
  };
  vi.mocked(requireRole).mockImplementation(async (min: Role) =>
    ROLE_RANK[papel] >= ROLE_RANK[min]
      ? { ok: true, user, org: { orgId: ORG, name: "Org", role: papel } }
      : { ok: false, response: fail("forbidden_role", `Requer role >= ${min}.`, 403, {}) },
  );
}

function req(corpo: Record<string, unknown> = {}): NextRequest {
  return new NextRequest("http://localhost/api/v1/attendants/presence", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });
}

async function chamar(corpo: Record<string, unknown> = {}) {
  const { POST } = await import("@/app/api/v1/attendants/presence/route");
  return POST(req(corpo));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSupportWrite).mockResolvedValue(null);
});

describe("POST /api/v1/attendants/presence — o emissor do sinal", () => {
  it("o sinal escreve `last_heartbeat_at` e MAIS NADA: a decisão de plantão não vai no payload", async () => {
    sessao("agent");
    const { escritas } = await comSupabase();

    const res = await chamar();
    expect(res.status).toBe(200);

    expect(escritas).toHaveLength(1);
    const [escrita] = escritas;
    expect(escrita!.tabela).toBe("attendant_availability");
    expect(escrita!.onConflict).toBe("organization_id,user_id");

    // ── O CONJUNTO EXATO. Não é "não contém is_available": é a lista fechada,
    //    para que uma coluna nova de decisão (ou `updated_at`, que é "quando a
    //    disponibilidade MUDOU" e a presença não muda disponibilidade nenhuma)
    //    não entre aqui por descuido.
    expect(Object.keys(escrita!.payload).sort()).toEqual([
      "last_heartbeat_at",
      "organization_id",
      "user_id",
    ]);
    for (const proibida of ["is_available", "capacity", "schedule", "updated_at"]) {
      expect(escrita!.payload).not.toHaveProperty(proibida);
    }
    // E o carimbo é de AGORA: presença vencida não reanima ninguém.
    const carimbo = new Date(String(escrita!.payload.last_heartbeat_at));
    expect(Number.isNaN(carimbo.getTime())).toBe(false);
    expect(Date.now() - carimbo.getTime()).toBeLessThan(5_000);
  });

  it("quem carimba é a SESSÃO: `user_id` no corpo do pedido não é usado", async () => {
    // A escalada que esta rota não tem: um corpo com o id de outra pessoa (e um
    // `is_available` de brinde) não pode virar escrita na linha dela.
    sessao("agent", ANA);
    const { escritas } = await comSupabase();

    const res = await chamar({ user_id: BRUNO, is_available: false, capacity: 99 });
    expect(res.status).toBe(200);

    expect(escritas[0]!.payload.user_id).toBe(ANA);
    expect(escritas[0]!.payload.organization_id).toBe(ORG);
    expect(Object.keys(escritas[0]!.payload)).not.toContain("capacity");
  });

  it("a resposta conta o sinal e o prazo dele — e nada sobre disponibilidade", async () => {
    sessao("agent");
    await comSupabase();

    const body = (await (await chamar()).json()) as { data: Record<string, unknown> };
    expect(Object.keys(body.data).sort()).toEqual([
      "last_heartbeat_at",
      "presence_expires_at",
      "present",
      "user_id",
    ]);
    // Quem recebe a resposta é a tela: ela não tem como concluir daqui que a
    // chave de plantão mudou, porque esta rota não a lê nem a devolve.
    expect(body.data).not.toHaveProperty("is_available");
    expect(body.data.present).toBe(true);
    const expira = new Date(String(body.data.presence_expires_at)).getTime();
    expect(expira - Date.now()).toBeGreaterThan(0);
  });

  // ─── Auditoria: a régua é "auditar quando houve efeito" ───────────────────
  //
  // Não é exceção nova. O CLAUDE.md já escreve, na seção Audit log, que a
  // rodada de cron que não fez nada não audita e a que fez, audita. Aqui o
  // efeito que outra pessoa sente é o INSERT da primeira batida, porque é ele
  // que dispara `trg_routing_availability_changed` e acorda o roteamento.
  //
  // Os dois casos abaixo são as duas direções: sem os dois, "não auditar" e
  // "auditar sempre" ficariam indistinguíveis.
  it("a PRIMEIRA batida audita uma linha — é ela que insere e acorda o roteamento", async () => {
    sessao("agent");
    await comSupabase(false);

    const res = await chamar();
    expect(res.status).toBe(200);

    expect(vi.mocked(audit)).toHaveBeenCalledTimes(1);
    // `mock.calls[0]` é opcional para o TypeScript (noUncheckedIndexedAccess), e
    // desestruturar direto não compila. O `?? []` mantém o teste legível sem
    // asserção de não-nulo.
    const [entrada] = vi.mocked(audit).mock.calls[0] ?? [];
    expect(entrada, "audit foi chamado, mas sem entrada").toBeDefined();
    if (!entrada) return;
    expect(entrada.action).toBe("attendant.presence_started");
    expect(entrada.organizationId).toBe(ORG);
    expect(entrada.actorUserId).toBe(ANA);
    expect(entrada.resourceType).toBe("attendant_availability");
  });

  it("a batida seguinte NÃO audita: renovar o carimbo não é efeito que alguém sinta", async () => {
    sessao("agent");
    await comSupabase(true);

    const res = await chamar();
    expect(res.status).toBe(200);

    expect(vi.mocked(audit)).not.toHaveBeenCalled();
  });

  it("viewer não emite sinal (a rota exige agent+)", async () => {
    sessao("viewer");
    const { escritas } = await comSupabase();

    const res = await chamar();
    expect(res.status).toBe(403);
    expect(escritas).toHaveLength(0);
  });

  it("sessão de suporte (impersonação) não emite presença em nome de ninguém", async () => {
    sessao("agent");
    vi.mocked(requireSupportWrite).mockResolvedValueOnce(
      fail("forbidden", "Este acompanhamento permite somente leitura.", 403),
    );
    const { escritas } = await comSupabase();

    const res = await chamar();
    expect(res.status).toBe(403);
    expect(escritas).toHaveLength(0);
  });
});
