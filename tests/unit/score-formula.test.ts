import { describe, expect, it } from "vitest";

import { calculaScore, FORMULA_V, type SinaisDoLead } from "@/lib/leads/score-formula";
import { FAIXA_LIMITES } from "@/lib/kanban/score-band";

function sinais(over: Partial<SinaisDoLead> = {}): SinaisDoLead {
  return {
    commitments: [],
    objections: [],
    checkpointId: "ck-1",
    qualification: {},
    risco: "em_dia",
    status: "open",
    bandAnterior: null,
    ...over,
  };
}

describe("fórmula do score", () => {
  it("lead sem conteúdo NÃO ganha score — e o que falta é dito", () => {
    // O cenário 17. Um lead criado à mão há cinco minutos tem estágio e tem
    // recência, e não tem nada a dizer sobre fechar. Se vitalidade contasse
    // para o mínimo, todo lead novo nasceria com um número.
    const r = calculaScore(sinais({ risco: "em_dia" }));
    expect(r.score).toBeNull();
    expect(r.semSinal).toBe("sem_conteudo");
  });

  it("null e ZERO são coisas diferentes", () => {
    // Zero é uma afirmação ("este lead não fecha"); null é a ausência dela.
    // Confundir os dois põe na tela um veredito que ninguém calculou.
    const r = calculaScore(sinais());
    expect(r.score).toBeNull();
    expect(r.score).not.toBe(0);
  });

  it("conteúdo sem lastro citável também é recusa", () => {
    // Sem o checkpoint, a razão viraria adjetivo e a evidência ficaria vazia —
    // a constraint recusaria o INSERT. Melhor recusar aqui, com motivo legível.
    // Dois sinais de propósito: com um, a recusa viria antes, pelo mínimo.
    const r = calculaScore(
      sinais({ commitments: ["fecha semana que vem", "assina hoje"], checkpointId: null }),
    );
    expect(r.score).toBeNull();
    expect(r.semSinal).toBe("sem_lastro_citavel");
  });

  it("a razão CITA as parcelas que mexeram no número", () => {
    const r = calculaScore(
      sinais({
        commitments: ["assinou proposta"],
        objections: ["achou caro"],
        qualification: { need: "automatizar", budget: "5k" },
        risco: "em_dia",
      }),
    );
    // 30 base + 12 compromisso − 8 objeção + 10 BANT + 10 em dia = 54
    expect(r.score).toBe(54);
    // TRÊS parcelas nomeadas (as de maior peso) — a quarta vira agregado, e não
    // some: truncar em silêncio quebraria a reconstrução da frase.
    expect(r.reason).toContain("compromisso do cliente");
    expect(r.reason).toContain("itens de qualificação");
    expect(r.reason).toContain("conversa em dia");
    expect(r.reason).toContain("outro fator");
    expect(r.reason.split(",").length).toBe(4); // 3 nomeadas + o agregado
  });

  it("a razão é ordenada pelo que MAIS pesou", () => {
    // Quem lê tem de ver primeiro o que decidiu o número, não a ordem em que o
    // programador escreveu as parcelas.
    const r = calculaScore(
      sinais({ commitments: ["a", "b", "c"], objections: ["x"], risco: "em_dia" }),
    );
    expect(r.reason.indexOf("compromissos do cliente")).toBeLessThan(
      r.reason.indexOf("objeção em aberto"),
    );
  });

  it("parcela que não pesou NÃO é citada", () => {
    // "0 objeções" na frase seria ruído com cara de informação.
    const r = calculaScore(sinais({ commitments: ["fecha amanhã", "manda contrato"], risco: "em_voo" }));
    expect(r.reason).not.toContain("objeç");
    expect(r.reason).not.toContain("qualificação");
  });

  it("a evidência aponta para o checkpoint DENTRO do fator, não numa lista à parte", () => {
    // Fonte única (0077): manter um array de ids ao lado dos fatores criaria
    // duas listas que podem discordar — e discordar sem sintoma, porque as duas
    // passariam na constraint.
    const r = calculaScore(sinais({ commitments: ["ok", "beleza"], checkpointId: "ck-42" }));
    const comAncora = (r.evidence.factors ?? []).filter((f) => f.ancora);
    expect(comAncora.length).toBeGreaterThan(0);
    expect(comAncora[0]!.ancora).toEqual({ kind: "checkpoint", id: "ck-42" });
    expect("checkpoint_ids" in r.evidence).toBe(false);
  });

  it("recência entra pelo classificador ÚNICO, e muda o número", () => {
    const base = { commitments: ["fecha"], qualification: { need: "x", budget: "5k" } };
    const emDia = calculaScore(sinais({ ...base, risco: "em_dia" })).score!;
    const critico = calculaScore(sinais({ ...base, risco: "critico" })).score!;
    expect(emDia - critico).toBe(30); // +10 contra −20
  });

  it("o score nunca escapa de 0..100, mesmo com sinal extremo", () => {
    const alto = calculaScore(
      sinais({
        commitments: ["a", "b", "c", "d", "e"],
        qualification: { a: "1", b: "2", c: "3", d: "4", e: "5" },
        risco: "em_dia",
      }),
    );
    const baixo = calculaScore(
      sinais({ objections: ["a", "b", "c", "d", "e"], risco: "critico" }),
    );
    expect(alto.score).toBeLessThanOrEqual(100);
    expect(baixo.score).toBeGreaterThanOrEqual(0);
  });

  it("a faixa devolvida é sempre GRAVÁVEL — a fórmula não pode brigar com o CHECK", () => {
    // A mesma varredura do invariante, aqui na origem: se a fórmula produzisse
    // um par (score, faixa) fora dos limites, o worker escreveria e o banco
    // recusaria — erro em produção, no lead que oscila.
    const anteriores = [null, "frio", "morno", "quente"] as const;
    for (const risco of ["em_dia", "em_voo", "em_risco", "critico"] as const) {
      for (let n = 0; n <= 5; n++) {
        for (const anterior of anteriores) {
          const r = calculaScore(
            sinais({
              commitments: Array.from({ length: n }, (_, i) => `c${i}`),
              objections: Array.from({ length: 5 - n }, (_, i) => `o${i}`),
              risco,
              bandAnterior: anterior,
            }),
          );
          if (r.score === null || r.band === null) continue;
          const lim = FAIXA_LIMITES[r.band];
          expect(
            r.score >= lim.min && r.score <= lim.max,
            `score ${r.score} com faixa '${r.band}' seria recusado pelo banco`,
          ).toBe(true);
        }
      }
    }
  });

  it("é DETERMINÍSTICA: mesma entrada, mesmo número e mesma frase", () => {
    // O ponto inteiro de ser fórmula. Com um modelo, duas chamadas iguais
    // devolveriam frases diferentes — e a razão deixaria de ser derivação.
    const entrada = sinais({ commitments: ["a"], objections: ["b"], qualification: { c: "d" } });  // 3 sinais
    const um = calculaScore(entrada);
    const dois = calculaScore(entrada);
    expect(um).toEqual(dois);
  });
});

