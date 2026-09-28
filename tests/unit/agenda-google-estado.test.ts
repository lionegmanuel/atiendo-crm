/**
 * O `state` do OAuth do Google — o que impede que o retorno seja forjado, e o
 * que diz DE QUEM é a agenda que acabou de ser autorizada.
 *
 * A agenda do Google é por PESSOA (`unique (organization_id, user_id, provider,
 * account_email)`), não por organização. Sem o `user_id` assinado dentro do
 * state, o callback teria de adivinhar — e a agenda de um atendente entraria
 * como a de outro, sem erro nenhum na tela.
 */
import { describe, expect, it } from "vitest";

import { VALIDADE_DO_ESTADO_MS, emitirEstado, verificarEstado } from "@/lib/agenda/google/estado";

const SEGREDO = "um-segredo-de-instalacao-bem-comprido";
const OUTRO_SEGREDO = "outro-segredo-de-instalacao-bem-comprido";
const AGORA = new Date("2026-08-26T12:00:00.000Z");
const DADOS = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  userId: "99999999-9999-4999-8999-999999999999",
};

describe("emitirEstado / verificarEstado", () => {
  it("leva a organização E a pessoa de volta", () => {
    const state = emitirEstado(DADOS, { segredo: SEGREDO, agora: AGORA });
    const lido = verificarEstado(state, { segredo: SEGREDO, agora: AGORA });
    expect(lido).toMatchObject(DADOS);
  });

  it("recusa assinatura de outra chave", () => {
    const state = emitirEstado(DADOS, { segredo: SEGREDO, agora: AGORA });
    expect(verificarEstado(state, { segredo: OUTRO_SEGREDO, agora: AGORA })).toBeNull();
  });

  it("recusa carga adulterada — trocar a pessoa quebra a assinatura", () => {
    const state = emitirEstado(DADOS, { segredo: SEGREDO, agora: AGORA });
    const [carga, assinatura] = state.split(".");
    if (!carga || !assinatura) throw new Error("state emitido fora do formato esperado");
    const cargaAberta = Buffer.from(carga, "base64url").toString("utf8");
    const forjada = Buffer.from(
      cargaAberta.replace(DADOS.userId, "88888888-8888-4888-8888-888888888888"),
      "utf8",
    ).toString("base64url");
    expect(verificarEstado(`${forjada}.${assinatura}`, { segredo: SEGREDO, agora: AGORA })).toBeNull();
  });

  it("vence: dez minutos é o tempo de atravessar a tela de consentimento", () => {
    const state = emitirEstado(DADOS, { segredo: SEGREDO, agora: AGORA });
    const quaseLa = new Date(AGORA.getTime() + VALIDADE_DO_ESTADO_MS);
    expect(verificarEstado(state, { segredo: SEGREDO, agora: quaseLa })).not.toBeNull();
    expect(verificarEstado(state, { segredo: SEGREDO, agora: new Date(quaseLa.getTime() + 1) })).toBeNull();
  });

  it("devolve o nonce, que é o que permite queimá-lo", () => {
    const state = emitirEstado(DADOS, { segredo: SEGREDO, agora: AGORA, nonce: "nonce-de-teste" });
    expect(verificarEstado(state, { segredo: SEGREDO, agora: AGORA })?.nonce).toBe("nonce-de-teste");
  });

  // A DÍVIDA DECLARADA AQUI FOI PAGA — em outro arquivo, e é isso que importa.
  //
  // Este bloco teve duas versões erradas antes desta. A primeira era um teste
  // que AFIRMAVA o defeito ("aqui ele não é queimado"), o que transforma dívida
  // em contrato: quem consertasse faria o caso vermelhecer e o caminho barato
  // seria consertar de volta. A segunda era um `skip` descrevendo o
  // comportamento desejado — melhor, mas ainda no lugar errado.
  //
  // O lugar errado importa: a queima não é desta camada. `verificarEstado` é
  // pura e não tem banco; quem queima é o callback, que grava o nonce em
  // `calendar_oauth_nonces` (migration 0190) ANTES de trocar o código. A guarda
  // real vive em `tests/unit/agenda-google-callback-route.test.ts`, com o caso
  // do `23505` e o da ordem.
  //
  // O que sobra aqui é o que esta camada de fato garante: devolver o nonce, que
  // é o que torna a queima possível.
  it("dois states do mesmo par de ids são diferentes", () => {
    const a = emitirEstado(DADOS, { segredo: SEGREDO, agora: AGORA });
    const b = emitirEstado(DADOS, { segredo: SEGREDO, agora: AGORA });
    expect(a).not.toBe(b);
  });

  it("recusa lixo sem lançar", () => {
    const opcoes = { segredo: SEGREDO, agora: AGORA };
    for (const lixo of [null, undefined, "", "sem-ponto", "a.b.c", "!!!.zzz"]) {
      expect(() => verificarEstado(lixo, opcoes)).not.toThrow();
      expect(verificarEstado(lixo, opcoes)).toBeNull();
    }
  });

  it("sem segredo de verdade, RECUSA emitir em vez de fingir proteção", () => {
    // O precedente da casa cai numa chave aleatória por processo quando o
    // segredo falta. Numa VPS com mais de uma réplica, o state emitido por um
    // processo não valida no outro — e o sintoma é "conectei e deu erro" de
    // forma intermitente, sem nada no log que aponte a causa.
    expect(() => emitirEstado(DADOS, { segredo: "", agora: AGORA })).toThrow(/INTERNAL_SECRET/);
    expect(() => emitirEstado(DADOS, { segredo: "curto", agora: AGORA })).toThrow(/INTERNAL_SECRET/);
  });

  it("recusa emitir sem a pessoa, ou com id que quebraria o separador", () => {
    expect(() => emitirEstado({ ...DADOS, userId: "" }, { segredo: SEGREDO, agora: AGORA })).toThrow(
      /organizationId e userId/,
    );
    expect(() =>
      emitirEstado({ ...DADOS, organizationId: "org.com.ponto" }, { segredo: SEGREDO, agora: AGORA }),
    ).toThrow(/ponto/);
  });
});
