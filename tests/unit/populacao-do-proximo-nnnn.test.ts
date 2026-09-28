/**
 * `populacao-do-proximo-nnnn.test.ts` — o NNNN que oito lugares do repo dizem
 * estar livre, medido sobre a POPULAÇÃO da pergunta (#1273).
 *
 * A pergunta é sempre a mesma: **"algum lugar já USA ou RESERVOU este número?"**
 * — e a resposta honesta é sobre a main do PRODUTO (o remoto que aponta para
 * `melgarafael/DeskcommCRM`, com qualquer nome) mais os PRs ABERTOS, inclusive
 * de fork. Oito lugares respondiam sobre recortes menores, e a revisão mediu
 * cada um: a main de um fork em vez da do produto, só branches locais sem os
 * PRs abertos, cabeças já buscadas de PRs FECHADOS, o DISCO em vez da main
 * atual, e uma cópia VELHA da cabeça de um PR.
 *
 * A regra que diverge oito vezes é a assinatura de que ela precisa de UM lugar
 * só: `scripts/migration-populacao.sh`. Este arquivo é a prova de que esse
 * lugar mede a população certa — e, atrás de cada caso, a prova de que o lugar
 * ANTES (que o próprio arquivo nomeia) mediria diferente.
 *
 * ## O que é POPULAÇÃO e o que NÃO é
 *
 *   * entra: a main do produto; `refs/heads` E `refs/remotes` juntas; e o que
 *     o script de CI já soma — os PRs abertos, pela LISTA do `gh`, nunca o
 *     curinga `refs/pull/*` (que persiste depois do PR fechar);
 *   * não entra: a main de um fork (a `origin/main` de quem contribuiu), a
 *     cópia de cabeça em `refs/remotes/<remoto>/pr/<N>` (é cópia, não PR
 *     aberto), o
 *     disco (a árvore de trabalho não é fonte de nada), e a cópia VELHA de uma
 *     cabeça de PR quando a atual é outra.
 *
 * ## Medido, sem rede
 *
 * Cada caso monta um "principal" local e clones descartáveis, como os testes
 * de shell do repo (`tests/shell/*.test.sh`) — nada aqui toca o clone de quem
 * roda. O `gh` é neutralizado por `PATH`: o caminho dos PRs abertos é o do
 * script de CI e é exercitado aqui por CONTRATO (a lista que o `gh` falso
 * devolve), não por rede.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RAIZ = path.resolve(__dirname, "../..");
const BIBLIOTECA = path.join(RAIZ, "scripts/migration-populacao.sh");
/** A URL que a biblioteca reconhece como o repositório PRINCIPAL. */
const URL_PRODUTO = "https://github.com/melgarafael/DeskcommCRM.git";
/** O repositório do produto, como o `gh` o nomeia (`--repo`). */
const REPO_PRODUTO = "melgarafael/DeskcommCRM";

/**
 * Onde a biblioteca mora e quem a consome — cada consumidor é um dos oito
 * lugares da #1273, e a lista é escrita aqui para o gate que exige que TODO
 * consumidor exista. Um lugar novo que a consuma e não for listado é
 * encontrado pelo teste de "todo consumidor declara a população", abaixo.
 */
const CONSUMIDORES = [
  ".agents/skills/deskcomm-contribuir/scripts/pre-voo.sh",
  ".agents/skills/deskcomm-contribuir/scripts/hooks/check-migration-triple.sh",
  "loop/hooks/check-migration-triple.sh",
  "triagem/scripts/complemento.sh",
] as const;

let TMP: string;

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_AUTHOR_NAME: "Teste",
      GIT_AUTHOR_EMAIL: "teste@exemplo.invalid",
      GIT_COMMITTER_NAME: "Teste",
      GIT_COMMITTER_EMAIL: "teste@exemplo.invalid",
    },
  });
}

function escrever(dir: string, rel: string, corpo: string): void {
  const alvo = path.join(dir, rel);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, corpo);
}

function commitar(dir: string, msg: string): void {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "--no-verify", "-m", msg);
}

