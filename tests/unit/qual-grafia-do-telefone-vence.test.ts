import { describe, expect, it } from "vitest";

import {
  escolherContatoCanonico,
  type ContatoCandidato,
} from "@/lib/channels/contato-por-telefone";
import { canonicalPhoneBR, phoneLookupVariants } from "@/lib/channels/phone-variants";

/**
 * QUAL GRAFIA DO TELEFONE VENCE — e por que o teste alimenta as DUAS ordens.
 *
 * ## O defeito
 *
 * Quatro sítios do repo buscavam o contato com
 * `.in("phone_number", variantes).limit(1)`, **sem `order by`**:
 *
 *   app/api/v1/webhooks/in/[token]/route.ts   (o que a issue #366 nomeia)
 *   lib/channels/contato-por-telefone.ts
 *   lib/channels/meta/ingest.ts
 *   lib/messaging/open-shared-contact-conversation.ts
 *
 * `+553284793302` e `+5532984793302` são a mesma pessoa e são DUAS linhas
 * enquanto a fusão da migration `0198` não passou por elas — estado que a
 * própria `0198` admite, ao chamar o seu passo 3 de "piso de segurança para o
 * unique". Sem ordenação, qual das duas volta é decisão do Postgres.
 *
 * O estrago: a resposta do cliente entra no cadastro errado, o follow-up não a
 * reconhece como resposta, e a mesma pergunta é enviada de novo — exatamente o
 * sintoma que a `0198` existe para acabar.
 *
 * ## Por que ALIMENTAR AS DUAS ORDENS é o teste, e não um capricho
 *
 * O defeito não é "devolve a linha X". É **"a saída depende da ordem em que as
 * linhas chegaram"**. Um teste que passasse uma ordem só mediria qual linha
 * volta naquela ordem — e passaria verde sobre o defeito, porque o código
 * antigo também devolveria algo. A propriedade só aparece comparando as duas
 * chamadas: mesma resposta, venha o par na ordem que vier.
 *
 * ## O que este arquivo NÃO cobre, declarado
 *
 * Mede a REGRA, que é pura. Não prova que o PostgREST devolve as duas linhas
 * (isso é `.in()` com `limit(4)`, e depende do banco), nem que a `0198` funde
 * os pares no backfill. O que ele garante é que, chegando o par, a escolha é
 * sempre a mesma e é a canônica.
 */

const SEM_NONO = "+553284793302";
const COM_NONO = "+5532984793302";

const linha = (id: string, phone: string | null): ContatoCandidato => ({
  id,
  phone_number: phone,
});

describe("a premissa: o par existe e uma das grafias é a canônica", () => {
  it("controle positivo — as duas grafias são variantes uma da outra", () => {
    // Sem isto, todo caso abaixo poderia estar medindo dois números que o
    // produto nem considera o mesmo contato.
    expect(phoneLookupVariants(SEM_NONO)).toContain(COM_NONO);
    expect(phoneLookupVariants(COM_NONO)).toContain(SEM_NONO);
  });

  it("a canônica é a COM o nono dígito, pelas duas entradas", () => {
    expect(canonicalPhoneBR(SEM_NONO)).toBe(COM_NONO);
    expect(canonicalPhoneBR(COM_NONO)).toBe(COM_NONO);
  });
});

describe("escolherContatoCanonico", () => {
  it("⭐ a ordem de chegada NÃO muda a resposta — é o defeito, em uma linha", () => {
    const a = linha("aaaa-1111", SEM_NONO);
    const b = linha("bbbb-2222", COM_NONO);

    const numaOrdem = escolherContatoCanonico([a, b], SEM_NONO);
    const naOutra = escolherContatoCanonico([b, a], SEM_NONO);

    expect(
      numaOrdem?.id,
      "a escolha mudou com a ordem das linhas — é exatamente o `.limit(1)` sem `order by`",
    ).toBe(naOutra?.id);
  });

  it("⭐ vence a grafia canônica, e não a que chegou primeiro", () => {
    const semNono = linha("aaaa-1111", SEM_NONO);
    const comNono = linha("bbbb-2222", COM_NONO);

    // O `id` do sem-nono ordena ANTES: se a regra fosse só "o menor id", este
    // caso passaria pelo motivo errado. É a canônica que tem de vencer.
    expect(escolherContatoCanonico([semNono, comNono], SEM_NONO)?.id).toBe("bbbb-2222");
    expect(escolherContatoCanonico([comNono, semNono], COM_NONO)?.id).toBe("bbbb-2222");
  });

  it("uma linha só é devolvida como está — inclusive a não-canônica", () => {
    // Quem tem só a grafia antiga continua sendo encontrado. Um conserto que
    // exigisse a canônica devolveria `null` aqui e perderia o contato.
    expect(escolherContatoCanonico([linha("x", SEM_NONO)], SEM_NONO)?.id).toBe("x");
  });

  it("sem candidatos, devolve null", () => {
    expect(escolherContatoCanonico([], SEM_NONO)).toBeNull();
  });

  it("nenhuma candidata canônica: a escolha é ARBITRÁRIA mas ESTÁVEL", () => {
    // Estado que não deveria existir. Devolver "qualquer uma" é o defeito;
    // devolver sempre a mesma é o conserto, mesmo sem preferência de negócio.
    const p = linha("zzzz-9999", null);
    const q = linha("mmmm-5555", null);
    expect(escolherContatoCanonico([p, q], SEM_NONO)?.id).toBe("mmmm-5555");
    expect(escolherContatoCanonico([q, p], SEM_NONO)?.id).toBe("mmmm-5555");
  });

  it("fixo e estrangeiro não têm par — e passam intactos", () => {
    const fixo = "+553132345678";
    expect(phoneLookupVariants(fixo)).toHaveLength(1);
    expect(escolherContatoCanonico([linha("f1", fixo)], fixo)?.id).toBe("f1");

    const gringo = "+14155550123";
    expect(phoneLookupVariants(gringo)).toHaveLength(1);
    expect(escolherContatoCanonico([linha("g1", gringo)], gringo)?.id).toBe("g1");
  });
});