describe("a razão é DERIVADA do cálculo, e isso é verificável", () => {
  /**
   * A C1 exige `reason` derivado, e o @Assistente notou que olhando o RESULTADO
   * uma frase gerada é indistinguível de uma derivada. Este teste desfaz o
   * empate: ele RECONSTRÓI o score a partir da frase.
   *
   * Se a frase citar parcela que não entrou na conta, ou omitir uma que entrou,
   * ou trouxer número diferente do que somou, a reconstrução não fecha. Uma
   * frase gerada por modelo passaria no olho e falharia aqui — que é
   * exatamente a distinção que a lei precisa.
   */
  function somaDaFrase(reason: string): number {
    // As parcelas são escritas como "+12 ..." / "−8 ..." (menos tipográfico).
    const parcelas = [...reason.matchAll(/([+−])(\d+)/g)];
    return parcelas.reduce(
      (soma, m) => soma + (m[1] === "+" ? 1 : -1) * Number(m[2]),
      0,
    );
  }

  const BASE_DA_FORMULA = 30;

  it("quando o clamp atua, a frase DIZ que atuou", () => {
    // O único caso em que a soma não bate com o número exibido. Se o limite
    // ficasse mudo, a razão pareceria errada — ou pior, pareceria gerada.
    const r = calculaScore(sinais({ objections: ["a", "b", "c"], risco: "critico" }));
    expect(r.score).toBe(0);
    expect(r.reason).toContain("limitado a 0");
  });

  it("somar os números da frase reproduz o score, quando não há clamp", () => {
    const casos: SinaisDoLead[] = [
      sinais({ commitments: ["a", "b"], risco: "em_dia" }),
      sinais({ objections: ["x", "y"], risco: "em_risco" }),
      sinais({ commitments: ["a", "b"], objections: ["x"], qualification: { n: "1" }, risco: "em_risco" }),
      // ⚠️ ERA `qualification` SOZINHA aqui, e o caso afirmava um score que o
      // BANCO NUNCA ACEITOU: sem compromisso nem objeção, nenhum fator recebe
      // âncora, e `crm_lead_scores_needs_reason` exige
      // `evidence @? '$.factors[*].ancora'`. A função devolvia 60 e o INSERT
      // do escritor real estourava 23514 — medido pelo caminho de produção no
      // invariante `score-escritor-real-satisfaz-a-constraint`. O teste provava
      // a FUNÇÃO e afirmava o SISTEMA. A recusa desse cenário está fixada no
      // caso próprio mais abaixo.
      sinais({ objections: ["x"], qualification: { a: "1", b: "2" }, risco: "em_voo" }),
    ];
    for (const caso of casos) {
      const r = calculaScore(caso);
      expect(r.score).not.toBeNull();
      expect(
        BASE_DA_FORMULA + somaDaFrase(r.reason),
        `a frase "${r.reason}" não reconstrói o score ${r.score}`,
      ).toBe(r.score);
    }
  });

  it("a frase não cita parcela que a conta não usou", () => {
    // Um "+5 itens de qualificação" numa frase de lead sem BANT seria a marca
    // de texto gerado ao lado do número em vez de derivado dele.
    const r = calculaScore(sinais({ commitments: ["fecha", "assina"], risco: "em_dia" }));
    expect(r.reason).not.toMatch(/qualificação|objeç/);
    expect(BASE_DA_FORMULA + somaDaFrase(r.reason)).toBe(r.score);
  });
});