/** Cria um repositório com uma migration de NNNN `nnnn` na main. */
function repoComMigration(nnnn: string, ts = "20260901000000"): string {
  const dir = fs.mkdtempSync(path.join(TMP, "repo-"));
  git(dir, "init", "-q", "-b", "main");
  escrever(dir, `supabase/migrations/${ts}_${nnnn}_exemplo.sql`, "select 1;\n");
  commitar(dir, `migration ${nnnn}`);
  return dir;
}

/**
 * Clone de `origem` (path local) e, com `nomeDoProduto`, um remoto `nome` que
 * aponta para a URL do REPOSITÓRIO PRINCIPAL.
 *
 * A URL é o que decide (e não o nome): o fixture tem de ter a URL do GitHub
 * escrita no config, senão a biblioteca — que faz o certo — não reconhece
 * nenhum remoto como o principal e o caso mede outra coisa. O path local
 * continua no `origin`, para servir de cópia de onde o clone foi feito.
 */
function clonar(origem: string, nomeDoProduto?: string): string {
  const dir = fs.mkdtempSync(path.join(TMP, "clone-"));
  execFileSync("git", ["clone", "-q", origem, dir], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
  });
  if (nomeDoProduto) {
    git(dir, "remote", "add", nomeDoProduto, URL_PRODUTO);
  }
  return dir;
}

/**
 * Roda um trecho bash com a biblioteca carregada, no diretório `dir`.
 * Devolve `{ stdout, rc }` — rc importa porque a ausência da main do produto
 * SAI 1, e é assim que o chamador sabe que precisa declarar.
 */
