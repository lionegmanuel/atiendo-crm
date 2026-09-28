import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * SPEC QUE DEPENDE DE ENVIO NÃO HERDA A HORA DE PAREDE — a guarda da CLASSE.
 *
 * ═══ A classe, e por que ela reaparece ═══════════════════════════════════════
 *
 * "Teste que lê uma grandeza que ninguém declarou como ENTRADA." A guarda irmã
 * (`agenda-spec-nao-escolhe-o-periodo-sozinha`) fechou a versão da AGENDA, onde
 * a grandeza era *que dia é hoje*. Esta fecha a versão do ENVIO, onde a
 * grandeza é *a janela de envio do canal está aberta?* — e ela custou um dia
 * inteiro de CI antes de alguém desconfiar do relógio.
 *
 * Medido em 2026-08-30/31, pelo horário em que a spec rodou:
 *
 *     21:41 BRT -> passou   (main)
 *     21:59 BRT -> falhou   (uma feature branch)
 *     22:00 BRT -> falhou   (main)
 *     22:24 BRT -> falhou   (branch SÓ DE DOCS)
 *
 * A última linha é a que fecha o diagnóstico: uma branch que só mexe em
 * documentação não quebra e2e por mérito próprio. Mas o sintoma não dizia isso
 * — dizia `expect(locator).toBeVisible() failed / element(s) not found` —, e um
 * sintoma mudo faz cada pessoa que o encontra suspeitar do PRÓPRIO código
 * primeiro. Foi o que aconteceu duas vezes em duas branches diferentes.
 *
 * ═══ O mecanismo ═════════════════════════════════════════════════════════════
 *
 * A janela anti-ban do produto é 7h-22h, com fim EXCLUSIVO. Passadas as 22h,
 * a ação de WhatsApp adia o envio, o motor grava o run com `status: 'adiado'` e
 * a aba Atividade o rotula "Aguardando envio" — que não é "Sucesso" nem
 * "Falhou". A spec procura um texto que a tela, corretamente, não escreveu.
 *
 * E o dano não para em quem envia: a pré-checagem de adiamento é
 * **all-or-nothing sobre o evento**, então o primeiro adiamento aborta o evento
 * INTEIRO, inclusive as regras que não mandam mensagem nenhuma. É por isso que
 * a régua abaixo cobre também a spec que só adiciona uma tag.
 *
 * ═══ A régua ═════════════════════════════════════════════════════════════════
 *
 * Existe UM lugar que declara a janela do rig — `garantirJanelaSempreAberta`,
 * em `scripts/seed-e2e-numero-conectado.ts` — e toda spec que depende de uma
 * automação executar tem de passar por ele, rodando o seed.
 *
 * ═══ O QUE ESTA GUARDA NÃO PEGA ══════════════════════════════════════════════
 *
 * Ela não lê o corpo da spec atrás de outras leituras de tempo, e não garante
 * que o autor obedeça à regra em cada linha. Ela impede a REINCIDÊNCIA
 * silenciosa: que a próxima spec de automação nasça herdando a hora do CI e
 * fique verde até as 22h de algum dia. Guarda de fonte não substitui revisão.
 *
 * Também não cobre o caminho do ADIAMENTO em si — esse continua provado onde é
 * determinístico, nos invariantes com relógio injetado. Fixar a janela no rig
 * não desliga o anti-ban do produto; declara a entrada do teste.
 */

const RAIZ = process.cwd();
const DIR_E2E = path.join(RAIZ, "tests/e2e");
const SEED = "scripts/seed-e2e-numero-conectado.ts";

/**
 * Specs dispensadas, com o motivo escrito. Esta lista SÓ ENCOLHE — cada entrada
 * é dívida declarada.
 */
const DISPENSADAS: Record<string, string> = {};

