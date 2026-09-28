/**
 * A regra de pacote é o que separa "o dono da clínica configurou o agente em
 * 30 segundos" de "o agente mandou WhatsApp para o cliente porque alguém
 * clicou num card".
 *
 * Dois blocos de propósito:
 *   - com catálogo de fixture, para exercitar a regra em estados que o catálogo
 *     real ainda não tem (pacote só com capacidade crítica, capacidade em dois
 *     pacotes ao mesmo tempo);
 *   - com o catálogo REAL, porque a fixture prova a função e não prova o
 *     produto. É no catálogo real que `crm_send_whatsapp_message` mora dentro
 *     de "Atender e responder".
 */
import { describe, expect, it } from "vitest";

import { TOOL_CATALOG } from "@/lib/mcp/tools/catalog";
import { PACOTES, type ToolBundle } from "@/lib/mcp/tools/pacotes";
import {
  TETO_TOOLS_POR_AGENTE,
  capacidadesAutomaticasDoPacote,
  capacidadesCriticasDoPacote,
  desligarPacote,
  estadoDoPacote,
  excedeuTeto,
  ligarPacote,
  vagasRestantes,
  type CapacidadeSelecionavel,
  textoDaContagem,
} from "@/lib/mcp/tools/selecao-por-pacote";

const TODOS: ReadonlyArray<ToolBundle> = PACOTES.map((p) => p.id);

/** Catálogo de fixture — estados que o catálogo real ainda não produz. */
const FIXTURE: ReadonlyArray<CapacidadeSelecionavel> = [
  { name: "ler_a", risco: "seguro", pacotes: ["atender"] },
  { name: "ler_b", risco: "seguro", pacotes: ["atender", "vender"] },
  { name: "escrever_a", risco: "atencao", pacotes: ["atender"] },
  { name: "enviar", risco: "critico", pacotes: ["atender"] },
  { name: "vender_a", risco: "atencao", pacotes: ["vender"] },
  { name: "so_critica", risco: "critico", pacotes: ["escalar"] },
];

describe("o que um pacote liga", () => {
  it("as automáticas do pacote deixam a crítica de fora", () => {
    expect(capacidadesAutomaticasDoPacote(FIXTURE, "atender")).toEqual([
      "ler_a",
      "ler_b",
      "escrever_a",
    ]);
  });

  it("a crítica é listada à parte, para a tela pedir marcação individual", () => {
    expect(capacidadesCriticasDoPacote(FIXTURE, "atender")).toEqual(["enviar"]);
  });

  it("ligar o pacote NÃO liga a capacidade crítica", () => {
    const depois = ligarPacote([], FIXTURE, "atender");
    expect(depois).toContain("ler_a");
    expect(depois).toContain("escrever_a");
    expect(depois).not.toContain("enviar");
  });

  it("ligar preserva o que já estava marcado, inclusive de outro pacote", () => {
    const depois = ligarPacote(["vender_a", "enviar"], FIXTURE, "atender");
    expect(depois).toContain("vender_a");
    expect(depois).toContain("enviar");
    expect(depois).toContain("ler_a");
  });

  it("a lista sai na ordem do catálogo, não na ordem dos cliques", () => {
    const a = ligarPacote([], FIXTURE, "vender");
    const b = ligarPacote([], FIXTURE, "atender");
    const ordemCatalogo = FIXTURE.map((c) => c.name);
    for (const lista of [a, b]) {
      const indices = lista.map((n) => ordemCatalogo.indexOf(n));
      expect(indices).toEqual([...indices].sort((x, y) => x - y));
    }
  });

  it("não duplica quando o pacote é ligado duas vezes", () => {
    const uma = ligarPacote([], FIXTURE, "atender");
    const duas = ligarPacote(uma, FIXTURE, "atender");
    expect(duas).toEqual(uma);
  });
});

describe("o estado que o pacote mostra na tela", () => {
  it("desligado quando nada dele está marcado", () => {
    expect(estadoDoPacote([], FIXTURE, "atender")).toBe("desligado");
  });

  it("parcial quando falta alguma automática", () => {
    expect(estadoDoPacote(["ler_a"], FIXTURE, "atender")).toBe("parcial");
  });

  it("ligado quando todas as automáticas estão marcadas — a crítica não conta", () => {
    const marcadas = ligarPacote([], FIXTURE, "atender");
    expect(estadoDoPacote(marcadas, FIXTURE, "atender")).toBe("ligado");
  });

  it("pacote só com capacidade crítica nunca aparece ligado", () => {
    // Senão a tela anunciaria como ativa uma jornada que não deu nada ao agente.
    expect(estadoDoPacote(["so_critica"], FIXTURE, "escalar")).toBe("desligado");
  });
});

