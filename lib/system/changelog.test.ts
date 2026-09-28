import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

import { extractChangelogRange, extractChangelogSection, markdownParaTextoSimples } from "./changelog";

const CHANGELOG = `# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.

## [Não lançado]

Sem novidades pendentes de lançamento.

## [1.1.0] — 2026-08-02

**⚠️ Requer atenção**

Se você usa número próprio no WhatsApp, reconecte depois de atualizar.

### Adicionado

- Botão de atualizar pela própria tela.

## [1.0.0] — 2026-07-27

Primeira versão marcada do DeskcommCRM.

[Não lançado]: https://github.com/melgarafael/DeskcommCRM/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/melgarafael/DeskcommCRM/releases/tag/v1.0.0
`;

describe("extractChangelogSection", () => {
  it("acha a versão pedida e devolve só o corpo dela", () => {
    const section = extractChangelogSection(CHANGELOG, "1.1.0");
    expect(section?.version).toBe("1.1.0");
    expect(section?.body).toContain("Botão de atualizar pela própria tela.");
    expect(section?.body).not.toContain("Primeira versão marcada");
    expect(section?.body).not.toContain("## [1.1.0]");
  });

  it("aceita a versão com o prefixo v da tag", () => {
    expect(extractChangelogSection(CHANGELOG, "v1.1.0")?.version).toBe("1.1.0");
  });

  it("extrai o bloco de atenção separado do corpo (formato negrito)", () => {
    const section = extractChangelogSection(CHANGELOG, "1.1.0");
    expect(section?.requiresAttention).toContain("reconecte depois de atualizar");
  });

  it("extrai bloco de atenção em heading (### ⚠️ Requer atenção)", () => {
    const raw = `## [1.0.0] — 2026-07-27
### ⚠️ Requer atenção
Seu sistema precisa de ação.
### Adicionado
- Algo novo`;
    const section = extractChangelogSection(raw, "1.0.0");
    expect(section?.requiresAttention).toContain("Seu sistema precisa de ação");
  });

  it("devolve null no bloco de atenção quando a versão não tem um", () => {
    const raw = `## [2.0.0] — 2026-09-01
### Adicionado
- Coisa`;
    expect(extractChangelogSection(raw, "2.0.0")?.requiresAttention).toBeNull();
  });

  it("para no próximo heading quando existe: testa com Não lançado que tem 1.1.0 seguinte", () => {
    // O teste placebo original testava 1.0.0 (última seção, sem próxima).
    // Agora testamos "Não lançado" que tem "1.1.0" como próxima seção.
    // A sabotagem (end = lines.length) faria incluir "Botão de atualizar".
    const section = extractChangelogSection(CHANGELOG, "Não lançado");
    expect(section?.body).toContain("Sem novidades pendentes");
    expect(section?.body).not.toContain("Botão de atualizar pela própria tela.");
  });

  it("remove referências de link do final (formato [algo]: http://...)", () => {
    // 1.0.0 é a última versão, então body inclui [1.0.0]: ... antes da limpeza.
    const section = extractChangelogSection(CHANGELOG, "1.0.0");
    expect(section?.body).not.toContain("[Não lançado]:");
    expect(section?.body).not.toContain("github.com");
    expect(section?.body).toContain("Primeira versão marcada");
  });

  it("devolve null para versão ausente", () => {
    expect(extractChangelogSection(CHANGELOG, "9.9.9")).toBeNull();
  });

  it("devolve null para entrada vazia ou lixo", () => {
    expect(extractChangelogSection("", "1.0.0")).toBeNull();
    expect(extractChangelogSection("qualquer coisa sem headings", "1.0.0")).toBeNull();
  });

  it("não confunde 1.1.0 com 1.1.0-beta", () => {
    const raw = "## [1.1.0-beta] — 2026-08-01\n\nbeta\n\n## [1.1.0] — 2026-08-02\n\nfinal\n";
    expect(extractChangelogSection(raw, "1.1.0")?.body.trim()).toBe("final");
  });

  it("não corta bloco de atenção em negrito no meio (ex: **Atenção especial**: ...)", () => {
    // IMPORTANT 3: negrito no meio não termina o bloco, só heading de verdade.
    const raw = `## [1.0.0] — 2026-07-27
**⚠️ Requer atenção**
Leia isto: **Atenção especial** antes de atualizar.
Mais informação aqui.
## [2.0.0]
Novo`;
    const section = extractChangelogSection(raw, "1.0.0");
    expect(section?.requiresAttention).toContain("Atenção especial");
    expect(section?.requiresAttention).toContain("Mais informação");
  });

  it("lê CHANGELOG.md real e encontra 1.0.0 com requiresAttention", () => {
    // Sem try/catch: se falhar, é informação crítica, não ruído.
    // Usa __dirname do teste, não process.cwd() que é frágil.
    const realChangelog = readFileSync(join(__dirname, "../../CHANGELOG.md"), "utf8");
    const section = extractChangelogSection(realChangelog, "1.0.0");
    expect(section).not.toBeNull();
    expect(section?.version).toBe("1.0.0");
    // No CHANGELOG real, linha 76 tem "### ⚠️ Requer atenção" com conteúdo
    expect(section?.requiresAttention).not.toBeNull();
  });

  it("body NÃO contém o texto do bloco de atenção — não pode duplicar na tela", () => {
    // 1.1.0 no fixture tem o bloco em negrito (**⚠️ Requer atenção**).
    const section = extractChangelogSection(CHANGELOG, "1.1.0");
    expect(section?.requiresAttention).toContain("reconecte depois de atualizar");
    expect(section?.body).not.toContain("reconecte depois de atualizar");
    expect(section?.body).not.toContain("Requer atenção");
  });

  it("body NÃO contém o bloco de atenção do CHANGELOG.md real (heading)", () => {
    const realChangelog = readFileSync(join(__dirname, "../../CHANGELOG.md"), "utf8");
    const section = extractChangelogSection(realChangelog, "1.0.0");
    expect(section?.requiresAttention).toContain("Node 22");
    expect(section?.body).not.toContain("Node 22 é obrigatório");
    expect(section?.body).not.toContain("Requer atenção");
  });

  it("remove referencias de link do bloco de atencao (versao ultima com bloco)", () => {
    // Versão que é a última do arquivo E tem bloco de atenção:
    // o defeito vaza referências de link em requiresAttention.
    const raw = `## [1.0.0] — 2026-07-27
### ⚠️ Requer atenção
Node 22 é obrigatório.
[1.0.0]: https://github.com/example/releases/tag/v1.0.0`;
    const section = extractChangelogSection(raw, "1.0.0");
    expect(section?.requiresAttention).not.toContain("github.com");
    expect(section?.requiresAttention).toContain("Node 22");
  });
});

