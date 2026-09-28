import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A triagem só termina quando a versão sai.
 *
 * O procedimento de triagem parava no merge, e isso deixava o trabalho do
 * contribuidor a meio caminho: o self-hoster puxa IMAGEM PUBLICADA por número de
 * versão (`docs/doctrine/packaging.md`), então um PR que para na `main` existe
 * só no repositório — nenhuma VPS o recebe, nunca.
 *
 * Este arquivo existe porque prosa que nenhum gate lê é prosa que diverge, e a
 * própria TRIAGEM.md diz isso no passe 11: todo defeito que os gates não pegaram
 * vira gate novo. Ele não julga a qualidade do texto — vigia que as três peças
 * que mudam o comportamento de quem tria continuem lá.
 */
const RAIZ = process.cwd();
const TRIAGEM = fs.readFileSync(path.join(RAIZ, "triagem/TRIAGEM.md"), "utf8");
const COMANDO = fs.readFileSync(path.join(RAIZ, ".claude/commands/triagem-de-pr.md"), "utf8");

describe("a triagem de PR carrega a disciplina de release", () => {
  it("o procedimento tem um passe sobre a versão, e ele aponta para a lei", () => {
    expect(TRIAGEM).toMatch(/##\s+12\.\s+A versão/);
    expect(TRIAGEM, "o passe não aponta para docs/doctrine/versionamento.md").toContain(
      "docs/doctrine/versionamento.md",
    );
  });

  it("o fragmento é cobrado, e quem tria o escreve quando falta", () => {
    // Cobrar como descuido um gate não documentado é proibido pelo passe 10, e
    // contribuidor externo não conhece a regra. Por isso a instrução é escrever,
    // não devolver.
    expect(TRIAGEM).toContain(".changes/");
    expect(TRIAGEM).toMatch(/escreva você/i);
  });

  it("seção de versão escrita à mão no CHANGELOG é bloqueador", () => {
    // Medido em 2026-08-27: o PR #354 trazia `## [1.7.0]` à mão, e até aquele
    // dia o merge dele teria criado a tag e publicado as três imagens sozinho.
    expect(TRIAGEM).toMatch(/escrita à mão é BLOQUEADOR|à mão é BLOQUEADOR/i);
  });

  it("o veredito declara a versão que o PR produz", () => {
    // Sem o campo, "este PR está pronto" não diz se ele leva alguém a agir na
    // VPS — que é a única pergunta que o número responde.
    expect(TRIAGEM).toMatch(/VERSÃO:\s+<patch \| minor \| major \| nenhuma>/);
  });

  it("a fronteira mantém o merge do PR de release com o mantenedor", () => {
    // Quem tria prepara e dispara o corte; quem publica para o parque é o dono.
    expect(TRIAGEM).toMatch(/mergear o PR de release/i);
    expect(TRIAGEM).toMatch(/Run workflow/);
  });

  it("o comando avisa disso antes de o arquivo ser aberto", () => {
    // O comando é o que se lê primeiro; se a regra só existe no fim de um
    // documento de 300 linhas, ela chega tarde demais.
    expect(COMANDO).toMatch(/não é entrega|nao e entrega/i);
    expect(COMANDO).toContain(".changes/");
  });
});
