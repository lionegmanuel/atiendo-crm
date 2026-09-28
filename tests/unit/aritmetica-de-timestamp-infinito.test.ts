/**
 * NENHUMA CONTA DE TEMPO SOBRE COLUNA QUE ACEITA `'infinity'`.
 *
 * ─── O defeito, medido em dois Postgres reais (2026-08-30) ─────────────────
 *
 * ```
 * select 'infinity'::timestamptz - now()
 *   pg15 → ERROR: cannot subtract infinite timestamps
 *   pg17 → infinity
 * ```
 *
 * Subtrair timestamp infinito só passou a funcionar a partir do Postgres 16.
 * Enquanto o piso declarado deste projeto era pg17, isso era latente. O PR que
 * baixa o piso para pg15 (#422) o tornou alcançável — e o que ele alcança é o
 * **relógio do worker**: `faltaParaOProximoJob` (`lib/agent-engine/queue/queue.ts`)
 * fazia `min(run_after) - now()`, e `session-watchdog.ts` grava
 * `run_after = 'infinity'` no hold de sessão, que é estado real de produção.
 *
 * A armadilha fina: a função **já tinha** um `least(..., 86400000)`, e o
 * comentário dela dizia que ele "segura o infinity". Segurava — em pg17. O
 * clamp estava no RESULTADO, e em pg15 a subtração estoura antes de ele rodar.
 * Proteção certa, ordem errada; e a ordem só aparece quando alguém roda no piso.
 *
 * ─── Por que um gate, e não só o conserto ──────────────────────────────────
 *
 * O conserto fecha a única instância que existe hoje — varri e confirmei:
 * duas colunas recebem `'infinity'` (`run_after` e `bot_silenced_until`), e só
 * `run_after` aparecia em aritmética. Mas nada impede a próxima. Este arquivo
 * é a catraca: quem escrever a segunda subtração descobre aqui, e não numa VPS
 * com Postgres 15.
 *
 * ─── Como ele decide ───────────────────────────────────────────────────────
 *
 * As colunas NÃO são uma lista fixa — elas são **derivadas por varredura** de
 * quem recebe `'infinity'` no repo. Uma lista escrita à mão envelheceria no dia
 * em que aparecesse a terceira coluna, e envelheceria em silêncio.
 *
 * A forma SEGURA é clampar o timestamp ANTES de subtrair
 * (`least(coluna, now() + interval …) - now()`). A forma insegura é subtrair
 * direto. O gate distingue as duas.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");
const AREAS = ["lib", "app", "workers", "supabase/migrations", "scripts"];
const IGNORADAS = new Set(["node_modules", ".next", "dist"]);

/** Caminho relativo sempre em barra normal — as mensagens deste gate são lidas. */
function rel(abs: string): string {
  return relative(RAIZ, abs).split(sep).join("/");
}

function arquivos(dir: string, out: string[] = []): string[] {
  let entradas: string[];
  try {
    entradas = readdirSync(dir);
  } catch {
    return out;
  }
  for (const nome of entradas) {
    if (IGNORADAS.has(nome)) continue;
    const p = join(dir, nome);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) arquivos(p, out);
    else if (/\.(ts|tsx|sql)$/.test(nome) && !/\.test\.tsx?$/.test(nome)) out.push(p);
  }
  return out;
}

const FONTES = AREAS.flatMap((a) => arquivos(join(RAIZ, a)));

/**
 * As colunas que recebem `'infinity'` em algum lugar do código — derivadas,
 * nunca declaradas. Reconhece `col = 'infinity'` e `col = 'infinity'::tipo`,
 * que são as duas formas usadas no repo.
 */
function colunasQueAceitamInfinito(): Set<string> {
  const achadas = new Set<string>();
  const rx = /([a-z_][a-z0-9_]{2,})\s*=\s*'infinity'/gi;
  for (const arquivo of FONTES) {
    const src = readFileSync(arquivo, "utf8");
    let m: RegExpExecArray | null;
    while ((m = rx.exec(src)) !== null) achadas.add(m[1]!.toLowerCase());
  }
  return achadas;
}

/**
 * `coluna - now()`, `now() - coluna`, `age(coluna)` — as formas que estouram.
 *
 * O `[\s)]*` entre a coluna e o operador NÃO é decoração: a forma que existia
 * no repo era `min(run_after) - now()`, com um parêntese de fechamento no meio.
 * A primeira versão desta regex exigia a coluna colada ao `-`, ficou VERDE com
 * o defeito na frente, e só apareceu porque sabotei o conserto para ver o gate
 * reprovar. Um gate que não morde é pior que gate nenhum: ele afirma cobertura.
 */
