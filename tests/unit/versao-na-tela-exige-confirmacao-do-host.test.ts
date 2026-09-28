import { describe, expect, it } from "vitest";

import { RUN_STALE_AFTER_MS, sucessoJaInstalado } from "@/lib/system/update-run";

/**
 * A VERSÃO QUE A TELA PODE AFIRMAR — e a que ela só pode PEDIR.
 *
 * ─── O caso medido, com os números dele ────────────────────────────────────
 *
 * `1.32.0` na tela, `1.23.0` no container. O run de atualização terminou com
 * `success`, o host nunca voltou a bater o heartbeat (agente morto, cron
 * removido, token vencido), e a tela continuou anunciando a versão do run como
 * se fosse a que está no ar. Quem olhava aquela tela não tinha como saber que o
 * container seguia velho.
 *
 * A causa é a assunção de `sucessoJaInstalado`: enquanto o host não reporta,
 * vale a `to_version` do run. Ela existe por uma razão boa — `run_result` fecha
 * o run e NÃO escreve `current_version` (quem escreve é o heartbeat, de 5 em 5
 * minutos), e sem a assunção a tela oferecia "Atualizar agora" para a versão
 * que acabou de ser instalada. O prazo resolve o conflito sem jogar a razão
 * fora: dentro da validade a tela não reoferece nada; passada a validade, quem
 * fala pela versão em execução volta a ser o host.
 *
 * ─── Os dois lados, e onde cada um chega na tela ───────────────────────────
 *
 * Estas funções são o portão: o retorno delas vira `just_updated` em
 * `app/api/v1/system/version/route.ts`, e é esse campo que o
 * `_components/UpdatePanel.tsx` usa para escolher o que dizer.
 *
 *   1. HOST NÃO CONFIRMA (o defeito desta issue): com a validade vencida, o
 *      portão fecha. A tela cai no estado normal, cuja versão em execução é
 *      `current_version` — a última que o host confirmou. A `to_version`
 *      continua viajando no run, e a tela a nomeia como PEDIDO, nunca como
 *      versão instalada.
 *   2. HOST CONFIRMA: na primeira batida depois do run, `current_version` passa
 *      a ser a versão nova e a coluna fica mais nova que o `finished_at`. O
 *      portão fecha sozinho e a versão afirmada é a do HOST — a mesma que ele
 *      escreveu, sem intermediação do run.
 *
 * O que a tela NUNCA faz, nos dois casos: afirmar como instalada uma versão
 * que o host não confirmou.
 */
const FIM = "2026-09-01T12:00:00.000Z";

/** O run que terminou bem: pediu `1.32.0`. Pedido, não fato. */
const RUN = { status: "success", to_version: "1.32.0" };

/** O que o host escreveu por último em `current_version` — e ficou nisso. */
const HOST_CONFIRMOU_POR_ULTIMO = "2026-08-20T09:00:00.000Z";

/** Uma batida de heartbeat dentro da validade da assunção. */
const DENTRO_DA_VALIDADE = new Date(Date.parse(FIM) + 60_000);

/** A primeira batida possível DEPOIS da validade: é aqui que ela perde a vez. */
const PASSADA_A_VALIDADE = new Date(Date.parse(FIM) + RUN_STALE_AFTER_MS + 1_000);

describe("a tela não afirma como instalada uma versão que o host não confirmou", () => {
  it("host calado além do prazo: a versão do run deixa de falar pela versão no ar", () => {
    expect(sucessoJaInstalado(HOST_CONFIRMOU_POR_ULTIMO, FIM, RUN, PASSADA_A_VALIDADE)).toBe(false);
  });

  it("host calado, mas dentro do prazo: a tela sabe que terminou — sem afirmar a versão nova", () => {
    // Este é o degrau que o prazo NÃO pode quebrar: aqui o botão continuaria
    // mandando instalar de novo o que o run acabou de instalar.
    expect(sucessoJaInstalado(HOST_CONFIRMOU_POR_ULTIMO, FIM, RUN, DENTRO_DA_VALIDADE)).toBe(true);
  });

  it("a fronteira é fechada: no último instante da validade o run ainda atende", () => {
    const limite = new Date(Date.parse(FIM) + RUN_STALE_AFTER_MS);
    expect(sucessoJaInstalado(HOST_CONFIRMOU_POR_ULTIMO, FIM, RUN, limite)).toBe(true);
  });

  it("host confirmou o `to_version` do run: a versão afirmada passa a ser a dele", () => {
    // A confirmação chega como `current_version = 1.32.0` com `updated_at`
    // depois do `finished_at` — e o portão fecha, porque quem tem a palavra
    // final sobre a versão em execução é o host.
    expect(sucessoJaInstalado("2026-09-01T12:05:00.000Z", FIM, RUN, DENTRO_DA_VALIDADE)).toBe(false);
  });

  it("host confirmou, mas OUTRA versão (o container ficou na antiga) também vence", () => {
    // O heartbeat chegou — só que contando a verdade incômoda: subiu `1.23.0`
    // ou nem subiu. A tela não pode completar a frase do host.
    expect(sucessoJaInstalado("2026-09-01T12:05:00.000Z", FIM, RUN, PASSADA_A_VALIDADE)).toBe(false);
  });

  it("sem heartbeat nunca: ausência de confirmação não é confirmação", () => {
    expect(sucessoJaInstalado(null, FIM, RUN, PASSADA_A_VALIDADE)).toBe(false);
  });
});
