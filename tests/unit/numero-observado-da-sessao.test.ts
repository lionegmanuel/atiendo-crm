import { describe, expect, it } from "vitest";

import { numeroObservadoDaSessao } from "@/lib/channels/numero-observado";

/**
 * ─── O defeito, medido numa instalação real ────────────────────────────────
 *
 * A rota de saúde gravava o número só quando a coluna estava VAZIA
 * (`if (jid && !phoneNumber)`). O primeiro pareamento gravava; dali em diante o
 * valor era imutável. Re-parear com outro aparelho — o que o dono faz toda vez
 * que o WhatsApp cai — deixava o banco mentindo para sempre.
 *
 * O que se mediu: a conexão de produção atendia `551148633324`, o banco dizia
 * `553198966398` (um pareamento anterior, de OUTRA organização), e os 23 avisos
 * abertos na Central nomeavam o número errado. O aviso existe para responder
 * "QUAL conexão caiu?"; com o dado errado ele manda pegar o celular errado.
 */
const LIA = "551148633324";
const ANTIGO = "553198966398";

describe("qual número o transporte está mesmo atendendo", () => {
  it("corrige o número quando o aparelho muda — o defeito medido", () => {
    expect(
      numeroObservadoDaSessao({
        jid: `${LIA}@c.us`,
        statusAoVivo: "WORKING",
        gravado: ANTIGO,
      }),
    ).toBe(LIA);
  });

  it("preenche quando ainda não havia nada — o caso que já funcionava", () => {
    expect(
      numeroObservadoDaSessao({ jid: `${LIA}@c.us`, statusAoVivo: "WORKING", gravado: null }),
    ).toBe(LIA);
  });

  it("FORA de WORKING não grava: o `me` é o do último pareamento que vingou", () => {
    // Medido no mesmo dia: com DUAS sessões em FAILED, a API do WAHA devolvia o
    // MESMO `me` para as duas — o de uma delas. Gravar ali trocaria um número
    // errado por outro, e ainda poderia bater na trava de número único do banco.
    for (const status of ["FAILED", "STOPPED", "STARTING", "SCAN_QR_CODE"]) {
      expect(
        numeroObservadoDaSessao({ jid: `${ANTIGO}@c.us`, statusAoVivo: status, gravado: LIA }),
      ).toBe(LIA);
    }
  });

  it("status ausente também não grava — sem observação não há o que afirmar", () => {
    expect(
      numeroObservadoDaSessao({ jid: `${ANTIGO}@c.us`, statusAoVivo: null, gravado: LIA }),
    ).toBe(LIA);
  });

  it("sem jid mantém o que está gravado", () => {
    expect(
      numeroObservadoDaSessao({ jid: null, statusAoVivo: "WORKING", gravado: LIA }),
    ).toBe(LIA);
  });

  it("jid sem parte local não APAGA o número que a tela já mostrava", () => {
    expect(
      numeroObservadoDaSessao({ jid: "@c.us", statusAoVivo: "WORKING", gravado: LIA }),
    ).toBe(LIA);
  });

  it("aceita o status em minúsculas — o vocabulário vem do transporte", () => {
    expect(
      numeroObservadoDaSessao({ jid: `${LIA}@c.us`, statusAoVivo: "working", gravado: ANTIGO }),
    ).toBe(LIA);
  });
});

describe("o call site — guardar a função não basta se a rota não a usa", () => {
  it("a rota de saúde da conexão chama a função, e não grava o jid na mão", async () => {
    const { readFileSync } = await import("node:fs");
    const fonte = readFileSync("app/api/v1/channel-sessions/[id]/route.ts", "utf-8");
    expect(fonte).toContain("numeroObservadoDaSessao({");
    // A forma antiga, que é o defeito: preencher só quando está vazio.
    expect(fonte).not.toMatch(/if\s*\(jid\s*&&\s*!phoneNumber\)/);
  });
});
