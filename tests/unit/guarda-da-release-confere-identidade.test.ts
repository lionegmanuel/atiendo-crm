import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

/**
 * A GUARDA DA RELEASE CONFERE IDENTIDADE, E NÃO NOME — issue #478.
 *
 * ═══ O defeito ══════════════════════════════════════════════════════════════
 *
 * A guarda perguntava ao git quem escreveu o commit:
 *
 *     [ "$(git log -1 --format=%an "$sha")" = "deskcomm-release[bot]" ]
 *
 * `%an` é NOME DE AUTOR — campo de texto que quem commita escolhe, e que
 *       git -c user.name='deskcomm-release[bot]' commit
 * devolve exatamente como pedido. Pior: a string procurada é LITERAL no próprio
 * release.yml (o `git config user.name` do ato 1), então a guarda comparava o
 * commit com uma constante escrita no repositório que ela vigia. Nome não é
 * identidade, e constante no repositório não é prova.
 *
 * ═══ A medida (2026-09-18, nesta `main`) ════════════════════════════════════
 *
 *   commit    o que o git diz (%an)   o que a API diz do PR de origem
 *   3a4df3cb  deskcomm-release[bot]   deskcommcrm-release[bot], Bot, PR #1160, head release/1.34.0, melgarafael/DeskcommCRM
 *   577c46e9  deskcomm-release[bot]   deskcommcrm-release[bot], Bot, PR #1136, head release/1.33.0, melgarafael/DeskcommCRM
 *   d73c32cc  Rafael Melgaço          deskcommopp4s-cmd,       User, PR #1112, head fix/EPIC-13-credencial-editavel, deskcommopp4s-cmd/deskcomm-fixes
 *
 * O nome no git NEM é o login da identidade: `%an` é um rótulo. A identidade é
 * `user.login` + `user.type` + `head.ref`/`head.repo`, que o commit não escolhe.
 * (Nem adianta trocar por assinatura: os cortes reais daqui dão `%G? = N`.)
 *
 * ═══ O que a guarda passa a aceitar ═════════════════════════════════════════
 *
 * Duas provas, as duas de fora do git — a issue #478 pede a primeira e cita a
 * segunda como alternativa:
 *
 *   1. o PR de origem foi aberto pelo bot do App que este workflow usa
 *      (`<app-slug>[bot]`, tipo `Bot`);
 *   2. o head do PR é `release/*` do PRÓPRIO repositório de cima, que é o
 *      caminho que o ato 1 abre. Fork não conta: quem não tem escrita no
 *      repositório de cima não cria branch lá nem mergeia um PR dele.
 *
 * ═══ Por que aqui roda o bash do workflow, com um `gh` de mentira ══════════
 *
 * O bloco `run:` é EXTRAÍDO do release.yml e executado: o que está sob teste é
 * o arquivo que o CI usa, não uma reescrita em TS que envelhece sozinha. A
 * pergunta à API entra por um stub no PATH (`montarStub`), porque teste que
 * fala com a rede mede o humor da rede — e no CI o `gh` existe e está
 * autenticado, o que tornaria o resultado dependente de qual repositório é.
 *
 * ⚠️ O caso central é a FORJA: commit com o nome de autor do App, PR de outra
 * pessoa. A guarda antiga aceitava isso. A nova tem de reprovar — e o teste
 * CONFERE o `%an` do commit forjado ANTES de esperar a recusa, senão a recusa
 * poderia estar passando só porque não havia forja nenhuma ali.
 */

const RAIZ = process.cwd();

/** O nome de autor que o ato 1 do release.yml grava: literal, e por isso forjável. */
const NOME_DE_AUTOR_QUE_O_APP_GRAVA = "deskcomm-release[bot]";

/** O login com que a API apresenta o App — o e-mail do corte real confirma o slug. */
const LOGIN_DO_APP = "deskcommcrm-release[bot]";
const REPO_DE_CIMA = "melgarafael/DeskcommCRM";

