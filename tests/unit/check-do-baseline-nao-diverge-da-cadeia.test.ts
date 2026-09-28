/**
 * O VOCABULÁRIO DE UM CHECK É O MESMO NA CADEIA E NO BASELINE — VARREDURA, NÃO LISTA FIXA.
 *
 * ## O defeito, medido
 *
 * O PR #963 estende `channel_sessions_provider_check` na migration 0343:
 *
 *     check (provider in ('waha', 'meta_cloud', 'zernio', 'zernio_social', 'wacalls'))
 *
 * e não toca no apêndice do `baseline.sql`, cujo bloco canônico segue com quatro
 * valores. `install.sh` e `update.sh` aplicam **só o baseline**: toda VPS de
 * cliente ficaria com uma constraint que não conhece `zernio_social`, e a
 * primeira conexão de rede social bateria em `23514`. Na nossa máquina passa,
 * porque aqui a cadeia de migrations roda.
 *
 * ## Por que nenhum portão viu
 *
 * `apendice-do-baseline-nao-diverge-da-cadeia.test.ts` compara os dois artefatos,
 * mas extrai com `/create or replace function public\.(fn_[a-z_]+)\s*\(/` — ele
 * só enxerga FUNÇÃO. `kind-check-migration-x-baseline.test.ts` compara CHECK, mas
 * por uma lista fixa de um nome (`agent_inbox_items_kind_check`). É a forma da
 * issue #128, onde uma varredura substituiu uma lista fixa de 6 e revelou que 8
 * de 25 estavam expostas: a lista fixa vigia o caso que já custou caro e dá álibi
 * às 119 irmãs. Este arquivo é a varredura equivalente para CHECK.
 *
 * ## A armadilha: comparar TEXTO nasce vermelho em tudo
 *
 * O `pg_dump` escreve `provider = ANY (ARRAY['waha'::"text", …])`; a mão humana
 * escreve `provider in ('waha', …)`. É a MESMA constraint. Um gate que comparasse
 * texto acusaria as 120 de uma vez, e gate que ninguém lê é pior que gate nenhum
 * — foi por medir FORMA que a sonda de função precisou excluir o corpo do dump.
 * Aqui não se compara forma: compara-se o CONJUNTO de literais de dentro do
 * `check (…)`. As duas notações colapsam no mesmo conjunto, e o dump entra na
 * medição em vez de ficar de fora dela.
 *
 * ## Contagem igual não é conjunto igual
 *
 * Se um lado perde um valor e o outro ganha outro, o total bate e o conteúdo não.
 * Por isso a diferença é calculada nos DOIS sentidos e a mensagem nomeia QUAIS
 * valores faltam e QUAIS sobram — "diferem" não diz a ninguém o que consertar.
 *
 * ## Qual é a definição VENCEDORA de cada lado (medido, não suposto)
 *
 * * **Na cadeia**: a ÚLTIMA migration que nomeia a constraint, em ordem
 *   lexicográfica de arquivo (o prefixo é timestamp de largura fixa, então essa é
 *   a ordem em que o Supabase CLI aplica). Um `drop constraint` sem `add` depois
 *   apaga a entrada — é o que o banco fica tendo, e modelar isso é o que impede
 *   de cobrar do baseline uma constraint que a cadeia derrubou de propósito.
 * * **No baseline**: a última definição do arquivo, que é o bloco do apêndice
 *   quando ele existe e a linha do dump quando não existe. Medido hoje: das 176
 *   constraints nomeadas no baseline, 118 vencem pelo apêndice e 58 pelo dump; 7
 *   aparecem duas vezes, e nas 7 a definição de baixo é a que o Postgres deixa de
 *   pé (o padrão idempotente `create table if not exists … constraint X` mais um
 *   `drop`+`add` para a base que já existe). Posição no arquivo É a regra, e ela
 *   coincide com a doutrina "uma constraint, um bloco" que
 *   `baseline-constraint-reconstruida.test.ts` cobra do apêndice.
 *
 * ## O que este arquivo NÃO mede, e por quê
 *
 * CHECK de coluna **sem nome** (`status text check (status in (…))`), que o
 * Postgres batiza sozinho de `<tabela>_<coluna>_check`. Medido: 52 constraints do
 * dump não têm par na cadeia, e todas são dessa forma — as migrations 0001 a 0007
 * são literalmente `SELECT 1;` (o schema original foi aplicado via MCP e nunca
 * virou texto em `migrations/`), então a cadeia no disco nunca as declara. Cobrar
 * a presença delas seria cobrar de um arquivo que não promete tê-las. Reinventar
 * o batismo automático do Postgres para casá-las seria arriscar atribuir o CHECK
 * à constraint errada — falso vermelho num gate novo, que é como um gate morre.
 * Por isso a comparação vale para o que os DOIS lados nomeiam, e a presença é
 * cobrada num sentido só: da cadeia para o baseline.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = join(process.cwd(), "supabase");

/** A definição de uma constraint que sobreviveu a tudo o que veio depois dela. */
interface Definicao {
  valores: Set<string>;
  origem: string;
}

