/**
 * A VARREDURA DE `anon` É O ÚLTIMO BLOCO DO BASELINE — E TEM QUE CONTINUAR SENDO.
 *
 * O `baseline.sql` traz, no corpo vindo do `pg_dump` do Supabase:
 *
 *     ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
 *       GRANT ALL ON FUNCTIONS TO anon;
 *
 * Isso não é uma linha cujo efeito acaba quando ela passa: grava uma entrada em
 * `pg_default_acl`, que fica no catálogo do banco. Depois que ela roda uma vez,
 * toda função criada em `public` a partir dali NASCE com `EXECUTE` para `anon` —
 * inclusive as de todo apêndice futuro. Numa instalação nova não incomoda (o
 * dump cria as funções antes da linha); em quem ATUALIZA, incomoda sempre.
 *
 * A cura (migration 0116) é uma varredura auto-curativa no fim do apêndice: ela
 * percorre todas as `security definer` de `public` e tira `anon`, preservando o
 * privilégio efetivo de `authenticated` e `service_role`. Funciona para função
 * que ainda nem existe — desde que rode DEPOIS de quem a cria.
 *
 * ## O defeito que este arquivo previne
 *
 * O apêndice do baseline cresce por acréscimo: cada migration cola o seu bloco
 * no fim do arquivo. É o movimento natural, e é exatamente o que desarma a cura
 * — um `create or replace function` colado ABAIXO da varredura cria a função com
 * `anon` no ACL e não há mais nada depois para tirar. O buraco volta calado, com
 * o gate verde: `install`/`update` do `scripts/test-db.sh` passam (a DDL é
 * válida), e `tests/invariants/hardening-definer-varredura.test.ts` também, se a
 * função nova ficar fora do que aquele invariante alcança.
 *
 * Não é hipótese de laboratório: é a diferença entre `install` e `update` já
 * medida numa VPS real em 2026-08-07 — 6 definer expostas a `anon`, entre elas
 * `fn_decrypt_oauth`, alcançável pela anon key, que vai para o browser.
 *
 * ## Por que estático
 *
 * A ordem dos blocos é uma propriedade do ARQUIVO, não do banco. Um teste em
 * Postgres mediria o estado final depois de aplicar tudo — e o estado final está
 * certo justamente enquanto a ordem estiver certa; ele só ficaria vermelho no dia
 * em que alguém colasse um bloco no lugar errado E o invariante de runtime desse
 * conta de olhar aquela função. Aqui a regra é medida onde ela mora: no texto.
 *
 * ## A regra
 *
 * Apêndice novo entra ANTES do bloco da varredura. Nenhuma função é criada
 * depois dele, e nenhum `grant` devolve `anon` depois dele.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const BASELINE = join(process.cwd(), "supabase", "baseline.sql");

/** O cabeçalho do bloco da 0116, no apêndice. */
const MARCADOR = /^-- ---- VARREDURA anon:/m;

/**
 * Criação de função ancorada em INÍCIO DE LINHA, e não em qualquer ocorrência do
 * texto: o próprio comentário do bloco explica que uma lista "reabre no próximo
 * `create function`". Casar solto acusaria a prosa que descreve a regra — o
 * instrumento reprovando o arquivo por ele falar de si mesmo.
 */
const CRIA_FUNCAO = /^[ \t]*create[ \t]+(?:or[ \t]+replace[ \t]+)?function/gim;

/** Devolve `anon` a algo — o outro jeito de desfazer a varredura por baixo. */
const GRANT_PARA_ANON = /^[ \t]*grant[ \t][^;]*\bto\b[^;]*\banon\b/gim;

function posicaoDaVarredura(sql: string): number {
  return MARCADOR.exec(sql)?.index ?? -1;
}

function posicoesDe(sql: string, padrao: RegExp): number[] {
  return [...sql.matchAll(padrao)].map((m) => m.index);
}

/** Nº da linha (1-based) de um offset, para a mensagem de falha ser acionável. */
function linhaDe(sql: string, offset: number): number {
  return sql.slice(0, offset).split("\n").length;
}

