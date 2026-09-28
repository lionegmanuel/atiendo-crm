import { describe, expect, it } from "vitest";

import { metaPodeReceber } from "@/lib/channels/meta/webhook";

/**
 * "PODE RECEBER" É AS DUAS METADES — e conferir uma só é o falso-verde que o
 * aviso existe para impedir.
 *
 * O passo do telefone, no primeiro acesso, avisa quando a instalação ainda não
 * consegue RECEBER pelo canal oficial. A primeira versão media
 * `Boolean(process.env.META_WEBHOOK_VERIFY_TOKEN)` — metade da condição.
 *
 * Os dois segredos têm papéis diferentes, medido na rota inteira e não no
 * helper (`app/api/v1/webhooks/meta/[token]/route.ts:63-66`):
 *
 *   sem META_WEBHOOK_VERIFY_TOKEN → o handshake GET falha; o webhook nem é aceito
 *   sem META_APP_SECRET           → o handshake GET devolve 200 e TODA mensagem
 *                                   inbound assinada devolve 401
 *                                   `invalid_signature`, com ZERO ingestão
 *
 * O segundo é o caro: quem preencheu só o verify token via a tela dizer que
 * está pronto, cadastra o número e não recebe nada — sem erro em lugar nenhum.
 * E nenhum dos dois é escrito pelo `install.sh` (`git grep 'META_' -- '*.sh'`
 * devolve vazio), então numa instalação nova os dois faltam.
 */

describe("metaPodeReceber — as duas metades, nunca uma", () => {
  it("com os dois segredos: pode receber", () => {
    expect(metaPodeReceber({ META_WEBHOOK_VERIFY_TOKEN: "vt", META_APP_SECRET: "as" })).toBe(true);
  });

  it("SÓ o verify token: NÃO pode — o handshake passa e a mensagem morre em 401", () => {
    // Este é o caso que a versão anterior deixava passar como pronto.
    expect(metaPodeReceber({ META_WEBHOOK_VERIFY_TOKEN: "vt" })).toBe(false);
  });

  it("SÓ o app secret: não pode — sem verify token o webhook nem é aceito", () => {
    expect(metaPodeReceber({ META_APP_SECRET: "as" })).toBe(false);
  });

  it("nenhum dos dois: é o estado de toda instalação recém-feita", () => {
    expect(metaPodeReceber({})).toBe(false);
  });

  it.each([
    ["string vazia", ""],
    ["só espaços", "   "],
  ])("%s é ausente, não configurado — o .env nasce com `CHAVE=`", (_nome, valor) => {
    // `Boolean("")` já seria false, mas `Boolean("   ")` é TRUE: sem o `.trim()`
    // uma chave com espaço passaria por preenchida. É o mesmo contrato de
    // `preenchida()` em lib/instalacao/ambiente.ts:61.
    expect(metaPodeReceber({ META_WEBHOOK_VERIFY_TOKEN: valor, META_APP_SECRET: "as" })).toBe(false);
    expect(metaPodeReceber({ META_WEBHOOK_VERIFY_TOKEN: "vt", META_APP_SECRET: valor })).toBe(false);
  });
});
