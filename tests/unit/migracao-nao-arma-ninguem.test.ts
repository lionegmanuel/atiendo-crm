/**
 * A MIGRATION 0159 NÃO ARMA NINGUÉM — E ISSO É PROPRIEDADE DO TEXTO, NÃO PROMESSA.
 *
 * ## O que está em jogo
 *
 * A 0159 liga o teto da tela (`ai_budgets.monthly_limit_cents`) ao gate que
 * recusa chamadas de LLM. Aquela coluna tem `DEFAULT 5000` e os dois backfills do
 * `baseline.sql` criam linha para **toda** organização em todo `install.sh` e todo
 * `update.sh` — então "escolhi US$ 50" é indistinguível de "nunca abri a tela".
 * Uma única linha de SQL que escrevesse `enforcement_mode = 'bloquear'` fora do
 * bloco de resgate calaria o WhatsApp de todo negócio que atualizasse, sem
 * ninguém ter pedido, numa VPS onde não há para quem ligar.
 *
 * A barreira é o `DEFAULT 'off'` do `ALTER` e a ausência de UPDATE. Ausência não
 * se vê lendo o diff de quem já está convencido de que ela existe — e é
 * exatamente o tipo de propriedade que some numa "simplificação" futura, sem
 * nenhum gate ficando vermelho.
 *
 * ## Por que estático, e não em Postgres
 *
 * Um invariante de banco mede o ESTADO depois de aplicar tudo. Ele pega o caso
 * "o default virou 'bloquear'", mas não distingue "esta migration não escreve"
 * de "esta migration escreve e algo depois desfaz". A regra que quero fixar é
 * sobre o ARQUIVO: o único bloco autorizado a escrever `'bloquear'` é o resgate
 * B->A, rotulado e delimitado. É onde a regra mora, então é onde ela é medida —
 * a mesma escolha de `tests/unit/varredura-anon-e-o-ultimo-bloco.test.ts`.
 *
 * E é deliberado que a propriedade central seja conferível **sem banco**: quem
 * revisa o PR não precisa de Docker para saber que ninguém é estrangulado.
 *
 * ## O terceiro detector, e a família de falha que ele fecha
 *
 * `(c)` proíbe qualquer `alter column monthly_limit_cents`. Esta migration não
 * faz nenhum, e o motivo está medido: um desenho concorrente punha
 * `update ... set monthly_limit_cents = null` dentro de um `do $$` e deixava o
 * `alter column ... drop not null` **depois** do bloco. Em instalação fresca
 * (`organizations` vazia) o UPDATE casava 0 linhas e o CI ficava verde; em clone
 * instalado ele estourava não-nulo, o `do $$` inteiro caía (é UM statement), o
 * `update.sh` — que roda **sem** `ON_ERROR_STOP` — engolia o erro e terminava com
 * exit 0, deixando a coluna nova **inexistente** e o release seguinte derrubando
 * toda chamada de IA com 42703. Um `drop not null` futuro reabre essa porta.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const MIGRATION = join(RAIZ, "supabase", "migrations", "20260814210000_0159_o_teto_que_vincula.sql");
const BASELINE = join(RAIZ, "supabase", "baseline.sql");

/** O cabeçalho do bloco compartilhado, idêntico nos dois arquivos. */
const ROTULO = "-- ---- o teto de IA que vincula (migration 0159) ----";

/** Os delimitadores do único bloco autorizado a armar alguém. */
const RESGATE_INICIO = "-- >>> RESGATE B->A: INICIO <<<";
const RESGATE_FIM = "-- >>> RESGATE B->A: FIM <<<";

/**
 * Substitui cada comentário `--` por espaços do MESMO comprimento.
 *
 * Apagá-los mudaria os offsets, e os offsets são o que liga uma ocorrência ao
 * bloco do resgate. Sem neutralizar os comentários, a prosa que EXPLICA a regra
 * ("o único bloco que escreve `enforcement_mode = 'bloquear'`…") seria acusada
 * como violação — o instrumento reprovando o arquivo por ele falar de si mesmo.
 */
