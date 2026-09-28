/**
 * "QUANTO ESTA ORGANIZAÇÃO GASTOU DE IA ESTE MÊS?" TEM UMA RESPOSTA SÓ.
 *
 * ## O defeito medido que fez esta catraca existir
 *
 * Antes da 0159 o produto tinha DUAS contagens de gasto, e elas divergiam:
 *
 *   * `assertBudget` (`lib/agent-engine/edge/llm/run-model-call.ts`) somava
 *     `llm_calls` do mês corrente numa query inline — é ela que BARRAVA a chamada;
 *   * `ai_budgets.current_month_consumed_cents` é o que a TELA mostra — um
 *     contador materializado pelo gatilho `fn_update_budget_consumption`, que soma
 *     `NEW.cost_cents` **sem olhar a data** e nunca zera (o `runBudgetReset` nunca
 *     foi agendado, e a onda de limpeza desta feature apagou o arquivo inteiro —
 *     zerar incondicionalmente no meio de um mês trocaria erro-para-mais por
 *     erro-para-menos). O único recomputo em produção é o apêndice da 0140, que só
 *     roda no `install.sh`/`update.sh`: numa instalação que não atualiza há três
 *     meses, o card compara três meses de gasto contra um teto MENSAL.
 *
 * Pedir a alguém que arme uma proteção contra um número que não é o número que
 * decide é pedir que ela se proteja de uma mentira. A 0159 cria
 * `public.fn_gasto_de_ia_do_mes(uuid)` para ser a régua única, e esta catraca é o
 * que impede a segunda régua de voltar por "otimização" — duplicação sem source
 * of truth é o anti-pattern nº 2 do `CLAUDE.md`, e aqui ele cairia justo no
 * número em que a proteção se apoia.
 *
 * ## O proxy, declarado
 *
 * A pergunta "este código calcula gasto mensal por conta própria?" não é
 * decidível por regex. O proxy é o PAR: um arquivo que traga `sum(cost_cents)` e
 * `date_trunc('month'` está reimplementando a função. O proxy é estreito de
 * propósito, e o que ele NÃO pega está escrito aqui para ninguém confundir
 * silêncio com aprovação:
 *
 *   * uma janela escrita de outro jeito (`now() - interval '30 days'`) passa;
 *   * `lib/agent-engine/obs/metrics.ts` soma `cost_cents` por JOB — pergunta
 *     diferente, janela diferente, e por isso não é acusado nem deve ser;
 *   * `scripts/` fica fora da varredura: é ferramenta de desenvolvimento, não o
 *     produto que o self-hoster instala.
 *
 * ## A dívida CONGELADA — e ela foi PAGA
 *
 * Quando este arquivo nasceu, `run-model-call.ts` ainda somava `llm_calls`
 * inline: um gate que nascesse vermelho seria desligado antes de pegar o
 * primeiro defeito de verdade, então a dívida entrou declarada, com a onda que
 * a removeria. O que a tornava catraca e não esconderijo é que o teste cobrava
 * que cada arquivo listado AINDA tivesse a dívida.
 *
 * A onda seguinte trocou `assertBudget` por `SQL_ORCAMENTO`, e a asserção "a
 * dívida só encolhe" ficou vermelha até esta lista esvaziar — que é exatamente
 * o desenho funcionando. A lista fica aqui, vazia: um `Record` vazio continua
 * cobrando as duas direções, e a próxima duplicação temporária tem onde ser
 * declarada sem ninguém precisar reinventar o mecanismo.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const MIGRATION = join(RAIZ, "supabase", "migrations", "20260814210000_0159_o_teto_que_vincula.sql");
const BASELINE = join(RAIZ, "supabase", "baseline.sql");
const ORCAMENTO = "lib/agent-engine/edge/llm/orcamento.ts";

const FUNCAO = "fn_gasto_de_ia_do_mes";

const RAIZES_VARRIDAS = ["app", "components", "hooks", "lib", "workers"] as const;

/**
 * Os arquivos que ainda têm a segunda régua, com a razão e a onda que a remove.
 * Cada entrada é cobrada duas vezes: não pode haver arquivo fora da lista com a
 * dívida, e não pode haver entrada na lista sem a dívida.
 */
