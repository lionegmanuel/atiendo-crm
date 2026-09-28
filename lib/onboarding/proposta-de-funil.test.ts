/**
 * O quadro proposto — o que se aceita, o que se conserta e o que se recusa.
 *
 * A saída da IA chega como JSON de um modelo que ninguém controla, e o destino
 * dela é uma tabela com CHECK, dois índices únicos parciais e uma FK
 * `ON DELETE RESTRICT`. Cada caso aqui é uma dessas defesas trazida para antes
 * do banco, para que a recusa chegue ao dono da clínica em português em vez de
 * como `23505 uniq_crm_stages_pipeline_won`.
 */
import { describe, expect, it } from "vitest";

import {
  etapasParaGravar,
  MAX_ETAPAS,
  normalizarProposta,
  validarProposta,
  type PropostaDeFunil,
} from "@/lib/onboarding/proposta-de-funil";
import { PACOTES, PACOTE_PADRAO } from "@/lib/onboarding/pacotes-de-funil";
import { PASSOS_QUE_PRECISAM_DE_ETAPA, coberturaDoFunil } from "@/lib/leads/agent-mapping";
import { slugDeNome } from "@/lib/leads/stage-editing";

const OK: PropostaDeFunil = {
  nome: "Agendamentos",
  etapas: [
    { nome: "Novo contato", passo: "new" },
    { nome: "Conversando", passo: "contacted" },
    { nome: "Marcou", passo: "won" },
    { nome: "Não marcou", passo: "lost" },
  ],
};

