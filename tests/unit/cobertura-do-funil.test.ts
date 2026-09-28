import { describe, expect, it } from "vitest";

import { coberturaDoFunil, PASSOS_QUE_PRECISAM_DE_ETAPA } from "@/lib/leads/agent-mapping";

/**
 * QUANTO DE UM FUNIL O ASSISTENTE SABE PERCORRER (spec 17 passo 4).
 *
 * Medido na produção: 6 de 36 etapas traduzidas, e três funis com ZERO. Neles o
 * assistente não sabe para onde mover — e a única forma de descobrir era entrar
 * funil por funil na tela de configuração.
 */

const etapa = (name: string, hint: string | null, extra: Partial<{ is_won: boolean; is_lost: boolean }> = {}) => ({
  id: `id-${name}`,
  name,
  is_won: extra.is_won ?? false,
  is_lost: extra.is_lost ?? false,
  agent_stage_hint: hint,
});

describe("cobertura", () => {
  it("funil sem tradução nenhuma é MUDO", () => {
    const c = coberturaDoFunil([etapa("Entrada", null), etapa("Fechado", null, { is_won: true })]);
    expect(c.mudo).toBe(true);
    expect(c.traduzidos).toBe(0);
    expect(c.faltando.length).toBe(c.total);
  });

  it("funil parcialmente traduzido NÃO é mudo — a diferença importa", () => {
    // Com 3 de 5 o assistente percorre em parte; com 0 ele não move nada,
    // nunca. Só o segundo merece alarme, e distinguir os dois é o que evita o
    // alarme constante que se aprende a ignorar.
    const c = coberturaDoFunil([
      etapa("Novo", "new"),
      etapa("Contatado", "contacted"),
      etapa("Qualificando", "qualifying"),
    ]);
    expect(c.mudo).toBe(false);
    expect(c.traduzidos).toBe(3);
    expect(c.faltando.length).toBe(2);
  });

  it("funil completo não deixa nada faltando", () => {
    const c = coberturaDoFunil(PASSOS_QUE_PRECISAM_DE_ETAPA.map((p) => etapa(p, p)));
    expect(c.traduzidos).toBe(c.total);
    expect(c.faltando).toEqual([]);
    expect(c.mudo).toBe(false);
  });

  it("ganho e perda NÃO entram na conta", () => {
    // Têm coluna própria no funil (`is_won`/`is_lost`) e o produto já sabe
    // encontrá-las sem tradução. Cobrá-las inflaria a lacuna com uma pendência
    // que não existe — e uma barra que nunca chega a 100% se aprende a ignorar.
    expect([...PASSOS_QUE_PRECISAM_DE_ETAPA]).not.toContain("won");
    expect([...PASSOS_QUE_PRECISAM_DE_ETAPA]).not.toContain("lost");

    const c = coberturaDoFunil([
      ...PASSOS_QUE_PRECISAM_DE_ETAPA.map((p) => etapa(p, p)),
      etapa("Ganho", "won", { is_won: true }),
      etapa("Perdido", "lost", { is_lost: true }),
    ]);
    expect(c.traduzidos).toBe(c.total);
  });

  it("hint vazio conta como AUSENTE, não como traduzido", () => {
    // String vazia num campo de texto é o que sobra quando alguém apaga a
    // escolha na tela sem salvar `null`.
    const c = coberturaDoFunil([etapa("Novo", ""), etapa("Contatado", "contacted")]);
    expect(c.traduzidos).toBe(1);
  });

  it("os passos que faltam vêm em PORTUGUÊS, para a tela poder nomeá-los", () => {
    const c = coberturaDoFunil([]);
    // Sem isto a tela mostraria "qualifying" e "negotiating" ao dono da clínica.
    expect(c.faltando.some((f) => /[çãéêáí]/i.test(f) || f !== f.toLowerCase())).toBe(true);
  });

  it("funil sem etapa nenhuma é mudo, não erro", () => {
    const c = coberturaDoFunil([]);
    expect(c.mudo).toBe(true);
  });
});