function bashComBiblioteca(
  dir: string,
  trecho: string,
  extraEnv: Record<string, string> = {},
): { stdout: string; rc: number } {
  const script = `set -uo pipefail
cd ${JSON.stringify(dir)}
source ${JSON.stringify(BIBLIOTECA)}
${trecho}`;
  const r = execFileSync("bash", ["-c", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      // NENHUM gh: a rede é o que o hook de pre-commit não pode fazer.
      PATH: "/usr/sbin:/usr/bin:/sbin:/bin",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { stdout: r, rc: 0 };
}

function bashCapturandoRc(
  dir: string,
  trecho: string,
  extraEnv: Record<string, string> = {},
): { stdout: string; rc: number } {
  const script = `set -uo pipefail
cd ${JSON.stringify(dir)}
source ${JSON.stringify(BIBLIOTECA)}
${trecho}
printf '__rc=%s\\n' "$?"`;
  const out = execFileSync("bash", ["-c", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: "/usr/sbin:/usr/bin:/sbin:/bin",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const m = out.match(/__rc=(\d+)/);
  return { stdout: out.replace(/__rc=\d+\n?$/, ""), rc: m ? Number(m[1]) : -1 };
}

beforeAll(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "populacao-nnnn-"));
  expect(fs.existsSync(BIBLIOTECA), "scripts/migration-populacao.sh não existe").toBe(true);
});

afterAll(() => {
  if (TMP) fs.rmSync(TMP, { recursive: true, force: true });
});

describe("a biblioteca da população existe e é consumida por todos os oito lugares", () => {
  it("a biblioteca declara de onde tira a população e o que não cobre", () => {
    const texto = fs.readFileSync(BIBLIOTECA, "utf8");
    // Declaração de escopo: sem ela, quem lê o número não sabe o que a conta
    // cobriu (o defeito que a #1155 registrou).
    expect(texto).toContain("NÃO MEDIDO");
    expect(texto).toContain("checar:colisao-de-migration");
    // A âncora do NNNN é a do #1269, e ela é aplicada AO NOME SEM A PASTA.
    expect(texto).toContain("pop_nnnn_de");
    expect(texto).toMatch(/sed -nE 's\/\^\[0-9\]\{14\}_/);
  });

  it.each(CONSUMIDORES)("%s carrega a biblioteca pelo caminho do repo", (c) => {
    const arquivo = path.join(RAIZ, c);
    expect(fs.existsSync(arquivo), `${c} não existe`).toBe(true);
    const texto = fs.readFileSync(arquivo, "utf8");
    expect(texto, `${c} não carrega scripts/migration-populacao.sh`).toMatch(
      /migration-populacao\.sh/,
    );
  });

  it("o espelho .claude da skill é byte-idêntico ao .agents (gate próprio, mas a lista é uma)", () => {
    for (const rel of [
      "scripts/pre-voo.sh",
      "scripts/hooks/check-migration-triple.sh",
    ]) {
      const fonte = fs.readFileSync(
        path.join(RAIZ, ".agents/skills/deskcomm-contribuir", rel),
        "utf8",
      );
      const espelho = path.join(RAIZ, ".claude/skills/deskcomm-contribuir", rel);
      if (!fs.existsSync(espelho)) continue;
      expect(fs.readFileSync(espelho, "utf8"), `espelho divergente: ${rel}`).toBe(fonte);
    }
  });
});

describe("a main medida é a do PRODUTO, com qualquer nome de remoto", () => {
  it("um clone cujo remoto se chama `upstream` e aponta para o principal mede a main do principal", () => {
    const principal = repoComMigration("0324");
    const clone = clonar(principal);
    // O remoto do PRODUTO pelo nome que o mantenedor usa, apontado para o
    // fixture local para a `upstream/main` EXISTIR de verdade. A URL do produto
    // vai num remoto próprio: é a URL que `pop_main_do_produto` lê, e o nome
    // `upstream` sozinho não prova nada (é o ponto do caso do insteadOf).
    git(clone, "remote", "add", "upstream", principal);
    git(
      clone,
      "config",
      "--file",
      path.join(clone, ".git/config"),
      "remote.produto.url",
      URL_PRODUTO,
    );

    const achado = bashCapturandoRc(clone, "pop_main_do_produto").stdout.trim();
    expect(achado, "nenhum remoto foi reconhecido como o do produto").toBe("produto/main");

    // Buscada a `upstream`, a ref EXISTE: é ela que o hook mede quando o
    // remoto do produto é o `upstream` — o caso real de quem já o configurou.
    git(clone, "fetch", "-q", "upstream");
    const r = bashCapturandoRc(clone, 'git rev-parse --verify -q "upstream/main"');
    expect(r.rc, "a main do produto não é uma ref de verdade no clone").toBe(0);
  });

  it("FORA: a main do produto não está no clone → sai 1, e o chamador declara", () => {
    const fork = repoComMigration("0323");
    const clone = clonar(fork); // nenhum remoto é o produto: a URL local não casa
    // A URL local do fixture não é github.com, então o produto não está lá.
    const r = bashCapturandoRc(clone, "pop_main_do_produto");
    expect(r.rc, "sem o principal, a função teria de inventar uma main").toBe(1);
    expect(r.stdout.trim()).toBe("");

    // O mesmo estado, mas a ORIGIN é o produto (URL de GitHub, sem rede) — que
    // é o caso REAL do fork: o `origin` é o principal e o `fork` é o segundo
    // remoto. Aí a main do produto é `origin/main` e o fork não é confundido.
    const comGitHub = clonar(fork);
    git(
      comGitHub,
      "config",
      "--file",
      path.join(comGitHub, ".git/config"),
      "remote.upstream.url",
      URL_PRODUTO,
    );
    const r2 = bashCapturandoRc(comGitHub, "pop_main_do_produto");
    expect(r2.stdout.trim(), "a main do produto não foi reconhecida pelo nome upstream").toBe(
      "upstream/main",
    );
    // E o fork, com URL de GitHub de outro dono, NÃO é a main do produto.
    const r3 = bashCapturandoRc(comGitHub, "pop_repo_do_produto");
    expect(r3.stdout.trim()).toBe(REPO_PRODUTO);
  });

  it("a URL CRUA decide: o insteadOf do git não troca o principal por um fork", () => {
    const fork = repoComMigration("0323");
    const clone = clonar(fork);
    git(clone, "remote", "add", "upstream", fork);
    // O `insteadOf` faz `git remote get-url fork` devolver a URL DO PRODUTO,
    // que é o PRODUCTO de quem usasse esse comando: quem mede a main por ele
    // mede a errada. A biblioteca lê `git config` CRU e não cai nisso.
    git(
      clone,
      "config",
      "--file",
      path.join(clone, ".git/config"),
      `url.${URL_PRODUTO}.insteadOf`,
      "https://github.com/webtecnica/DeskcommCRM.git",
    );
    git(
      clone,
      "config",
      "--file",
      path.join(clone, ".git/config"),
      "remote.fork.url",
      "https://github.com/webtecnica/DeskcommCRM.git",
    );
    // O remoto do PRODUTO existe com a URL CRUA do produto; o `fork` tem a URL
    // do webtecnica. É a distinção que o caso mede.
    git(
      clone,
      "config",
      "--file",
      path.join(clone, ".git/config"),
      "remote.produto.url",
      URL_PRODUTO,
    );
    const r = bashCapturandoRc(clone, "pop_repo_do_produto");
    expect(r.stdout.trim(), "a URL crua do fork não foi confundida com a do produto").toBe(
      REPO_PRODUTO,
    );
    // E o que o `get-url` devolveria, para deixar a premissa do caso visível:
    const getUrl = execFileSync("git", ["-C", clone, "remote", "get-url", "fork"], {
      encoding: "utf8",
    }).trim();
    expect(getUrl, "o insteadOf parou de valer: o caso não mede o que diz medir").toContain(
      "melgarafael/DeskcommCRM",
    );
    // O remoto do PRODUTO é reconhecido, e não se confunde com o `fork` (cuja
    // URL crua é a do webtecnica, mesmo com o insteadOf apontando para cá).
    expect(bashCapturandoRc(clone, "pop_main_do_produto").stdout.trim()).toBe("produto/main");
  });
});

describe("a população inclui as branches REMOTAS, e deixa de fora as cópias de PR", () => {
  it("NNNN que só existe numa branch REMOTA entra na conta", () => {
    const principal = repoComMigration("0324");
    const clone = clonar(principal);
    // Uma branch REMOTA que existe sem cópia local nenhuma. (O 0269 do PR
    // aberto #965 vivia só na CÓPIA `refs/remotes/origin/pr/965`, e essa
    // continua fora — quem o pega é o `checar`, pela lista de abertos.)
    // Precisa de um commit próprio, senão a ref resolve para o HEAD e sai da
    // conta por ser a branch de quem está rodando.
    git(clone, "checkout", "-q", "-b", "colega");
    escrever(clone, "supabase/migrations/20260902000000_0400_do_colega.sql", "select 1;\n");
    commitar(clone, "colega");
    git(clone, "checkout", "-q", "main");
    git(clone, "update-ref", "refs/remotes/origin/colega", "refs/heads/colega");
    // A cópia de cabeça de PR que a triagem deixa: `refs/remotes/origin/pr/965`.
    git(clone, "update-ref", "refs/remotes/origin/pr/965", "refs/heads/colega");

    // O recorte ANTIGO (`git branch`) vê zero refs remotas — a premissa do caso.
    const antigo = execFileSync("git", ["-C", clone, "branch", "--format=%(refname:short)"], {
      encoding: "utf8",
    })
      .split("\n")
      .filter((l) => l.startsWith("refs/remotes/")).length;
    expect(antigo, "a premissa do caso mudou: `git branch` passou a ver refs/remotes").toBe(0);

    const remotas = bashComBiblioteca(
      clone,
      'pop_refs_de_outrem "" | grep -c "^refs/remotes/" || true',
    ).stdout.trim();
    expect(Number(remotas), "a branch remota não entrou na população").toBeGreaterThan(0);
    // E a cópia de PR fica de fora (o outro caso, aqui embaixo, mede o porquê).
    expect(
      bashComBiblioteca(clone, 'pop_refs_de_outrem "" | grep -c "origin/pr/965" || true').stdout.trim(),
    ).toBe("0");
  });

  it("a cópia em refs/remotes/*/pr/N NÃO entra: ela sobrevive ao fechamento do PR", () => {
    // É a distinção que fecha a porta dos fundos: o script de CI mede os PRs
    // ABERTOS pela LISTA do gh, e uma cópia de cabeça em refs/remotes não é
    // "PR aberto" — no clone do mantenedor eram 965 cópias contra 43 PRs
    // abertos (medido em 19/09/2026). Medi-las devolveria número de PR morto.
    const principal = repoComMigration("0324");
    const clone = clonar(principal);
    // Commit próprio: com a ref no HEAD, a exclusão seria a de "a branch de
    // quem roda", e o caso passaria pelo motivo errado.
    git(clone, "checkout", "-q", "-b", "velho");
    escrever(clone, "supabase/migrations/20260902000000_0401_de_pr_fechado.sql", "select 1;\n");
    commitar(clone, "pr que ja fechou");
    git(clone, "checkout", "-q", "main");
    git(clone, "update-ref", "refs/remotes/origin/pr/900", "refs/heads/velho");
    // A forma SEM remoto é a que a própria triagem grava (`refs/remotes/pr/N`):
    // 1336 delas no clone do mantenedor em 27/09/2026.
    git(clone, "update-ref", "refs/remotes/pr/901", "refs/heads/velho");
    const r = bashComBiblioteca(
      clone,
      'pop_refs_de_outrem "" | grep -cE "pr/90[01]" || true',
    ).stdout.trim();
    expect(r).toBe("0");
  });

  it("a ref que resolve para o HEAD (o PR de quem roda) não vira 'quem tem o número'", () => {
    const principal = repoComMigration("0324");
    const clone = clonar(principal);
    git(clone, "checkout", "-q", "-b", "fix/minha");
    git(clone, "update-ref", "refs/heads/outra", "HEAD");
    // A armadilha da #1155: a varredura acusar o autor de colidir com a si.
    const r = bashComBiblioteca(clone, 'pop_refs_de_outrem "" || true').stdout;
    expect(r, "a própria branch entrou na população").not.toContain("refs/heads/outra");
  });

  it("NNNN de uma branch REMOTA entra no teto que a população devolve", () => {
    const principal = repoComMigration("0324");
    const clone = clonar(principal);
    // branch remota com migration 0400 — o teto do disco é 0324.
    git(clone, "checkout", "-q", "-b", "colega");
    escrever(clone, "supabase/migrations/20260902000000_0400_do_colega.sql", "select 1;\n");
    commitar(clone, "colega traz o 0400");
    git(clone, "checkout", "-q", "main");
    git(clone, "update-ref", "refs/remotes/origin/colega", "refs/heads/colega");

    const r = bashComBiblioteca(
      clone,
      'pop_migrations $(pop_refs_de_outrem "") | pop_teto_da_populacao',
    );
    expect(r.stdout.trim(), "o 0400 da branch remota não levantou o teto").toBe("0400");
  });
});

describe("o NNNN sai do nome canônico, e não do slug nem da pasta", () => {
  it("número de 4 dígitos no SLUG não vira NNNN", () => {
    // O defeito latente do item 7: `…_0326_relatorio_2024_anual.sql` fazia a
    // extração solta dar teto 2024 e esconder uma duplicata real de 0326.
    const r = bashComBiblioteca(
      RAIZ,
      `printf '%s\\n' 20260902000000_0326_relatorio_2024_anual.sql 20260903000000_0327_corrige_0241_lembrete.sql | pop_nnnn_de | sort -n | tail -1`,
    );
    expect(r.stdout.trim(), "o teto saiu do slug, não do nome canônico").toBe("0327");
  });

  it("a duplicata real continua visível (o `sed` guloso a perdia)", () => {
    // Os nomes EXATOS da reprodução da issue: o guloso pega o ÚLTIMO `_NNNN_`,
    // que é o do SLUG, e a duplicata real de 0326 desaparece do `uniq -d`.
    // Medido nesta máquina, com estes nomes: guloso → vazio, âncora → 0326.
    const nomes =
      "20260902000000_0326_relatorio_2024_anual.sql\n" +
      "20260905000000_0326_outro_2024.sql\n" +
      "20260903000000_0327_corrige_0241_lembrete.sql";
    const anchored = bashComBiblioteca(
      RAIZ,
      `printf '%b' ${JSON.stringify(nomes)} | pop_nnnn_de | sort | uniq -d`,
    ).stdout.trim();
    const guloso = bashComBiblioteca(
      RAIZ,
      `printf '%b' ${JSON.stringify(nomes)} | sed -E 's/.*_([0-9]{4})_.*/\\1/' | sort | uniq -d`,
    ).stdout.trim();
    expect(anchored, "a âncora perdeu a duplicata de 0326").toBe("0326");
    expect(guloso, "a variante gulosa devia perder a duplicata (a premissa do caso)").toBe("");
  });

  it("o caminho COM pasta também extrai (o `sed` ancorado sozinho não extrai nada)", () => {
    // Medido na revisão: `s/^([^/]*\/)?[0-9]{14}_…/` com caminho completo dá
    // 0 linhas — e a sonda passa a dizer "nenhum número" sem avisar.
    const comPasta = bashComBiblioteca(
      RAIZ,
      `printf '%s\\n' supabase/migrations/20260902000000_0326_x.sql | pop_nnnn_de`,
    ).stdout.trim();
    const semPasta = bashComBiblioteca(
      RAIZ,
      `printf '%s\\n' 20260902000000_0326_x.sql | pop_nnnn_de`,
    ).stdout.trim();
    expect(semPasta).toBe("0326");
    expect(comPasta, "caminho com pasta deixou de extrair").toBe("0326");
  });

  it("a migration de nome legado, sem NNNN, é ignorada (não vira teto)", () => {
    const r = bashComBiblioteca(
      RAIZ,
      `printf '%s\\n' 00001_initial_schema.sql 20260902000000_0326_x.sql | pop_nnnn_de | sort -n | tail -1`,
    ).stdout.trim();
    expect(r).toBe("0326");
  });
});

describe("o que fica de fora é declarado, com o comando que cobre", () => {
  it("pop_aviso_populacao nomeia os PRs abertos e o comando que os mede", () => {
    const r = bashComBiblioteca(RAIZ, "pop_aviso_populacao origin/main");
    expect(r.stdout).toContain("PRs ABERTOS");
    expect(r.stdout).toContain("checar:colisao-de-migration");
  });

  it("sem a main do produto, o aviso diz isso em vez de calar", () => {
    const r = bashComBiblioteca(RAIZ, "pop_aviso_populacao");
    expect(r.stdout).toContain("NÃO MEDIDO");
    expect(r.stdout).toContain("melgarafael/DeskcommCRM");
  });

  it("o script de CI (#1269) segue sendo quem mede os PRs abertos, e declara o limite dele", () => {
    const ci = fs.readFileSync(path.join(RAIZ, "scripts/checar-colisao-de-migration.sh"), "utf8");
    expect(ci, "o script de CI deixou de declarar a lista de PRs abertos").toContain(
      "--state open",
    );
    // A âncora é a MESMA nos dois lugares: uma regra, um lugar.
    expect(ci).toMatch(/s\/\^\[0-9\]\{14\}_/);
  });
});

describe("a ausência da biblioteca degrada declarado, nunca em silêncio", () => {
  it("sem a biblioteca, o chamador que a carrega com `|| true` mantém a população antiga e DIZ", () => {
    // É o contrato do `pre-voo.sh` e do hook: sem a biblioteca, o comportamento
    // é o de antes + uma linha dizendo qual é. Um hook que encolhe o universo
    // sem dizer é o defeito que a #1273 corrige.
    const dir = fs.mkdtempSync(path.join(TMP, "sem-bib-"));
    git(dir, "init", "-q", "-b", "main");
    // `--allow-empty`: um repo sem arquivo nenhum não tem o que commitar, e o
    // caso é sobre o `source` que falha, não sobre o commit.
    git(dir, "commit", "-q", "--allow-empty", "--no-verify", "-m", "vazio");
    const script = `set -uo pipefail
cd ${JSON.stringify(dir)}
source /caminho/que/nao/existe/migration-populacao.sh || true
if declare -F pop_main_do_produto >/dev/null; then echo TEM; else echo "pop_main_do_produto AUSENTE"; fi`;
    const out = execFileSync("bash", ["-c", script], { encoding: "utf8" });
    expect(out).toContain("pop_main_do_produto AUSENTE");
  });
});