describe("os quadros prontos", () => {
  it("todo pacote é aceito pelo próprio validador", () => {
    // O plano B não pode ser recusado por quem o chama: se um pacote curado não
    // passa, a pessoa fica sem quadro nenhum justamente quando a IA já falhou.
    for (const p of PACOTES) {
      const r = validarProposta(p.proposta);
      expect(r.ok ? [] : r.erros, p.id).toEqual([]);
    }
  });

  it("todo pacote ensina o funcionário a percorrer o quadro inteiro", () => {
    // Medido neste banco: 312 etapas, 4 com destino. Um pacote que só desse os
    // nomes repetiria o defeito com colunas mais bonitas.
    for (const p of PACOTES) {
      const cobertura = coberturaDoFunil(
        p.proposta.etapas.map((e, i) => ({
          id: String(i),
          name: e.nome,
          is_won: e.passo === "won",
          is_lost: e.passo === "lost",
          agent_stage_hint: e.passo,
        })),
      );
      expect(cobertura.faltando, p.id).toEqual([]);
      expect(cobertura.traduzidos, p.id).toBe(PASSOS_QUE_PRECISAM_DE_ETAPA.length);
    }
  });

  it("nenhum pacote fala a língua de manual de vendas", () => {
    // O dono de uma clínica não chama ninguém de "MQL", e a régua desta sessão é
    // que nenhum nome técnico aparece no wizard.
    const jargao = /\b(MQL|SQL|lead scoring|prospec|funil de topo|fundo de funil|nutri)\w*/i;
    const sujos = PACOTES.flatMap((p) =>
      p.proposta.etapas.filter((e) => jargao.test(e.nome)).map((e) => `${p.id}: ${e.nome}`),
    );
    expect(sujos).toEqual([]);
  });

  it("o pacote de último recurso existe e é genérico", () => {
    expect(PACOTE_PADRAO.id).toBe("generico");
  });

  it("cada pacote tem um id único", () => {
    const ids = PACOTES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("normalizar", () => {
  it("tira espaço sobrando e colapsa espaço interno", () => {
    const p = normalizarProposta({
      nome: "  Agendamentos  ",
      etapas: [{ nome: " Novo   contato ", passo: "new" }],
    });
    expect(p.nome).toBe("Agendamentos");
    expect(p.etapas[0]?.nome).toBe("Novo contato");
  });

  it("junta as colunas que a pessoa leria como a mesma", () => {
    // "Pós venda" e "Pos  Venda" viram duas colunas que ninguém sabe distinguir.
    // A régua é a MESMA da tela de edição de etapas (`chaveDeNome`), de
    // propósito: uma segunda noção de "mesmo nome" faria a sugestão propor o
    // que a tela recusaria depois.
    const p = normalizarProposta({
      nome: "X",
      etapas: [
        { nome: "Pós venda", passo: "new" },
        { nome: "Pos  Venda", passo: "contacted" },
      ],
    });
    expect(p.etapas.map((e) => e.nome)).toEqual(["Pós venda"]);
  });

  it("uma etapa por passo — a segunda perde o passo, não a vaga", () => {
    // `uniq_crm_stages_pipeline_hint` recusaria a segunda. Descartar a COLUNA
    // seria jogar fora uma etapa que o dono quer ver no quadro.
    const p = normalizarProposta({
      nome: "X",
      etapas: [
        { nome: "Primeiro", passo: "new" },
        { nome: "Segundo", passo: "new" },
      ],
    });
    expect(p.etapas).toEqual([
      { nome: "Primeiro", passo: "new" },
      { nome: "Segundo", passo: null },
    ]);
  });

  it("passo que não existe no atendimento vira coluna sem passo", () => {
    // O modelo inventa token ('mql', 'follow_up'); o CHECK do banco recusaria.
    const p = normalizarProposta({
      nome: "X",
      etapas: [{ nome: "Nutrição", passo: "mql" }],
    });
    expect(p.etapas[0]?.passo).toBeNull();
  });

  it("corta o excesso em vez de entregar um quadro que não cabe na tela", () => {
    const p = normalizarProposta({
      nome: "X",
      etapas: Array.from({ length: 20 }, (_, i) => ({ nome: `Etapa ${i}`, passo: null })),
    });
    expect(p.etapas).toHaveLength(MAX_ETAPAS);
  });

  it("aguenta lixo no lugar da lista sem explodir", () => {
    // Isto vem de `JSON.parse` de texto de LLM: `etapas` pode chegar como
    // string, null, ou um array de números.
    expect(normalizarProposta({ nome: 42, etapas: "nada" }).etapas).toEqual([]);
    expect(normalizarProposta({}).etapas).toEqual([]);
    expect(normalizarProposta({ nome: "X", etapas: [null, 7, { passo: "new" }] }).etapas).toEqual([]);
  });

  it("não inventa a coluna que falta", () => {
    // Completar a proposta seria o produto escrevendo o funil e creditando à
    // sugestão — o dono aprovaria um texto que ninguém propôs.
    const p = normalizarProposta({ nome: "X", etapas: [{ nome: "Só essa", passo: "new" }] });
    expect(p.etapas).toHaveLength(1);
    expect(validarProposta(p).ok).toBe(false);
  });
});

describe("validar", () => {
  it("aceita o mínimo que conta uma história de venda", () => {
    expect(validarProposta(OK).ok).toBe(true);
  });

  it("recusa quadro sem onde fechar negócio", () => {
    // Sem `is_won`, `/leads/[id]/win` responde 422 `pipeline_no_won_stage` e
    // nenhum negócio deste tenant consegue ser fechado.
    const r = validarProposta({
      ...OK,
      etapas: OK.etapas.map((e) => (e.passo === "won" ? { ...e, passo: null } : e)),
    });
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.erros.join(" ")).toMatch(/fechado/i);
  });

  it("recusa quadro sem onde colocar quem desistiu", () => {
    const r = validarProposta({
      ...OK,
      etapas: OK.etapas.map((e) => (e.passo === "lost" ? { ...e, passo: null } : e)),
    });
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.erros.join(" ")).toMatch(/não fechou/i);
  });

  it("recusa quadro curto demais", () => {
    const r = validarProposta({ nome: "X", etapas: OK.etapas.slice(0, 2) });
    expect(r.ok).toBe(false);
  });

  it("recusa quadro sem nome", () => {
    expect(validarProposta({ ...OK, nome: "" }).ok).toBe(false);
  });

  it("acusa TODOS os problemas de uma vez", () => {
    // Uma tela que corrige um erro por vez faz a pessoa clicar quatro vezes para
    // descobrir quatro coisas.
    const r = validarProposta({ nome: "", etapas: [] });
    expect(r.ok).toBe(false);
    expect(r.ok ? 0 : r.erros.length).toBeGreaterThanOrEqual(3);
  });
});

describe("virar linhas do banco", () => {
  const linhas = etapasParaGravar(OK, slugDeNome);

  it("ganho e perda saem do passo, nunca de um campo próprio", () => {
    // O CHECK `crm_stages_hint_coerente_com_won_lost` vigia a discordância entre
    // os dois. Uma fonte só é a forma de nunca discordar.
    for (const l of linhas) {
      expect(l.is_won, l.nome).toBe(l.agent_stage_hint === "won");
      expect(l.is_lost, l.nome).toBe(l.agent_stage_hint === "lost");
    }
    expect(linhas.filter((l) => l.is_won)).toHaveLength(1);
    expect(linhas.filter((l) => l.is_lost)).toHaveLength(1);
  });

  it("as posições deixam espaço para arrastar uma coluna entre duas", () => {
    expect(linhas.map((l) => l.position)).toEqual([1000, 2000, 3000, 4000]);
  });

  it("slugs que colidiriam recebem sufixo", () => {
    // `uniq_crm_stages_pipeline_slug` não é parcial: "Proposta!" e "Proposta?"
    // colapsam no mesmo slug e o INSERT em lote falharia inteiro.
    const l = etapasParaGravar(
      {
        nome: "X",
        etapas: [
          { nome: "Proposta!", passo: "new" },
          { nome: "Proposta?", passo: "contacted" },
        ],
      },
      slugDeNome,
    );
    expect(new Set(l.map((x) => x.slug)).size).toBe(2);
  });

  it("preserva a ordem em que a pessoa aprovou as colunas", () => {
    expect(linhas.map((l) => l.nome)).toEqual(OK.etapas.map((e) => e.nome));
  });
});