/** Uma linha no formato que o `--jq` da guarda produz: cinco campos por TAB. */
function linhaDaApi(login: string, tipo: string, ref: string, repo: string, numero: number): string {
  return [login, tipo, ref, repo, String(numero)].join("\t");
}

/** Corte real do App (PR #1160, 3a4df3cb) — só o head é o do repositório sintético. */
const RESPOSTA_DO_APP = linhaDaApi(LOGIN_DO_APP, "Bot", "release/9.9.9", REPO_DE_CIMA, 1160);

/** PR real de gente (PR #1112, d73c32cc): usuário, head de fork — nada de release. */
const RESPOSTA_DE_GENTE = linhaDaApi(
  "deskcommopp4s-cmd",
  "User",
  "fix/EPIC-13-credencial-editavel",
  "deskcommopp4s-cmd/deskcomm-fixes",
  1112,
);

/** O bloco `run:` do passo que decide se este push foi um corte. */
function bashDaGuarda(): string {
  const yml = readFileSync(join(RAIZ, ".github/workflows/release.yml"), "utf8");
  const inicio = yml.indexOf("Este push foi um corte de release?");
  expect(inicio, "o passo da guarda sumiu do release.yml").toBeGreaterThan(-1);
  const run = yml.indexOf("run: |", inicio);
  expect(run, "o passo da guarda não tem bloco run").toBeGreaterThan(-1);

  const linhas = yml.slice(run + "run: |".length).split("\n").slice(1);
  const corpo: string[] = [];
  for (const l of linhas) {
    // O bloco acaba na primeira linha não-vazia com indentação menor que a dele.
    if (l.trim() !== "" && !l.startsWith("          ")) break;
    corpo.push(l.slice(10));
  }
  return corpo.join("\n");
}

let repo = "";
let stub = "";
let contador = 0;

function git(args: string[], opts: { autor?: string } = {}): string {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  if (opts.autor) {
    const email = `${opts.autor.replace(/[^\w.@+-]/g, ".")}@exemplo.test`;
    Object.assign(env, {
      GIT_AUTHOR_NAME: opts.autor,
      GIT_COMMITTER_NAME: opts.autor,
      GIT_AUTHOR_EMAIL: email,
      GIT_COMMITTER_EMAIL: email,
    });
  }
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", env }).trim();
}

/**
 * O `gh` de mentira, no PATH antes do de verdade.
 *
 * A guarda agora pergunta à API quem abriu o PR de origem deste commit — e num
 * teste essa pergunta não pode sair para a rede: o resultado dependeria do que
 * a internet diz no minuto do run. Este stub ignora os argumentos e imprime o
 * que a API responderia; quem escolhe a resposta é o caso, em `GH_RESPOSTA`.
 *
 * Sem ele, todo caso daqui morreria no passo que recusa por falta de prova — e
 * a suíte passaria a medir outra coisa que não a guarda.
 */
