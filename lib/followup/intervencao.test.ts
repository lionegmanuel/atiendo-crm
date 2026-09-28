import { describe, expect, it } from "vitest";

import {
  escolheSaida,
  podeAdiarOuPular,
  podePausar,
  podeRetomar,
  restanteDaEspera,
  retomadaApos,
  validaAdiamento,
} from "./intervencao";
import type { FlowEdge, FlowNode } from "./graph-schema";

const AGORA = new Date("2026-08-10T12:00:00.000Z");

describe("quem aceita cada intervenção", () => {
  it("pausar é para quem está andando; retomar, só para quem uma PESSOA pausou", () => {
    expect(podePausar("active")).toBe(true);
    expect(podePausar("waiting_reply")).toBe(true);
    expect(podePausar("completed")).toBe(false);
    // `paused_handoff` é outro estado: quem o retoma é o fecho do atendimento
    // humano, e pausar por cima dele confundiria as duas máquinas.
    expect(podePausar("paused_handoff")).toBe(false);

    expect(podeRetomar("paused_manual")).toBe(true);
    expect(podeRetomar("paused_handoff")).toBe(false);
    expect(podeRetomar("active")).toBe(false);

    expect(podeAdiarOuPular("active")).toBe(true);
    expect(podeAdiarOuPular("paused_manual")).toBe(false);
  });
});

describe("restanteDaEspera — o relógio congela, não zera", () => {
  it("guarda o que FALTAVA, para a retomada honrar o fluxo", () => {
    expect(restanteDaEspera("2026-08-10T16:00:00.000Z", AGORA)).toBe(14_400_000);
  });

  it("já vencido é zero: retomar acorda na hora, como teria acontecido sem a pausa", () => {
    expect(restanteDaEspera("2026-08-10T11:00:00.000Z", AGORA)).toBe(0);
    expect(restanteDaEspera(null, AGORA)).toBe(0);
    expect(restanteDaEspera("data ilegível", AGORA)).toBe(0);
  });
});

describe("retomadaApos", () => {
  it("devolve o estado anterior e o tempo que faltava", () => {
    const r = retomadaApos({ prior_status: "waiting_reply", restante_ms: 3_600_000 }, AGORA);
    expect(r.status).toBe("waiting_reply");
    expect(r.next_eval_at).toBe("2026-08-10T13:00:00.000Z");
  });

  it("pausar por uma semana um fluxo que ia falar em 4h devolve 4h — não uma rajada", () => {
    const umaSemanaDepois = new Date("2026-08-17T12:00:00.000Z");
    const r = retomadaApos({ prior_status: "active", restante_ms: 14_400_000 }, umaSemanaDepois);
    expect(r.next_eval_at).toBe("2026-08-17T16:00:00.000Z");
  });

  it("evento da pausa perdido NÃO trava a retomada — volta ativo agora", () => {
    // Travar aqui deixaria o follow-up preso para sempre por causa de uma linha
    // de log que faltou (o insert do evento é fire-and-forget).
    const r = retomadaApos(null, AGORA);
    expect(r.status).toBe("active");
    expect(r.next_eval_at).toBe(AGORA.toISOString());
  });

  it("payload adulterado não vira estado inválido", () => {
    const r = retomadaApos({ prior_status: "completed", restante_ms: -5 }, AGORA);
    // 'completed' não é estado com relógio: cair em `active` é o seguro, e o
    // motor reavalia o nó em vez de acreditar num status vindo de um jsonb.
    expect(r.status).toBe("active");
    expect(r.next_eval_at).toBe(AGORA.toISOString());
  });
});

