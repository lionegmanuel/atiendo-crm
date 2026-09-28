/**
 * O transporte de WhatsApp da instalação, lido do ambiente.
 *
 * Este arquivo pode nomear o provedor — é o lado de dentro da fronteira que
 * `scripts/lint-channels.ts` guarda. Os casos vieram de
 * `lib/instalacao/ambiente.test.ts`, que nomeava as variáveis do lado de fora.
 */
import { describe, expect, it } from "vitest";

import { lerTransporteDeWhatsapp } from "@/lib/channels/transporte";

describe("o transporte de WhatsApp da instalação", () => {
  it("ambiente vazio não inventa nada", () => {
    expect(lerTransporteDeWhatsapp({})).toEqual({ apontado: false, comChave: false });
  });

  it("o valor de exemplo do repo NÃO conta como chave configurada", () => {
    // É o estado "ninguém trocou ainda". Contar como chave faria o diagnóstico
    // do passo 1 dizer que o WhatsApp está pronto num servidor onde ele nunca
    // subiu — e a pessoa iria parear um número contra um serviço que não existe.
    expect(
      lerTransporteDeWhatsapp({
        WAHA_API_BASE_URL: "http://waha:3000",
        WAHA_API_KEY: "dev_plaintext_change_me",
      }),
    ).toEqual({ apontado: true, comChave: false });
  });

  it("apontado e com chave de verdade", () => {
    expect(
      lerTransporteDeWhatsapp({
        WAHA_API_BASE_URL: "http://waha:3000",
        WAHA_API_KEY: "uma-chave-de-verdade",
      }),
    ).toEqual({ apontado: true, comChave: true });
  });

  it("chave sem endereço não basta — e vice-versa", () => {
    expect(lerTransporteDeWhatsapp({ WAHA_API_KEY: "x" }).apontado).toBe(false);
    expect(lerTransporteDeWhatsapp({ WAHA_API_BASE_URL: "http://waha:3000" }).comChave).toBe(false);
  });

  it("espaço em branco não é configuração", () => {
    expect(
      lerTransporteDeWhatsapp({ WAHA_API_BASE_URL: "   ", WAHA_API_KEY: "  " }),
    ).toEqual({ apontado: false, comChave: false });
  });
});