function subtracoesDe(coluna: string): RegExp {
  return new RegExp(
    String.raw`(?:\b${coluna}\b[\s)]*-\s*now\s*\(\s*\)` +
      String.raw`|now\s*\(\s*\)\s*-[\s(]*\b${coluna}\b` +
      String.raw`|\bage\s*\(\s*[^)]*\b${coluna}\b)`,
    "i",
  );
}

/**
 * O clamp protetor está aplicado ao TIMESTAMP — e não ao resultado?
 *
 * ```
 * least(min(run_after), now() + interval '1 day') - now()   ← SEGURO
 * least(greatest(extract(epoch from (min(run_after) - now())) …), 86400000)  ← NÃO
 * ```
 *
 * A distinção é o miolo deste gate, e a primeira versão errou: eu procurava
 * `least(` … coluna, e o `least(` da forma INSEGURA também casa — ele só está
 * mais longe, com `greatest(extract(` no meio. Com isso o gate ficou VERDE
 * sobre o defeito duas vezes seguidas, e as duas só apareceram porque sabotei
 * o conserto para vê-lo reprovar.
 *
 * O discriminador certo: no clamp seguro a coluna vem LOGO depois do `least(`,
 * no máximo com um `min(` no caminho — nunca com `extract` ou `epoch`, que são
 * a assinatura de já se estar operando sobre o RESULTADO da subtração.
 */
function temClampDoTimestamp(trecho: string, coluna: string): boolean {
  const rx = new RegExp(
    String.raw`least\s*\(\s*(?:min\s*\(\s*)?\b${coluna}\b`,
    "i",
  );
  return rx.test(trecho);
}

describe("aritmética de timestamp sobre coluna que aceita 'infinity'", () => {
  const colunas = colunasQueAceitamInfinito();

  it("a varredura ACHA as colunas que aceitam infinito — senão o gate é vácuo", () => {
    // Sem esta asserção, uma regex que parasse de casar deixaria o gate verde
    // por não ter o que varrer. `run_after` é o caso conhecido; se ele sumir,
    // é a sonda que quebrou, não o repo que ficou limpo.
    expect(
      colunas.size,
      "nenhuma coluna com 'infinity' encontrada — a varredura ficou cega",
    ).toBeGreaterThan(0);
    expect(colunas).toContain("run_after");
  });

  it("varre um número de arquivos compatível com o repo", () => {
    // Segunda guarda contra vácuo: se a caminhada de diretórios quebrar, a
    // varredura acima também não acha nada e o teste acima já pega — mas este
    // diz QUAL das duas falhou.
    expect(FONTES.length, "a caminhada de arquivos não achou fontes").toBeGreaterThan(300);
  });

  it("nenhuma subtração crua — o clamp vem ANTES, no timestamp", () => {
    const infratores: string[] = [];

    for (const arquivo of FONTES) {
      const src = readFileSync(arquivo, "utf8");
      const linhas = src.split("\n");

      for (const coluna of colunas) {
        if (!src.includes(coluna)) continue;
        const rx = subtracoesDe(coluna);

        linhas.forEach((linha, i) => {
          // Comentário não executa: o cabeçalho desta própria função descreve a
          // forma insegura para explicá-la, e acusá-lo seria o gate reprovando
          // o texto que documenta o acerto.
          const semComentario = linha.replace(/--.*$/, "").replace(/^\s*\*.*$/, "");
          if (!rx.test(semComentario)) return;

          // A subtração pode estar quebrada em várias linhas (é SQL formatado).
          // Olho a vizinhança para achar o clamp.
          const vizinhanca = linhas.slice(Math.max(0, i - 3), i + 2).join(" ");
          if (temClampDoTimestamp(vizinhanca, coluna)) return;

          infratores.push(`${rel(arquivo)}:${i + 1} → ${coluna} (${semComentario.trim().slice(0, 70)})`);
        });
      }
    }

    expect(
      infratores,
      "Conta de tempo sobre coluna que aceita 'infinity'.\n" +
        "Em Postgres 15 e 16 isso é ERRO DO SERVIDOR — `cannot subtract infinite\n" +
        "timestamps` — e derruba o caminho inteiro, não devolve um valor estranho.\n" +
        "Clampe o TIMESTAMP antes de subtrair:\n" +
        "  least(<coluna>, now() + interval '1 day') - now()\n" +
        "Clampar o RESULTADO (`least(extract(...), teto)`) NÃO serve: a subtração\n" +
        "estoura antes de o clamp rodar. Ver lib/agent-engine/queue/queue.ts.",
    ).toEqual([]);
  });
});
