/**
 * A recusa que o modelo recebe não pode virar frase errada na cara do cliente.
 *
 * Guarda de um defeito MEDIDO com LLM real, não hipotético: com a mensagem
 * técnica (`Role 'agent' insufficient (required: 'manager')`), o `gpt-5.6-terra`
 * respondeu "SEU perfil atual é agent, e essa alteração exige permissão de
 * manager" — falso para quem lê (o papel é do assistente) e vazando vocabulário
 * interno para fora da empresa.
 *
 * O que este teste vigia é o INSUMO: se o texto que vai ao modelo voltar a
 * carregar os termos que ele repete, o defeito volta. Não dá para testar a saída
 * do modelo aqui — ela é medida no QA com IA real
 * (`tests/e2e/qa-agente-usa-as-maos.spec.ts`).
 */
import { describe, expect, it } from "vitest";

import { recusaDeCapacidadeParaOModelo } from "@/lib/mcp/recusa-para-o-modelo";
import { TOOL_CATALOG } from "@/lib/mcp/tools/catalog";

/** Os termos que fizeram o modelo errar o sujeito da frase. */
const VOCABULARIO_INTERNO = ["agent", "manager", "role", "insufficient", "requiresRole"];

describe("recusa de capacidade — o texto que vai ao modelo", () => {
  it("tem pelo menos uma capacidade apenasHumano para exercitar (guarda de vacuidade)", () => {
    // Sem isto, o teste do ramo `apenasHumano` passaria por ausência de dado.
    expect(TOOL_CATALOG.filter((t) => t.apenasHumano).length).toBeGreaterThan(0);
  });

  it("não entrega ao modelo os termos que ele repetiu errado", () => {
    const vazamentos: string[] = [];
    for (const tool of TOOL_CATALOG) {
      const texto = recusaDeCapacidadeParaOModelo(tool.name);
      for (const termo of VOCABULARIO_INTERNO) {
        // As aspas do próprio texto ("não cite `agent`") são a instrução de NÃO
        // usar — o que se caça é o termo solto, afirmando algo.
        const solto = new RegExp(`(?<!")\\b${termo}\\b(?!")`, "i");
        if (solto.test(texto)) vazamentos.push(`${tool.name}: "${termo}"`);
      }
    }
    expect(vazamentos).toEqual([]);
  });

  it("capacidade operada por pessoa diz que É por pessoa, e oferece caminho", () => {
    const humana = TOOL_CATALOG.find((t) => t.apenasHumano)!;
    const texto = recusaDeCapacidadeParaOModelo(humana.name);
    expect(texto).toMatch(/PESSOA do time/i);
    // "não conseguiu" sem próximo passo é beco — o invariante 5 pede a saída.
    expect(texto).toMatch(/ofereça que alguém do time faça/i);
    // E a instrução tem que dizer que a culpa não é de quem está falando.
    expect(texto).toMatch(/não é falha sua/i);
  });

  it("capacidade inalcançável por ACIDENTE não promete que um gestor resolve", () => {
    // A distinção existe porque prometer "peça a um gestor" numa capacidade que
    // ninguém deveria ter restringido manda a pessoa bater numa porta que não
    // abre — é o BUG-02 transformado em promessa falsa ao cliente.
    const acidental = recusaDeCapacidadeParaOModelo("crm_capacidade_inexistente");
    expect(acidental).toMatch(/limitação da configuração/i);
    expect(acidental).not.toMatch(/ofereça que alguém do time faça/i);
    expect(acidental).toMatch(/quem cuida do sistema/i);
  });

  it("usa o rótulo em português da capacidade, não o identificador técnico", () => {
    const texto = recusaDeCapacidadeParaOModelo("crm_create_stage");
    expect(texto).toContain("criar etapa no funil");
    expect(texto).not.toContain("crm_create_stage");
  });
});
