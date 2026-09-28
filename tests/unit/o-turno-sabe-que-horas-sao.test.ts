import { describe, expect, it, vi } from "vitest";

import { renderAgora, rotuloLocal } from "@/lib/tempo/agora";
import { FUSO_PADRAO } from "@/lib/tempo/fusos";
import { fusoDaOrganizacao } from "@/lib/agent-engine/agent/fuso-da-org";

/**
 * O MODELO PRECISA SABER QUE DIA É HOJE — e no fuso de quem instalou.
 *
 * ─── O defeito ──────────────────────────────────────────────────────────────
 *
 * O ritual de abertura do turno entregava checkpoint, funil, notas e histórico,
 * e nenhum relógio. Sem data, "quinta às 14h" não vira `starts_at`, e
 * `crm_book_appointment` nunca é chamada — o agente cai no "vou confirmar com a
 * equipe" e a consulta não é marcada. Medido numa instalação real: o dono do
 * produto escreveu no system prompt do agente dele um parágrafo inteiro
 * ensinando a IA a inferir a data pelo carimbo da última mensagem.
 *
 * ─── O INSTANTE DE PROVA, e por que é este ─────────────────────────────────
 *
 * `2026-09-04T03:30:00Z` foi escolhido porque cai em dias DIFERENTES nos dois
 * fusos do mesmo país:
 *
 *   America/Sao_Paulo (-3) → sexta-feira, 04/09/2026, 00:30
 *   America/Manaus    (-4) → quinta-feira, 03/09/2026, 23:30
 *
 * Um instante do meio da tarde passaria com uma implementação que ignorasse o
 * fuso e imprimisse o UTC cru — a hora sairia errada, mas o DIA DA SEMANA
 * bateria, e é o dia da semana que a pessoa diz ao marcar. Aqui não: com o fuso
 * ignorado, o bloco diria "sexta" para a clínica de Manaus na quinta à noite, e
 * o teste reprova. É o caso de controle do arquivo — sem ele, `toISOString()`
 * cru passaria.
 */

/** Sexta em São Paulo, quinta em Manaus — ver o cabeçalho. */
const INSTANTE = new Date("2026-09-04T03:30:00Z");

describe("renderAgora — o bloco que diz ao modelo que horas são", () => {
  it("dá o dia da semana por extenso, a data e a hora locais", () => {
    const bloco = renderAgora(INSTANTE, "America/Sao_Paulo");

    expect(bloco).toContain("## Agora");
    expect(bloco).toContain("sexta-feira, 04/09/2026, 00:30 (America/Sao_Paulo)");
  });

  it("O FUSO MUDA O DIA — o mesmo instante é quinta em Manaus e sexta em São Paulo", () => {
    // O caso de controle do arquivo. Com o fuso ignorado, os dois blocos seriam
    // idênticos e este `not` é o único que reprovaria.
    const sp = renderAgora(INSTANTE, "America/Sao_Paulo");
    const manaus = renderAgora(INSTANTE, "America/Manaus");

    expect(sp).toContain("sexta-feira, 04/09/2026, 00:30");
    expect(manaus).toContain("quinta-feira, 03/09/2026, 23:30");
    expect(sp).not.toEqual(manaus);
  });

  it("entrega o instante absoluto no formato que as ferramentas exigem de volta", () => {
    // `crm_book_appointment.starts_at` e `crm_schedule_followup.promised_at` são
    // `z.string().datetime({ offset: true })`. O modelo copia daqui em vez de
    // montar — e montar é onde ele erra o fuso.
    expect(renderAgora(INSTANTE, "America/Sao_Paulo")).toContain(
      "instante_absoluto: 2026-09-04T03:30:00.000Z",
    );
  });

  it("fuso inválido NÃO derruba o turno — degrada para o padrão", () => {
    // `America/Asunción` com acento é o caso real que `lib/tempo/fusos.ts`
    // documenta: `Intl.DateTimeFormat` lança `RangeError`. Este bloco é montado
    // ANTES da chamada de modelo; um throw aqui mata o atendimento inteiro e o
    // sintoma chega ao dono como agente mudo.
    expect(() => renderAgora(INSTANTE, "America/Asunción")).not.toThrow();
    // ⚠️ NÃO BASTA CONFERIR O RÓTULO ENTRE PARÊNTESES. Este caso já foi assim, e
    // uma sabotagem o pegou passando: `renderAgora` que colasse
    // "(America/Sao_Paulo)" no texto e formatasse a hora em UTC ficava verde.
    // O que prova a degradação é a SAÍDA ser idêntica à do fuso padrão.
    const comPadrao = renderAgora(INSTANTE, FUSO_PADRAO);
    expect(renderAgora(INSTANTE, "America/Asunción")).toBe(comPadrao);
    expect(renderAgora(INSTANTE, "")).toBe(comPadrao);
  });

  it("não cita ferramenta interna — o bloco entra no prompt de todo turno", () => {
    // A abertura já é varrida por `entrega-de-capacidade.test.ts`, que exige que
    // o nome de uma ferramenta ENTREGUE ao Operador não sobre no texto. Um bloco
    // novo que citasse tool furaria aquela guarda por uma porta que ela não olha.
    const bloco = renderAgora(INSTANTE, "America/Sao_Paulo");
    for (const nome of ["update_lead_state", "save_lead_note", "send_message", "crm_"]) {
      expect(bloco).not.toContain(nome);
    }
  });
});