/**
 * Tira comentário de SQL SEM cortar string literal.
 *
 * Não dá para usar um `replace(/--.*$/)` de linha aqui, e a diferença é
 * concreta: o bloco canônico do baseline explica cada valor com parágrafos de
 * `--` DENTRO da lista, e esses parágrafos têm parênteses ("(migration 0233,
 * chamada de voz)") e apóstrofos em português. Parêntese de comentário fecharia
 * a lista no lugar errado; apóstrofo de comentário viraria valor. E o inverso
 * também morde: `'--'` dentro de uma string é dado, não comentário.
 */
function semComentarios(sql: string): string {
  let saida = "";
  let i = 0;
  let emString = false;
  while (i < sql.length) {
    const c = sql[i]!;
    if (emString) {
      saida += c;
      // `''` é apóstrofo escapado, não fim de string. (Barra invertida não é
      // escape aqui: `standard_conforming_strings` é o padrão, e medido, não há
      // uma única sequência `\'` nos dois artefatos.)
      if (c === "'") {
        if (sql[i + 1] === "'") {
          saida += "'";
          i += 2;
          continue;
        }
        emString = false;
      }
      i++;
      continue;
    }
    if (c === "'") {
      emString = true;
      saida += c;
      i++;
      continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    saida += c;
    i++;
  }
  return saida;
}

/**
 * Conteúdo do `check (…)` a partir do parêntese que o abre, contando níveis.
 *
 * Parar no primeiro `)` é o que os parsers irmãos fazem, e ali é seguro porque
 * eles só olham `in (…)`. Aqui não dá: o dump escreve `CHECK ((x = ANY (ARRAY[…])))`
 * e o apêndice tem coerências de várias cláusulas entre parênteses. Ler até o
 * primeiro fechamento devolveria uma lista truncada — divergência inventada.
 */
function corpoDoCheck(sql: string, indiceDoAbre: number): string | null {
  let nivel = 0;
  let emString = false;
  for (let i = indiceDoAbre; i < sql.length; i++) {
    const c = sql[i]!;
    if (emString) {
      if (c === "'") {
        if (sql[i + 1] === "'") {
          i++;
          continue;
        }
        emString = false;
      }
      continue;
    }
    if (c === "'") {
      emString = true;
      continue;
    }
    if (c === "(") nivel++;
    else if (c === ")") {
      nivel--;
      if (nivel === 0) return sql.slice(indiceDoAbre + 1, i);
    }
  }
  return null;
}

function literaisDe(corpo: string): Set<string> {
  return new Set(
    [...corpo.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]!.replace(/''/g, "'")),
  );
}

/**
 * Casa as três escritas de uma constraint nomeada: `add constraint X check (…)`
 * do apêndice, `constraint X check (…)` de dentro de um `create table`, e
 * `CONSTRAINT "X" CHECK (…)` com aspas, que é como o `pg_dump` escreve.
 */
