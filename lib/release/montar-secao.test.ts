import { describe, expect, it } from "vitest";

import { extractChangelogSection, markdownParaTextoSimples } from "../system/changelog";
import { parseFragmento } from "./fragmento";
import { aplicarNoChangelog, montarSecao } from "./montar-secao";

/** URL sintética: este arquivo é varrido pela catraca de marca e não nomeia o repo. */
const comparar = (de: string, para: string) => `https://exemplo.test/compare/${de}...${para}`;

function frag(over: {
  impacto?: string;
  secao?: string;
  titulo?: string;
  corpo?: string;
  atencao?: string;
}) {
  const texto = [
    "---",
    `impacto: ${over.impacto ?? "nada_mudou"}`,
    `secao: ${over.secao ?? "corrigido"}`,
    `titulo: ${over.titulo ?? "Um conserto"}`,
    "---",
    "",
    over.corpo ?? "O que estava quebrado voltou a funcionar.",
    ...(over.atencao ? ["", "## Requer atenção", "", over.atencao] : []),
  ].join("\n");
  return parseFragmento("x.md", texto);
}

const CABECALHO = ["# Changelog", "", "## [Não lançado]", "", "## [1.6.0] — 2026-08-26", "", "### Corrigido", "", "- **Algo antigo** ...", ""].join("\n");

describe("montarSecao — o que a TELA da VPS vai mostrar", () => {
  it("a seção montada é legível pelo parser que a tela usa", () => {
    const texto = aplicarNoChangelog(
      CABECALHO,
      montarSecao([frag({ titulo: "A IA avisa antes de sair" })], "1.6.1", "2026-08-27"),
      "1.6.0",
      comparar,
    );
    const s = extractChangelogSection(texto, "1.6.1");
    expect(s).not.toBeNull();
    expect(s?.body).toContain("A IA avisa antes de sair");
  });

  it("todos os avisos caem num único bloco de atenção, e não vazam para o corpo", () => {
    const secao = montarSecao(
      [
        frag({ impacto: "exige_acao", titulo: "Primeiro", atencao: "Edite o arquivo A." }),
        frag({ impacto: "exige_acao", titulo: "Segundo", atencao: "Rode o comando B." }),
      ],
      "2.0.0",
      "2026-08-27",
    );
    const s = extractChangelogSection(aplicarNoChangelog(CABECALHO, secao, "1.6.0", comparar), "2.0.0")!;

    expect(s.requiresAttention).toContain("Edite o arquivo A.");
    expect(s.requiresAttention).toContain("Rode o comando B.");
    // Se o aviso também ficasse no corpo, a tela o mostraria duas vezes — e a
    // segunda sem a distinção entre "aviso" e "changelog geral".
    expect(s.body).not.toContain("Edite o arquivo A.");
    expect(s.body).not.toContain("Requer atenção");
  });

  it("nenhuma marcação sobra depois da conversão que a tela faz", () => {
    const secao = montarSecao(
      [frag({ titulo: "Conserto", corpo: "Mexe em `fn_user_org_ids()` e no *fluxo* de envio." })],
      "1.6.1",
      "2026-08-27",
    );
    const s = extractChangelogSection(aplicarNoChangelog(CABECALHO, secao, "1.6.0", comparar), "1.6.1")!;
    const naTela = markdownParaTextoSimples(s.body);
    expect(naTela).not.toMatch(/\*\*/);
    // O identificador precisa chegar inteiro: a regra de ênfase do renderizador
    // ignora `_` colado em letra justamente por causa de nomes de função.
    expect(naTela).toContain("fn_user_org_ids()");
  });

  it("preserva o corpo verbatim, sem refluir — negrito partido chegaria com asterisco à mostra", () => {
    const corpo = "Primeira linha do parágrafo,\nsegunda linha que continua a frase.";
    const secao = montarSecao([frag({ corpo })], "1.6.1", "2026-08-27");
    expect(secao.texto).toContain("segunda linha que continua a frase.");
    const s = extractChangelogSection(aplicarNoChangelog(CABECALHO, secao, "1.6.0", comparar), "1.6.1")!;
    expect(markdownParaTextoSimples(s.body)).toContain("segunda linha que continua a frase.");
  });

  it("a seção anterior continua inteira e alcançável", () => {
    const texto = aplicarNoChangelog(CABECALHO, montarSecao([frag({})], "1.6.1", "2026-08-27"), "1.6.0", comparar);
    expect(extractChangelogSection(texto, "1.6.0")?.body).toContain("Algo antigo");
  });

  it("`## [Não lançado]` continua existindo e vazio", () => {
    const texto = aplicarNoChangelog(CABECALHO, montarSecao([frag({})], "1.6.1", "2026-08-27"), "1.6.0", comparar);
    expect(texto).toContain("## [Não lançado]");
    expect(extractChangelogSection(texto, "Não lançado")?.body).toBe("");
  });

  it("prosa com `$&` e crase invertida sai idêntica — `replace` com string a corromperia", () => {
    const corpo = "O padrão $& e o `$`' do shell aparecem literais aqui.";
    const texto = aplicarNoChangelog(CABECALHO, montarSecao([frag({ corpo })], "1.6.1", "2026-08-27"), "1.6.0", comparar);
    expect(texto).toContain("O padrão $& e o");
    expect(texto).not.toContain("## [Não lançado]## [Não lançado]");
  });

  it("o rodapé de referências é reescrito — à mão ele apodrece, e apodreceu", () => {
    const comRodape = `${CABECALHO}\n[Não lançado]: https://exemplo.test/compare/v1.5.0...HEAD\n`;
    const texto = aplicarNoChangelog(comRodape, montarSecao([frag({})], "1.6.1", "2026-08-27"), "1.6.0", comparar);
    expect(texto).toContain("[Não lançado]: https://exemplo.test/compare/v1.6.1...HEAD");
    expect(texto).toContain("[1.6.1]: https://exemplo.test/compare/v1.6.0...v1.6.1");
    expect(texto).not.toContain("compare/v1.5.0...HEAD");
  });

  it("recusa CHANGELOG sem a âncora, em vez de inserir em lugar nenhum", () => {
    expect(() => aplicarNoChangelog("# Changelog\n", montarSecao([frag({})], "1.6.1", "2026-08-27"), "1.6.0", comparar)).toThrow(
      /Não lançado/,
    );
  });
});
