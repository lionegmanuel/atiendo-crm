import { describe, expect, it } from "vitest";

import {
  ABANDONO_HORAS_DEFAULT,
  formatarDuracao,
  formatarMedida,
  montarPares,
  razao,
  taxaDeAutomacao,
  lerAbandonoHoras,
  taxaDeAbandono,
  taxaDeContorno,
  taxaDeEsperaCalada,
  taxaDeRepergunta,
  vetosPorExecucao,
  type AtritoRaw,
} from "@/lib/metrics/atrito";

/**
 * O GATE DA REGRA 3.3 — toda eficiência publicada com sua contra-métrica.
 *
 * A doutrina (`docs/doctrine/sistema-vivo/03-medida-do-proposito.md` §3.3) diz:
 * "toda medida que empurra o sistema a fazer mais de alguma coisa vem
 * acompanhada da medida que denuncia o custo dessa coisa. Publicadas juntas,
 * nunca separadas — separadas, a de eficiência vence sempre, porque é a que
 * sobe."
 *
 * Isso é enumerável a partir do código, então é teste e não hábito (cap. 8.4).
 * Sem ele, a regra seria um comentário pedindo cuidado — e a próxima métrica de
 * eficiência entraria sozinha, porque é a mais fácil de coletar e a que todo
 * mundo pede.
 *
 * O segundo bloco guarda o ZERO LISONJEIRO: denominador vazio devolve `null`,
 * nunca `0`. Um `0` aqui viraria "0% de contorno" numa org sem nenhum envio —
 * exatamente a frase tranquilizadora que a ausência de medição não autoriza.
 */

/** Fixture com números distintos por campo — troca de campo não passa batida. */
const RAW: AtritoRaw = {
  escopo: {
    demandas: 40, de: "2026-07-01T00:00:00Z", ate: "2026-08-01T00:00:00Z",
    abandono_horas: 72, repeticao_min: 0.7, espera_horas: 4,
    demandas_com_caso: 25, demandas_abertas: 18, denominador: "demandas",
  },
  cliente: {
    turnos_p50: 7,
    turnos_p90: 21,
    insistencia_media: 2.5,
    insistencia_max: 6,
    pedidos_de_humano: 11,
    descadastros: 3,
    abandonos: 9,
    conversas_com_fala_nossa: 60,
    reperguntas: 7,
    perguntas_com_resposta: 50,
    esperas_caladas: 4,
    esperas_medidas: 80,
    espera_resposta_p90_s: 1800,
    repeticao_pos_passagem: 4,
    passagens_medidas: 10,
  },
  empresa: {
    intervencoes_por_demanda: 1.4,
    espera_humana_p50_s: 900,
    espera_humana_p90_s: 7200,
    retrabalho: 5,
    vetos: 18,
    execucoes_medidas: 120,
    envios_por_ia: 600,
    envios_por_automacao: 150,
    envios_por_integracao: 75,
    envios_humano_no_sistema: 300,
    envios_humano_fora: 100,
    demandas_sem_proximo_passo: 6,
  },
  eficiencia: { ganhos: 12, perdidos: 8 },
};