/**
 * Os sinais de que a spec depende de uma automação EXECUTAR.
 *
 * ⚠️ Lista ABERTA, e isso é lição paga: o detector da guarda irmã precisou
 * crescer depois de nascer, porque uma spec dependia da mesma grandeza sem ter
 * nenhum dos sinais escolhidos na primeira versão. Quem acrescentar um caminho
 * novo de automação acrescenta o sinal aqui.
 *
 * Não procuramos `new Date()` no fonte da spec: a dependência não está no que a
 * spec escreve, está no que o motor faz por baixo dela. Uma spec sem uma única
 * data pode depender inteiramente da hora — as duas que originaram esta guarda
 * eram assim.
 */
function dependeDeAutomacaoExecutar(fonte: string): boolean {
  // Cria ou dispara automação, e afirma sobre o DESFECHO dela.
  const mexeComAutomacao =
    /automation-rules|Nova automação|Nova regra|aba-atividade|ActivityTab/.test(fonte) ||
    /event-log-drain/.test(fonte);
  const afirmaSobreODesfecho =
    /getByText\("(Sucesso|Falhou|Parcial|Aguardando envio)"\)/.test(fonte) ||
    /automation_rule_runs|status.*Sucesso na aba/.test(fonte);
  return mexeComAutomacao && afirmaSobreODesfecho;
}

function specsDeAutomacao(): string[] {
  return readdirSync(DIR_E2E)
    .filter((f) => f.endsWith(".spec.ts"))
    .filter((f) => dependeDeAutomacaoExecutar(readFileSync(path.join(DIR_E2E, f), "utf8")));
}

describe("spec que depende de envio não herda a hora de parede", () => {
  it("a varredura ENCONTRA specs — uma lista vazia passaria por vacuidade", () => {
    // O controle. Sem ele, quebrar o detector deixa a guarda VERDE sobre um
    // conjunto vazio, que é a forma mais silenciosa de uma guarda morrer.
    // O piso é 2 porque são exatamente as duas que originaram o defeito:
    // `automacao-diz-a-verdade` e `webhooks`.
    expect(specsDeAutomacao().length).toBeGreaterThanOrEqual(2);
  });

  it("o módulo que declara a janela existe e abre 0h-24h, domingo incluído", () => {
    // A régua depende de o seed de fato abrir a janela. Se alguém trocar os
    // valores por 7-22 "para ficar igual à produção", a guarda das specs
    // continuaria verde e o defeito voltaria inteiro.
    const fonte = readFileSync(path.join(RAIZ, SEED), "utf8");
    expect(fonte).toContain("export async function garantirJanelaSempreAberta");
    expect(fonte).toMatch(/window_start_hour:\s*0/);
    expect(fonte).toMatch(/window_end_hour:\s*24/);
    // Domingo é avaliado ANTES da faixa horária: sem isto o buraco volta um dia
    // por semana, e volta o dia inteiro.
    expect(fonte).toMatch(/allow_sunday:\s*true/);
  });

  it("a janela é aberta para TODAS as sessões da org, não só para a deste seed", () => {
    // Quem paga o adiamento nem sempre é quem envia: a pré-checagem do motor é
    // all-or-nothing sobre o evento. Abrir só um canal conserta por acidente —
    // enquanto ele for o único — e reabre o buraco na próxima sessão semeada.
    const fonte = readFileSync(path.join(RAIZ, SEED), "utf8");
    const corpo = fonte.slice(fonte.indexOf("garantirJanelaSempreAberta"));
    expect(corpo).toContain('.from("channel_sessions")');
    expect(corpo).toMatch(/\.eq\("organization_id", orgId\)/);
  });

  it("toda spec que depende de automação executar roda o seed que declara a janela", () => {
    const faltando: string[] = [];
    for (const spec of specsDeAutomacao()) {
      if (spec in DISPENSADAS) continue;
      const fonte = readFileSync(path.join(DIR_E2E, spec), "utf8");
      if (!fonte.includes(SEED)) faltando.push(spec);
    }

    expect(
      faltando,
      `estas specs dependem de uma automação executar e não rodam \`${SEED}\`, ` +
        "que é quem declara a janela de envio do rig. Sem ele, elas passam de dia e " +
        "reprovam a partir das 22h — em qualquer branch, inclusive na main. " +
        "Rode o seed no `beforeAll`, ou declare a dispensa em DISPENSADAS, com o motivo.",
    ).toEqual([]);
  });
});