function semComentarios(texto: string): string {
  return texto.replace(/--[^\n]*/g, (m) => " ".repeat(m.length));
}

/** Nº da linha (1-based) de um offset, para a falha ser acionável. */
function linhaDe(texto: string, offset: number): number {
  return texto.slice(0, offset).split("\n").length;
}

/**
 * O bloco compartilhado: do rótulo até o próximo cabeçalho `-- ---- ` ou o fim.
 *
 * Devolve `null` quando o rótulo sumiu — e não string vazia, que passaria por
 * todos os detectores como "nada a acusar".
 */
function blocoDoTeto(texto: string): string | null {
  const inicio = texto.indexOf(ROTULO);
  if (inicio === -1) return null;
  const resto = texto.slice(inicio + ROTULO.length);
  const fim = resto.indexOf("\n-- ---- ");
  return resto.slice(0, fim === -1 ? undefined : fim);
}

/** A faixa `[início, fim)` do bloco de resgate. `null` se os marcadores sumiram. */
function faixaDoResgate(texto: string): [number, number] | null {
  const i = texto.indexOf(RESGATE_INICIO);
  const f = texto.indexOf(RESGATE_FIM);
  if (i === -1 || f === -1 || f < i) return null;
  return [i, f + RESGATE_FIM.length];
}

interface Achado {
  linha: number;
  trecho: string;
}

function foraDoResgate(texto: string, offset: number): boolean {
  const faixa = faixaDoResgate(texto);
  if (faixa === null) return true;
  return offset < faixa[0] || offset >= faixa[1];
}

/**
 * (a) `enforcement_mode` recebendo qualquer coisa que não seja `'off'`.
 *
 * São DUAS formas de um valor entrar na coluna, e uma só não cobre a outra:
 *
 *   * `ATRIBUICAO` — `set enforcement_mode = 'bloquear'`, o UPDATE;
 *   * `DEFAULT_DA_COLUNA` — `add column … enforcement_mode text not null default
 *     'bloquear'`, que arma TODA linha existente de uma vez, sem UPDATE nenhum.
 *     É a forma mais perigosa das duas, porque não se parece com uma escrita.
 *
 * A primeira versão desta função tentou as duas num regex só
 * (`enforcement_mode\s*(?:=|default)`) e o controle negativo do DEFAULT reprovou:
 * entre o nome da coluna e a palavra `default` vem ` text not null `, que `\s*`
 * não atravessa. O detector estava cego justamente para o caminho que arma todo
 * mundo — e as asserções sobre os arquivos reais ficariam verdes.
 *
 * `[^;']*` no meio impede o casamento de atravessar o fim do statement ou entrar
 * numa string, então `check (enforcement_mode in ('off', …))` e
 * `comment on column …enforcement_mode is '…'` não casam. `<> 'bloquear'` também
 * não: depois do nome vem `<`, nunca `=`.
 */
const ATRIBUICAO = /enforcement_mode\s*=\s*'([a-z_]+)'/gi;
const DEFAULT_DA_COLUNA = /enforcement_mode\b[^;']*\bdefault\s+'([a-z_]+)'/gi;

function armaAlguem(texto: string): Achado[] {
  const limpo = semComentarios(texto);
  return [...limpo.matchAll(ATRIBUICAO), ...limpo.matchAll(DEFAULT_DA_COLUNA)]
    .filter((m) => (m[1] ?? "").toLowerCase() !== "off")
    .filter((m) => foraDoResgate(texto, m.index))
    .map((m) => ({ linha: linhaDe(texto, m.index), trecho: m[0] }));
}

/** (b) Escrita em `monthly_limit_cents` fora do resgate. */
function reescreveTeto(texto: string): Achado[] {
  const limpo = semComentarios(texto);
  return [...limpo.matchAll(/monthly_limit_cents\s*=/gi)]
    .filter((m) => foraDoResgate(texto, m.index))
    .map((m) => ({ linha: linhaDe(texto, m.index), trecho: m[0] }));
}

/** (c) Qualquer `alter column monthly_limit_cents`, em qualquer lugar. */
function mexeNaColuna(texto: string): Achado[] {
  const limpo = semComentarios(texto);
  return [...limpo.matchAll(/alter\s+column\s+"?monthly_limit_cents/gi)].map((m) => ({
    linha: linhaDe(texto, m.index),
    trecho: m[0],
  }));
}