describe("regra 3.3 — nenhuma eficiência é publicada sozinha", () => {
  const pares = montarPares(RAW);

  it("existe pelo menos um par (senão o gate é vácuo)", () => {
    expect(pares.length).toBeGreaterThan(0);
  });

  it.each(montarPares(RAW).map((p) => [p.chave, p] as const))(
    "par %s tem eficiência e ao menos um dano",
    (_chave, par) => {
      expect(par.eficiencia).toBeDefined();
      expect(par.eficiencia.rotulo.length).toBeGreaterThan(0);
      expect(par.danos.length).toBeGreaterThanOrEqual(1);
      for (const d of par.danos) {
        expect(d.rotulo.length).toBeGreaterThan(0);
      }
    },
  );

  it("as chaves dos pares são únicas — dois pares com a mesma chave some na tela", () => {
    const chaves = pares.map((p) => p.chave);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it("cobre as quatro frentes da Fase 1 da spec 17", () => {
    expect(pares.map((p) => p.chave).sort()).toEqual(
      ["automacao", "contencao", "conversao", "custo_humano"].sort(),
    );
  });

  it("a insistência do agente é publicada — é o defeito que motivou a spec", () => {
    // Um agente que insiste 6x converte mais e queima relacionamento; nos
    // painéis antigos ele era o melhor da org. Se esta medida sair do par de
    // conversão, o defeito volta em silêncio.
    const conversao = pares.find((p) => p.chave === "conversao");
    expect(conversao?.danos.map((d) => d.chave)).toContain("insistencia_media");
  });

  it("a insistência do PIOR CASO é publicada junto da média", () => {
    // Pego na prova de tela: o painel mostrava só a média (2.0) e a função já
    // calculava o máximo (6). Numa base de 40 demandas, seis retornos num único
    // cliente somem na média — e é exatamente esse caso que a spec existe para
    // denunciar. Medir o dano e escondê-lo na exibição é o mesmo defeito, um
    // andar acima.
    const conversao = pares.find((p) => p.chave === "conversao");
    const chaves = conversao?.danos.map((d) => d.chave) ?? [];
    expect(chaves).toContain("insistencia_max");
    // E a média não pode ser publicada SEM o máximo ao lado.
    expect(chaves.indexOf("insistencia_max")).toBeGreaterThan(
      chaves.indexOf("insistencia_media"),
    );
  });

  it("p50 e p90 iguais são explicados como base pequena, não como fila homogênea", () => {
    // Dois números idênticos lado a lado leem-se como bug. Pego na prova de
    // tela: 35min e 35min sem nenhuma explicação.
    const iguais = montarPares({
      ...RAW,
      empresa: { ...RAW.empresa, espera_humana_p50_s: 900, espera_humana_p90_s: 900 },
    });
    const p90 = iguais
      .find((p) => p.chave === "custo_humano")
      ?.danos.find((d) => d.chave === "espera_humana_p90_s");
    expect(p90?.nota).toMatch(/poucas esperas/i);

    // E quando diferem, a nota volta a ser a que explica o próprio p90.
    const p90Diferente = pares
      .find((p) => p.chave === "custo_humano")
      ?.danos.find((d) => d.chave === "espera_humana_p90_s");
    expect(p90Diferente?.nota).toMatch(/quem espera mais/i);
  });

  it("a taxa de contorno é publicada — mede a ferramenta sendo evitada", () => {
    const automacao = pares.find((p) => p.chave === "automacao");
    expect(automacao?.danos.map((d) => d.chave)).toContain("taxa_de_contorno");
  });
});

describe("abandono e a régua (Fase 2)", () => {
  const pares = montarPares(RAW);
  const conversao = pares.find((p) => p.chave === "conversao")!;

  it("o abandono é publicado — é a perda que ninguém reclama", () => {
    // Em vez de pedir para sair, a pessoa só para de responder. Não gera
    // ticket, não gera nota baixa, e some de todo painel convencional.
    expect(conversao.danos.map((d) => d.chave)).toContain("taxa_de_abandono");
  });

  it("a taxa é sobre as conversas EM QUE FALAMOS, não sobre o total", () => {
    // 9 de 60 = 15%. Um denominador maior faria o abandono parecer pequeno.
    expect(taxaDeAbandono(RAW.cliente)).toBeCloseTo(0.15, 6);
  });

  it("org onde o sistema nunca falou não reporta '0% de abandono'", () => {
    expect(taxaDeAbandono({ ...RAW.cliente, abandonos: 0, conversas_com_fala_nossa: 0 })).toBeNull();
  });

  it("a RÉGUA aparece no rótulo — número sem régua não compara", () => {
    // Doutrina §3.4 regra 4. Se o rótulo não trouxer as horas, ninguém sabe se
    // o 15% de hoje e o de mês passado foram medidos com a mesma régua.
    const dano = conversao.danos.find((d) => d.chave === "taxa_de_abandono")!;
    expect(dano.rotulo).toContain("72h");

    const outraRegua = montarPares({ ...RAW, escopo: { ...RAW.escopo, abandono_horas: 24 } });
    const dano24 = outraRegua
      .find((p) => p.chave === "conversao")!
      .danos.find((d) => d.chave === "taxa_de_abandono")!;
    expect(dano24.rotulo).toContain("24h");
    expect(dano24.rotulo).not.toContain("72h");
  });

  it("a nota mostra os componentes crus, não só a razão", () => {
    // Regra 2 do cap. 3.4: agregado nunca aparece sozinho.
    const dano = conversao.danos.find((d) => d.chave === "taxa_de_abandono")!;
    expect(dano.nota).toContain("9");
    expect(dano.nota).toContain("60");
  });
});

describe("lerAbandonoHoras — régua vinda de jsonb livre", () => {
  it("ausente, nulo ou vazio cai no default", () => {
    expect(lerAbandonoHoras(undefined)).toBe(ABANDONO_HORAS_DEFAULT);
    expect(lerAbandonoHoras(null)).toBe(ABANDONO_HORAS_DEFAULT);
    expect(lerAbandonoHoras({})).toBe(ABANDONO_HORAS_DEFAULT);
    expect(lerAbandonoHoras({ atrito: {} })).toBe(ABANDONO_HORAS_DEFAULT);
  });

  it("valor válido é respeitado", () => {
    expect(lerAbandonoHoras({ atrito: { abandono_horas: 48 } })).toBe(48);
  });

  it("lixo NÃO derruba o painel nem vira NaN no rótulo", () => {
    // O rótulo interpola a régua: um NaN aqui apareceria como "após NaNh" na
    // tela do usuário — pior que o default silencioso.
    for (const lixo of ["abc", {}, [], true, 2.5, Number.NaN]) {
      expect(lerAbandonoHoras({ atrito: { abandono_horas: lixo } })).toBe(ABANDONO_HORAS_DEFAULT);
    }
  });

  it("valor fora da faixa cai no default", () => {
    expect(lerAbandonoHoras({ atrito: { abandono_horas: 0 } })).toBe(ABANDONO_HORAS_DEFAULT);
    expect(lerAbandonoHoras({ atrito: { abandono_horas: -5 } })).toBe(ABANDONO_HORAS_DEFAULT);
    expect(lerAbandonoHoras({ atrito: { abandono_horas: 99999 } })).toBe(ABANDONO_HORAS_DEFAULT);
  });
});

describe("o invariante 4 vira número (Fase 4)", () => {
  const pares = montarPares(RAW);

  it("demandas abertas sem próximo passo é publicado", () => {
    // Vazamento invisível é o que a doutrina inteira combate. Antes da entidade
    // de demanda (0136) este número não era sequer enumerável.
    const custo = pares.find((p) => p.chave === "custo_humano")!;
    expect(custo.danos.map((d) => d.chave)).toContain("demandas_sem_proximo_passo");
  });

  it("a nota diz sobre QUANTAS abertas — 6 sozinho não significa nada", () => {
    const d = pares
      .find((p) => p.chave === "custo_humano")!
      .danos.find((x) => x.chave === "demandas_sem_proximo_passo")!;
    expect(d.valor).toBe(6);
    expect(d.nota).toContain("18");
  });

  it("a insistência declara seu PRÓPRIO denominador, menor que o total", () => {
    // Insistência só existe onde houve caso (25 das 40). Publicá-la sem dizer
    // isso a faria parecer medida sobre todas as demandas.
    const d = pares
      .find((p) => p.chave === "conversao")!
      .danos.find((x) => x.chave === "insistencia_media")!;
    expect(d.nota).toContain("25");
  });
});

describe("repetição e espera (Fase 3)", () => {
  const pares = montarPares(RAW);

  it("a repergunta é dano da AUTOMAÇÃO — responder não é resolver", () => {
    const automacao = pares.find((p) => p.chave === "automacao")!;
    expect(automacao.danos.map((d) => d.chave)).toContain("taxa_de_repergunta");
  });

  it("a taxa é sobre as perguntas QUE TIVERAM RESPOSTA, não sobre todas", () => {
    // 7 de 50 = 14%. Só é possível reperguntar o que já foi respondido; usar
    // todas as mensagens do cliente como denominador diluiria o sinal.
    expect(taxaDeRepergunta(RAW.cliente)).toBeCloseTo(0.14, 6);
  });

  it("o rótulo declara que é PISO — a camada lexical subconta de propósito", () => {
    // Limiar 0.7 foi calibrado para ZERO falso positivo, ao custo de perder
    // reformulações. Publicar isso como total seria mentir para baixo.
    const dano = pares
      .find((p) => p.chave === "automacao")!
      .danos.find((d) => d.chave === "taxa_de_repergunta")!;
    expect(dano.nota).toMatch(/piso/i);
    expect(dano.nota).toMatch(/escapa/i);
  });

  it("a espera calada é dano do CUSTO HUMANO e traz a régua no rótulo", () => {
    const dano = pares
      .find((p) => p.chave === "custo_humano")!
      .danos.find((d) => d.chave === "taxa_de_espera_calada")!;
    expect(dano.rotulo).toContain("4h");
    expect(taxaDeEsperaCalada(RAW.cliente)).toBeCloseTo(0.05, 6);
  });

  it("org sem pergunta respondida não reporta '0% de repergunta'", () => {
    expect(taxaDeRepergunta({ ...RAW.cliente, reperguntas: 0, perguntas_com_resposta: 0 })).toBeNull();
    expect(taxaDeEsperaCalada({ ...RAW.cliente, esperas_caladas: 0, esperas_medidas: 0 })).toBeNull();
  });
});

describe("zero lisonjeiro — ausência de dado é null, nunca 0", () => {
  it("razao devolve null quando o denominador é zero", () => {
    expect(razao(0, 0)).toBeNull();
    expect(razao(5, 0)).toBeNull();
  });

  it("razao devolve null para entrada não-finita", () => {
    expect(razao(Number.NaN, 10)).toBeNull();
    expect(razao(10, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("org sem nenhum envio não reporta '0% de contorno'", () => {
    const vazio = {
      ...RAW.empresa,
      envios_por_ia: 0,
      envios_por_automacao: 0,
      envios_por_integracao: 0,
      envios_humano_no_sistema: 0,
      envios_humano_fora: 0,
    };
    expect(taxaDeContorno(vazio)).toBeNull();
    expect(taxaDeAutomacao(vazio)).toBeNull();
    expect(formatarMedida({ chave: "x", rotulo: "x", valor: null, unidade: "razao" })).toBe("—");
  });

  it("org sem execução medida não reporta '0 vetos por execução'", () => {
    expect(vetosPorExecucao({ ...RAW.empresa, vetos: 0, execucoes_medidas: 0 })).toBeNull();
  });
});

describe("cálculos derivados", () => {
  it("taxa de contorno é sobre as respostas HUMANAS, não sobre o total", () => {
    // 100 fora / (300 no sistema + 100 fora) = 25%. Se o denominador incluísse
    // os 600 da IA, daria 10% e faria o contorno parecer pequeno.
    expect(taxaDeContorno(RAW.empresa)).toBeCloseTo(0.25, 6);
  });

  it("taxa de automação inclui o contorno no denominador", () => {
    // 600 / (600 + 300 + 100) = 60%. Excluir o external_device daria 66,7% —
    // automação inflada numa org onde o time responde pelo celular.
    expect(taxaDeAutomacao(RAW.empresa)).toBeCloseTo(0.6, 6);
    const semContorno = razao(
      RAW.empresa.envios_por_ia,
      RAW.empresa.envios_por_ia + RAW.empresa.envios_humano_no_sistema,
    );
    expect(semContorno).not.toBeCloseTo(taxaDeAutomacao(RAW.empresa)!, 6);
  });

  it("vetos por execução usa as execuções medidas como denominador", () => {
    expect(vetosPorExecucao(RAW.empresa)).toBeCloseTo(18 / 120, 6);
  });
});

describe("formatação", () => {
  it("razão vira percentual", () => {
    expect(formatarMedida({ chave: "x", rotulo: "x", valor: 0.25, unidade: "razao" })).toBe("25.0%");
  });

  it("contagem é inteira", () => {
    expect(formatarMedida({ chave: "x", rotulo: "x", valor: 12, unidade: "contagem" })).toBe("12");
  });

  it("média mantém uma casa — 2.5 retornos não é 3", () => {
    expect(formatarMedida({ chave: "x", rotulo: "x", valor: 2.5, unidade: "media" })).toBe("2.5");
  });

  it.each([
    [45, "45s"],
    [900, "15min"],
    [3600, "1h"],
    [7200, "2h"],
    [5400, "1h 30min"],
  ])("duração de %is é %s", (segundos, esperado) => {
    expect(formatarDuracao(segundos)).toBe(esperado);
  });
});

/**
 * O LAÇO DE RETORNO DA PASSAGEM (invariante 7, migration 0294).
 *
 * A pergunta que mede se o cartão da passagem serviu para alguma coisa: DEPOIS
 * de a IA passar a conversa, o cliente precisou repetir o que já tinha dito? Se
 * o briefing chegou a quem assumiu, a repetição cai. Se não chegou, ela não muda
 * — e a feature é decoração cara.
 *
 * Ela é publicada como DANO do par `automacao`, encostada em "Passagens para
 * humano": a eficiência ali empurra o sistema a automatizar mais, e o custo de
 * automatizar mal é exatamente a pessoa repetindo o que já disse.
 */
describe("repetição depois da passagem — o laço de retorno", () => {
  const pares = montarPares(RAW);
  const automacao = pares.find((p) => p.chave === "automacao")!;
  const medida = automacao.danos.find((d) => d.chave === "repeticao_pos_passagem");

  it("é publicada no par da AUTOMAÇÃO, ao lado das passagens para humano", () => {
    // Fora do par ela vira número solto num painel: sem a eficiência ao lado,
    // ninguém sabe do que ela é o custo — e é justamente a regra 3.3 que este
    // arquivo inteiro guarda.
    expect(medida, "a medida do laço sumiu do par `automacao`").toBeDefined();
    const chaves = automacao.danos.map((d) => d.chave);
    expect(chaves).toContain("pedidos_de_humano");
  });

  it("é uma RAZÃO calculada na borda: 4 de 10", () => {
    expect(medida!.unidade).toBe("razao");
    expect(medida!.valor).toBeCloseTo(0.4, 6);
  });

  it("sem passagem em que o cliente voltou a falar, o número é `—`, nunca 0%", () => {
    // AUSÊNCIA DE DADO É null. Um `0` aqui viraria "0% de repetição" numa
    // organização onde ninguém voltou a falar depois de nenhuma passagem — a
    // frase tranquilizadora que a falta de medição não autoriza, e o número que
    // faria alguém declarar a feature um sucesso.
    const vazio = montarPares({
      ...RAW,
      cliente: { ...RAW.cliente, repeticao_pos_passagem: 0, passagens_medidas: 0 },
    });
    const semDado = vazio
      .find((p) => p.chave === "automacao")!
      .danos.find((d) => d.chave === "repeticao_pos_passagem")!;
    expect(semDado.valor).toBeNull();
    expect(formatarMedida(semDado)).toBe("—");
  });

  it("a nota traz o numerador, o denominador e a RÉGUA — número sem régua não compara", () => {
    // Limiar e janela precisam viajar com o número: se amanhã alguém mexer em
    // qualquer um dos dois, o valor de hoje e o de então não são comparáveis, e
    // o índice perde a única coisa que ele tinha.
    expect(medida!.nota).toContain("4");
    expect(medida!.nota).toContain("10");
    expect(medida!.nota).toMatch(/0,7/);
    expect(medida!.nota).toMatch(/24h/);
  });

  it("a nota declara que dois papéis veem números diferentes — e isso é de boa-fé", () => {
    // `fn_atrito_metrics` é SECURITY INVOKER: um `agent` numa organização em
    // `visibility_mode='own'` enxerga só as conversas dele. Sem esta ressalva,
    // quem comparar o painel de duas pessoas vai concluir que um dos dois está
    // errado — e nenhum está.
    expect(medida!.nota).toMatch(/own/);
  });
});

/**
 * O NÚMERO DA AUTOMAÇÃO TEM LUGAR (#652) — o contrário dele mente.
 *
 * Quando o carimbo da automação saiu de `'ai'` (issue #652), `envios_por_ia`
 * CAIU para quem usa regra. A queda é correta — o agente não escreveu aquelas
 * mensagens —, mas sem um número próprio ela chegaria na tela como o agente
 * encolhendo, sem nada que a explicasse. Este bloco prende o LUGAR do número
 * novo: ele é publicado, com o valor que veio do banco, e não infla a conta do
 * agente em nenhuma das duas pontas.
 */
describe("o número próprio da automação (#652)", () => {
  it("`envios_por_automacao` é publicado no painel, em Contenção", () => {
    const contencao = montarPares(RAW).find((p) => p.chave === "contencao");
    expect(contencao, "Contenção sumiu do painel").toBeDefined();
    const medida = contencao!.danos.find((d) => d.chave === "envios_por_automacao");
    expect(
      medida,
      "o payload traz `envios_por_automacao` e o painel não mostra: a org com automação vê o 'por IA' cair sem explicação na tela",
    ).toBeDefined();
    expect(medida!.valor).toBe(150);
    expect(medida!.unidade).toBe("contagem");
    expect(formatarMedida(medida!)).toContain("150");
  });

  it("`envios_por_integracao` é publicado no painel, em Contenção", () => {
    // Gêmeo do caso acima, e pelo mesmo motivo: sem ele o contador novo existe
    // no payload, na função do banco e no tipo — e não aparece em tela nenhuma.
    // Controle que não é lido é decoração, e decoração passa em typecheck.
    const contencao = montarPares(RAW).find((p) => p.chave === "contencao");
    const medida = contencao!.danos.find((d) => d.chave === "envios_por_integracao");
    expect(
      medida,
      "o payload traz `envios_por_integracao` e o painel não mostra: a org com integração vê o 'por IA' cair sem explicação na tela",
    ).toBeDefined();
    expect(medida!.valor).toBe(75);
    expect(medida!.unidade).toBe("contagem");
    expect(formatarMedida(medida!)).toContain("75");
  });

  it("o número do agente não é inflado pela automação", () => {
    const contencao = montarPares(RAW).find((p) => p.chave === "contencao")!;
    expect(contencao.eficiencia.valor).toBe(600);
    // 600 do agente sobre 600 + 300 + 100 de saídas COM dono entre agente e
    // pessoa: a automação (150) não entra em nenhuma das duas pontas, senão o
    // número do agente subiria por mensagem que ele não escreveu.
    expect(taxaDeAutomacao(RAW.empresa)).toBeCloseTo(0.6, 6);
  });
});
