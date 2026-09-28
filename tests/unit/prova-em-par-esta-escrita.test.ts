/**
 * A doutrina do PAR continua escrita onde o aceite é pedido.
 *
 * A regra nasceu da validação da v1.12.0 (#489): um caso de aceite que atravessa
 * o agente de IA **mede o modelo, não a ferramenta** — o par é a unidade. O caso
 * `"quero 2 iphone 15"` passou por uma bateria que o esperava reprovar porque o
 * agente reformulou a consulta; a ferramenta, medida direto com o mesmo texto,
 * devolvia zero (#476, o defeito de origem).
 *
 * ── Por que um gate para uma regra de doutrina ───────────────────────────────
 *
 * Nada no runtime depende desta regra: ela é texto. E texto de doutrina morre
 * do jeito mais barato que existe — alguém reescreve o parágrafo para ficar
 * mais curto, ou apaga o bloco achando que ele repete o DoD 12. Nenhum teste
 * ficaria vermelho, e a próxima pessoa voltaria a declarar resolvido um defeito
 * real a partir de um verde que media outra coisa.
 *
 * O sintoma é visível a olho; o que este arquivo prende é a **volta**. Por isso
 * ele não pergunta "existe texto sobre agentes de IA?" — pergunta pelos **dois
 * lados do par**, pelo **mesmo texto cru**, e pelo **caso que a produziu**. A
 * regra pela metade é o defeito que ela existe para pegar.
 *
 * Escopo: os guias e checklists **onde o aceite é pedido** a quem vai medir. A
 * lei mora em `docs/doctrine/prova-em-par.md`, e o pre-voo de quem contribui
 * cita essa lei — o que este arquivo exige é que a emenda sobreviva nos dois
 * lados do espelho (`.agents/skills` fonte, `.claude/skills` espelho), que é o
 * que a pessoa carrega no CLI na hora de fechar o PR.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();

/** A lei. É dela que os guias descendem; ninguém a reescreve por aqui. */
const LEI = "docs/doctrine/prova-em-par.md";

/**
 * Onde a emenda tem de estar escrita: o passo de prova em tela do guia de
 * contribuição e o item correspondente do pré-voo (o checklist que a triagem
 * espelha). Os dois existem para a mesma pessoa no mesmo momento — por isso
 * exigem os dois.
 */
const GUIAS_DE_ACEITE = [
  ".agents/skills/deskcomm-contribuir/SKILL.md",
  ".agents/skills/deskcomm-contribuir/references/pre-voo.md",
  // Espelho do Claude Code: o mesmo texto, lido por outro CLI.
  ".claude/skills/deskcomm-contribuir/SKILL.md",
  ".claude/skills/deskcomm-contribuir/references/pre-voo.md",
] as const;

function ler(caminho: string): string {
  return readFileSync(join(RAIZ, caminho), "utf8");
}

/** O texto cru que produziu a regra — é ele que a regra manda medir nos dois lados. */
const CASO = "quero 2 iphone 15";

/**
 * O texto com as quebras de linha **removidas**.
 *
 * Medido: com o texto cru, `mesmo texto de entrada` atravessava a quebra de linha
 * no `pre-voo.md` e o gate reprovava com a emenda escrita e no lugar — a prosa
 * deste repo quebra a linha a 100 colunas, e procurar uma frase sem normalizar
 * mede a diagramação, não a regra. As quebras viram espaço e a frase volta a
 * ser a mesma.
 */
function corrido(caminho: string): string {
  return ler(caminho).replace(/\s+/g, " ");
}

describe("a prova em par continua escrita (#489)", () => {
  it("a lei existe e carrega o caso que a produziu", () => {
    const lei = ler(LEI);
    expect(lei, `${LEI}: a lei sumiu do disco`).toContain(CASO);
    // A lei é a emenda do DoD 12, não a substituição dele: sem a frase que
    // proíbe a troca, ela vira doutrina de que a tela deixou de valer.
    expect(lei, `${LEI}: a emenda precisa dizer que NÃO substitui a prova pela tela`).toMatch(
      /não substitui a (prova pela )?tela/i,
    );
  });

  it.each(GUIAS_DE_ACEITE)("%s pede o PAR, com o caso que o produziu", (guia) => {
    const texto = corrido(guia);

    // ⚠️ `par` sozinho é VAZIO: casa em "para", "compartilhavam", "separado" — 21
    // ocorrências neste guia antes da emenda, nenhuma sobre a regra. O que
    // distingue a regra de uma palavra comum é a frase que nomeia a UNIDADE, e
    // é ela que se exige.
    expect(texto, `${guia}: falta a regra do par como unidade`).toMatch(
      /par (é a unidade|vai em par|em par|junto)/i,
    );

    // O caso que a produziu. Sem ele a emenda continua verdadeira e deixa de
    // ser conferível: o próximo que discordar do texto não tem contra o quê.
    expect(texto, `${guia}: a regra não carrega o caso que a produziu`).toContain(CASO);

    // "mesmo texto cru" é o que separa o par de "rodei o caso duas vezes com
    // entradas diferentes" — que mede duas coisas e não compara nada.
    expect(texto, `${guia}: o par tem de ser medido com o mesmo texto de entrada`).toMatch(
      /mesmo texto (cru|de entrada)/i,
    );

    // E o critério: as duas concordam, senão o que se mediu foi o modelo.
    expect(texto, `${guia}: falta a regra de que só conta quando as duas concordam`).toMatch(
      /concorda|discord/i,
    );
  });

  it.each(GUIAS_DE_ACEITE)("%s aponta para a lei por um caminho que existe", (guia) => {
    const texto = ler(guia);
    // O alvo é procurado como LINK (`](../../docs/...)`), não como texto: um
    // guia que só menciona "prova-em-par" em prosa ensina a regra sem levar
    // ninguém à lei, e a lei é onde está o caso que a produziu.
    const link = texto.match(/\]\((\.\.?\/[^)#\s]*prova-em-par\.md)\)/)?.[1];
    expect(link, `${guia}: nenhum link relativo para a lei — a emenda vira folclore`).toBeDefined();

    // E o link tem que abrir. O prefixo relativo muda de arquivo para arquivo
    // (a lei mora na raiz; `SKILL.md` está um nível abaixo de `references/`),
    // então isto mede o caminho, que é o que o leitor vai seguir.
    const alvo = join(RAIZ, join(guia, ".."), link!);
    expect(existsSync(alvo), `${guia} → ${link}: o link aponta para arquivo que não existe`).toBe(
      true,
    );
  });

  it("o item 12 do DoD no CLAUDE.md aponta para a emenda", () => {
    // A lei diz ser "emenda ao item 12". Se o item 12 não souber dela, quem lê
    // a doutrina pela porta principal nunca chega à regra do par.
    const claude = ler("CLAUDE.md");
    const item12 = claude.match(/^12\. \*\*Se tocou UI[^\n]*/m)?.[0];
    expect(item12, "CLAUDE.md: o item 12 do DoD sumiu ou mudou de forma").toBeDefined();
    expect(item12, "CLAUDE.md: o item 12 do DoD não cita a emenda da prova em par").toContain(LEI);
  });
});
