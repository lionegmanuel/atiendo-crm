import { describe, expect, it } from "vitest";

import { roteiaProximasAcoes, type EstadoDoContato } from "@/lib/leads/next-action";
import type { LeadCandidate } from "@/lib/leads/active-lead";

const ORG = "00000000-0000-4000-8000-000000000001";
const CONTATO = "00000000-0000-4000-8000-0000000000c1";
const OUTRO_CONTATO = "00000000-0000-4000-8000-0000000000c2";
const PIPE_A = "00000000-0000-4000-8000-0000000000a1";
const PIPE_B = "00000000-0000-4000-8000-0000000000b1";

type Cand = LeadCandidate & { contact_id: string | null };

function lead(id: string, over: Partial<Cand> = {}): Cand {
  return {
    id,
    organization_id: ORG,
    pipeline_id: PIPE_A,
    status: "open",
    last_activity_at: "2026-07-20T10:00:00Z",
    created_at: "2026-07-01T10:00:00Z",
    contact_id: CONTATO,
    ...over,
  };
}

const proposta: EstadoDoContato = {
  contact_id: CONTATO,
  next_action: "ligar para o Carlos amanhã",
  next_action_seq: 7,
  updated_at: "2026-07-24T19:48:12Z",
};

describe("roteamento da próxima ação (contato → negócio)", () => {
  it("um único negócio aberto recebe a proposta", () => {
    const { porLead: mapa } = roteiaProximasAcoes([proposta], [lead("L1")]);
    expect(mapa.get("L1")?.label).toBe("ligar para o Carlos amanhã");
    expect(mapa.size).toBe(1);
  });

  it("dois negócios ambíguos: não aparece em nenhum, MAS avisa", () => {
    // Uma ação, dois botões seria pior que nenhum botão: aprovar num executaria
    // pelo outro. Mas recusar o palpite não pode virar silêncio — sem o aviso,
    // a IA propõe, ninguém vê, e a demanda apodrece.
    const { porLead: mapa, ambiguas } = roteiaProximasAcoes(
      [proposta],
      [lead("L1"), lead("L2")], // mesmo last_activity_at → empate
    );
    expect(mapa.size).toBe(0);
    expect(ambiguas).toHaveLength(1);
    expect(ambiguas[0]!.contact_id).toBe(CONTATO);
    expect(ambiguas[0]!.candidateIds.sort()).toEqual(["L1", "L2"]);
  });

  it("sem negócio aberto NÃO entra na lista de ambíguas", () => {
    // Não há o que desambiguar: um item pedindo escolha entre zero negócios
    // seria ruído. Este caso tem pendência própria (reportada ao orquestrador).
    const { porLead: mapa, ambiguas } = roteiaProximasAcoes(
      [proposta],
      [lead("L1", { status: "won" })],
    );
    expect(mapa.size).toBe(0);
    expect(ambiguas).toHaveLength(0);
  });

  it("dois abertos com atividades diferentes: vai para o mais recente", () => {
    const { porLead: mapa } = roteiaProximasAcoes(
      [proposta],
      [lead("L1"), lead("L2", { last_activity_at: "2026-07-24T10:00:00Z" })],
    );
    expect(mapa.get("L2")?.label).toBe("ligar para o Carlos amanhã");
    expect(mapa.has("L1")).toBe(false);
  });

  it("a lista precisa vir da ORG, não do pipeline aberto na tela", () => {
    // A armadilha silenciosa: com os candidatos recortados por pipeline, cada
    // board veria UM negócio do contato e mostraria a proposta como se fosse
    // dele — dois cards, em telas diferentes, com o mesmo botão.
    const doPipelineA = [lead("L1")];
    expect(roteiaProximasAcoes([proposta], doPipelineA).porLead.size).toBe(1); // visão recortada: roteia

    const daOrgInteira = [lead("L1"), lead("L2", { pipeline_id: PIPE_B })];
    expect(roteiaProximasAcoes([proposta], daOrgInteira).porLead.size).toBe(0); // visão real: ambíguo
  });

  it("negócio fechado não recebe proposta", () => {
    const { porLead: mapa } = roteiaProximasAcoes([proposta], [lead("L1", { status: "won" })]);
    expect(mapa.size).toBe(0);
  });

  it("proposta vazia ou só espaços não vira slot", () => {
    for (const texto of ["", "   ", null]) {
      const { porLead: mapa } = roteiaProximasAcoes(
        [{ ...proposta, next_action: texto }],
        [lead("L1")],
      );
      expect(mapa.size).toBe(0);
    }
  });

  it("estado de um contato não vaza para o negócio de outro", () => {
    const { porLead: mapa } = roteiaProximasAcoes(
      [proposta],
      [lead("L1", { contact_id: OUTRO_CONTATO })],
    );
    expect(mapa.size).toBe(0);
  });

  it("lead sem contato é ignorado sem quebrar o resto", () => {
    const { porLead: mapa } = roteiaProximasAcoes(
      [proposta],
      [lead("L0", { contact_id: null }), lead("L1")],
    );
    expect(mapa.get("L1")?.label).toBe("ligar para o Carlos amanhã");
  });

  it("a IDENTIDADE da proposta viaja junto, não o texto — a trava compara ela", () => {
    const { porLead: mapa } = roteiaProximasAcoes([proposta], [lead("L1")]);
    expect(mapa.get("L1")?.seq).toBe(7);
    expect(mapa.get("L1")?.proposed_at).toBe("2026-07-24T19:48:12Z");
  });
});