/** Espaço em branco não é diferença de SQL. */
function normalizar(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

const migration = readFileSync(MIGRATION, "utf8");
const baseline = readFileSync(BASELINE, "utf8");

const ARQUIVOS: Array<{ nome: string; texto: string }> = [
  { nome: "supabase/migrations/20260814210000_0159_o_teto_que_vincula.sql", texto: migration },
  { nome: "supabase/baseline.sql", texto: baseline },
];

describe("0159 — a migration não arma ninguém", () => {
  describe("guardas de vacuidade (sem elas, verde por não medir nada)", () => {
    it("os dois arquivos existem e não estão vazios", () => {
      expect(migration.length).toBeGreaterThan(2000);
      expect(baseline.length).toBeGreaterThan(100000);
    });

    it("o rótulo do bloco aparece exatamente uma vez em cada arquivo", () => {
      for (const { nome, texto } of ARQUIVOS) {
        expect(texto.split(ROTULO).length - 1, `rótulo em ${nome}`).toBe(1);
      }
    });

    it("os marcadores do resgate aparecem uma vez em cada arquivo, na ordem", () => {
      for (const { nome, texto } of ARQUIVOS) {
        expect(texto.split(RESGATE_INICIO).length - 1, `INICIO em ${nome}`).toBe(1);
        expect(texto.split(RESGATE_FIM).length - 1, `FIM em ${nome}`).toBe(1);
        expect(faixaDoResgate(texto), `faixa em ${nome}`).not.toBeNull();
      }
    });

    it("o bloco compartilhado é o MESMO texto nos dois arquivos", () => {
      // Divergir aqui significa que o self-hoster recebe um SQL diferente do que
      // a migration afirma — o par que ninguém confere lendo só um dos dois.
      const naMigration = blocoDoTeto(migration);
      const noBaseline = blocoDoTeto(baseline);
      expect(naMigration).not.toBeNull();
      expect(noBaseline).not.toBeNull();
      expect(normalizar(noBaseline ?? "")).toEqual(normalizar(naMigration ?? ""));
    });

    it("o resgate REALMENTE arma alguém (controle positivo)", () => {
      // Sem isto a propriedade "só o resgate arma" seria satisfeita por um
      // arquivo que não arma ninguém em lugar nenhum — verde por ausência de
      // dado, que é o modo de falha desta família de teste.
      for (const { nome, texto } of ARQUIVOS) {
        const faixa = faixaDoResgate(texto);
        expect(faixa, nome).not.toBeNull();
        const dentro = texto.slice(faixa?.[0] ?? 0, faixa?.[1] ?? 0);
        expect(dentro, `o bloco de resgate de ${nome} não escreve 'bloquear'`).toMatch(
          /enforcement_mode\s*=\s*'bloquear'/i,
        );
        expect(dentro, `o bloco de resgate de ${nome} não escreve monthly_limit_cents`).toMatch(
          /monthly_limit_cents\s*=/i,
        );
      }
    });

    it("o neutralizador de comentários preserva os offsets", () => {
      const original = "abc -- comentário\ndef";
      expect(semComentarios(original)).toHaveLength(original.length);
      expect(semComentarios(original)).toBe("abc              \ndef");
    });
  });

  for (const { nome, texto } of ARQUIVOS) {
    describe(nome, () => {
      it("(a) nada escreve enforcement_mode ≠ 'off' fora do resgate", () => {
        expect(
          armaAlguem(texto),
          "Uma linha fora do bloco RESGATE B->A arma organizações que não pediram.\n" +
            "A barreira desta migration é a AUSÊNCIA de UPDATE: enforcement_mode nasce\n" +
            "'off' pelo DEFAULT do ALTER, e nenhum dado de hoje pode satisfazer a condição\n" +
            "de bloqueio. Escrever outro valor em qualquer outro bloco cala a IA de quem\n" +
            "só atualizou o sistema.",
        ).toEqual([]);
      });

      it("(b) nada reescreve monthly_limit_cents fora do resgate", () => {
        expect(
          reescreveTeto(texto),
          "Escrita em monthly_limit_cents fora do bloco RESGATE B->A.\n" +
            "Não tocar nessa coluna é o que torna o apêndice idempotente SEM guarda de\n" +
            "catálogo, e é o que impede o `update.sh` de sobrescrever, a cada atualização,\n" +
            "o teto que a pessoa escolheu na tela.",
        ).toEqual([]);
      });

      it("(c) nenhum `alter column monthly_limit_cents`", () => {
        expect(
          mexeNaColuna(texto),
          "`alter column monthly_limit_cents` reabre a família de falha que matou um\n" +
            "desenho concorrente: DDL que habilita um dado rodando DEPOIS do dado, erro\n" +
            "engolido pelo `update.sh` (que roda sem ON_ERROR_STOP), exit 0, e a coluna\n" +
            "nova inexistente no clone — 42703 em toda chamada de IA no release seguinte.",
        ).toEqual([]);
      });
    });
  }

  describe("controle negativo — o detector enxerga a violação quando ela existe", () => {
    // Sem estes casos, um regex quebrado deixaria TODAS as asserções acima verdes.
    // Contados como DELTA sobre o arquivo real: se um dia o arquivo estiver de
    // fato violando, quem fica vermelho são os casos acima, não estes.
    it("(a) acusa um UPDATE que arma todo mundo", () => {
      const sabotado = `${migration}\nupdate public.ai_budgets set enforcement_mode = 'bloquear';\n`;
      expect(armaAlguem(sabotado).length - armaAlguem(migration).length).toBe(1);
    });

    it("(a) acusa também um DEFAULT que arma na criação da coluna", () => {
      const sabotado = migration.replace(
        "add column if not exists enforcement_mode text not null default 'off';",
        "add column if not exists enforcement_mode text not null default 'bloquear';",
      );
      expect(sabotado).not.toEqual(migration);
      expect(armaAlguem(sabotado).length - armaAlguem(migration).length).toBe(1);
    });

    it("(b) acusa uma reescrita de teto fora do resgate", () => {
      const sabotado = `${migration}\nupdate public.ai_budgets set monthly_limit_cents = 0;\n`;
      expect(reescreveTeto(sabotado).length - reescreveTeto(migration).length).toBe(1);
    });

    it("(c) acusa o `drop not null` que matou o desenho concorrente", () => {
      const sabotado = `${migration}\nalter table public.ai_budgets alter column monthly_limit_cents drop not null;\n`;
      expect(mexeNaColuna(sabotado).length - mexeNaColuna(migration).length).toBe(1);
    });

    it("a prosa que descreve a regra não é confundida com código", () => {
      // Controle do controle: os comentários desta migration citam
      // `enforcement_mode = 'bloquear'` e `monthly_limit_cents` em texto corrido.
      const prosa =
        "-- o único bloco que escreve enforcement_mode = 'bloquear' é o resgate\n" +
        "-- e nenhuma linha faz monthly_limit_cents = null nem alter column monthly_limit_cents\n";
      expect(armaAlguem(prosa)).toEqual([]);
      expect(reescreveTeto(prosa)).toEqual([]);
      expect(mexeNaColuna(prosa)).toEqual([]);
    });
  });
});
