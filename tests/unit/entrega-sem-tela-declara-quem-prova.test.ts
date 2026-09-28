import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * FRENTE SEM TELA DECLARA QUEM A PROVA EM TELA — e o endereço tem de existir.
 *
 * ## Por que este teste existe
 *
 * A doutrina de QA Visual deste repo diz que nada é pronto sem prova em tela.
 * Uma camada de API não tem pixel: ela não consegue cumprir isso sozinha, e se
 * depender da tela para fechar, vira dependência circular com quem depende dela
 * para existir.
 *
 * A DECISÃO 21 da entrega da Agenda resolveu assim: a frente sem tela fecha com
 * prova de caminho real **declarando o nome da spec** que vai cobri-la em tela.
 * A obrigação não some — ela ganha endereço.
 *
 * ## E por que ele NÃO é burocracia
 *
 * Sem este gate, a DECISÃO 21 depende da disciplina de quem escreve o relatório:
 * basta citar uma spec que não existe, ou que nunca vai existir, e a dívida
 * evapora sem ninguém ver. Foi o próprio @Maestro quem apontou, aplicando à
 * governança a conclusão que a entrega tirou da infraestrutura:
 *
 *   **regra não protege quem a escreve; mecanismo protege.**
 *
 * É a mesma tese que levou o time de "avisar antes de subir o banco" para
 * "subir stack com nome próprio" — e de "lembrar de escolher porta" para
 * "o daemon escolhe".
 *
 * ## O contrato
 *
 * QUALQUER `.md` de `evidence/calendario/` que contenha uma linha
 * `prova-em-tela: <caminho>` precisa que aquele caminho EXISTA e tenha teste.
 *
 * ⚠️ Varre TODO `.md` de propósito, e não só `ENTREGA-*`. O primeiro desenho
 * casava um padrão de nome — e o MaestroConexoes mediu que ZERO arquivos da
 * pasta o satisfaziam, incluindo o `PROVA-EM-TELA-do-maestro.md` que o próprio
 * autor deste gate havia escrito. Quem chegasse depois seguiria o precedente
 * visível e a declaração não seria varrida — não por má-fé, por seguir o
 * exemplo errado. E a ironia que ele nomeou fecha o argumento: um gate criado
 * sob a tese "regra não protege, mecanismo protege" estava pendurado numa
 * CONVENÇÃO DE NOME que ninguém mecanizou. Relatório
 * sem a linha não é cobrado aqui — quem cobra é a revisão; este teste garante
 * apenas que **endereço declarado é endereço real**.
 */
const RAIZ = process.cwd();
const PASTA = path.join(RAIZ, "evidence", "calendario");
const DECLARACAO = /^\s*prova-em-tela:\s*(\S+)\s*$/gim;

/**
 * A spec tem teste VIVO? — `test(`/`it(` que não seja `.skip` nem `.fixme`.
 *
 * Ponto cego medido pelo DevVivo no primeiro desenho deste gate: um arquivo de
 * zero bytes fechava a dívida, e `test.skip("depois eu faço")` fechava com cara
 * ainda melhor, porque parece trabalho começado. O gate provava que o CAMINHO
 * existia; não que existia TESTE.
 *
 * É a tese desta entrega aplicada mais um nível — mecanismo protege onde regra
 * não protegia, e o furo seguinte é sempre "o mesmo gesto com um comando a mais".
 */
