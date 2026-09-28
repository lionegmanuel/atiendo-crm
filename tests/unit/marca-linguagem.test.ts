import { describe, expect, it } from "vitest";

import {
  avisosDaMarca,
  motivosDoFallback,
  TRADUCOES,
  type MotivoLido,
} from "@/lib/branding/linguagem";

/**
 * A guarda da LÍNGUA da tela de marca.
 *
 * Quem lê `/admin/marca` é o dono de uma VPS, não um designer. "O accent foi
 * deslocado dois stops na rampa" é uma frase correta que não informa nada a ele
 * — e é exatamente a frase que sai quando alguém traduz um código novo com
 * pressa, copiando o vocabulário do motor.
 *
 * A EXAUSTIVIDADE não é testada aqui de propósito: `TRADUCOES` é
 * `Record<CodigoDaMarca, Traducao>` sobre a união dos três tipos de código do
 * motor, então código novo em `lib/branding/` reprova o `pnpm typecheck`. Um
 * teste de runtime sobre a mesma propriedade seria mais fraco (só pegaria o que
 * alguém lembrasse de listar) e daria a sensação de já estar coberto.
 */

/**
 * O vocabulário que NÃO pode chegar ao operador. Cada termo aqui foi tirado do
 * próprio motor: são as palavras que existem em `lib/branding/` e que, copiadas
 * para a tela, transformam um diagnóstico em ruído.
 */
