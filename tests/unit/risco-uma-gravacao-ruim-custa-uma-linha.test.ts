import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/v1/cron/risk-watcher/route";
import type { EstadoCalculado } from "@/lib/leads/risk-seed";
import { observaTravessias } from "@/lib/leads/risk-worker";

/**
 * UMA GRAVAÇÃO RUIM CUSTA UMA LINHA — e a falha chega a quem lê o cron.
 *
 * O observador de risco lançava na primeira gravação recusada, e o `catch` da
 * rota engolia a organização inteira: as demais travessias nem eram avaliadas,
 * e o vencimento de reativações daquela org também não rodava. O conserto
 * (recorte do #803) troca o `throw` por `continue` + contagem.
 *
 * Os testes de `sinceDoBucket` guardam a CAUSA (o `since` no futuro). Este
 * guarda a AMPLIFICAÇÃO, que é o que continua valendo para qualquer recusa
 * futura que não seja essa — e guarda as duas pontas juntas:
 *
 *   1. a linha seguinte à recusada é gravada (o laço não para);
 *   2. a recusa é CONTADA e aparece na resposta do cron. Trocar "para e grita"
 *      por "não faz e cala" seria pior que o defeito: antes a org aparecia em
 *      `organizations_com_erro`; depois do `continue` ela sai de lá, e só o
 *      campo `gravacoes_falhas` ocupa o lugar dela.
 *
 * A linha recusada vem PRIMEIRO de propósito: com o `throw` de volta, a
 * segunda nunca seria gravada — é a ordem que faz o teste distinguir.
 */

const ORG = "00000000-0000-4000-8000-000000000001";
const AGORA = new Date("2026-09-12T22:00:00Z");
const RECUSA = 'new row for relation "crm_lead_risk_states" violates check constraint "crm_lead_risk_states_since_no_passado"';

vi.mock("@/lib/env", () => ({
  env: { INTERNAL_CRON_SECRET: "segredo", INTERNAL_SECRET: "" },
}));

// `vi.hoisted`: a fábrica do mock roda quando a rota é importada, antes das
// declarações comuns deste arquivo.
const logado = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: logado }));

let estados: EstadoCalculado[] = [];
vi.mock("@/lib/leads/risk-seed", () => ({
  calculaBucketsAtuais: async () => estados,
}));

// `em_voo` vindo de "sem estado gravado" é travessia SILENCIOSA (ver `narra`):
// nenhuma linha de timeline, nenhuma proposta. Os dublês abaixo existem só para
// o módulo carregar; se o caminho os alcançar, o teste mediu outra coisa.
vi.mock("@/lib/leads/reactivation", () => ({
  propoeReativacao: async () => {
    throw new Error("travessia silenciosa não propõe reativação");
  },
  venceReativacoes: async () => ({ vencidas: 0, itensDeCaixa: 0, falhasDeAtividade: 0 }),
}));

let recusarLead: string | null = null;
let gravados: string[] = [];

/**
 * Dublê mínimo do client: só a fatia que a rota e o observador usam. Tabela não
 * modelada estoura, para o teste não passar por engano num caminho que ele não
 * representa.
 */
function adminDuble() {
  return {
    from(tabela: string) {
      if (tabela === "crm_leads") {
        return {
          select: () => ({ eq: async () => ({ data: [{ organization_id: ORG }], error: null }) }),
        };
      }
      if (tabela === "crm_lead_risk_states") {
        return {
          select: () => ({ eq: async () => ({ data: [], error: null }) }),
          upsert: async (linha: { lead_id: string }) => {
            if (linha.lead_id === recusarLead) return { error: { message: RECUSA } };
            gravados.push(linha.lead_id);
            return { error: null };
          },
        };
      }
      throw new Error(`tabela não modelada no dublê: ${tabela}`);
    },
  };
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminDuble() }));

function estado(leadId: string): EstadoCalculado {
  return { leadId, contactId: null, bucket: "em_voo", since: AGORA, coldHours: 72 };
}

function requisicaoAutorizada(): Parameters<typeof GET>[0] {
  // O handler só lê `headers.get("authorization")`.
  return { headers: new Headers({ authorization: "Bearer segredo" }) } as never;
}

beforeEach(() => {
  estados = [estado("lead-recusado"), estado("lead-seguinte")];
  recusarLead = "lead-recusado";
  gravados = [];
  for (const f of Object.values(logado)) f.mockClear();
});

describe("observador de risco: uma gravação recusada", () => {
  it("⛔ não impede a gravação da travessia seguinte", async () => {
    const r = await observaTravessias(adminDuble() as never, ORG, AGORA);
    expect(gravados).toEqual(["lead-seguinte"]);
    expect(r.travessias).toBe(2);
    expect(r.silenciosas).toBe(1);
  });

  it("⛔ é CONTADA e registrada com o lead e o motivo", async () => {
    const r = await observaTravessias(adminDuble() as never, ORG, AGORA);
    expect(r.falhasDeGravacao).toBe(1);
    expect(logado.error).toHaveBeenCalledWith(
      "risco.gravacao_falhou",
      expect.objectContaining({ organizationId: ORG, leadId: "lead-recusado", motivo: RECUSA }),
    );
  });
});

describe("cron risk-watcher: a contagem chega a quem lê a rodada", () => {
  it("⛔ a recusa aparece em `gravacoes_falhas`, não some junto com a org", async () => {
    const resposta = await GET(requisicaoAutorizada());
    expect(resposta.status).toBe(200);
    const { data } = (await resposta.json()) as { data: Record<string, number> };
    expect(data.organizations_com_erro).toBe(0);
    expect(data.gravacoes_falhas).toBe(1);
    expect(data.travessias).toBe(2);
    expect(logado.warn).toHaveBeenCalledWith(
      "[risk-watcher] travessias sem estado gravado",
      expect.objectContaining({ gravacoesFalhas: 1 }),
    );
  });

  it("CONTROLE: rodada sem recusa responde zero e não avisa", async () => {
    recusarLead = null;
    const resposta = await GET(requisicaoAutorizada());
    const { data } = (await resposta.json()) as { data: Record<string, number> };
    expect(data.gravacoes_falhas).toBe(0);
    expect(gravados).toEqual(["lead-recusado", "lead-seguinte"]);
    expect(logado.warn).not.toHaveBeenCalledWith(
      "[risk-watcher] travessias sem estado gravado",
      expect.anything(),
    );
  });
});