function temTesteVivo(fonte: string): boolean {
  const semComentarios = fonte.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  return /(^|[^.\w])(test|it)\s*\(/.test(semComentarios);
}

/**
 * Os caminhos declarados num relatório.
 *
 * ⚠️ O `throw` não é defensivismo: `DECLARACAO` exige `(\S+)`, então um match
 * SEM grupo 1 é impossível por construção. Ele existe porque a alternativa
 * óbvia sob `noUncheckedIndexedAccess` — `m[1] ?? ""` — faz o gate ficar VERDE
 * pelo motivo errado: `existsSync(path.join(RAIZ, ""))` é a raiz do repo, que
 * sempre existe. Um instrumento que não sabe medir tem de vermelhecer, nunca
 * devolver "está tudo certo".
 */
function alvosDeclarados(conteudo: string): string[] {
  return [...conteudo.matchAll(DECLARACAO)].map((m) => {
    const alvo = m[1];
    if (alvo === undefined) throw new Error(`declaração casou sem alvo: ${m[0]}`);
    return alvo;
  });
}

describe("frente sem tela declara quem a prova em tela", () => {
  it("toda spec citada como prova-em-tela existe no disco", () => {
    if (!existsSync(PASTA)) return; // a entrega ainda não produziu evidência

    const quebrados: string[] = [];
    for (const arquivo of readdirSync(PASTA).filter((f) => f.endsWith(".md"))) {
      const conteudo = readFileSync(path.join(PASTA, arquivo), "utf-8");
      for (const alvo of alvosDeclarados(conteudo)) {
        if (!existsSync(path.join(RAIZ, alvo))) quebrados.push(`${arquivo} → ${alvo}`);
      }
    }

    expect(
      quebrados,
      "Relatório de entrega cita uma prova em tela que NÃO existe. A DECISÃO 21 " +
        "permite fechar frente sem pixel, mas o endereço declarado tem de ser real — " +
        "senão a obrigação evapora sem ninguém ver. Crie a spec ou corrija o caminho.",
    ).toEqual([]);
  });

  it("a spec citada tem teste DE VERDADE — arquivo vazio ou só .skip não fecha dívida", () => {
    if (!existsSync(PASTA)) return;

    const vazias: string[] = [];
    for (const arquivo of readdirSync(PASTA).filter((f) => f.endsWith(".md"))) {
      const conteudo = readFileSync(path.join(PASTA, arquivo), "utf-8");
      for (const alvo of alvosDeclarados(conteudo)) {
        const caminho = path.join(RAIZ, alvo);
        if (!existsSync(caminho)) continue; // o caso acima já cobre
        if (!temTesteVivo(readFileSync(caminho, "utf-8"))) vazias.push(`${arquivo} → ${alvo}`);
      }
    }

    expect(
      vazias,
      "A spec citada existe mas NÃO TEM TESTE VIVO — está vazia, ou só com .skip/.fixme. " +
        "`touch` fecharia a dívida sem provar nada, e `.skip` fecha com cara de trabalho começado. " +
        "Enquanto a frente está aberta, a spec pulada é o marcador legítimo (DECISÃO 21.3); " +
        "o relatório ENTREGA-*.md, porém, é o artefato de FECHAMENTO — escrevê-lo exige o teste real.",
    ).toEqual([]);
  });

  it("CONTROLE: a varredura alcança a pasta — zero relatórios não é verde de graça", () => {
    // O outro controle exercita a REGEX contra string literal. Este exercita a
    // VARREDURA: se ela deixar de enxergar a pasta, os dois casos acima ficam
    // verdes percorrendo lista vazia — e verde por instrumento morto é
    // indistinguível de verde por estar tudo certo. Buraco apontado pelo
    // MaestroConexoes, comparando com o gate do VPS, que afirma um piso de
    // arquivos justamente por isto.
    if (!existsSync(PASTA)) return;
    const lidos = readdirSync(PASTA).filter((f) => f.endsWith(".md"));
    expect(
      lidos.length,
      `A varredura não achou nenhum .md em evidence/calendario. Ou a pasta esvaziou, ` +
        `ou o filtro parou de casar — e nos dois casos os testes acima passam sem medir nada.`,
    ).toBeGreaterThan(0);
  });

  it("CONTROLE: o detector de spec-vazia enxerga uma spec vazia", () => {
    // Sem este par, o reforço acima pode nascer morto e ninguém ver — o mesmo
    // buraco que o controle da declaração evita para a outra metade.
    expect(temTesteVivo("")).toBe(false);
    expect(temTesteVivo('test.skip("depois eu faço", () => {});')).toBe(false);
    expect(temTesteVivo('test.fixme("quebrado", () => {});')).toBe(false);
    expect(temTesteVivo('test("marca pela tela", async ({ page }) => { await page.goto("/"); });')).toBe(true);
    expect(temTesteVivo('  it("faz algo", () => {});')).toBe(true);
  });

  it("CONTROLE: o detector enxerga uma declaração quebrada", () => {
    // Sem este caso, o teste acima fica verde se a regex parar de casar —
    // e verde por instrumento morto é indistinguível de verde por estar tudo certo.
    const amostra = "prova-em-tela: tests/e2e/nao-existe-de-proposito.spec.ts\n";
    const achados = [...amostra.matchAll(DECLARACAO)].map((m) => m[1]);
    expect(achados).toEqual(["tests/e2e/nao-existe-de-proposito.spec.ts"]);
    expect(existsSync(path.join(RAIZ, achados[0]!))).toBe(false);
  });
});