describe("os quatro deltas do contrato", () => {
  it("negócio FECHADO não tem probabilidade de fechar", () => {
    // Sem isto, um lead ganho exibiria "72%" para sempre no card — número que
    // não muda decisão nenhuma, porque a pergunta já foi respondida.
    for (const status of ["won", "lost"] as const) {
      const r = calculaScore(
        sinais({ commitments: ["assinou", "pagou"], qualification: { need: "x" }, status }),
      );
      expect(r.score).toBeNull();
      expect(r.semSinal).toBe("negocio_fechado");
    }
  });

  it("UM sinal substantivo não vira porcentagem; DOIS viram", () => {
    // Porcentagem magra é indistinguível de porcentagem bem apurada para quem
    // lê — e é o "score inventado" que o cenário 17 proíbe.
    const um = calculaScore(sinais({ qualification: { need: "automatizar" } }));
    expect(um.score).toBeNull();
    expect(um.semSinal).toBe("sem_conteudo");

    // DOIS sinais que o sistema INTEIRO aceita: o de compromisso carrega a
    // âncora que a constraint exige. Antes este par era `need` + `budget`, e o
    // score que ele produzia morria no INSERT (ver o caso da recusa abaixo).
    const dois = calculaScore(
      sinais({ commitments: ["ligar terça"], qualification: { need: "automatizar" } }),
    );
    expect(dois.score).not.toBeNull();
  });

  it("só qualificação recusa com motivo, em vez de produzir score que o banco rejeita", () => {
    // ═══ O defeito que este caso prende (CRMV5W) ═══
    //
    // Só os fatores de COMPROMISSO e OBJEÇÃO recebem âncora; qualificação e
    // recência nascem sem ela — a recência de propósito ("é a AUSÊNCIA de
    // pontos"). Um negócio cujo conteúdo é apenas BANT passava nas duas
    // recusas, produzia score, e o escritor real estourava `23514` ao gravar:
    // o lead ficava SEM SCORE NENHUM, com a tela vazia e a causa só no log do
    // worker. Medido pelo caminho de produção, não por leitura.
    //
    // A promessa já estava escrita no cabeçalho de `calculaScore` — "melhor
    // recusar aqui, com motivo legível, do que descobrir no INSERT". A
    // verificação é que parava no checkpoint existir, e não em algum fator
    // USAR a âncora dele.
    const r = calculaScore(sinais({ qualification: { need: "sim", budget: "10k", authority: "dono" } }));
    expect(r.score, "produziu score sem nenhum fator ancorado — o banco recusa esta linha").toBeNull();
    expect(r.semSinal).toBe("sem_lastro_citavel");
  });

  it("recência NÃO conta para o mínimo — vitalidade não é conteúdo", () => {
    // Um lead novo tem estágio e recência e nada a dizer sobre fechar.
    const r = calculaScore(sinais({ commitments: ["só isto"], risco: "em_dia" }));
    expect(r.score).toBeNull();
  });

  it("os fatores vão ESTRUTURADOS, não só dentro da frase", () => {
    // O card precisa renderizar evidências separadas; extraí-las do texto
    // exigiria parse de volta da frase que a fórmula acabou de montar.
    const r = calculaScore(
      sinais({ commitments: ["a"], objections: ["b"], qualification: { c: "d" } }),
    );
    expect(r.evidence.factors).toBeDefined();
    expect(r.evidence.factors!.length).toBeGreaterThanOrEqual(3);
    for (const f of r.evidence.factors!) {
      expect(typeof f.pontos).toBe("number");
      expect(f.frase).toBeTruthy();
    }
    // A soma dos fatores estruturados É o score (fora do clamp) — a estrutura e
    // a frase contam a mesma história porque saem da mesma lista.
    const soma = 30 + r.evidence.factors!.reduce((t, f) => t + f.pontos, 0);
    expect(soma).toBe(r.score);
  });

  it("a âncora existe onde há ponto no tempo, e falta onde não há", () => {
    const r = calculaScore(sinais({ commitments: ["a"], objections: ["b"] }));
    const comAncora = r.evidence.factors!.filter((f) => f.ancora);
    const semAncora = r.evidence.factors!.filter((f) => !f.ancora);
    expect(comAncora.length).toBeGreaterThan(0);
    // Recência é a AUSÊNCIA de acontecimentos: dar-lhe âncora seria apontar
    // para o que não aconteceu.
    expect(semAncora.some((f) => /resposta|conversa/.test(f.frase))).toBe(true);
  });

  it("a versão da fórmula viaja junto", () => {
    // Sem ela, score de v1 comparado com score de v2 é maçã com pera, e não há
    // como saber qual produziu qual.
    const r = calculaScore(sinais({ commitments: ["a", "b"] }));
    expect(r.evidence.formula_v).toBe(FORMULA_V);
  });
});
