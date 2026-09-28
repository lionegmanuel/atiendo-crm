import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Nenhum seed de E2E pode ler `.env.local` DIRETO do disco.
 *
 * ═══ O DEFEITO QUE ISTO CONGELA (medido em 2026-08-06) ═══
 *
 * Os seeds faziam:
 *
 *     const envFile = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
 *
 * ignorando `process.env`. Num checkout de trabalho, `.env.local` aponta para
 * PRODUÇÃO — então a suíte E2E semeava organizações, usuários e agentes de teste
 * **no banco real**, e passava verde. O `.env.e2e` injetado no `webServer` do
 * Playwright não os alcançava, porque eles nunca olhavam para o ambiente.
 *
 * A org `e2e-test-org` está na produção deste projeto desde 2026-04-29. Não foi
 * um acidente de sessão: era o comportamento normal.
 *
 * ═══ POR QUE UM TESTE E NÃO SÓ A CORREÇÃO ═══
 *
 * Os 16 seeds foram migrados para `scripts/lib/env-de-teste.ts`. Sem este gate, o
 * 17º nasce copiando o mais próximo — e o padrão volta pela porta que ninguém
 * está olhando. O custo de escrever em produção não é reparável por code review
 * depois do fato.
 *
 * ESCOPO: os seeds de E2E **e** as sondas/provas de `scripts/` e `tests/`. A
 * dívida das ~96 sondas foi paga — todas passaram a usar `carregarEnvLocal()`,
 * que faz `process.env` vencer e tolera a ausência do arquivo (o worktree
 * dedicado de e2e não tem `.env.local`, e é essa ausência que protege).
 *
 * O anúncio de destino (`anunciarDestino`) continua exigido só dos SEEDS: eles
 * rodam sem ninguém olhando, dentro da suíte. Uma sonda é disparada à mão, com
 * a pessoa lendo a saída — exigir a linha de todas seria cerimônia sem ganho.
 */
const SEEDS = readdirSync(join(process.cwd(), "scripts"))
  .filter((f) => f.startsWith("seed-e2e-") && f.endsWith(".ts"))
  .map((f) => join("scripts", f))
  .sort();

/** Toda sonda/prova/seed que possa falar com um Supabase. */
function varrer(dir: string): string[] {
  return readdirSync(join(process.cwd(), dir))
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
    .map((f) => join(dir, f));
}
const SONDAS = [...varrer("scripts"), ...varrer("tests"), ...varrer("tests/e2e")].sort();

/**
 * A forma que denuncia: ler o arquivo, em vez de perguntar ao ambiente.
 *
 * ⚠️ A primeira versão desta regex NÃO PEGAVA o padrão real, e o gate passava
 * medindo nada. Ela era:
 *
 *     /readFileSync\s*\(\s*(?:path\.join\([^)]*)?["'`][^"'`]*\.env\.local/
 *
 * O `[^)]*` parava no `)` de `process.cwd()` — que está no meio de
 * `path.join(process.cwd(), ".env.local")` — então a alternativa nunca casava.
 * Descoberto por sabotagem: reintroduzir a leitura num seed não vermelhou nada.
 *
 * A versão atual não tenta entender a estrutura da chamada: procura `.env.local`
 * como argumento de QUALQUER coisa parecida com leitura de arquivo. Regex que
 * modela sintaxe erra em silêncio; regex que procura o literal, não.
 */
const LE_DO_DISCO = /readFileSync[\s\S]{0,80}?\.env\.local/;

/**
 * Tira COMENTÁRIO antes de aplicar a regex — comentário não é caminho de execução.
 *
 * Medido em 2026-08-08: documentar esta própria lição dentro de
 * `tests/e2e/escalacao-ciclo.spec.ts` reprovou o gate. O texto explicava por que a
 * flag `--env-file` tinha saído e citava, em prosa, as duas palavras que a regex
 * procura — a 80 caracteres uma da outra. O match caía inteiro dentro do bloco de
 * comentário.
 *
 * A escolha aqui é deliberada e vale dizer por quê, porque "afrouxar o gate para o
 * teste passar" é normalmente a troca errada: o que o gate PRETENDE medir é
 * comportamento de execução, e prosa não executa. Um gate que reprova quem
 * documenta ensina a não documentar — e a próxima pessoa a explicar esta armadilha
 * tropeçaria nela de novo.
 *
 * O que se perde: uma violação escondida dentro de código COMENTADO deixa de ser
 * pega. Código comentado também não executa, então a perda é nominal.
 */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("seeds de E2E não leem .env.local do disco", () => {
  it("a varredura acha os seeds — sem isto, um teste vazio passaria e não mediria nada", () => {
    // Controle positivo. Um filtro errado devolve [], o `it.each` não roda
    // nenhum caso, e o arquivo inteiro vira decoração verde.
    expect(SEEDS.length).toBeGreaterThanOrEqual(15);
  });

  it.each(SEEDS)("%s pergunta ao ambiente, não ao arquivo", (seed) => {
    const fonte = readFileSync(seed, "utf8");
    expect(
      LE_DO_DISCO.test(semComentarios(fonte)),
      `${seed} lê .env.local do disco. Num checkout de trabalho isso aponta para PRODUÇÃO — ` +
        "use `credenciaisSupabaseDeTeste()` de scripts/lib/env-de-teste.ts, que faz process.env vencer.",
    ).toBe(false);
  });

  it.each(SEEDS)("%s anuncia contra qual banco vai escrever", (seed) => {
    const fonte = readFileSync(seed, "utf8");
    // O modo de falha caro é silencioso: um seed que escreve em produção acha os
    // mesmos dados de teste de sempre e termina com "✅ Seed completo". A linha
    // impressa é o que torna o destino observável antes do estrago.
    expect(
      fonte.includes("anunciarDestino("),
      `${seed} não chama anunciarDestino() — sem isso, ninguém vê que ele foi para a nuvem.`,
    ).toBe(true);
  });

  it("a varredura das sondas acha arquivos — controle da segunda bateria", () => {
    expect(SONDAS.length).toBeGreaterThan(100);
  });

  it.each(SONDAS)("%s não lê .env.local do disco", (arquivo) => {
    const fonte = readFileSync(arquivo, "utf8");
    expect(
      LE_DO_DISCO.test(semComentarios(fonte)),
      `${arquivo} lê .env.local do disco. Num checkout de trabalho isso aponta para PRODUÇÃO — ` +
        "use `carregarEnvLocal()` de scripts/lib/env-de-teste.ts, que faz process.env vencer " +
        "e tolera a ausência do arquivo.",
    ).toBe(false);
  });
});
