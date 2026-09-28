// @vitest-environment node
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { baseDoStorage } from "@/lib/branding/logo";

/**
 * O DOMÍNIO DO SUPABASE NÃO PODE SER ASSADO NO BUILD.
 *
 * ─── O defeito, medido no contêiner de produção ─────────────────────────────
 *
 * A imagem Docker é genérica: uma só serve qualquer projeto Supabase. Por isso
 * o Dockerfile builda com `ARG NEXT_PUBLIC_SUPABASE_URL=https://placeholder.
 * supabase.co`, e os valores reais entram em RUNTIME.
 *
 * Só que o Next substitui todo acesso ESTÁTICO a `process.env.NEXT_PUBLIC_*`
 * pelo valor do build — inclusive no bundle do SERVIDOR. `baseDoStorage()` lia
 * `process.env.NEXT_PUBLIC_SUPABASE_URL` direto, e o compilador dobrou a função
 * inteira numa constante:
 *
 *   function n(){return"https://placeholder.supabase.co".trim()}
 *
 * O efeito para quem usa: sobe o logo, a tela diz "salvo", o arquivo está no
 * Storage e o caminho está certo no banco — e o `<img>` pede
 * `https://placeholder.supabase.co/storage/...`. Imagem quebrada, com tudo
 * correto atrás dela. Foi assim que apareceu: o dono da instalação viu o logo
 * quebrado na barra lateral e mandou a URL.
 *
 * Vale para TODA instalação que suba um logo, não só uma.
 *
 * ─── Por que o conserto é ler pela variável ─────────────────────────────────
 *
 * O Next só reescreve o acesso estático. Passar `process.env` por uma variável
 * (ou inteiro, como `lib/env.ts` faz em `schema.safeParse(process.env)`)
 * derrota a substituição — e é exatamente por isso que `lib/env.ts` sempre teve
 * o valor certo enquanto este arquivo não tinha.
 *
 * ─── O que este teste NÃO prova ─────────────────────────────────────────────
 *
 * Ele lê o FONTE, não o bundle. A prova de verdade é `grep placeholder` no
 * `.next` de uma imagem buildada — que é como o defeito foi encontrado, e o que
 * um teste de unidade não alcança. Esta é a rede possível: impede a REGRESSÃO
 * exata (alguém voltar ao acesso estático "porque é mais legível").
 */

/**
 * O CÓDIGO, sem os comentários.
 *
 * A regra é sobre o que o compilador vê, e o compilador não vê prosa. Sem esta
 * limpeza o teste reprovaria o próprio docblock que EXPLICA o defeito — citar
 * `process.env.NEXT_PUBLIC_SUPABASE_URL` para dizer "não faça isto" viraria
 * violação. Um gate que proíbe descrever o bug empurra a explicação para fora
 * do arquivo, que é onde ela morre.
 */
const FONTE = readFileSync("lib/branding/logo.ts", "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "");

describe("a base do Storage vem de runtime, nunca do build", () => {
  it("não há acesso ESTÁTICO a process.env.NEXT_PUBLIC_*", () => {
    // É este acesso, e só ele, que o Next dobra em constante.
    const estaticos = [...FONTE.matchAll(/process\.env\.NEXT_PUBLIC_[A-Z_]+/g)].map((m) => m[0]);
    expect(estaticos, "o Next vai assar isto com o valor do build").toEqual([]);
  });

  it("no servidor, devolve o valor que o process.env tem AGORA", () => {
    // Controle positivo de COMPORTAMENTO, não de texto. O caso anterior era
    // `expect(FONTE).toMatch(/NEXT_PUBLIC_SUPABASE_URL/)` e NÃO segurava o que
    // dizia segurar: trocando o ramo do servidor por `return ""` — exatamente a
    // sabotagem que o comentário descrevia — o teste ficava VERDE, porque o
    // literal sobrevive na linha do NAVEGADOR (`window.__PUBLIC_ENV__?.…`), que
    // a sabotagem não toca. O controle media o ramo errado.
    //
    // Medido: (a) fonte do PR → passa; (b) com `return ""` no ramo do servidor →
    // `AssertionError: expected '' to be 'https://o-supabase-do-cliente…'`;
    // (c) restaurado → passa.
    const antes = process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://o-supabase-do-cliente.supabase.co";
    try {
      expect(baseDoStorage()).toBe("https://o-supabase-do-cliente.supabase.co");
    } finally {
      if (antes === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = antes;
    }
  });

  it("o navegador continua lendo o env injetado por requisição", () => {
    // A metade do cliente nunca esteve quebrada, e o conserto do servidor não
    // pode tê-la custado: no browser não existe `process.env`.
    expect(FONTE).toMatch(/window\.__PUBLIC_ENV__/);
  });

  it("a URL pública é montada a partir da base recebida, não de uma constante", () => {
    // Se alguém voltar a embutir um domínio aqui, o defeito volta por outro
    // caminho — com o gate acima verde.
    expect(FONTE, "domínio literal no código").not.toMatch(/https:\/\/[a-z0-9-]+\.supabase\.co/);
  });
});
