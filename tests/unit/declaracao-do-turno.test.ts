import { describe, expect, it } from "vitest";

import {
  DECLARACAO_INSTRUCTION,
  declaracaoDoTurnoSchema,
  promessasEmAberto,
  renderDeclaracaoParaHumano,
  type DeclaracaoDoTurno,
} from "@/lib/agent-engine/agent/declaracao";
import {
  CHECKPOINT_INSTRUCTION,
  parseCheckpointText,
} from "@/lib/agent-engine/agent/inbound-turn";
import { buildHandoffSummary } from "@/lib/agent-engine/agent/human-handoff";

/**
 * O contrato da fronteira FALAR/OPERAR (spec 16 §5).
 *
 * O que estes testes guardam é COMPORTAMENTO, não texto: a distinção entre "não
 * declarou" e "declarou que não havia nada", o fato de a declaração chegar ao
 * humano no handoff, e a ausência de vocabulário de sistema na instrução que o
 * Conversador lê. Trocar a redação da instrução não deve vermelhar nada aqui —
 * mas apagar a distinção de estado, sim.
 */
describe("declaração do turno — o contrato", () => {
  describe("ausente ≠ vazia (a distinção que justifica o campo)", () => {
    it("checkpoint SEM declaração deixa o campo undefined — não inventa um objeto vazio", () => {
      // Um `.default({})` aqui faria "o modelo esqueceu de declarar" virar
      // "o modelo avaliou e não havia nada" — dois turnos diferentes com o
      // mesmo registro, e o esquecimento sumiria da vista.
      const c = parseCheckpointText(
        '{"commitments":[],"objections":[],"next_action":null,"rolling_summary":"oi"}',
      );
      expect(c.declaracao).toBeUndefined();
    });

    it("nada_a_declarar:true é um valor PRESENTE — a avaliação ficou registrada", () => {
      const c = parseCheckpointText(
        '{"commitments":[],"objections":[],"next_action":null,"rolling_summary":"",' +
          '"declaracao":{"intencoes":[],"promessas":[],"nada_a_declarar":true}}',
      );
      expect(c.declaracao).toBeDefined();
      expect(c.declaracao?.nada_a_declarar).toBe(true);
    });

    it("os dois estados NÃO são iguais — é a asserção que a coluna nullable existe para sustentar", () => {
      const naoDeclarou = parseCheckpointText('{"rolling_summary":"x"}');
      const declarouVazio = parseCheckpointText(
        '{"rolling_summary":"x","declaracao":{"nada_a_declarar":true}}',
      );
      expect(naoDeclarou.declaracao).not.toEqual(declarouVazio.declaracao);
    });
  });

  describe("validação", () => {
    it("campo extra é REJEITADO — o modelo inventar estrutura vira erro de ensino, não strip silencioso", () => {
      const r = declaracaoDoTurnoSchema.safeParse({
        intencoes: [],
        promessas: [],
        nada_a_declarar: true,
        crm_lead_id: "abc",
      });
      expect(r.success).toBe(false);
    });

    it("intenção sem evidência é rejeitada — sem trecho que sustente, é invenção", () => {
      const r = declaracaoDoTurnoSchema.safeParse({
        intencoes: [{ o_que: "quer remarcar", evidencia: "" }],
      });
      expect(r.success).toBe(false);
    });

    it("promessa sem prazo é VÁLIDA — 'te retorno assim que souber' é promessa real", () => {
      const r = declaracaoDoTurnoSchema.safeParse({
        promessas: [{ o_que: "vou verificar e te aviso" }],
      });
      expect(r.success).toBe(true);
      expect(r.success && r.data.promessas[0]!.prazo).toBeNull();
    });

    it("checkpoint com declaração malformada reprova o fechamento inteiro", () => {
      // O turno re-tenta pela fila. Aceitar um checkpoint com declaração quebrada
      // gravaria lixo na fronteira que a próxima camada vai consumir.
      expect(() =>
        parseCheckpointText('{"rolling_summary":"x","declaracao":{"intencoes":"nao é lista"}}'),
      ).toThrow();
    });
  });

  describe("a instrução que o Conversador lê", () => {
    it("a declaração entra na instrução de fechamento — que o runtime IMPÕE", () => {
      // Se saísse daqui para uma tool, dependeria de o modelo lembrar de chamá-la.
      expect(CHECKPOINT_INSTRUCTION).toContain(DECLARACAO_INSTRUCTION);
    });

    it("não carrega vocabulário de sistema — é o defeito que a spec 16 existe para matar", () => {
      // Guarda a PROPRIEDADE (nenhum termo interno no texto que quem fala lê),
      // não a redação. A lista cobre as três portas medidas: nome de tabela,
      // nome de ferramenta e termo de arquitetura.
      const proibidos = [
        "crm_",
        "lead_state",
        "lead_checkpoints",
        "tool",
        "webhook",
        "pipeline",
        "stage",
        "jsonb",
      ];
      const texto = DECLARACAO_INSTRUCTION.toLowerCase();
      const achados = proibidos.filter((t) => texto.includes(t));
      expect(achados, `vocabulário interno na instrução do Conversador: ${achados.join(", ")}`).toEqual([]);
    });
  });

  describe("o segundo leitor — o humano que assume a conversa", () => {
    const declaracao: DeclaracaoDoTurno = {
      intencoes: [{ o_que: "quer remarcar para a semana que vem", evidencia: "não vou poder terça" }],
      promessas: [
        { o_que: "confirmar o novo horário", prazo: "2026-08-07T14:00:00Z" },
        { o_que: "verificar se o convênio cobre", prazo: null },
      ],
      nada_a_declarar: false,
    };

    it("o handoff entrega o que a pessoa quer e o que foi prometido — não a conversa crua", () => {
      const resumo = buildHandoffSummary({
        commitments: [],
        objections: [],
        next_action: null,
        rolling_summary: "paciente da clínica",
        declaracao,
      });
      expect(resumo).toContain("quer remarcar para a semana que vem");
      expect(resumo).toContain("confirmar o novo horário");
    });

    it("promessa COM prazo mostra o prazo colado — quem assume precisa do 'até quando'", () => {
      const resumo = buildHandoffSummary({
        commitments: [],
        objections: [],
        next_action: null,
        rolling_summary: "",
        declaracao,
      });
      expect(resumo).toContain("confirmar o novo horário (até 2026-08-07T14:00:00Z)");
      // A sem prazo aparece inteira e SEM parêntese órfão — "(até null)" na tela
      // de quem assume é pior que não mostrar prazo nenhum.
      expect(resumo).toContain("verificar se o convênio cobre");
      expect(resumo).not.toContain("(até null)");
      // Exatamente uma das duas promessas tem prazo: o marcador não vaza para a outra.
      expect(resumo.match(/\(até /g)).toHaveLength(1);
    });

    it("a declaração vem ANTES de compromissos/objeções — é o que decide a próxima frase", () => {
      const resumo = buildHandoffSummary({
        commitments: ["enviar orçamento"],
        objections: ["achou caro"],
        next_action: null,
        rolling_summary: "",
        declaracao,
      });
      expect(resumo.indexOf("quer remarcar")).toBeLessThan(resumo.indexOf("Compromissos:"));
    });

    it("sem declaração, o handoff degrada para o resumo de hoje — nunca quebra", () => {
      // Chamador antigo e checkpoint gravado antes da coluna existir.
      const resumo = buildHandoffSummary({
        commitments: ["enviar orçamento"],
        objections: [],
        next_action: "ligar amanhã",
        rolling_summary: "conversa em andamento",
      });
      expect(resumo).toContain("conversa em andamento");
      expect(resumo).toContain("Compromissos: enviar orçamento");
    });

    it("declaração vazia não imprime cabeçalho órfão", () => {
      const vazia: DeclaracaoDoTurno = { intencoes: [], promessas: [], nada_a_declarar: true };
      expect(renderDeclaracaoParaHumano(vazia)).toBe("");
    });
  });

  describe("promessas em aberto — o ponto único do cálculo", () => {
    it("sem declaração, não há promessa a quitar", () => {
      expect(promessasEmAberto(null)).toEqual([]);
    });

    it("promessa declarada entra na lista de quem tem de quitá-la", () => {
      const d: DeclaracaoDoTurno = {
        intencoes: [],
        promessas: [{ o_que: "vou confirmar com a equipe", prazo: null }],
        nada_a_declarar: false,
      };
      expect(promessasEmAberto(d)).toHaveLength(1);
    });
  });
});
