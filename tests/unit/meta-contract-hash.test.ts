/**
 * O hash é a âncora da trava por obsolescência: config salva aponta para um
 * `contract_hash`, e hash divergente = alguém editou o template na Meta.
 *
 * Os dois modos de errar são simétricos e ambos fatais:
 *   - hash INSTÁVEL (muda por reordenação de chave ou por vírgula no texto) faz
 *     toda config virar obsoleta a cada sync → alarme falso permanente → alguém
 *     desliga a trava;
 *   - hash SURDO (não muda quando o contrato muda) deixa a config obsoleta passar
 *     → o 132000 volta em produção, que é o estado atual do TomikCRM.
 */
import { describe, expect, it } from "vitest";
import { hashContract } from "@/lib/channels/meta/contract-hash";

describe("hashContract", () => {
  it("é estável a reordenação de chaves — senão toda config vira obsoleta a cada sync", () => {
    const a = [{ type: "BODY", text: "Oi {{1}}" }];
    const b = [{ text: "Oi {{1}}", type: "BODY" }];
    expect(hashContract(a)).toBe(hashContract(b));
  });

  it("muda quando um placeholder é ACRESCENTADO", () => {
    const antes = [{ type: "BODY", text: "Oi {{1}}" }];
    const depois = [{ type: "BODY", text: "Oi {{1}}, pedido {{2}}" }];
    expect(hashContract(antes)).not.toBe(hashContract(depois));
  });

  it("muda quando o FORMATO do header muda (o caso do 132012)", () => {
    const texto = [{ type: "HEADER", format: "TEXT", text: "Oi" }];
    const imagem = [{ type: "HEADER", format: "IMAGE" }];
    expect(hashContract(texto)).not.toBe(hashContract(imagem));
  });

  it("é estável a mudança de texto que NÃO afeta parâmetro", () => {
    // Corrigir uma vírgula no corpo não deve invalidar a config de ninguém.
    const a = [{ type: "BODY", text: "Olá {{1}}, tudo bem?" }];
    const b = [{ type: "BODY", text: "Olá {{1}} tudo bem?" }];
    expect(hashContract(a)).toBe(hashContract(b));
  });

  it("muda quando a Meta troca POSITIONAL por NAMED, com os MESMOS components", () => {
    // Discordância com o plano, registrada no HANDOFF: a assinatura do plano
    // (`hashContract(components)`) põe `parameterFormat` no payload canônico mas
    // não tem como fazê-lo variar — o campo entraria morto, e um hash com campo
    // morto MENTE sobre o que cobre.
    //
    // O caso é real e não hipotético: `parameter_format` é declarado pela Meta e
    // MUDA o payload de envio (NAMED exige `parameter_name` em cada parâmetro).
    // Uma config salva sob POSITIONAL continua "válida" pelo hash depois do flip,
    // e todo envio passa a falhar — exatamente a classe de defeito que esta fase
    // existe para matar. O comentário de `template-contract.ts` já avisa que
    // template NAMED com chave numérica existe, então os slots podem ser idênticos.
    const components = [{ type: "BODY", text: "Oi {{1}}" }];
    expect(hashContract(components, "POSITIONAL")).not.toBe(hashContract(components, "NAMED"));
  });

  it("omitir o formato é o mesmo que declarar POSITIONAL — é o default da Meta", () => {
    const components = [{ type: "BODY", text: "Oi {{1}}" }];
    expect(hashContract(components)).toBe(hashContract(components, "POSITIONAL"));
  });
});
