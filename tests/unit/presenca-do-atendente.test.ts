/**
 * O SINAL DE PRESENÇA EXISTE, E O CUSTO DELE ESTÁ MEDIDO AQUI.
 *
 * ─── O defeito que esta peça conserta (issue #996, decisão 18) ─────────────
 *
 * O produto tinha o leitor do sinal de vida e nunca teve o emissor: o cron
 * `/api/v1/cron/attendant-heartbeat` desligava o plantão de quem não emitisse
 * sinal em 15 min, e nenhum arquivo do repositório emitia sinal nenhum — o
 * único carimbo de `last_heartbeat_at` era o clique no botão de plantão. A
 * chave se desligava sozinha ~15 min depois de ligada, em toda instalação.
 *
 * O #720 tirou o cron e derivou o plantão da jornada. Esta peça é o emissor que
 * faltava, com a fronteira que o defeito original não tinha:
 *
 *   `is_available`      = decisão ("estou de plantão") — dura
 *   `last_heartbeat_at` = presença ("o navegador está aberto") — expira
 *
 * A presença NÃO escreve na decisão, e a prova disso vive em DOIS lugares: a
 * separação de TIPO está aqui (o predicado do plantão não recebe presença, e o
 * roster passa pelo MESMO `estaDePlantao` com presença presente ou vencida), e
 * a separação de ESCRITA está em
 * `tests/unit/attendant-presence-route.test.ts` (o payload do sinal não carrega
 * `is_available`). Sabotagem medida desta linha: devolver a presença para dentro
 * da conta do plantão derruba os dois casos "o plantão não muda com o sinal" —
 * e mais nada, porque a regra do plantão em si não foi tocada.
 *
 * ─── O custo, medido em vez de estimado ────────────────────────────────────
 *
 * O pedido explícito da issue é não transformar aba aberta em escrita a cada
 * poucos segundos. O número que responde isso sai do simulador abaixo, rodando
 * sobre as MESMAS constantes que o emissor usa em produção — não de uma conta
 * de guardanapo no corpo do PR: 480 escritas por turno de 8 h por aba, e ZERO
 * quando a aba não existe (fechar a aba não escreve nada).
 */
import { describe, expect, it } from "vitest";

import {
  deveEmitirSinal,
  estaPresente,
  INTERVALO_DO_SINAL_SEGUNDOS,
  PRESENCA_EXPIRA_SEGUNDOS,
} from "@/lib/atendimento/presenca";
import { estaDePlantao } from "@/lib/routing/eligibility";
import { podeAssumirAgora } from "@/lib/escalacao/atendentes";

const AGORA = new Date("2026-09-17T12:00:00.000Z");

/** Um carimbo de presença com `segundos` de idade, em relação a `agora`. */
function sinalHa(segundos: number, agora: Date = AGORA): string {
  return new Date(agora.getTime() - segundos * 1000).toISOString();
}