const DEFINE = /\bconstraint\s+"?([a-z0-9_]+)"?\s+check\s*\(/gi;
/**
 * O `%I` do `execute format('… drop constraint %I', …)` não casa aqui de
 * propósito: o nome é resolvido em tempo de execução e nenhuma leitura estática
 * sabe qual constraint cai. Derrubar uma que não foi derrubada é falso vermelho.
 */
const DERRUBA = /\bdrop\s+constraint\s+(?:if\s+exists\s+)?"?([a-z0-9_]+)"?/gi;

/** Aplica um arquivo SQL sobre o estado acumulado, na ordem em que ele executa. */
function aplicar(estado: Map<string, Definicao>, sqlBruto: string, origem: string): void {
  const sql = semComentarios(sqlBruto);
  const eventos: Array<{ pos: number; nome: string; valores: Set<string> | null }> = [];
  for (const m of sql.matchAll(DEFINE)) {
    const corpo = corpoDoCheck(sql, m.index + m[0].length - 1);
    // Parêntese desbalanceado não vira "constraint sem valores" — vira nada. A
    // diferença importa: uma lista vazia se compararia como vocabulário vazio e
    // passaria despercebida; a ausência some do conjunto medido e cai no piso do
    // controle de vivacidade abaixo.
    if (corpo === null) continue;
    eventos.push({ pos: m.index, nome: m[1]!.toLowerCase(), valores: literaisDe(corpo) });
  }
  for (const m of sql.matchAll(DERRUBA)) {
    eventos.push({ pos: m.index, nome: m[1]!.toLowerCase(), valores: null });
  }
  for (const e of eventos.sort((a, b) => a.pos - b.pos)) {
    if (e.valores === null) estado.delete(e.nome);
    else estado.set(e.nome, { valores: e.valores, origem });
  }
}

const naCadeia = (() => {
  const acc = new Map<string, Definicao>();
  for (const arquivo of readdirSync(join(RAIZ, "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    aplicar(acc, readFileSync(join(RAIZ, "migrations", arquivo), "utf8"), arquivo);
  return acc;
})();

const noBaseline = (() => {
  const acc = new Map<string, Definicao>();
  aplicar(acc, readFileSync(join(RAIZ, "baseline.sql"), "utf8"), "baseline.sql");
  return acc;
})();

const ordenado = (s: Set<string>): string[] => [...s].sort();

describe("vocabulário de CHECK — a cadeia de migrations e o baseline dizem o mesmo", () => {
  it("a sonda está viva — mede constraint de verdade nos dois lados", () => {
    // Um parser que parasse de casar devolveria mapas vazios, e os dois casos
    // abaixo passariam por vacuidade: verde por não ter medido nada. Os pisos
    // vêm da medição de 2026-09-19 (120 na cadeia, 172 no baseline, 120 em
    // comum, 335 literais) com folga para baixo — eles guardam contra o parser
    // morrer, não contra o schema crescer.
    expect(naCadeia.size, "nenhuma constraint nomeada na cadeia").toBeGreaterThan(80);
    expect(noBaseline.size, "nenhuma constraint nomeada no baseline").toBeGreaterThan(120);

    const comuns = [...naCadeia.keys()].filter((n) => noBaseline.has(n));
    expect(comuns.length, "nada em comum — os dois lados deixaram de se encontrar").toBeGreaterThan(
      80,
    );
    const literais = comuns.reduce((n, c) => n + naCadeia.get(c)!.valores.size, 0);
    expect(literais, "as constraints em comum não têm valor nenhum").toBeGreaterThan(250);
  });

  it("o instrumento enxerga as duas notações, o comentário e a diferença nos dois sentidos", () => {
    const ler = (sql: string) => {
      const m = new Map<string, Definicao>();
      aplicar(m, sql, "sintético");
      return m;
    };

    // `in (…)` e `= any (array[…])` são a MESMA constraint escrita por mãos
    // diferentes. Se algum dia deixarem de colapsar no mesmo conjunto, este gate
    // vira ruído e ninguém o lê — é o controle mais importante do arquivo.
    const mao = ler("alter table t add constraint c_check check (p in ('waha', 'zernio'));");
    const dump = ler(
      `CREATE TABLE "t" (\n  CONSTRAINT "c_check" CHECK (("p" = ANY (ARRAY['waha'::"text", 'zernio'::"text"])))\n);`,
    );
    expect(ordenado(mao.get("c_check")!.valores)).toEqual(["waha", "zernio"]);
    expect(ordenado(dump.get("c_check")!.valores)).toEqual(ordenado(mao.get("c_check")!.valores));

    // Comentário com parêntese e apóstrofo no meio da lista: o parêntese não pode
    // fechar a lista antes da hora, e a prosa não pode virar valor.
    const comentado = ler(
      "alter table t add constraint c_check check (p in (\n" +
        "  'waha',\n" +
        "  -- 'zernio_social' (migration 0343) entra aqui; não é valor, é prosa\n" +
        "  'wacalls'\n" +
        "));",
    );
    expect(ordenado(comentado.get("c_check")!.valores)).toEqual(["wacalls", "waha"]);

    // CONTAGEM IGUAL NÃO É CONJUNTO IGUAL: três de cada lado, um trocado. Um gate
    // que comparasse `length` estaria verde exatamente aqui.
    const a = ler("alter table t add constraint c_check check (p in ('a','b','c'));");
    const b = ler("alter table t add constraint c_check check (p in ('a','b','d'));");
    expect(a.get("c_check")!.valores.size).toEqual(b.get("c_check")!.valores.size);
    expect(ordenado(a.get("c_check")!.valores)).not.toEqual(ordenado(b.get("c_check")!.valores));

    // Constraint ausente some do mapa — nunca vira entrada de conjunto vazio, que
    // se compararia como "vocabulário vazio" e passaria por igual.
    expect(ler("select 1;").has("c_check")).toBe(false);
    // Derrubada e não reconstruída também some: é o que sobra no banco.
    expect(
      ler(
        "alter table t add constraint c_check check (p in ('a'));\n" +
          "alter table t drop constraint if exists c_check;",
      ).has("c_check"),
    ).toBe(false);
    // A ÚLTIMA definição vence, como no Postgres.
    expect(
      ordenado(
        ler(
          "alter table t add constraint c_check check (p in ('a'));\n" +
            "alter table t drop constraint if exists c_check;\n" +
            "alter table t add constraint c_check check (p in ('a','b'));",
        ).get("c_check")!.valores,
      ),
    ).toEqual(["a", "b"]);
  });

  it("toda constraint que a cadeia nomeia chega ao baseline", () => {
    const ausentes = [...naCadeia.entries()]
      .filter(([nome]) => !noBaseline.has(nome))
      .map(([nome, d]) => `${nome} (última em ${d.origem})`);

    expect(
      ausentes,
      "Uma migration cria a constraint e o apêndice do baseline.sql não a recebeu.\n" +
        "Quem aplica a cadeia ganha a proteção; quem instala pelo kit self-host — que aplica\n" +
        "SÓ o baseline — fica sem ela, e `pnpm test:db` não vê, porque ele também só aplica o\n" +
        "baseline. Acrescente o bloco idempotente (`drop constraint if exists` + `add constraint`)\n" +
        "ao apêndice, na mesma mudança.\n",
    ).toEqual([]);
  });

  it("o vocabulário da última definição da cadeia é o mesmo do baseline, valor a valor", () => {
    const divergentes: string[] = [];
    for (const [nome, daCadeia] of naCadeia) {
      const doBaseline = noBaseline.get(nome);
      if (doBaseline === undefined) continue; // presença é o caso acima
      const faltando = ordenado(doBaseline.valores).filter((v) => !daCadeia.valores.has(v));
      const sobrando = ordenado(daCadeia.valores).filter((v) => !doBaseline.valores.has(v));
      if (faltando.length === 0 && sobrando.length === 0) continue;
      divergentes.push(
        `${nome} — na cadeia (${daCadeia.origem}) sobra: ${sobrando.join(", ") || "(nada)"}; ` +
          `falta: ${faltando.join(", ") || "(nada)"}`,
      );
    }

    expect(
      divergentes,
      "A constraint aceita valores diferentes conforme o caminho de schema.\n" +
        "`sobra` é o que a migration aceita e o baseline recusa: é o caso do PR #963, e o\n" +
        "cliente que instala pela VPS bate 23514 no primeiro uso enquanto aqui passa.\n" +
        "`falta` é o contrário: uma reconstrução na cadeia encolheu o vocabulário, e o clone\n" +
        "que usa `supabase db push` para de aceitar o que já aceitava — em silêncio, porque\n" +
        "quem grava captura o 23514 e segue.\n" +
        "Conserto: acrescente o valor ao bloco canônico do apêndice (UM bloco por constraint),\n" +
        "ou traga uma migration forward-fix com a lista inteira. Editar migration aplicada é\n" +
        "proibido.\n",
    ).toEqual([]);
  });
});