function montarStub(dir: string) {
  const caminho = join(dir, "gh");
  writeFileSync(
    caminho,
    [
      '#!/usr/bin/env bash',
      '[ -n "${GH_FALHA}" ] && exit 1',
      '[ -n "${GH_RESPOSTA}" ] && printf \'%s\\n\' "${GH_RESPOSTA}"',
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(caminho, 0o755);
}

function fragmento(nome: string, impacto = "nada_mudou") {
  mkdirSync(join(repo, ".changes"), { recursive: true });
  writeFileSync(
    join(repo, ".changes", nome),
    `---\nimpacto: ${impacto}\nsecao: corrigido\ntitulo: ${nome}\n---\n\ncorpo.\n`,
  );
}

function commit(mensagem: string, autor = "Alguém do time"): string {
  git(["add", "-A"]);
  git(["commit", "-q", "-m", mensagem], { autor });
  return git(["rev-parse", "HEAD"]);
}

/**
 * Um repositório novo por caso, com o git configurado como a máquina que roda
 * o gate o configura — inclusive `diff.renames=false`, que é o estado que
 * obriga a guarda a pedir `--find-renames` na mão.
 */
function novoRepo() {
  if (repo) rmSync(repo, { recursive: true, force: true });
  repo = mkdtempSync(join(tmpdir(), "guarda-identidade-"));
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.name", "Alguém do time"]);
  git(["config", "user.email", "alguem@exemplo.test"]);
  git(["config", "commit.gpgsign", "false"]);
  git(["config", "diff.renames", "false"]);
  writeFileSync(join(repo, "CHANGELOG.md"), "# Changelog\n");
  mkdirSync(join(repo, ".changes"), { recursive: true });
  writeFileSync(join(repo, ".changes/.gitkeep"), "");
  commit("chore: raiz");
}

/**
 * Monta um commit com a FORMA de um corte: um branch que apaga fragmentos
 * declarados, escreve a seção no CHANGELOG e mergeia com `--no-ff` — o merge
 * que o App faz. O nome do autor e o nome do branch são escolhidos pelo caso,
 * porque são justamente o que está em julgamento.
 */
function corteDeMentira(nomeDoBranch: string, autor: string): string {
  fragmento("a.md");
  fragmento("b.md");
  const antes = commit("feat: dois fragmentos declarados");

  git(["checkout", "-q", "-b", nomeDoBranch, antes]);
  rmSync(join(repo, ".changes/a.md"));
  rmSync(join(repo, ".changes/b.md"));
  writeFileSync(join(repo, "CHANGELOG.md"), "# Changelog\n\n## [9.9.9] — a seção que autoriza a tag\n");
  commit("release(9.9.9): a versão montada a partir dos fragmentos", autor);
  git(["checkout", "-q", "main"]);
  // O merge também é assinado: no corte real o App abre o PR E mergeia, então
  // os dois commits que a guarda antiga podia olhar trazem o nome dela.
  git(["merge", "-q", "--no-ff", "-m", `Merge pull request #9999 from ${nomeDoBranch}`, nomeDoBranch], { autor });
  return git(["rev-parse", "HEAD"]);
}

interface Resultado {
  status: number;
  decisao: string;
  saida: string;
}

/**
 * Roda a guarda de VERDADE, como se `HEAD` fosse `sha`, com a API respondendo
 * `resposta`.
 *
 * Devolve o status em vez de deixar a exceção subir: `expect(...).toThrow()`
 * sozinho é VÁCUO — qualquer coisa que derrube o bash satisfaria o caso, e a
 * recusa passaria a valer pelo motivo errado. Aqui o `status` é afirmado, e a
 * saída é lida.
 */
function rodarGuarda(sha: string, respostaDaApi: string, opts: { apiFalha?: boolean } = {}): Resultado {
  const original = bashDaGuarda();

  // A versão vem do CHANGELOG por um script de TS que não existe no repo
  // sintético; ela é irrelevante aqui e fica num número sem tag, para não sair
  // pelo primeiro `if`. `[^\n]*` e não `.*$`: com `$` e a flag `m`, um `\r` de
  // fim de linha faz a âncora não casar, a substituição vira NO-OP SILENCIOSA,
  // e o script tenta rodar `pnpm exec tsx` no repositório temporário.
  const script = original
    .replace(/^[ \t]*versao=\$\([^\n]*\)[ \t\r]*$/m, 'versao="999.999.999"')
    .replace(/HEAD\^2/g, `${sha}^2`)
    .replace(/HEAD\^/g, `${sha}^`)
    .replace(/\bHEAD\b/g, sha);

  expect(script, "a linha `versao=$(...)` não foi substituída — o script rodaria o cortar-release de verdade").not.toMatch(
    /cortar-release\.ts/,
  );

  const saidaDoGithub = join(repo, `.github-output-${process.pid}-${contador++}`);
  writeFileSync(saidaDoGithub, "");

  const env = {
    ...process.env,
    PATH: `${stub}:${process.env.PATH}`,
    GH_RESPOSTA: respostaDaApi,
    GH_FALHA: opts.apiFalha ? "1" : "",
    GITHUB_OUTPUT: saidaDoGithub,
    GITHUB_REPOSITORY: REPO_DE_CIMA,
    GITHUB_SHA: sha,
    APP_SLUG: "deskcommcrm-release",
  };

  try {
    const saida = execFileSync("bash", ["-c", script], {
      cwd: repo,
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    }) as string;
    return { status: 0, decisao: /cortar=(\w+)/.exec(`${saida}\n${readFileSync(saidaDoGithub, "utf8")}`)?.[1] ?? "(nenhuma decisão)", saida };
  } catch (err) {
    const e = err as { stderr?: Buffer | string; stdout?: Buffer | string; status?: number };
    const detalhe = [
      `exit=${e.status ?? "?"}`,
      `stderr: ${String(e.stderr ?? "").trim() || "(vazio)"}`,
      `stdout: ${String(e.stdout ?? "").trim() || "(vazio)"}`,
      `GITHUB_OUTPUT: ${readFileSync(saidaDoGithub, "utf8").trim() || "(vazio)"}`,
    ].join("\n");
    return { status: e.status ?? -1, decisao: "(recusou)", saida: detalhe };
  }
}

beforeEach(() => {
  novoRepo();
  if (!stub) {
    stub = mkdtempSync(join(tmpdir(), "gh-de-mentira-"));
    montarStub(stub);
  }
});

afterAll(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
  if (stub) rmSync(stub, { recursive: true, force: true });
});

describe("a guarda confere IDENTIDADE pelo PR de origem, não pelo nome do autor", () => {
  it("A FORJA: nome de autor do App num PR de gente REPROVA — e a guarda antiga aceitava", () => {
    // A forma exata da #478. O commit é idêntico a um corte por fora: apaga os
    // fragmentos, escreve a seção, mergeia com --no-ff. Só o PR de origem não é
    // do App — e é a única coisa que não dá para forjar de dentro do commit.
    const forjado = corteDeMentira("chore/limpeza-de-fragmentos", NOME_DE_AUTOR_QUE_O_APP_GRAVA);

    // A forja é REAL: a string que a guarda antiga procurava está nos dois
    // commits que ela podia olhar. Sem esta linha, a recusa abaixo poderia
    // estar passando por não haver forja nenhuma ali.
    expect(git(["log", "-1", "--format=%an", forjado])).toBe(NOME_DE_AUTOR_QUE_O_APP_GRAVA);
    expect(
      git(["log", "-1", "--format=%an", `${forjado}^2`]),
      "a ponta do branch de release — o commit que a guarda antiga olhava",
    ).toBe(NOME_DE_AUTOR_QUE_O_APP_GRAVA);

    const r = rodarGuarda(forjado, RESPOSTA_DE_GENTE);
    expect(r.status, "a guarda tem de sair com 1, e não morrer por outro motivo").toBe(1);
    expect(r.saida).toMatch(/não foi aberto pelo App da release/);
    // A recusa cita o dado de FORA do git: quem a API diz que abriu o PR.
    expect(r.saida).toMatch(/deskcommopp4s-cmd/);
  });

  it("o nome do autor não manda: PR do App com nome de autor QUALQUER corta (controle positivo)", () => {
    // Sem este caso, \"recusa sempre\" satisfaria o anterior — e a guarda viraria
    // um portão fechado com outro nome.
    const legitimo = corteDeMentira("release/9.9.9", "Fulano de Tal");
    expect(git(["log", "-1", "--format=%an", legitimo])).toBe("Fulano de Tal");
    const r = rodarGuarda(legitimo, RESPOSTA_DO_APP);
    expect(r.status, `a guarda derrubou o passo: ${r.saida}`).toBe(0);
    expect(r.decisao).toBe("sim");
  });
});

describe("a alternativa que a issue cita: head `release/*` do repositório de cima", () => {
  it("PR aberto por gente, com head release/9.9.9 DESTE repositório, corta", () => {
    const corte = corteDeMentira("release/9.9.9", "Fulano de Tal");
    const r = rodarGuarda(corte, linhaDaApi("deskcommopp4s-cmd", "User", "release/9.9.9", REPO_DE_CIMA, 1112));
    expect(r.status, `a guarda derrubou o passo: ${r.saida}`).toBe(0);
    expect(r.decisao).toBe("sim");
  });

  it("o mesmo head num FORK não corta — o fork não é o repositório de cima", () => {
    const corte = corteDeMentira("release/9.9.9", NOME_DE_AUTOR_QUE_O_APP_GRAVA);
    const r = rodarGuarda(
      corte,
      linhaDaApi("deskcommopp4s-cmd", "User", "release/9.9.9", "deskcommopp4s-cmd/deskcomm-fixes", 1112),
    );
    expect(r.status, "a guarda tem de sair com 1, e não morrer por outro motivo").toBe(1);
    expect(r.saida).toMatch(/deskcommopp4s-cmd/);
  });

  it("commit sem PR de origem nenhum não corta, nem com o nome de autor do App", () => {
    const corte = corteDeMentira("chore/parece-release", NOME_DE_AUTOR_QUE_O_APP_GRAVA);
    const r = rodarGuarda(corte, "");
    expect(r.status, "a guarda tem de sair com 1, e não morrer por outro motivo").toBe(1);
    expect(r.saida).toMatch(/nenhum PR de origem/);
  });
});

describe("a borda do --diff-filter=D: renomear fragmento não é consumir fragmento", () => {
  it("fragmento RENOMEADO não conta como removido, e a guarda não corta tag por isso", () => {
    // A guarda roda com o git DESTA máquina. Com `diff.renames=false` (o que
    // `novoRepo` configura), o git sem a flag põe o caminho ANTIGO na lista de
    // removidos: um rename passaria a contar como \"fragmento consumido\" sem
    // ninguém ter consumido nada. As duas medidas abaixo são a borda inteira.
    fragmento("a.md");
    commit("feat: um fragmento declarado");
    git(["mv", ".changes/a.md", ".changes/za.md"]);
    const renomeado = commit("chore: renomeia o fragmento para arrumar a ordem alfabética");

    const semFlag = git(["diff", "--diff-filter=D", "--name-only", `${renomeado}^`, renomeado, "--", ".changes/"]);
    const comFlag = git(["diff", "--find-renames", "--diff-filter=D", "--name-only", `${renomeado}^`, renomeado, "--", ".changes/"]);
    expect(semFlag, "sem --find-renames o git lista o caminho antigo: é o que a flag fecha").toContain(".changes/a.md");
    expect(comFlag, "com --find-renames o rename não é remoção").toBe("");

    // E a guarda, com a flag, decide que este push não foi um corte — em vez de
    // exigir do PR de origem uma identidade que não tem nada com o caso.
    const r = rodarGuarda(renomeado, RESPOSTA_DE_GENTE);
    expect(r.status, `a guarda derrubou o passo: ${r.saida}`).toBe(0);
    expect(r.decisao).toBe("nao");
  });
});

describe("a API só é consultada quando há fragmento apagado", () => {
  it("push comum (zero removidos) com a API fora do ar NÃO pinta o workflow de vermelho", () => {
    // Antes, a pergunta à API rodava em todo push para a main e saía `exit 1`
    // quando a API soluçava — num merge que não corta nada.
    fragmento("a.md");
    const comum = commit("feat: um PR comum, com o seu fragmento");
    const r = rodarGuarda(comum, "", { apiFalha: true });
    expect(r.status, `a guarda derrubou o passo: ${r.saida}`).toBe(0);
    expect(r.decisao).toBe("nao");
  });

  it("com fragmento apagado e a API fora do ar, a guarda RECUSA (controle: a falha ainda fecha)", () => {
    const corte = corteDeMentira("release/9.9.9", "Fulano de Tal");
    const r = rodarGuarda(corte, RESPOSTA_DO_APP, { apiFalha: true });
    expect(r.status, "a guarda tem de sair com 1, e não morrer por outro motivo").toBe(1);
    expect(r.saida).toMatch(/não conseguiu perguntar à API/);
  });
});