describe("o que sobra ao desligar um pacote", () => {
  it("desligar leva junto a crítica daquele pacote", () => {
    const marcadas = [...ligarPacote([], FIXTURE, "atender"), "enviar"];
    const depois = desligarPacote(marcadas, FIXTURE, "atender", TODOS);
    expect(depois).not.toContain("enviar");
    expect(depois).not.toContain("ler_a");
  });

  it("preserva o que também pertence a outro pacote que continua ligado", () => {
    // "ler_b" é de atender E de vender. Desligar atender com vender ligado não
    // pode esvaziar vender pela metade.
    const marcadas = ligarPacote(ligarPacote([], FIXTURE, "atender"), FIXTURE, "vender");
    expect(estadoDoPacote(marcadas, FIXTURE, "vender")).toBe("ligado");

    const depois = desligarPacote(marcadas, FIXTURE, "atender", TODOS);
    expect(depois).toContain("ler_b");
    expect(depois).toContain("vender_a");
    expect(depois).not.toContain("ler_a");
    expect(estadoDoPacote(depois, FIXTURE, "vender")).toBe("ligado");
  });

  it("não preserva por causa de pacote vizinho apenas PARCIAL", () => {
    // vender parcial (só ler_b) não é decisão do humano de manter vender.
    const marcadas = [...ligarPacote([], FIXTURE, "atender")];
    const depois = desligarPacote(marcadas, FIXTURE, "atender", TODOS);
    expect(depois).not.toContain("ler_b");
  });
});

describe("o teto de capacidades", () => {
  it("conta as vagas que sobram", () => {
    expect(vagasRestantes(["a", "b"])).toBe(TETO_TOOLS_POR_AGENTE - 2);
  });

  it("acusa quando passa do teto", () => {
    const cheio = Array.from({ length: TETO_TOOLS_POR_AGENTE }, (_, i) => `t${i}`);
    expect(excedeuTeto(cheio)).toBe(false);
    expect(excedeuTeto([...cheio, "estourou"])).toBe(true);
  });
});

describe("o catálogo real — a fixture prova a função, isto prova o produto", () => {
  it("tem capacidade suficiente para o teste não passar vazio", () => {
    expect(TOOL_CATALOG.length).toBeGreaterThan(0);
    expect(TOOL_CATALOG.some((t) => t.risco === "critico")).toBe(true);
  });

  it("nenhum pacote real liga uma capacidade crítica", () => {
    const criticas = new Set(
      TOOL_CATALOG.filter((t) => t.risco === "critico").map((t) => t.name),
    );
    for (const pacote of TODOS) {
      const ligadas = ligarPacote([], TOOL_CATALOG, pacote);
      const vazadas = ligadas.filter((n) => criticas.has(n));
      expect(vazadas, `pacote "${pacote}" ligou capacidade crítica`).toEqual([]);
    }
  });

  it("ligar 'Atender e responder' não dá direito de enviar WhatsApp ao cliente", () => {
    const alvo = "crm_send_whatsapp_message";
    const entrada = TOOL_CATALOG.find((t) => t.name === alvo);
    expect(entrada, `${alvo} sumiu do catálogo — o caso perdeu o objeto`).toBeDefined();
    expect(entrada!.risco).toBe("critico");
    expect(entrada!.pacotes).toContain("atender");

    expect(ligarPacote([], TOOL_CATALOG, "atender")).not.toContain(alvo);
  });

  it("nenhum pacote real estoura o teto sozinho", () => {
    // Se um pacote sozinho não couber, o caminho padrão da tela fica impossível
    // — o humano liga o card e leva um erro que não sabe resolver.
    for (const pacote of TODOS) {
      const ligadas = ligarPacote([], TOOL_CATALOG, pacote);
      expect(
        ligadas.length,
        `pacote "${pacote}" liga ${ligadas.length} capacidades e o teto é ${TETO_TOOLS_POR_AGENTE}`,
      ).toBeLessThanOrEqual(TETO_TOOLS_POR_AGENTE);
    }
  });
});

describe("texto da contagem — o caminho que saiu do alcance do E2E", () => {
  it("pacote sem capacidade nenhuma diz isso, em vez de fingir um switch útil", () => {
    // Este caso ERA coberto por E2E, enquanto o pacote `reter` estava vazio.
    // Deixou de ser alcançável pela tela quando o épico preencheu os seis
    // pacotes — e sem este teste sumiria da cobertura junto com a asserção que
    // foi removida de lá.
    expect(textoDaContagem(0, 0)).toBe("Nenhuma capacidade disponível ainda para esta jornada.");
  });

  it("com capacidades, conta quantas estão ligadas", () => {
    expect(textoDaContagem(6, 0)).toBe("0 de 6 capacidades ligadas");
    expect(textoDaContagem(6, 3)).toBe("3 de 6 capacidades ligadas");
  });

  it("com uma só, substantivo E particípio ficam no singular", () => {
    // ⚠️ Esta asserção JÁ GRAVOU a forma errada — "1 de 1 capacidade ligadas".
    // O nome do caso prometia guardar a concordância e a asserção congelava o
    // defeito: um teste respondendo com confiança sobre o que não mediu.
    // Achado pelo Arquiteto (W1) conferindo o merge.
    expect(textoDaContagem(1, 1)).toBe("1 de 1 capacidade ligada");
    expect(textoDaContagem(1, 0)).toBe("0 de 1 capacidade ligada");
  });
});