describe("o sinal de presença (lib/atendimento/presenca)", () => {
  it("sinal dentro do prazo conta como presente; passado o prazo, não", () => {
    expect(estaPresente(sinalHa(0), AGORA)).toBe(true);
    expect(estaPresente(sinalHa(INTERVALO_DO_SINAL_SEGUNDOS), AGORA)).toBe(true);
    // Exatamente no prazo ainda vale (limite fechado); um segundo depois não.
    expect(estaPresente(sinalHa(PRESENCA_EXPIRA_SEGUNDOS), AGORA)).toBe(true);
    expect(estaPresente(sinalHa(PRESENCA_EXPIRA_SEGUNDOS + 1), AGORA)).toBe(false);
  });

  it("sem carimbo, ou carimbo ilegível, nunca é presente", () => {
    // `null` é o estado de quem nunca abriu uma tela logado — não é "sumiu",
    // e o roster mostra os dois com o mesmo selo porque os dois são ausência.
    expect(estaPresente(null, AGORA)).toBe(false);
    expect(estaPresente(undefined, AGORA)).toBe(false);
    expect(estaPresente("", AGORA)).toBe(false);
    expect(estaPresente("não é uma data", AGORA)).toBe(false);
  });

  it("o prazo cobre uma batida perdida: duas falhas seguidas ainda contam como presente", () => {
    // É o que evita o selo piscar para quem está na frente da tela: o emissor
    // bate a cada INTERVALO, e o prazo vale 3× isso.
    expect(estaPresente(sinalHa(INTERVALO_DO_SINAL_SEGUNDOS * 2), AGORA)).toBe(true);
    expect(estaPresente(sinalHa(INTERVALO_DO_SINAL_SEGUNDOS * 3 + 1), AGORA)).toBe(false);
  });

  it("o sinal NÃO decide plantão nem elegibilidade: presente ou vencido, a resposta é a mesma", () => {
    const jornada = { timezone: "America/Sao_Paulo", windows: [] };

    // 1) O plantão não conhece presença: `estaDePlantao` recebe decisão +
    //    jornada, e nada mais. Ligada sem jornada é 24/7 — com a aba aberta ou
    //    fechada, o texto é o mesmo.
    expect(estaDePlantao({ isAvailable: true, schedule: jornada }, AGORA)).toBe(true);

    // 2) E a ELEGIBILIDADE também não — o caso com dentes, porque é aqui que a
    //    presença poderia virar porta: duas pessoas idênticas em tudo (chave
    //    ligada, folga, sem janela de horário), diferindo SÓ na presença. Quem
    //    fecha a aba não pode sair da fila por isso: presença informa o
    //    roteamento, não o veta. Se alguém um dia pendurar `presente` dentro de
    //    `podeAssumirAgora`, este caso fica vermelho.
    const base = {
      userId: "11111111-1111-4111-8111-111111111111",
      papel: "agent" as const,
      disponivel: true,
      capacidade: 5,
      agenda: jornada,
      atualizadoEm: null,
      cargaAtual: 0,
    };
    const comSinalNovo = { ...base, ultimoSinalEm: sinalHa(5), presente: true };
    const comSinalVencido = { ...base, ultimoSinalEm: sinalHa(60 * 60), presente: false };

    expect(podeAssumirAgora(comSinalNovo, AGORA)).toBe(true);
    expect(podeAssumirAgora(comSinalVencido, AGORA)).toBe(true);
  });

  it("o espaçamento é o teto de custo: 60 s por aba, nunca 'a cada poucos segundos'", () => {
    // Trava do pedido explícito da issue. Se alguém apertar o intervalo para
    // segundos, o custo medido abaixo muda de ordem de grandeza — e este caso
    // avisa antes de o número chegar na VPS de alguém.
    expect(INTERVALO_DO_SINAL_SEGUNDOS).toBeGreaterThanOrEqual(30);
  });

  it("MEDIÇÃO: um turno de 8 h com a aba aberta gera 480 escritas — e nenhuma com a aba fechada", () => {
    const SEGUNDOS_POR_TURNO = 8 * 60 * 60;

    /** Simula o turno com um tique por segundo, como o timer do emissor. */
    function turno(ticksPorSegundo = 1): number {
      let ultimoEnvioEm: Date | null = null;
      let escritas = 0;
      for (let s = 0; s < SEGUNDOS_POR_TURNO; s++) {
        const now = new Date(AGORA.getTime() + s * 1000);
        for (let t = 0; t < ticksPorSegundo; t++) {
          if (deveEmitirSinal({ ultimoEnvioEm, now })) {
            ultimoEnvioEm = now;
            escritas += 1;
          }
        }
      }
      return escritas;
    }

    // Aba aberta: um sinal a cada INTERVALO_DO_SINAL_SEGUNDOS (60 s) ⇒ 480/turno.
    expect(turno()).toBe(SEGUNDOS_POR_TURNO / INTERVALO_DO_SINAL_SEGUNDOS);
    expect(turno()).toBe(480);

    // O número NÃO depende da frequência do tique: um navegador que chame o
    // emissor 60 vezes por segundo escreve o mesmo (o espaçamento é a regra, o
    // timer é detalhe). Sem isto, um `setInterval` apertado viraria escrita
    // multiplicada — exatamente o custo que a issue manda segurar.
    expect(turno(60)).toBe(480);

    // Aba fechada: o emissor não existe, ninguém chama `deveEmitirSinal`, zero
    // escritas. NÃO há sinal de despedida (`beforeunload`/`sendBeacon`) — quem
    // responde "sumiu" é o prazo, derivado na leitura.
    expect(turno(0)).toBe(0);

    // Piso e teto de uma única batida: a primeira sai sempre (abrir a tela
    // marca presença na hora), e a segunda só depois do intervalo.
    expect(deveEmitirSinal({ ultimoEnvioEm: null, now: AGORA })).toBe(true);
    expect(
      deveEmitirSinal({
        ultimoEnvioEm: new Date(AGORA.getTime() - (INTERVALO_DO_SINAL_SEGUNDOS - 1) * 1000),
        now: AGORA,
      }),
    ).toBe(false);
    expect(
      deveEmitirSinal({
        ultimoEnvioEm: new Date(AGORA.getTime() - INTERVALO_DO_SINAL_SEGUNDOS * 1000),
        now: AGORA,
      }),
    ).toBe(true);
  });
});
