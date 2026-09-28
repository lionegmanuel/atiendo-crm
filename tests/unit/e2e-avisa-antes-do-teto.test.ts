/**
 * O E2E AVISA ANTES DE ESTOURAR O TETO — NÃO DEPOIS.
 *
 * ## O defeito, medido
 *
 * O job `e2e-parte` tem `timeout-minutes: 30`. Quando uma parte cresce, quem
 * corta é esse teto — e ele corta em SILÊNCIO: o run fica `cancelled`, sem
 * nenhuma linha dizendo de que se tratava. No run 35160549180 a parte 1 cravou
 * os 30 min e foi cancelada com o caso 141 de 156 ainda VERDE. O sintoma que
 * chega a quem olha o run é "a rodada caiu", que se lê como infraestrutura —
 * não como "a parte cresceu demais". Foi preciso ir ao log contar caso por
 * caso para descobrir que o problema era o tamanho da parte.
 *
 * O que este arquivo guarda é o PAR: a medição (relógio do job inteiro, não só
 * o do Playwright — o preparo de ambiente custa ~9 min por parte; até o #983,
 * o `Initialize containers` dos services somava ~51 s a cada uma) e o aviso que acontece
 * ANTES do corte, nomeando o problema com o número medido.
 *
 * ## Por que ler o YAML em vez de exercitar a rodada
 *
 * Um workflow não roda em teste unitário. O que dá para prender aqui é o
 * contrato: que a medição exista, que ela cubra o custo fixo da parte, que o
 * corte antecipado venha antes do teto do job e que o erro carregue o nome do
 * problema. O resto (se o `timeout` de fato interrompe o Playwright) só uma
 * rodada real mede — dito no corpo do PR, não fingido aqui.
 *
 * ## Sabotagem
 *
 * Falha também quando o mecanismo é REMOVIDO do workflow: é o caso que mede se
 * estes testes ainda têm o que guardar (ver `guarda de vacuidade`).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = path.resolve(__dirname, "../..");
const CAMINHO = ".github/workflows/e2e.yml";
const workflow = readFileSync(path.join(RAIZ, CAMINHO), "utf8");

/**
 * Só o job `e2e-parte`: é nele que o teto corta. O arquivo tem outros jobs com
 * `actions/checkout` (o `e2e-alcance` roda antes das partes), e um índice sobre
 * o arquivo inteiro compararia o relógio das partes com o checkout de outro job.
 */
const JOB_PARTE = (() => {
  const inicio = workflow.indexOf("\n  e2e-parte:\n");
  if (inicio < 0) return "";
  const resto = workflow.slice(inicio + 1);
  const fim = resto.slice(1).search(/\n  [a-zA-Z0-9_-]+:\n/);
  return fim < 0 ? resto : resto.slice(0, fim + 1);
})();

/** Linhas de COMANDO do job: comentário que MENCIONA a regra não é a regra. */
const COMANDOS = JOB_PARTE
  .split("\n")
  .filter((l) => !l.trim().startsWith("#"))
  .map((l) => l.trim());

/** Índice do primeiro comando que casa, ou -1. */
function primeiroIndice(padrao: RegExp): number {
  return COMANDOS.findIndex((l) => padrao.test(l));
}

/** O `echo "NOME=valor"` que publica a constante no `$GITHUB_ENV`, ou null. */
function constante(nome: string): number | null {
  const m = workflow.match(new RegExp(`echo "${nome}=(\\d+)"`));
  return m ? Number(m[1]) : null;
}

/** O `timeout-minutes` do job `e2e-parte` — o teto que cancela sem avisar. */
const TETO_MIN = (() => {
  const job = workflow.slice(workflow.indexOf("\n  e2e-parte:"));
  const m = job.match(/\n    timeout-minutes:\s*(\d+)/);
  return m ? Number(m[1]) : null;
})();

/** Onde o resumo do job recebe o bloco de relógio (linhas entre o título e o `>>`). */
function blocoDoResumo(marcador: RegExp): string {
  const linhas = workflow.split("\n");
  const i = linhas.findIndex((l) => marcador.test(l));
  if (i < 0) return "";
  const j = linhas.findIndex((l, k) => k > i && l.includes('>> "$GITHUB_STEP_SUMMARY"'));
  return j < 0 ? "" : linhas.slice(i, j + 1).join("\n");
}