describe("baseline.sql — a varredura de anon é o último bloco", () => {
  const sql = readFileSync(BASELINE, "utf8");

  it("o instrumento acha o que precisa achar (guarda de vacuidade)", () => {
    // Sem isto, um marcador renomeado ou um regex quebrado fariam as asserções
    // abaixo passarem por ausência de dado — verde por não medir nada.
    expect(
      posicaoDaVarredura(sql),
      "bloco da varredura (migration 0116) não encontrado no baseline.sql — " +
        "ele foi removido, ou o cabeçalho '-- ---- VARREDURA anon:' foi reescrito?",
    ).toBeGreaterThan(-1);
    expect(posicoesDe(sql, CRIA_FUNCAO).length).toBeGreaterThan(40);
  });

  it("nenhuma função é criada depois da varredura", () => {
    const varredura = posicaoDaVarredura(sql);
    const depois = posicoesDe(sql, CRIA_FUNCAO)
      .filter((i) => i > varredura)
      .map((i) => `linha ${linhaDe(sql, i)}`);

    expect(
      depois,
      "Função criada DEPOIS do bloco da varredura de anon (que está na linha " +
        `${linhaDe(sql, varredura)}).\n` +
        "O ALTER DEFAULT PRIVILEGES do corpo do baseline faz toda função nova nascer com\n" +
        "EXECUTE para anon; a varredura cura isso, mas só para o que veio ANTES dela.\n" +
        "Mova o apêndice novo para cima do bloco — ele é, de propósito, o último do arquivo.",
    ).toEqual([]);
  });

  it("nenhum grant devolve anon depois da varredura", () => {
    // O outro caminho para o mesmo estrago: não criar função nova, e sim
    // reconceder o que a varredura acabou de tirar.
    const varredura = posicaoDaVarredura(sql);
    const depois = posicoesDe(sql, GRANT_PARA_ANON)
      .filter((i) => i > varredura)
      .map((i) => `linha ${linhaDe(sql, i)}`);

    expect(depois, "grant para anon depois da varredura — a cura é desfeita no mesmo run").toEqual(
      [],
    );
  });

  it("o instrumento enxerga a violação quando ela existe (controle negativo)", () => {
    // Sabotagem: o mesmo arquivo com um bloco colado DEPOIS da varredura, que é
    // exatamente o movimento natural de quem adiciona uma migration.
    const sabotado = `${sql}\n-- ---- alguma coisa (migration 9999) ----\ncreate or replace function public.fn_sabotagem() returns int\n  language sql as $$ select 1 $$;\n\ngrant execute on function public.fn_sabotagem() to anon;\n`;

    // Contado como DELTA sobre o arquivo real, não como total absoluto: se o
    // baseline um dia estiver de fato violando a regra, quem tem de ficar
    // vermelho são os casos acima — este aqui continua medindo só o detector.
    const depois = (texto: string, padrao: RegExp) =>
      posicoesDe(texto, padrao).filter((i) => i > posicaoDaVarredura(texto)).length;

    expect(depois(sabotado, CRIA_FUNCAO) - depois(sql, CRIA_FUNCAO)).toBe(1);
    expect(depois(sabotado, GRANT_PARA_ANON) - depois(sql, GRANT_PARA_ANON)).toBe(1);
  });

  it("a prosa do próprio bloco não é confundida com código", () => {
    // Controle do controle: o comentário da 0116 cita "create function" e "anon"
    // em texto corrido. Se o regex casasse comentário, o teste acima ficaria
    // vermelho para sempre e alguém o "consertaria" afrouxando a regra.
    const prosa =
      "-- Lista conserta o estoque e reabre no próximo `create function`.\n" +
      "-- grant execute on function public.fn_x() to anon;\n";
    expect(posicoesDe(prosa, CRIA_FUNCAO)).toEqual([]);
    expect(posicoesDe(prosa, GRANT_PARA_ANON)).toEqual([]);
  });
});
