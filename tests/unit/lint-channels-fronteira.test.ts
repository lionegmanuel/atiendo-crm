/**
 * A FRONTEIRA do padrão do `lint:channels` (issue #118).
 *
 * ## O defeito que fez este arquivo existir
 *
 * `scripts/lint-channels.ts` é catraca de merge (está no `gov:verify`) para o
 * invariante 1 da doutrina de restrição de canal. O padrão dele usava `\b` como
 * fronteira. `_` é *word character*, então `\b` não fecha entre `WAHA` e `_`: a
 * catraca não enxergava **nenhum** identificador da família `WAHA_*`/`waha_*` —
 * justamente os nomes mais comuns de provider no código. Sete arquivos violavam
 * o invariante com o gate verde, e nenhum estava declarado como dívida.
 *
 * Nada acusou, e nada podia acusar: o único teste possível seria sobre o padrão,
 * e o padrão morava dentro de um script que varre o disco e chama `process.exit`
 * no topo do módulo — importá-lo de um teste rodaria o lint. Por isso o padrão
 * saiu para `scripts/lint-channels.pattern.ts`.
 *
 * ## O que se guarda aqui
 *
 * O RECONHECIMENTO, não a lista de ofensores (essa é do próprio lint, e muda a
 * cada arquivo novo). Cada caso abaixo é uma grafia que já escapou ou que
 * escaparia; voltar a fronteira para `\b`, ou a alternação para
 * case-sensitive, deixa este arquivo vermelho.
 *
 * Os casos negativos não são enfeite: um padrão frouxo demais (ex.: sem
 * fronteira nenhuma) passaria em todos os positivos e transformaria a catraca
 * num gerador de falso positivo, que é o outro jeito de matá-la.
 */
import { describe, expect, it } from "vitest";

import { PADROES, nomeiaProvider } from "../../scripts/lint-channels.pattern";

describe("fronteira do padrão de nome de provider", () => {
  it.each([
    // Os que o `\b` deixava passar — o defeito da #118, em suas duas pontas.
    ["WAHA_API_KEY", "env var: `_` depois do nome não fechava a fronteira"],
    ["WAHA_API_BASE_URL", "env var"],
    ["waha_session_name", "coluna de banco — a grafia mais frequente no repo"],
    ["waha_sessions_count", "campo de resposta de API"],
    ["waha_error", "código de erro"],
    ["X_WAHA", "`_` antes do nome também não abria a fronteira"],
    // A outra dimensão do mesmo furo: a grafia PascalCase, que a alternação
    // `(waha|WAHA)` não reconhecia — e que a fronteira "não-alfanumérico"
    // sozinha também não pega, porque a letra seguinte é alfanumérica.
    ["WahaChannelAdapter", "identificador PascalCase"],
    ["WahaClient", "identificador PascalCase"],
    ["createWahaSession", "segmento PascalCase no meio do identificador"],
    // Os que já funcionavam — ficam para o conserto não regredir o que servia.
    ["waha", "menção nua"],
    ["WAHA", "menção nua em caixa alta"],
    ["import { x } from '@/lib/waha/client'", "caminho de import"],
    ["meta_cloud", "outro provider do vocabulário"],
    ["graph.facebook.com", "host de provider"],
  ])("reconhece %s (%s)", (texto) => {
    expect(nomeiaProvider(texto)).toBe(true);
  });

  it.each([
    ["wahax", "`waha` como prefixo de outra palavra"],
    ["xwaha", "`waha` como sufixo de outra palavra"],
    ["wahalla", "palavra que apenas começa igual"],
    ["Wahalla", "idem, em PascalCase — `Waha` seguido de minúscula não é segmento"],
    ["metacloud", "sem o separador, não é o termo do vocabulário"],
    ["graphxfacebookxcom", "o ponto do host é literal, não coringa"],
  ])("NÃO reconhece %s (%s)", (texto) => {
    expect(nomeiaProvider(texto)).toBe(false);
  });

  it("as duas fronteiras são independentes (guarda de vacuidade)", () => {
    // Sem isto, uma das duas podendo cobrir sozinha todos os casos acima
    // deixaria a outra virar código morto sem ninguém notar — e o dia em que
    // ela fosse apagada por "simplificação" o teste seguiria verde.
    expect(PADROES.SEPARADO.test("WahaClient")).toBe(false);
    expect(PADROES.PASCAL.test("waha_session_name")).toBe(false);
    // E nenhuma delas pode voltar a usar `\b`, que é o defeito da #118.
    expect(PADROES.SEPARADO.source).not.toContain("\\b");
    expect(PADROES.PASCAL.source).not.toContain("\\b");
  });
});
