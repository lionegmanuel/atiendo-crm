/**
 * A JANELA DE ENVIO DA AUTOMAÇÃO — o que este arquivo guarda, e por quê.
 *
 * Ele substitui os casos de `throttle.test.ts` que exercitavam
 * `withinSendWindow()` / `nextWindowStart()`, removidas junto com esta mudança.
 * Aqueles casos eram VERDES sobre um defeito: escreviam
 * `new Date("2026-07-17T10:00:00")` — sem `Z`, portanto lido no fuso do
 * processo — contra uma função que também lia `getHours()` no fuso do processo.
 * Dois erros que se cancelavam, e por isso a suíte não tinha como enxergar que
 * a janela de produção era 4h–19h de Brasília num contêiner em UTC.
 *
 * Aqui todo instante é ABSOLUTO (termina em `Z`), e o caso central prova a
 * propriedade que a régua antiga não tinha: o resultado depende do fuso do
 * TENANT, não do relógio de quem roda o código.
 */
import { describe, it, expect, vi } from "vitest";

import { knobsDoCanal, adiarAteAJanelaAbrir } from "@/lib/automation/janela-do-canal";
import { PACING_DEFAULTS } from "@/lib/agent-engine/pacing/defaults";

/** Duplo do client: devolve `linha` (ou `erro`) para o `.maybeSingle()` da consulta. */
function admin(resposta: { data: unknown; error: { message: string } | null }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => resposta,
  };
  return { from: () => chain } as never;
}

const SEM_LINHA = admin({ data: null, error: null });
const ORG = "11111111-1111-4111-8111-111111111111";
const CANAL = "22222222-2222-4222-8222-222222222222";

describe("a régua é o fuso do TENANT, não o relógio de quem roda", () => {
  // 09:00Z é 06:00 em São Paulo (UTC-3) e 18:00 em Tóquio (UTC+9). Com a janela
  // padrão 7h–22h, o MESMO instante tem de dar respostas OPOSTAS.
  //
  // É exatamente isto que uma régua lida com `new Date().getHours()` não
  // consegue produzir: ela daria a mesma resposta para os dois, porque só
  // conhece um relógio — o do processo. Se alguém ressuscitar aquela régua,
  // este caso é o que reprova.
  const INSTANTE = new Date("2026-07-17T09:00:00Z");

  it("06h em São Paulo → fechada (adia)", async () => {
    const knobs = admin({
      data: { throttle_ms: null, jitter_max_ms: null, window_start_hour: null,
              window_end_hour: null, allow_sunday: null,
              timezone: "America/Sao_Paulo", warmup_daily_caps: null },
      error: null,
    });
    expect(await adiarAteAJanelaAbrir(knobs, ORG, CANAL, INSTANTE)).not.toBeNull();
  });

  it("18h em Tóquio → aberta (envia), no MESMO instante", async () => {
    const knobs = admin({
      data: { throttle_ms: null, jitter_max_ms: null, window_start_hour: null,
              window_end_hour: null, allow_sunday: null,
              timezone: "Asia/Tokyo", warmup_daily_caps: null },
      error: null,
    });
    expect(await adiarAteAJanelaAbrir(knobs, ORG, CANAL, INSTANTE)).toBeNull();
  });
});

describe("as duas horas que a régua antiga errava, em Brasília", () => {
  // 22:30Z = 19:30 em São Paulo. A régua antiga comparava 22 contra o fim da
  // janela (22) e FECHAVA: o envio das 19h30 ficava represado até as 4h da
  // manhã. Dentro de 7h–22h no fuso do tenant, ele sai na hora.
  it("19h30 de Brasília envia — antes ficava represado até as 4h", async () => {
    expect(await adiarAteAJanelaAbrir(SEM_LINHA, ORG, CANAL, new Date("2026-07-17T22:30:00Z")))
      .toBeNull();
  });

  // 08:00Z = 05:00 em São Paulo. A régua antiga via "8h", achava que estava
  // dentro de 7h–22h e MANDAVA — mensagem no celular do cliente às 5h da manhã.
  it("05h de Brasília adia — antes mandava mensagem de madrugada", async () => {
    const quando = await adiarAteAJanelaAbrir(SEM_LINHA, ORG, CANAL, new Date("2026-07-17T08:00:00Z"));
    expect(quando).not.toBeNull();

    // A próxima abertura é 7h de São Paulo do MESMO dia = 10:00Z — mais um
    // JITTER de até `jitterMaxMs`, que não é ruído e não deve ser cravado:
    // `proximaAberturaDaJanela` soma `jitterOf(Math.random)` de propósito.
    // Sem ele, cem automações represadas na madrugada abririam todas às
    // 07:00:00.000 do mesmo segundo — que é a assinatura de robô que a janela
    // existe para evitar. Por isso a asserção é de FAIXA, não de igualdade.
    const abertura = Date.parse("2026-07-17T10:00:00.000Z");
    const t = Date.parse(quando as string);
    expect(t).toBeGreaterThanOrEqual(abertura);
    expect(t).toBeLessThanOrEqual(abertura + PACING_DEFAULTS.jitterMaxMs);
  });
});

describe("o que o operador configurou em Conexões é o que vale", () => {
  it("janela apertada para 9h–18h fecha as 8h de Brasília", async () => {
    const knobs = admin({
      data: { throttle_ms: null, jitter_max_ms: null, window_start_hour: 9,
              window_end_hour: 18, allow_sunday: null,
              timezone: "America/Sao_Paulo", warmup_daily_caps: null },
      error: null,
    });
    // 11:00Z = 08:00 em São Paulo: dentro do padrão 7h–22h, fora do 9h–18h dele.
    expect(await adiarAteAJanelaAbrir(knobs, ORG, CANAL, new Date("2026-07-17T11:00:00Z")))
      .not.toBeNull();
  });

  it("domingo desligado adia o que cairia no domingo", async () => {
    const knobs = admin({
      data: { throttle_ms: null, jitter_max_ms: null, window_start_hour: null,
              window_end_hour: null, allow_sunday: false,
              timezone: "America/Sao_Paulo", warmup_daily_caps: null },
      error: null,
    });
    // 2026-07-19 é domingo. 15:00Z = 12:00 em São Paulo, em plena janela.
    expect(await adiarAteAJanelaAbrir(knobs, ORG, CANAL, new Date("2026-07-19T15:00:00Z")))
      .not.toBeNull();
  });
});

describe("quem nunca abriu a tela de Conexões", () => {
  it("sem linha em channel_knobs recebe os defaults do pacing", async () => {
    expect(await knobsDoCanal(SEM_LINHA, ORG, CANAL)).toEqual(PACING_DEFAULTS);
  });

  it("erro de leitura falha ABERTO — segue com os defaults, e não cala", async () => {
    const aviso = vi.spyOn(await import("@/lib/logger").then((m) => m.logger), "warn")
      .mockImplementation(() => {});
    const quebrado = admin({ data: null, error: { message: "connection reset" } });

    expect(await knobsDoCanal(quebrado, ORG, CANAL)).toEqual(PACING_DEFAULTS);
    // Falhar aberto na AÇÃO (a mensagem sai) mas nunca em silêncio: se a
    // leitura dos knobs parar de funcionar, o log é a única coisa que denuncia.
    expect(aviso).toHaveBeenCalledOnce();
    aviso.mockRestore();
  });
});