const DIVIDA_CONGELADA: Record<string, string> = {};

function arquivosVarridos(dir: string): string[] {
  const alvos: string[] = [];
  for (const entrada of readdirSync(join(RAIZ, dir), { withFileTypes: true })) {
    const rel = posix.join(dir, entrada.name);
    if (entrada.isDirectory()) alvos.push(...arquivosVarridos(rel));
    else if (rel.endsWith(".ts") || rel.endsWith(".tsx")) alvos.push(rel);
  }
  return alvos;
}

/** O par que denuncia uma segunda régua de gasto MENSAL. */
function calculaGastoMensalInline(fonte: string): boolean {
  return /sum\(\s*(?:[a-z_]+\.)?cost_cents\s*\)/i.test(fonte) && /date_trunc\(\s*'month'/i.test(fonte);
}

/**
 * O `create or replace function public.fn_gasto_de_ia_do_mes …` inteiro, do
 * `create` até o `$$;` que o fecha. `null` quando não existe — nunca string
 * vazia, que se compararia como "iguais" entre dois arquivos que perderam a
 * função.
 */
function definicaoDaFuncao(sql: string): string | null {
  const inicio = sql.search(new RegExp(`^create\\s+or\\s+replace\\s+function\\s+public\\.${FUNCAO}\\b`, "im"));
  if (inicio === -1) return null;
  const fim = sql.indexOf("$$;", inicio);
  if (fim === -1) return null;
  return sql.slice(inicio, fim + 3);
}

function ocorrencias(texto: string, agulha: string): number {
  return texto.split(agulha).length - 1;
}

function normalizar(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

const migration = readFileSync(MIGRATION, "utf8");
const baseline = readFileSync(BASELINE, "utf8");
const alvos = RAIZES_VARRIDAS.flatMap((r) => arquivosVarridos(r));

describe("uma régua só de gasto de IA", () => {
  describe("a régua existe, é uma só, e é a mesma nos dois artefatos de schema", () => {
    it("a varredura alcança as cinco raízes (guarda de vacuidade)", () => {
      for (const raiz of RAIZES_VARRIDAS) {
        expect(arquivosVarridos(raiz).length, `${raiz}/ não devolveu arquivo nenhum`).toBeGreaterThan(0);
      }
      expect(alvos.length).toBeGreaterThan(500);
    });

    it("a função é criada exatamente uma vez na migration e uma vez no baseline", () => {
      // Duas criações no baseline seriam duas definições convivendo, e a última a
      // rodar venceria — a divergência que este arquivo existe para impedir,
      // dentro do próprio artefato.
      const criacao = new RegExp(`^create\\s+or\\s+replace\\s+function\\s+public\\.${FUNCAO}\\b`, "gim");
      expect([...migration.matchAll(criacao)]).toHaveLength(1);
      expect([...baseline.matchAll(criacao)]).toHaveLength(1);
    });

    it("a definição é IDÊNTICA na migration e no baseline", () => {
      const naMigration = definicaoDaFuncao(migration);
      const noBaseline = definicaoDaFuncao(baseline);
      expect(naMigration, "função não encontrada na migration 0159").not.toBeNull();
      expect(noBaseline, "função não encontrada no baseline.sql").not.toBeNull();
      expect(
        normalizar(noBaseline ?? ""),
        "Quem aplica migrations e quem aplica o baseline ficariam com contas de gasto\n" +
          "diferentes — e o self-hoster recebe o baseline.",
      ).toEqual(normalizar(naMigration ?? ""));
    });

    it("a definição É a soma do mês em llm_calls (controle positivo)", () => {
      // Sem isto, uma função que devolvesse `0` satisfaria todas as asserções de
      // unicidade acima e a proteção inteira passaria a decidir sobre zero.
      const corpo = definicaoDaFuncao(migration) ?? "";
      expect(corpo).toMatch(/sum\(\s*cost_cents\s*\)/i);
      expect(corpo).toMatch(/from\s+public\.llm_calls/i);
      expect(corpo).toMatch(/created_at\s*>=\s*date_trunc\(\s*'month',\s*now\(\)\s*\)/i);
    });

    it("a função é revogada de public, anon e authenticated nos dois artefatos", () => {
      // Ela é `security invoker`, e o bloco VARREDURA anon do baseline percorre
      // só `p.prosecdef` — ele NÃO cura função invoker. Sem os revokes próprios,
      // o PostgREST a serve como RPC alcançável pela anon key, que vai ao browser.
      // Medido em pg17 (2026-08-14) removendo a linha: proacl passa a ter
      // `anon=X` e `authenticated=X`, nos dois caminhos (install e update).
      for (const [nome, texto] of [
        ["migration 0159", migration],
        ["baseline.sql", baseline],
      ] as const) {
        expect(texto, `revoke ausente em ${nome}`).toMatch(
          new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+public\\.${FUNCAO}\\(uuid\\)\\s*\\n?\\s*from\\s+public,\\s*anon,\\s*authenticated;`, "i"),
        );
      }
    });
  });

  describe("nenhuma segunda régua no produto", () => {
    const comDivida = alvos.filter((f) => calculaGastoMensalInline(readFileSync(join(RAIZ, f), "utf8")));

    it("nenhum arquivo fora da dívida congelada calcula gasto mensal inline", () => {
      expect(
        comDivida.filter((f) => !(f in DIVIDA_CONGELADA)),
        "Este arquivo soma cost_cents numa janela mensal por conta própria — é uma\n" +
          "segunda régua, e a segunda régua sempre diverge da primeira.\n" +
          "Use `select public.fn_gasto_de_ia_do_mes($1)`.\n" +
          "Se a duplicação for temporária e conhecida, declare-a em DIVIDA_CONGELADA\n" +
          "com a onda que a remove — nunca apague a asserção.",
      ).toEqual([]);
    });

    it("a dívida congelada só encolhe: toda entrada listada ainda tem a dívida", () => {
      const resolvidas = Object.keys(DIVIDA_CONGELADA).filter((f) => !comDivida.includes(f));
      expect(
        resolvidas,
        "Entrada de DIVIDA_CONGELADA cuja dívida já foi paga. Apague a linha — uma\n" +
          "allowlist que não encolhe vira esconderijo para a próxima duplicação.",
      ).toEqual([]);
    });

    it("o gate pergunta o gasto à função, e não a uma cópia", () => {
      const fonte = readFileSync(join(RAIZ, ORCAMENTO), "utf8");
      expect(fonte.length).toBeGreaterThan(500);
      expect(
        ocorrencias(fonte, FUNCAO),
        `${ORCAMENTO} deixou de chamar ${FUNCAO} — o statement do gate voltou a ter conta própria`,
      ).toBeGreaterThan(0);
      expect(calculaGastoMensalInline(fonte)).toBe(false);
    });
  });

  describe("controle negativo — o detector enxerga a segunda régua quando ela existe", () => {
    it("acusa a query inline de assertBudget reintroduzida no statement do gate", () => {
      const fonte = readFileSync(join(RAIZ, ORCAMENTO), "utf8");
      const sabotado =
        fonte +
        "\nconst COPIA = `select coalesce(sum(cost_cents), 0)::float8 as spent" +
        " from llm_calls where organization_id = $1 and created_at >= date_trunc('month', now())`;\n";
      expect(calculaGastoMensalInline(fonte)).toBe(false);
      expect(calculaGastoMensalInline(sabotado)).toBe(true);
    });

    it("não acusa quem soma cost_cents em outra janela (controle do controle)", () => {
      // `lib/agent-engine/obs/metrics.ts` soma por JOB. Se o detector o acusasse,
      // alguém afrouxaria a regra inteira para fazê-lo calar.
      expect(calculaGastoMensalInline("select sum(cost_cents) from llm_calls where job_id = $1")).toBe(false);
    });

    it("distingue função ausente de definição vazia", () => {
      expect(definicaoDaFuncao("select 1;")).toBeNull();
    });
  });
});
