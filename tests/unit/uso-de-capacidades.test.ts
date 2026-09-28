/**
 * O painel de uso só vale se o SINAL estiver certo. Contagem errada o humano
 * percebe; sinal errado ele obedece — desliga a capacidade que funciona, ou
 * deixa ligada a que falha em toda tentativa.
 *
 * O que mais erra aqui não é cada caso isolado, é a PRECEDÊNCIA entre eles:
 * uma capacidade pode estar, ao mesmo tempo, desligada, falhando e usada só em
 * teste. Testar os três estados separados não prova qual vence — por isso os
 * casos abaixo ligam as condições de propósito.
 */
import { describe, expect, it } from "vitest";

import {
  montarUsoDeCapacidades,
  resumirUso,
  type CapacidadeConhecida,
  type LinhaDeUso,
} from "@/lib/ai/agents/uso-de-capacidades";

const CATALOGO: ReadonlyArray<CapacidadeConhecida> = [
  { name: "crm_ler", rotulo: "Ler a conversa", o_que_toca: "Atendimento", risco: "seguro" },
  { name: "crm_mover", rotulo: "Mover de etapa", o_que_toca: "Funil", risco: "atencao" },
  { name: "crm_enviar", rotulo: "Enviar mensagem", o_que_toca: "Atendimento", risco: "critico" },
  { name: "crm_pedir_ajuda", rotulo: "Pedir ajuda humana", o_que_toca: "Atendimento", risco: "atencao" },
];

function uso(p: Partial<LinhaDeUso> & { tool_name: string }): LinhaDeUso {
  return {
    total: 0,
    falhas: 0,
    em_teste: 0,
    ultima_vez: "2026-08-01T10:00:00.000Z",
    ...p,
  };
}

const AGORA = Date.parse("2026-08-05T12:00:00.000Z");
/** Configuração velha o bastante para "nunca usada" ser diagnóstico, não relógio. */
const CONFIG_ANTIGA = "2026-05-01T12:00:00.000Z";

function montar(ligadas: string[], linhas: LinhaDeUso[], janelaEmDias = 30) {
  return montarUsoDeCapacidades({
    ligadas,
    catalogo: CATALOGO,
    linhas,
    janelaEmDias,
    configuradaEm: CONFIG_ANTIGA,
    agora: AGORA,
  });
}

describe("o sinal de cada capacidade", () => {
  it("ligada e sem nenhum uso é 'nunca usada', e a recomendação diz a janela", () => {
    const [linha] = montar(["crm_ler"], [], 45);
    expect(linha!.sinal).toBe("nunca_usada");
    expect(linha!.recomendacao).toContain("45 dias");
    expect(linha!.ligada).toBe(true);
  });

  it("usada sem estar ligada aparece — some da tela seria esconder uso real", () => {
    const [linha] = montar([], [uso({ tool_name: "crm_pedir_ajuda", total: 3 })]);
    expect(linha!.sinal).toBe("fora_da_configuracao");
    expect(linha!.ligada).toBe(false);
    expect(linha!.total).toBe(3);
  });

  it("todas as tentativas falhando é 'só falha'", () => {
    const [linha] = montar(["crm_mover"], [uso({ tool_name: "crm_mover", total: 4, falhas: 4 })]);
    expect(linha!.sinal).toBe("so_falha");
    expect(linha!.recomendacao).toContain("4");
  });

  it("parte falhando é 'falhando', com o número das duas pontas", () => {
    const [linha] = montar(["crm_mover"], [uso({ tool_name: "crm_mover", total: 10, falhas: 3 })]);
    expect(linha!.sinal).toBe("falhando");
    expect(linha!.recomendacao).toContain("3 de 10");
  });

  it("usada só nas execuções de teste não conta como funcionando em produção", () => {
    const [linha] = montar(
      ["crm_ler"],
      [uso({ tool_name: "crm_ler", total: 4, em_teste: 4 })],
    );
    expect(linha!.sinal).toBe("so_em_teste");
  });

  it("usada de verdade e sem falha é 'saudável'", () => {
    const [linha] = montar(
      ["crm_ler"],
      [uso({ tool_name: "crm_ler", total: 9, em_teste: 2 })],
    );
    expect(linha!.sinal).toBe("saudavel");
    expect(linha!.recomendacao).toContain("2 em teste");
  });
});

describe("precedência — quando mais de uma condição vale ao mesmo tempo", () => {
  it("falha vence 'só em teste': o dono precisa saber que quebrou, não onde", () => {
    const [linha] = montar(
      ["crm_mover"],
      [uso({ tool_name: "crm_mover", total: 3, falhas: 3, em_teste: 3 })],
    );
    expect(linha!.sinal).toBe("so_falha");
  });

  it("falha vence 'usada sem estar ligada'", () => {
    const [linha] = montar(
      [],
      [uso({ tool_name: "crm_pedir_ajuda", total: 5, falhas: 2 })],
    );
    expect(linha!.sinal).toBe("falhando");
    // A informação de que está desligada não se perde — vira campo próprio.
    expect(linha!.ligada).toBe(false);
  });

  it("'usada sem estar ligada' vence 'só em teste'", () => {
    const [linha] = montar(
      [],
      [uso({ tool_name: "crm_pedir_ajuda", total: 2, em_teste: 2 })],
    );
    expect(linha!.sinal).toBe("fora_da_configuracao");
  });
});