describe("markdownParaTextoSimples", () => {
  // Contra o CHANGELOG.md REAL, não um fixture inventado — o revisor apontou
  // com razão que um fixture escrito por quem implementa evita justo os
  // casos reais (negrito, crase, lista) que o changelog de verdade usa.
  const realChangelog = readFileSync(join(__dirname, "../../CHANGELOG.md"), "utf8");

  it("limpa negrito e crase do bloco de atenção real, sem sumir com o conteúdo", () => {
    const section = extractChangelogSection(realChangelog, "1.0.0");
    const limpo = markdownParaTextoSimples(section!.requiresAttention!);
    expect(limpo).not.toMatch(/[*`#]/);
    expect(limpo).toContain("Node 22 é obrigatório para desenvolvimento.");
    expect(limpo).toContain("WebSocket global");
    expect(limpo).toMatch(/^•\s/);
  });

  it("limpa heading e crase do corpo real (várias seções, várias listas)", () => {
    const section = extractChangelogSection(realChangelog, "1.0.0");
    const limpo = markdownParaTextoSimples(section!.body);
    expect(limpo).not.toMatch(/[*`#]/);
    expect(limpo).toContain("Plataforma");
    expect(limpo).toContain("fn_user_org_ids()");
    expect(limpo).toMatch(/•\s+Multi-tenancy/);
  });

  it("não mexe em texto sem marcação nenhuma", () => {
    expect(markdownParaTextoSimples("texto normal, sem markdown.")).toBe(
      "texto normal, sem markdown.",
    );
  });

  it("não confunde underscore de identificador com itálico (fn_user_org_ids)", () => {
    // Achado rodando contra o CHANGELOG real: a primeira versão comia os
    // "_" internos de nomes de função, virando "fnuserorg_ids()".
    expect(markdownParaTextoSimples("resolvida por `fn_user_org_ids()`.")).toBe(
      "resolvida por fn_user_org_ids().",
    );
  });

  it("ainda converte itálico de underscore de verdade (delimitado por espaço)", () => {
    expect(markdownParaTextoSimples("isso é _importante_ para todos")).toBe(
      "isso é importante para todos",
    );
  });
});

describe("extractChangelogRange — todas as seções entre a instalada e a alvo", () => {
  const TRES = [
    "# Changelog",
    "",
    "## [Não lançado]",
    "",
    "## [1.2.0] — 2026-08-03",
    "",
    "### Adicionado",
    "",
    "- coisa nova",
    "",
    "## [1.1.0] — 2026-08-02",
    "",
    "### ⚠️ Requer atenção",
    "",
    "- reconecte o número depois de atualizar",
    "",
    "### Corrigido",
    "",
    "- conserto do meio",
    "",
    "## [1.0.0] — 2026-08-01",
    "",
    "- primeira",
    "",
  ].join("\n");

  it("devolve da mais nova para a mais antiga, sem incluir a instalada", () => {
    const f = extractChangelogRange(TRES, "1.2.0", "1.0.0");
    expect(f.secoes.map((s) => s.version)).toEqual(["1.2.0", "1.1.0"]);
    expect(f.completa).toBe(true);
  });

  it("o aviso da versão do MEIO sobrevive — é o defeito que esta função existe para corrigir", () => {
    // Quem pulava versões via só a seção-alvo, e o aviso de ação manual da
    // versão intermediária desaparecia (commit ac9472c5).
    const f = extractChangelogRange(TRES, "1.2.0", "1.0.0");
    const comAviso = f.secoes.filter((s) => s.requiresAttention);
    expect(comAviso.map((s) => s.version)).toEqual(["1.1.0"]);
    expect(comAviso[0]?.requiresAttention).toContain("reconecte o número");
  });

  it("não afirma completude quando a instalada é um SHA (instalação fora de release)", () => {
    const f = extractChangelogRange(TRES, "1.2.0", "abc1234");
    expect(f.completa).toBe(false);
    expect(f.secoes.length).toBeGreaterThan(0);
  });

  it("não afirma completude quando o texto chegou cortado antes da instalada", () => {
    const cortado = TRES.slice(0, TRES.indexOf("## [1.0.0]"));
    expect(extractChangelogRange(cortado, "1.2.0", "1.0.0").completa).toBe(false);
  });

  it("em dia: nada entre as duas, e isso NÃO é incompletude", () => {
    expect(extractChangelogRange(TRES, "1.2.0", "1.2.0")).toEqual({ secoes: [], completa: true });
  });

  it("instalada mais nova que a alvo devolve a seção-alvo, nunca uma lista vazia dizendo-se completa", () => {
    // Um `slice(iAlvo, iInst)` ingênuo devolveria [] com completa=true aqui: a
    // tela ficaria sem corpo nenhum afirmando estar inteira.
    const f = extractChangelogRange(TRES, "1.0.0", "1.2.0");
    expect(f.secoes.map((s) => s.version)).toEqual(["1.0.0"]);
    expect(f.secoes[0]?.body).toContain("primeira");
  });

  it("alvo que não existe no texto devolve vazio e incompleto", () => {
    expect(extractChangelogRange(TRES, "9.9.9", "1.0.0")).toEqual({ secoes: [], completa: false });
  });

  it("faixa de uma versão só é igual à seção única — as duas leituras não podem divergir", () => {
    const pelaFaixa = extractChangelogRange(TRES, "1.2.0", "1.1.0").secoes[0];
    const pelaSecao = extractChangelogSection(TRES, "1.2.0");
    expect(pelaFaixa).toEqual(pelaSecao);
  });

  it("`[Não lançado]` nunca entra na faixa", () => {
    const f = extractChangelogRange(TRES, "1.2.0", "1.0.0");
    expect(f.secoes.map((s) => s.version)).not.toContain("Não lançado");
  });
});
