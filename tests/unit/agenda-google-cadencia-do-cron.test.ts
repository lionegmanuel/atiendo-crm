/**
 * A CADÊNCIA das rodadas da agenda — o que `cron-routes-scheduled` não vê.
 *
 * Aquele gate prova que a LINHA existe no crontab, e foi ele que acusou quando
 * as duas rotas do Google não estavam agendadas. Mas linha existir não é
 * cadência estar certa: um passo de 59 minutos passaria por ele e deixaria o
 * token do Google vencer entre dois ticks — a agenda morreria do mesmo jeito,
 * com o gate verde.
 *
 * (E este parágrafo já nasceu quebrado uma vez: escrever o passo de cron na
 * forma literal, com asterisco e barra, FECHA o comentário de bloco e o resto
 * do arquivo vira código. Prosa que contém o delimitador do próprio recipiente
 * é a mesma armadilha da crase dentro de aspas duplas no shell, que quebrou o
 * entrypoint meia hora atrás.)
 *
 * O que se guarda aqui é a RELAÇÃO entre dois números que moram em arquivos
 * diferentes: a janela de renovação, que é código TypeScript, e o intervalo do
 * crontab, que é um arquivo de shell. Ninguém que mexa num vê o outro.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { JANELA_DE_RENOVACAO_MS } from "@/app/api/v1/cron/agenda-google-refresh/route";

const ENTRYPOINT = readFileSync(
  path.join(process.cwd(), "docker/scheduler/entrypoint.sh"),
  "utf8",
);

/** O intervalo em minutos de uma rota, lido do campo de minuto do crontab. */
function intervaloEmMinutos(rota: string): number | null {
  const linha = ENTRYPOINT.split("\n").find(
    (l) => l.includes(`api/v1/cron/${rota}`) && l.includes("|"),
  );
  if (!linha) return null;
  const minuto = linha.split("|")[0]?.trim().split(/\s+/)[0] ?? "";
  if (minuto === "*") return 1;
  const passo = /^\*\/(\d+)$/.exec(minuto);
  if (passo?.[1]) return Number(passo[1]);
  // Minuto fixo (`17 * * * *`) = uma vez por hora.
  if (/^\d+$/.test(minuto)) return 60;
  return null;
}

describe("a cadência das rodadas da agenda do Google", () => {
  it("o CONTROLE: o leitor de cadência funciona numa rota conhecida", () => {
    // Sem isto, um leitor quebrado devolveria `null` para tudo e os casos
    // abaixo passariam por vacuidade — que é o modo de falha que esta sessão
    // já pagou três vezes.
    expect(intervaloEmMinutos("agent-dispatcher")).toBe(1);
    expect(intervaloEmMinutos("contact-phones")).toBe(30);
  });

  it("a renovação roda com FOLGA dentro da janela — senão o token vence entre ticks", () => {
    // A rodada só renova quem está a menos de `JANELA_DE_RENOVACAO_MS` do
    // vencimento. Se o intervalo do cron for maior ou igual à janela, existe um
    // token que entra na janela DEPOIS de um tick e vence ANTES do próximo — e
    // a agenda morre sem erro nenhum, que é o defeito que esta rota existe para
    // impedir.
    const janelaEmMinutos = JANELA_DE_RENOVACAO_MS / 60_000;
    const intervalo = intervaloEmMinutos("agenda-google-refresh");
    expect(intervalo).not.toBeNull();
    expect(intervalo!).toBeLessThan(janelaEmMinutos);
  });

  it("renovação e sync NÃO compartilham cadência — os custos são diferentes", () => {
    // Renovar é uma requisição por conexão que está VENCENDO; sincronizar é uma
    // por calendário, SEMPRE. Colar as duas obriga a escolher entre renovar raro
    // demais (a agenda morre) ou sincronizar caro demais (gasta cota do
    // cliente).
    const renovacao = intervaloEmMinutos("agenda-google-refresh");
    const sync = intervaloEmMinutos("agenda-google-sync");
    expect(renovacao).not.toBeNull();
    expect(sync).not.toBeNull();
    expect(sync).not.toBe(renovacao);
  });

  it("o sync tem prazo maior que o padrão — ele percorre paginação", () => {
    const linha = ENTRYPOINT.split("\n").find((l) => l.includes("api/v1/cron/agenda-google-sync"));
    const prazo = Number(linha?.split("|")[1] ?? 0);
    expect(prazo).toBeGreaterThan(60);
  });
});
