/**
 * O PACOTE NÃO PROMETE UMA ESCOLHA QUE O TETO IMPEDE (issue #162).
 *
 * ## O defeito
 *
 * A regra deliberada de `selecao-por-pacote.ts` é que **capacidade `critico`
 * nunca entra por pacote** — o humano tem de marcar à mão, e a tela diz isso
 * ("o pacote não liga por você"). O teto (`TETO_TOOLS_POR_AGENTE`) existe por
 * outro motivo, também escrito: prompt com capacidade demais degrada a escolha
 * do modelo. O número dele já mudou uma vez (20 → 25) e por isso não se repete
 * aqui: quem precisar do valor de hoje lê a constante.
 *
 * As duas regras se cancelavam. Ligar "Atender" traz 17 automáticas; somadas ao
 * que já estivesse ligado, o teto era atingido — e aí o checkbox da crítica
 * ficava `disabled`. O pacote prometia uma escolha que o produto não permitia
 * fazer, e o único sinal era um checkbox morto com `opacity-60`.
 *
 * Achado ao trazer as specs do épico IA 360 para o CI (issue #63): a spec que
 * cobre exatamente essa jornada reprovava por timeout de clique. Ela não rodava
 * em gate nenhum desde que foi escrita, e o catálogo cresceu no meio.
 *
 * ## O que se guarda
 *
 * A CONTA, não a mensagem: quantas vagas ligar um pacote realmente exige. Sem
 * as críticas nessa conta, o pacote cabe "por pouco" e a crítica morre.
 */
import { describe, expect, it } from "vitest";

import { PACOTE_PADRAO_DO_ONBOARDING } from "@/lib/ai/agents/capacidades-padrao";
import { TOOL_CATALOG } from "@/lib/mcp/tools/catalogo";
import {
  TETO_TOOLS_POR_AGENTE,
  capacidadesAutomaticasDoPacote,
  capacidadesCriticasDoPacote,
  ligarPacote,
  vagasExigidasPeloPacote,
} from "@/lib/mcp/tools/selecao-por-pacote";

const CATALOGO = TOOL_CATALOG.map((t) => ({
  name: t.name,
  risco: t.risco,
  pacotes: t.pacotes,
}));

/** Pacotes que realmente têm crítica — os únicos onde a reserva muda algo. */
const COM_CRITICA = [...new Set(CATALOGO.flatMap((c) => c.pacotes as string[]))].filter(
  (p) => capacidadesCriticasDoPacote(CATALOGO as never, p as never).length > 0,
);