const JARGAO_PROIBIDO =
  /\boklch\b|\brampa\b|\bstop\b|ΔE|\bwcag\b|\btoken\b|\bcss\b|var\(--|\baccent\b|\bhex\b|allowlist|serializ|acrom[áa]t|dicromac/i;

function frases(): string[] {
  return Object.values(TRADUCOES).flatMap((t) => (t.modo === "frase" ? [t.texto] : []));
}

describe("tradução dos códigos da marca", () => {
  it("a varredura de frases não está vazia — senão o resto não prova nada", () => {
    // Guarda de vacuidade: `TRADUCOES` só tem entradas `com_contexto`/`silencio`
    // num futuro em que alguém esvaziou o mapa, e aí o teste de jargão passaria
    // sobre uma lista de zero frases.
    expect(frases().length).toBeGreaterThanOrEqual(8);
  });

  it("nenhuma frase carrega o vocabulário interno do motor", () => {
    const ruins = frases().filter((texto) => JARGAO_PROIBIDO.test(texto));
    expect(ruins, `frase com jargão:\n  ${ruins.join("\n  ")}`).toEqual([]);
  });

  it("o regex de jargão de fato reprova — controle positivo", () => {
    // Sem isto, um regex quebrado devolveria zero achados e pareceria aprovação.
    expect(JARGAO_PROIBIDO.test("o accent andou 2 stops na rampa (ΔE alto)")).toBe(true);
  });

  it("toda decisão de não mostrar algo vem com o porquê escrito", () => {
    const mudas = Object.entries(TRADUCOES).filter(
      ([, t]) => t.modo !== "frase" && t.porque.trim().length < 40,
    );
    expect(mudas.map(([codigo]) => codigo)).toEqual([]);
  });
});

const DESLOCADO_NOS_DOIS_MODOS: MotivoLido[] = [
  { codigo: "accent_deslocado", tema: "claro", alvo: "--color-accent" },
  { codigo: "accent_deslocado", tema: "escuro", alvo: "--color-accent" },
];

describe("avisosDaMarca", () => {
  it("diz 'mais escuro' quando o botão desceu na escala e 'mais claro' quando subiu", () => {
    const avisos = avisosDaMarca(DESLOCADO_NOS_DOIS_MODOS, { claro: 3, escuro: -1 });
    expect(avisos.some((a) => /modo claro.*mais escuro que a sua cor/.test(a.texto))).toBe(true);
    expect(avisos.some((a) => /modo escuro.*mais claro que a sua cor/.test(a.texto))).toBe(true);
    // O fecho só aparece quando o botão de fato deixou de ser a cor da pessoa.
    expect(avisos.some((a) => a.texto.includes("continua no logo"))).toBe(true);
  });

  it("distância zero: o botão É a cor da pessoa, e a frase não inventa ajuste", () => {
    // MEDIDO com `#f5c518` (amarelo): o modo escuro anda +2 a partir do tom
    // padrão dele e pousa EXATAMENTE na cor da pessoa. A versão anterior desta
    // função lia o deslocamento do motor e dizia "um tom mais escuro da sua
    // cor" — falso, e falso justamente na cor que mais estressa o contraste.
    const avisos = avisosDaMarca(DESLOCADO_NOS_DOIS_MODOS, { claro: 3, escuro: 0 });
    expect(avisos.some((a) => /modo escuro.*exatamente a sua cor/.test(a.texto))).toBe(true);
    expect(avisos.some((a) => /modo escuro.*mais (escuro|claro)/.test(a.texto))).toBe(false);
  });

  it("sem ajuste nenhum além do que pousou na própria cor, não consola de perda que não houve", () => {
    const avisos = avisosDaMarca(
      [{ codigo: "accent_deslocado", tema: "claro", alvo: "--color-accent" }],
      { claro: 0, escuro: 0 },
    );
    expect(avisos.some((a) => a.texto.includes("continua no logo"))).toBe(false);
  });

  it("marca neutra: nenhuma frase começa com 'sua cor', porque ela não pinta nada", () => {
    // MEDIDO com `#808080` e `#ffffff`: a escala em uso é a do produto, e a
    // derivação emite `semantica_deslocada` porque o VERDE DO PRODUTO colide com
    // o verde de sucesso do PRODUTO — colisão que existia antes de a pessoa
    // colar cor nenhuma. As duas frases contextuais culpariam quem não fez nada.
    const avisos = avisosDaMarca(
      [
        ...DESLOCADO_NOS_DOIS_MODOS,
        { codigo: "semantica_deslocada", tema: "claro", alvo: "success" },
        { codigo: "marca_acromatica", tema: null, alvo: null },
      ],
      { claro: null, escuro: null },
    );
    expect(avisos).toHaveLength(1);
    expect(avisos[0]?.texto).toContain("tom neutro");
    expect(avisos.some((a) => a.texto.startsWith("Sua cor ficou parecida"))).toBe(false);
  });

  it("não promete afastar as cores de alerta — esta versão não afasta", () => {
    // `semantica_deslocada` é emitido pela derivação, mas `lib/branding/css.ts`
    // NÃO serializa as semânticas nesta fase (ele mesmo emite
    // `token_nao_serializado` dizendo isso). Uma frase no passado — "afastamos o
    // tom de erro" — descreveria um pixel que a tela não pinta.
    const avisos = avisosDaMarca(
      [
        { codigo: "semantica_deslocada", tema: "claro", alvo: "error" },
        { codigo: "semantica_deslocada", tema: "escuro", alvo: "error" },
        { codigo: "token_nao_serializado", alvo: "error" },
      ],
      { claro: 0, escuro: 0 },
    );
    expect(avisos).toHaveLength(1);
    expect(avisos[0]?.texto).toContain("ainda não afasta");
    expect(avisos[0]?.texto).toContain("erro");
  });

  it("agrupa as cores de alerta numa frase só, ordenadas", () => {
    const avisos = avisosDaMarca(
      [
        { codigo: "semantica_deslocada", tema: "claro", alvo: "warning" },
        { codigo: "semantica_deslocada", tema: "claro", alvo: "error" },
        { codigo: "redundancia_nao_cromatica_necessaria", tema: "escuro", alvo: "success" },
      ],
      { claro: 0, escuro: 0 },
    );
    expect(avisos).toHaveLength(1);
    expect(avisos[0]?.texto).toContain("atenção, erro e sucesso");
  });

  it("não repete a mesma frase quando dois temas emitem o mesmo código", () => {
    const avisos = avisosDaMarca(
      [
        { codigo: "accent_sem_contraste_possivel", tema: "claro", alvo: null },
        { codigo: "accent_sem_contraste_possivel", tema: "escuro", alvo: null },
      ],
      { claro: 0, escuro: 0 },
    );
    expect(avisos).toHaveLength(1);
    expect(avisos[0]?.tom).toBe("problema");
  });

  it("fica calado no caso normal — cor que coube sem ajuste nenhum", () => {
    expect(avisosDaMarca([], { claro: 0, escuro: 0 })).toEqual([]);
  });
});

describe("motivosDoFallback", () => {
  it("traduz o formato gravado na coluna, com e sem alvo colado", () => {
    // `motivoDoFallback` (lib/branding/instalacao.ts) grava
    // "codigo, codigo@alvo" — o alvo é nome de coisa interna e não vai à tela.
    const avisos = motivosDoFallback("semente_invalida, papel_desconhecido@--color-brand");
    expect(avisos).toHaveLength(2);
    expect(avisos.map((a) => a.texto).join(" ")).not.toContain("--color-brand");
    expect(avisos.every((a) => a.tom === "problema")).toBe(true);
  });

  it("colapsa os três códigos da verificação de segurança numa linha", () => {
    const avisos = motivosDoFallback(
      "nome_de_token_invalido, valor_fora_da_allowlist, saida_suspeita",
    );
    expect(avisos).toHaveLength(1);
  });

  it("código desconhecido produz frase, nunca silêncio", () => {
    // O alarme está aceso. Um bloco de alerta sem nenhuma linha embaixo parece
    // defeito da tela e é onde o operador para de acreditar no alarme.
    const avisos = motivosDoFallback("motivo_de_outra_versao");
    expect(avisos).toHaveLength(1);
    expect(avisos[0]?.texto).toContain("não sabe explicar");
  });

  it("sem alarme, nenhuma linha", () => {
    expect(motivosDoFallback(null)).toEqual([]);
    expect(motivosDoFallback("")).toEqual([]);
  });
});