describe("o que entra na lista e em que ordem", () => {
  it("lista as ligadas e as usadas, e nada além disso", () => {
    const linhas = montar(["crm_ler"], [uso({ tool_name: "crm_pedir_ajuda", total: 1 })]);
    expect(linhas.map((l) => l.name).sort()).toEqual(["crm_ler", "crm_pedir_ajuda"]);
    // crm_enviar e crm_mover existem no catálogo, não estão ligadas nem foram
    // usadas: listá-las afogaria as linhas que pedem decisão.
  });

  it("o que pede ação vem antes do que está bem", () => {
    const linhas = montar(
      ["crm_ler", "crm_mover", "crm_enviar", "crm_pedir_ajuda"],
      [
        uso({ tool_name: "crm_ler", total: 20 }),
        uso({ tool_name: "crm_mover", total: 5, falhas: 5 }),
        uso({ tool_name: "crm_pedir_ajuda", total: 8, falhas: 1 }),
      ],
    );
    expect(linhas.map((l) => l.sinal)).toEqual([
      "so_falha",
      "falhando",
      "nunca_usada",
      "saudavel",
    ]);
  });

  it("capacidade que saiu do catálogo mantém a linha, com o id no lugar do rótulo", () => {
    const [linha] = montar(["crm_capacidade_extinta"], []);
    expect(linha!.rotulo).toBe("crm_capacidade_extinta");
    expect(linha!.o_que_toca).toContain("removida");
  });
});

describe("o resumo do topo", () => {
  it("soma usos e falhas e conta quantas pedem decisão", () => {
    const linhas = montar(
      ["crm_ler", "crm_mover", "crm_enviar"],
      [
        uso({ tool_name: "crm_ler", total: 10 }),
        uso({ tool_name: "crm_mover", total: 4, falhas: 4 }),
      ],
    );
    // crm_enviar ligada e nunca usada; crm_mover só falha → 2 pedem decisão.
    expect(resumirUso(linhas)).toEqual({
      usos: 14,
      falhas: 4,
      precisam_de_atencao: 2,
    });
  });

  it("tudo saudável não inventa pendência", () => {
    const linhas = montar(["crm_ler"], [uso({ tool_name: "crm_ler", total: 3 })]);
    expect(resumirUso(linhas).precisam_de_atencao).toBe(0);
  });
});

describe("configuração recém-feita não pede decisão nenhuma", () => {
  it("ligada há 2 minutos NÃO manda desligar", () => {
    // O defeito que a prova com IA real expôs: o painel dizia "nunca usada nos
    // últimos 30 dias, considere desligar" para sete capacidades ligadas dois
    // minutos antes. A frase estava certa sobre o dado e errada sobre o mundo.
    const [linha] = montarUsoDeCapacidades({
      ligadas: ["crm_ler"],
      catalogo: CATALOGO,
      linhas: [],
      janelaEmDias: 30,
      configuradaEm: new Date(AGORA - 2 * 60_000).toISOString(),
      agora: AGORA,
    });
    expect(linha!.sinal).toBe("recem_ligada");
    expect(linha!.recomendacao).not.toMatch(/considere desligar/);
    expect(resumirUso([linha!]).precisam_de_atencao).toBe(0);
  });

  it("passada a janela, a mesma capacidade vira cobrança", () => {
    const [linha] = montarUsoDeCapacidades({
      ligadas: ["crm_ler"],
      catalogo: CATALOGO,
      linhas: [],
      janelaEmDias: 30,
      configuradaEm: new Date(AGORA - 31 * 86_400_000).toISOString(),
      agora: AGORA,
    });
    expect(linha!.sinal).toBe("nunca_usada");
    expect(linha!.recomendacao).toMatch(/considere desligar/);
    expect(resumirUso([linha!]).precisam_de_atencao).toBe(1);
  });

  it("sem saber quando foi configurada, mantém a cobrança (não inventa desculpa)", () => {
    const [linha] = montarUsoDeCapacidades({
      ligadas: ["crm_ler"],
      catalogo: CATALOGO,
      linhas: [],
      janelaEmDias: 30,
      configuradaEm: null,
      agora: AGORA,
    });
    expect(linha!.sinal).toBe("nunca_usada");
  });

  it("recém-ligada não atropela falha: quem quebrou continua em primeiro", () => {
    const linhas = montarUsoDeCapacidades({
      ligadas: ["crm_ler", "crm_mover"],
      catalogo: CATALOGO,
      linhas: [uso({ tool_name: "crm_mover", total: 2, falhas: 2 })],
      janelaEmDias: 30,
      configuradaEm: new Date(AGORA - 60_000).toISOString(),
      agora: AGORA,
    });
    expect(linhas.map((l) => l.sinal)).toEqual(["so_falha", "recem_ligada"]);
  });
});