describe("escolheSaida — pular sem decidir pelo operador", () => {
  const edge = (id: string, target: string, priority = 0, condition: FlowEdge["condition"] = { type: "always" }): FlowEdge => ({
    id,
    source: "no-atual",
    target,
    priority,
    condition,
  });

  it("saída única: segue direto, perguntar seria burocracia", () => {
    const r = escolheSaida([edge("e1", "b")], "no-atual");
    expect(r.ok && r.edge.id).toBe("e1");
  });

  it("mais de uma saída: NÃO escolhe — devolve as opções para a tela perguntar", () => {
    const r = escolheSaida(
      [edge("e1", "quente", 1, { type: "class_match", value: "quente" }), edge("e2", "frio", 0, { type: "class_match", value: "frio" })],
      "no-atual",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.codigo).toBe("escolha_necessaria");
      expect(r.opcoes.map((o) => o.edge_id)).toEqual(["e1", "e2"]);
      // A frase vem do vocabulário compartilhado (`lib/followup/vocabulario.ts`):
      // ela nomeia a IA como quem julgou, porque quem lê precisa saber que a
      // decisão foi de um modelo e não de uma regra fixa.
      expect(r.opcoes[0]?.quando).toBe("quando a IA classifica a resposta como “quente”");
    }
  });

  it("as opções nomeiam a etapa da regra pelo nome, não pelo id que o motor compara", () => {
    const ID_DA_ETAPA = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
    const origem: FlowNode = {
      id: "no-atual",
      type: "condition",
      label: "Pagou?",
      position: { x: 0, y: 0 },
      config: {
        branching: "per_check",
        combinator: "and",
        checks: [{ id: "regra-1", field: "lead_stage", op: "eq", value: ID_DA_ETAPA }],
      },
    };
    const r = escolheSaida(
      [edge("e1", "a", 1, { type: "branch", branch_id: "regra-1" }), edge("e2", "b", 0)],
      "no-atual",
      null,
      origem,
      { etapa: (id) => (id === ID_DA_ETAPA ? "Pago · Vendas" : null) },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.opcoes[0]?.quando).toBe("quando o lead está na etapa “Pago · Vendas”");
  });

  it("com a escolha feita, respeita a escolha", () => {
    const r = escolheSaida([edge("e1", "a"), edge("e2", "b")], "no-atual", "e2");
    expect(r.ok && r.edge.target).toBe("b");
  });

  it("aresta que não sai DESTE passo é recusada, nunca substituída em silêncio", () => {
    // Aceitar mandaria o follow-up para um ponto arbitrário do fluxo.
    const outra: FlowEdge = { id: "x", source: "outro-no", target: "z", priority: 0, condition: { type: "always" } };
    const r = escolheSaida([edge("e1", "a"), outra], "no-atual", "x");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codigo).toBe("caminho_invalido");
  });

  it("passo sem saída não tem para onde pular", () => {
    const r = escolheSaida([], "no-atual");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codigo).toBe("sem_caminho");
  });
});

describe("validaAdiamento", () => {
  it("aceita horário no futuro dentro do teto de 90 dias", () => {
    expect(validaAdiamento("2026-08-12T12:00:00.000Z", AGORA).ok).toBe(true);
  });

  it("recusa passado, texto ilegível e além do teto", () => {
    const passado = validaAdiamento("2026-08-09T12:00:00.000Z", AGORA);
    expect(passado.ok).toBe(false);
    if (!passado.ok) expect(passado.motivo).toBe("data_no_passado");

    const lixo = validaAdiamento("amanhã de manhã", AGORA);
    expect(lixo.ok).toBe(false);
    if (!lixo.ok) expect(lixo.motivo).toBe("data_invalida");

    const longe = validaAdiamento("2027-08-10T12:00:00.000Z", AGORA);
    expect(longe.ok).toBe(false);
    if (!longe.ok) expect(longe.motivo).toBe("data_longe_demais");
  });

  it("tolera a deriva entre o relógio do navegador e o do servidor", () => {
    // Recusar "daqui a 10 segundos" por 2s de diferença seria erro de instrumento.
    const quaseAgora = new Date(AGORA.getTime() - 5_000).toISOString();
    expect(validaAdiamento(quaseAgora, AGORA).ok).toBe(true);
  });
});
