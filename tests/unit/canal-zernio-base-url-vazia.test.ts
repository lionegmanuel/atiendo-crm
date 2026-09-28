/**
 * A BASE DA API DO CANAL INTERMEDIADO HONRA O CONTRATO DO `.env.example`.
 *
 * ## O defeito, e por que ele escapou de tudo
 *
 * `zernioBaseUrl()` resolvia com `??`. O `.env.example` entrega
 * `ZERNIO_API_BASE_URL=` VAZIA, com esta promessa escrita ao lado:
 *
 *     # Só para apontar para homologação. Vazio usa a produção do provedor.
 *
 * `??` não cumpre essa promessa. Ele só cai no padrão em `null`/`undefined`;
 * string vazia é valor e passa direto. Resultado medido, executando:
 *
 *     baseUrl resolvida: ""
 *     URL montada      : "/v1/inbox/conversations?account_id=x"
 *     fetch LANÇOU     : TypeError: Failed to parse URL
 *
 * Atingia quem fez `cp .env.example .env`, preencheu `ZERNIO_ACCOUNT_ID` e
 * `ZERNIO_API_KEY` para conectar o canal, e deixou o override como veio — que
 * é o caminho NORMAL, porque o próprio comentário diz que ele é só para
 * homologação. Todo envio pelo canal quebrava.
 *
 * Não escapava por um caminho só: a credencial da SESSÃO (token cifrado no
 * banco) chama esta mesma função, então configurar pela tela não salvava.
 *
 * ## Por que os gates existentes não pegaram
 *
 * A doutrina de QA deste repo manda testar com os envs opcionais **AUSENTES**,
 * e ausente SEMPRE funcionou — o `??` pega `undefined`. O estado que quebra é
 * **presente e vazio**, que é exatamente o que copiar o `.env.example`
 * produz. É o vão entre os dois que este arquivo fecha.
 *
 * E `ZERNIO_API_BASE_URL` não aparece em `lib/env.ts`: nada a valida no boot.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { zernioBaseUrl } from "@/lib/channels/zernio/credentials";

const CHAVE = "ZERNIO_API_BASE_URL";
const PRODUCAO = "https://zernio.com/api";

// O `.env.local` desta máquina entra no `process.env` via `vitest.setup.ts`,
// então o valor real precisa sair e voltar em volta de cada caso — senão o
// teste mede o ambiente de quem roda, não o código.
let original: string | undefined;
beforeEach(() => {
  original = process.env[CHAVE];
});
afterEach(() => {
  if (original === undefined) delete process.env[CHAVE];
  else process.env[CHAVE] = original;
});

describe("zernioBaseUrl honra o que o .env.example promete", () => {
  it("VAZIA cai na produção do provedor — a promessa escrita no .env.example", () => {
    process.env[CHAVE] = "";
    expect(zernioBaseUrl()).toBe(PRODUCAO);
  });

  it("AUSENTE cai na produção do provedor", () => {
    delete process.env[CHAVE];
    expect(zernioBaseUrl()).toBe(PRODUCAO);
  });

  it("só espaço em branco também cai na produção", () => {
    // Uma linha `ZERNIO_API_BASE_URL= ` com um espaço sobrando não é um
    // endereço, e montaria a mesma URL sem host.
    process.env[CHAVE] = "   ";
    expect(zernioBaseUrl()).toBe(PRODUCAO);
  });

  it("valor real continua vencendo — o override de homologação segue existindo", () => {
    // O caso que dá sentido aos de cima: a correção não pode ter matado o
    // motivo de a variável existir.
    process.env[CHAVE] = "https://homologacao.zernio.com/api";
    expect(zernioBaseUrl()).toBe("https://homologacao.zernio.com/api");
  });

  it("espaço em volta de um valor real é aparado, não herdado", () => {
    process.env[CHAVE] = "  https://homologacao.zernio.com/api  ";
    expect(zernioBaseUrl()).toBe("https://homologacao.zernio.com/api");
  });

  it("o que a função devolve monta uma URL ABSOLUTA — a falha era esta", () => {
    // A asserção que fecha a distância entre "resolveu para string vazia" e o
    // sintoma real. `new URL` recusa caminho relativo do mesmo jeito que o
    // `fetch` do Node recusava.
    process.env[CHAVE] = "";
    const url = `${zernioBaseUrl()}/v1/inbox/conversations`;
    expect(() => new URL(url)).not.toThrow();
    expect(new URL(url).host).toBe("zernio.com");
  });
});