describe("a rodada de e2e avisa antes de estourar o teto de 30 min", () => {
  it("o teto e a suíte existem (guarda de vacuidade)", () => {
    // Sem isto, todos os casos abaixo poderiam ficar verdes vigiando um
    // workflow que não roda suíte nenhuma ou que perdeu o teto — e o arquivo
    // viraria peso morto que ninguém percebe.
    expect(TETO_MIN, "o job `e2e-parte` perdeu o `timeout-minutes`").not.toBeNull();
    expect(primeiroIndice(/playwright test/), "nenhum passo roda a suíte").toBeGreaterThan(-1);
  });

  it("o relógio começa no PRIMEIRO passo do job (mede o preparo, não só a suíte)", () => {
    // O corte de 30 min conta a partir do job, e o preparo (Supabase, baseline,
    // build, env) é pago por parte. Medir só o relógio do Playwright deixaria
    // de fora justamente o custo que decidiu o estouro da parte 1.
    const marca = primeiroIndice(/T0_JOB=\$\(date/);
    const checkout = primeiroIndice(/uses: actions\/checkout/);
    expect(marca, "ninguém marca o início do job — o aviso mediria só a suíte").toBeGreaterThan(-1);
    expect(
      marca,
      "o relógio começa DEPOIS do preparo: marcar não basta, tem de ser o primeiro passo",
    ).toBeLessThan(checkout);
  });

  it("o teto declarado é o mesmo `timeout-minutes` do job (catraca anti-deriva)", () => {
    // Duas medidas do mesmo teto que podem divergir: o número que o aviso usa e
    // o `timeout-minutes` que de fato cancela. Se alguém subir o teto sem mexer
    // no aviso (ou o contrário), o vermelho abaixo tem de aparecer.
    const teto = constante("TETO_SEGUNDOS");
    expect(teto, "o aviso não declara TETO_SEGUNDOS").not.toBeNull();
    expect(
      teto,
      "TETO_SEGUNDOS e `timeout-minutes` medem o mesmo relógio — divirjam e o aviso mente",
    ).toBe((TETO_MIN ?? 0) * 60);
  });

  it("o teto do job continua sendo o teto (não foi afrouxado)", () => {
    // A tentação é subir `timeout-minutes` para o e2e parar de cair. O teto é o
    // que denuncia a suíte crescendo; afrouxá-lo troca um vermelho honesto hoje
    // por um CI mais lento todo mês, sem ninguém perceber.
    expect(TETO_MIN, "o teto do e2e foi afrouxado em vez de avisar antes dele").toBe(30);
  });

  it("o orçamento avisa ANTES do teto, com margem para o que o relógio não vê", () => {
    const orcamento = constante("ORCAMENTO_SEGUNDOS");
    const teto = constante("TETO_SEGUNDOS");
    const margem = constante("MARGEM_SEGUNDOS");
    expect(orcamento, "não há orçamento declarado: não há quando avisar").not.toBeNull();
    expect(teto, "não há teto declarado").not.toBeNull();
    expect(margem, "não há margem declarada").not.toBeNull();
    expect(
      orcamento!,
      "o orçamento não é menor que o teto — avisar no teto é avisar depois do corte",
    ).toBeLessThan(teto! - margem!);
  });

  it("a folga da suíte desconta o que o preparo já gastou", () => {
    // Este é o coração da issue: o relógio que decide o corte é o do JOB.
    expect(
      workflow,
      "a folga é calculada sem `T0_JOB`: o custo fixo da parte volta a ficar de fora",
    ).toMatch(/FOLGA=\$\(\(\s*TETO_SEGUNDOS - MARGEM_SEGUNDOS - \(AGORA - T0_JOB\)/);
    expect(
      workflow,
      "o custo fixo da parte não é medido a partir do início do job",
    ).toMatch(/DECORRIDO=\$\(\(\s*AGORA - T0_JOB\s*\)\)/);
  });

  it("a suíte roda sob um corte que acontece antes do teto do job", () => {
    // Sem watchdog, quem corta é o `timeout-minutes` — e ele cancela sem dizer
    // nada. É este `timeout` que transforma o corte cego em erro nomeado.
    const corta = primeiroIndice(/timeout -k \d+ --signal=TERM "\$\{FOLGA\}s" pnpm exec playwright/);
    expect(
      corta,
      "a suíte roda sem corte antecipado: o vermelho volta a ser 'cancelled' sem explicação",
    ).toBeGreaterThan(-1);
  });

  it("o vermelho diz o nome do problema e o número medido", () => {
    // "Process completed with exit code 124" é exatamente o erro genérico que a
    // issue pede para não ter: quem lê o run precisa saber que a PARTE cresceu,
    // com o número na mão.
    const erros = COMANDOS.filter(
      (l) => l.includes("::error") && /\$PARTE|\$\{PARTE\}|matrix\.parte/.test(l),
    );
    expect(
      erros,
      "o estouro do relógio não nomeia a parte — o erro volta a ser genérico",
    ).not.toHaveLength(0);
    expect(
      erros.join("\n"),
      "o erro não carrega número medido: sem ele, 'cresceu' é adjetivo, não medida",
    ).toMatch(/\$\{?(SUITE|FOLGA|DECORRIDO)/);
  });

  it("a parte que passou do orçamento ainda deixa aviso, mesmo verde", () => {
    const avisos = COMANDOS.filter(
      (l) => l.includes("::warning") && /ORCAMENTO_SEGUNDOS/.test(l),
    );
    expect(
      avisos,
      "nada avisa a parte que passou do orçamento mas ainda não estourou o teto",
    ).not.toHaveLength(0);
    expect(avisos.join("\n"), "o aviso não diz QUAL parte passou do orçamento").toMatch(
      /\$PARTE|\$\{PARTE\}|matrix\.parte/,
    );
  });

  // ── O CORTE NÃO DIAGNOSTICA SEM OLHAR O VERMELHO ─────────────────────────
  //
  // Medido no #1210 (job 105739419202): o `timeout` matou a suíte antes de o
  // Playwright imprimir o sumário, o único vestígio do caso que falhou era a
  // linha `✘` no meio do log, e a mensagem do corte afirmava "a parte cresceu".
  // O time saiu rebalancear a partição — e a parte estava saudável (797–933 s
  // de suíte em quatro rodadas do mesmo dia). O que estourou o relógio foi UM
  // caso vermelho que declara `test.setTimeout(420_000)` e, ao travar, queima
  // 7 min sozinho.
  it("o corte por relógio conta os casos vermelhos antes de culpar o tamanho", () => {
    const corte = COMANDOS.join("\n");
    expect(
      corte,
      "a saída da suíte não é guardada em arquivo — sem ela não há o que contar depois do corte",
    ).toMatch(/tee "\$SAIDA"/);
    expect(
      corte,
      "o código de saída vem do `tee`, não do Playwright: com pipe, `$?` é sempre 0",
    ).toMatch(/PIPESTATUS/);
    expect(corte, "o corte não conta os casos vermelhos do log").toMatch(/VERMELHOS=/);
    const diagnostico = COMANDOS.filter((l) => l.includes("::error") && /VERMELHO/.test(l));
    expect(
      diagnostico,
      "o corte não tem mensagem própria para 'havia vermelho antes do corte'",
    ).not.toHaveLength(0);
    // A afirmação "a parte cresceu" só pode existir no ramo do ZERO vermelho.
    const cresceu = COMANDOS.filter((l) => l.includes("a parte cresceu"));
    expect(cresceu, "sumiu a mensagem do crescimento real").not.toHaveLength(0);
    expect(
      cresceu.join("\n"),
      "'a parte cresceu' voltou a ser afirmado sem consultar o vermelho",
    ).toMatch(/[Nn]enhum caso vermelho/);
  });

  // `test.fail(...)` é falha ESPERADA e sai com o MESMO `✘` (medido no run
  // 35388254053: `degradacao-silenciosa.spec.ts` imprime ✘ e o job fecha
  // "150 passed"). Contá-la inverteria o erro — inventaria um vermelho.
  it("a contagem de vermelhos exclui as falhas declaradas como esperadas", () => {
    const corte = COMANDOS.join("\n");
    expect(corte, "a contagem não procura quem declara test.fail").toMatch(/test\\?\.fail/);
    expect(corte, "a contagem não filtra os specs de falha esperada").toMatch(/ESPERADAS/);
  });

  it("o resumo publica os specs mais caros da parte (o dado que decide a partição)", () => {
    const bloco = blocoDoResumo(/## E2E parte \$\{PARTE\}/);
    expect(bloco, "o resumo não publica o tempo por spec").toMatch(/specs mais caros/);
    expect(
      bloco,
      "o resumo não lê a saída guardada da suíte — sem ela não há tempo por spec",
    ).toMatch(/SAIDA_DA_SUITE/);
  });

  it("o resumo do job publica os relógios da parte (o número fica onde alguém lê)", () => {
    // A medição que só existe no log se perde. O resumo do job é o lugar onde
    // a próxima pessoa olha antes de decidir repartir as listas.
    const bloco = blocoDoResumo(/## E2E parte \$\{PARTE\}/);
    expect(bloco, "o resumo do job não publica o relógio da parte").not.toBe("");
    expect(bloco, "o resumo não traz o relógio da suíte").toMatch(/\$\{SUITE\}/);
    expect(bloco, "o resumo não traz o custo fixo da parte").toMatch(/\$\{FIXO\}/);
    expect(bloco, "o resumo não traz o relógio total da parte").toMatch(/\$\{TOTAL\}/);
    expect(bloco, "o resumo não traz o teto contra o qual o total é lido").toMatch(
      /TETO_SEGUNDOS/,
    );
  });
});