describe("ligar pacote reserva a vaga das próprias críticas", () => {
  it("existem pacotes com crítica (guarda de vacuidade)", () => {
    // Sem isto, um catálogo que perdesse o conceito de `critico` faria os casos
    // abaixo passarem por ausência de dado — verde sobre nada.
    expect(COM_CRITICA.length).toBeGreaterThan(0);
  });

  it.each(COM_CRITICA)("%s: a conta inclui as críticas, não só as automáticas", (pacote) => {
    const auto = capacidadesAutomaticasDoPacote(CATALOGO as never, pacote as never);
    const crit = capacidadesCriticasDoPacote(CATALOGO as never, pacote as never);

    const soAutomaticas = ligarPacote([], CATALOGO as never, pacote as never).length;
    const exigido = vagasExigidasPeloPacote([], CATALOGO as never, pacote as never);

    expect(soAutomaticas).toBe(auto.length);
    expect(
      exigido,
      "sem as críticas na conta, o pacote cabe 'por pouco' e a crítica dele nasce com o checkbox morto",
    ).toBe(auto.length + crit.length);
  });

  it("o que já está ligado entra na conta", () => {
    const pacote = COM_CRITICA[0]!;
    const fora = CATALOGO.find((c) => !(c.pacotes as string[]).includes(pacote))!;
    const semNada = vagasExigidasPeloPacote([], CATALOGO as never, pacote as never);
    const comUma = vagasExigidasPeloPacote([fora.name], CATALOGO as never, pacote as never);
    expect(comUma).toBe(semNada + 1);
  });

  it("capacidade do pacote já ligada não é contada duas vezes", () => {
    const pacote = COM_CRITICA[0]!;
    const jaLigada = capacidadesAutomaticasDoPacote(CATALOGO as never, pacote as never)[0]!;
    expect(vagasExigidasPeloPacote([jaLigada], CATALOGO as never, pacote as never)).toBe(
      vagasExigidasPeloPacote([], CATALOGO as never, pacote as never),
    );
  });

  it("a partir do agente que nasce hoje, ALGUM outro pacote ainda cabe", () => {
    // ⚠️ ESTE CASO É O DEFEITO D3, VIRADO DO AVESSO — e ele passou por uma
    // versão ERRADA antes de chegar aqui, o que vale contar.
    //
    // A primeira tentativa media "o agente novo mais a família de agenda cabe no
    // teto". Ela fica VERDE com o teto antigo de 20: o agente novo já nasce com
    // 4 das 5 capacidades de agenda, então somar a família inteira dá 17, e 17
    // cabe em 20. Uma guarda cega justamente no caso que ela dizia proteger é
    // pior que guarda nenhuma — ela afirma o que não mediu.
    //
    // A propriedade com tensão de verdade é esta: um agente recém-nascido tem de
    // conseguir ganhar ALGUMA jornada nova. Medido no teto de 20, a partir do
    // default de 16 capacidades, NENHUM segundo pacote cabia — evoluir exigia
    // 21, reter 22, escalar 28, atender 30, organizar 32. O produto oferecia
    // seis cards de jornada e recusava todos, dizendo só "faltam N vagas".
    //
    // É por construção que o dono ficava preso: não é o agente dele que era
    // estranho, é que depois do primeiro pacote não havia segundo.
    const doOnboarding = ligarPacote([], CATALOGO as never, PACOTE_PADRAO_DO_ONBOARDING as never);
    // Controle do instrumento: default vazio faria toda conta abaixo dar zero e
    // o caso ficaria verde por não medir nada.
    expect(doOnboarding.length, "o agente novo não nasce com capacidade nenhuma").toBeGreaterThan(5);

    const outros = [...new Set(CATALOGO.flatMap((c) => c.pacotes as string[]))].filter(
      (p) => p !== PACOTE_PADRAO_DO_ONBOARDING,
    );
    const exigencias = outros.map((p) => ({
      pacote: p,
      vagas: vagasExigidasPeloPacote(doOnboarding, CATALOGO as never, p as never),
    }));
    const cabem = exigencias.filter((e) => e.vagas <= TETO_TOOLS_POR_AGENTE);

    expect(
      cabem.map((e) => e.pacote),
      `nenhuma jornada nova cabe depois do agente nascer: ` +
        exigencias.map((e) => `${e.pacote} exige ${e.vagas}`).join(", ") +
        `, contra o teto de ${TETO_TOOLS_POR_AGENTE}. O dono liga o primeiro pacote e o ` +
        "produto passa a recusar todos os outros — foi o beco do defeito D3 da v1.7.0. " +
        "Ou o teto sobe, ou o catálogo encolhe: não é caso para afrouxar a asserção.",
    ).not.toEqual([]);
  });

  it("nenhum pacote sozinho estoura o teto (senão a reserva o tornaria inatingível)", () => {
    // Se um pacote exigisse mais que o teto por si só, reservar apenas trocaria
    // "crítica morta" por "pacote que nunca liga". Este caso é o alarme para quem
    // acrescentar capacidade ao catálogo sem olhar o teto.
    //
    // ⚠️ O NÚMERO SAIU DESTE COMENTÁRIO de propósito. Ele dizia "medido em
    // 2026-08-06: o maior é 18 contra teto 20", e venceu duas vezes no mesmo
    // mês — o catálogo foi de 51 para 57 capacidades e o teto de 20 para 25.
    // Número em prosa envelhece calado; a asserção abaixo não, porque deriva as
    // duas pontas do código. Quem quiser o valor de hoje roda o teste.
    for (const pacote of COM_CRITICA) {
      expect(
        vagasExigidasPeloPacote([], CATALOGO as never, pacote as never),
        `o pacote ${pacote} sozinho já não cabe em ${TETO_TOOLS_POR_AGENTE} — reservar não resolve, o teto é que precisa de decisão`,
      ).toBeLessThanOrEqual(TETO_TOOLS_POR_AGENTE);
    }
  });
});