/** Dublê de `Queryable` — a assinatura mínima que o motor usa (pg.Pool a satisfaz). */
function bancoQueDevolve(timezone: string | null | undefined) {
  return {
    query: vi.fn().mockResolvedValue({ rows: timezone === undefined ? [] : [{ timezone }] }),
  } as never;
}

describe("fusoDaOrganizacao — de onde sai o fuso, e o que acontece quando ele não presta", () => {
  it("usa a coluna da organização", async () => {
    expect(await fusoDaOrganizacao(bancoQueDevolve("America/Manaus"), "org-1")).toBe(
      "America/Manaus",
    );
  });

  it("valor que o Intl recusa vira o padrão, e o motivo vai ao log", async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    expect(await fusoDaOrganizacao(bancoQueDevolve("America/Asunción"), "org-1", log)).toBe(
      FUSO_PADRAO,
    );
    // Sem o log, a organização que digitou o fuso errado veria horário de São
    // Paulo para sempre e nada explicaria por quê.
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0]?.[1]).toMatchObject({ fuso_recusado: "America/Asunción" });
  });

  it("organização sem linha, ou com a coluna vazia, cai no padrão sem lançar", async () => {
    expect(await fusoDaOrganizacao(bancoQueDevolve(undefined), "org-1")).toBe(FUSO_PADRAO);
    expect(await fusoDaOrganizacao(bancoQueDevolve(null), "org-1")).toBe(FUSO_PADRAO);
    expect(await fusoDaOrganizacao(bancoQueDevolve("   "), "org-1")).toBe(FUSO_PADRAO);
  });

  it("FALHA ABERTA: banco fora do ar não derruba o turno", async () => {
    // Um clone que atualizou o código antes do schema, ou um instante de banco
    // indisponível, não pode custar o atendimento de um cliente.
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const bancoQuebrado = {
      query: vi.fn().mockRejectedValue(new Error('relation "organizations" does not exist')),
    } as never;

    expect(await fusoDaOrganizacao(bancoQuebrado, "org-1", log)).toBe(FUSO_PADRAO);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});

describe("rotuloLocal — o horário que o agente OFERECE à pessoa", () => {
  it("põe o dia da semana e a hora da parede daquele fuso", () => {
    // 17:00Z = 14:00 em São Paulo, sexta.
    expect(rotuloLocal(new Date("2026-09-04T17:00:00Z"), "America/Sao_Paulo")).toBe(
      "sexta-feira 04/09 às 14:00",
    );
  });

  it("o FUSO MUDA O RÓTULO — é o controle que reprova o ISO cru", () => {
    const instante = new Date("2026-09-04T03:30:00Z");
    expect(rotuloLocal(instante, "America/Sao_Paulo")).toBe("sexta-feira 04/09 às 00:30");
    expect(rotuloLocal(instante, "America/Manaus")).toBe("quinta-feira 03/09 às 23:30");
  });

  it("não leva ano nem instante técnico — isso é do bloco do turno, não de cada horário", () => {
    // Ele se repete uma vez por horário oferecido; o ISO já vai no campo ao lado.
    const r = rotuloLocal(new Date("2026-09-04T17:00:00Z"), "America/Sao_Paulo");
    expect(r).not.toContain("2026");
    expect(r).not.toContain("instante_absoluto");
  });

  it("fuso inválido degrada em vez de derrubar a lista de horários", () => {
    expect(() => rotuloLocal(new Date("2026-09-04T17:00:00Z"), "America/Asunción")).not.toThrow();
  });
});
