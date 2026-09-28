/**
 * A INSTALAÇÃO FRESCA NASCE VAZIA — E A SPEC QUE A EXERCITA NÃO PODE NASCER SEM DONO.
 *
 * ## O defeito
 *
 * A `vps-fresh-onboarding` (parte 4 do e2e) é a única spec que roda numa
 * instalação de verdade fresca. O `beforeAll` dela resolve a organização do
 * DONO do bootstrap (`dono@qa.local`) para resetá-la, e para ALTO se não achar:
 * ela apaga `onboarding_state`, `ai_agents` e `channel_sessions` de quem
 * resolver, então escolher "a primeira organização" já custou o onboarding e a
 * sessão de WhatsApp de uma instalação real (medido em 2026-09-03).
 *
 * Essa precondição está escrita no cabeçalho da própria spec — "primeiro
 * usuário criado via `scripts/bootstrap-owner.ts` (como o `install.sh`)" —
 * junto de WAHA e Redis. Das três, era a única que o workflow não provia: ele
 * subia WAHA, Redis e o dublê de SaaS, esperava o WAHA responder e entregava o
 * turno ao Playwright. A parte 4 morria no `beforeAll`, antes do primeiro
 * teste, com a mensagem que a spec escreveu exatamente para este caso.
 *
 * ## Por que uma guarda estática, e não "rodar o workflow"
 *
 * É acoplamento entre TRÊS arquivos — o workflow, o gerador do `.env.e2e` e a
 * spec — e é decidível lendo os três, como o guard vizinho
 * (`e2e-workflow-honra-o-env.test.ts`) já argumenta. O outro caminho é gastar
 * um job de ~10 min de e2e (a parte 4 é a mais lenta das quatro) para descobrir
 * o que uma leitura responde.
 *
 * ## O que se guarda
 *
 * Que o passo exista, que ele valha para a parte 4, que ele venha ANTES de a
 * suíte rodar, e que as credenciais do dono continuem tendo UMA fonte — o
 * `.env.e2e`, que o job publica — CONCORDANDO com o que a spec declara. Duas
 * fontes que divergem é o defeito que já custou 8 specs em 401 neste mesmo
 * workflow; duas fontes que concordam por coincidência é o mesmo defeito com
 * data marcada.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const RAIZ = path.resolve(__dirname, "../..");
const ler = (rel: string): string => fs.readFileSync(path.join(RAIZ, rel), "utf8");

const workflow = ler(".github/workflows/e2e.yml");
const gerador = ler("scripts/gerar-env-e2e.sh");
const spec = ler("tests/e2e/vps-fresh-onboarding.spec.ts");

/** Linhas de `run:` do workflow, na ordem em que o job as executa. */
const LINHAS = workflow.split("\n");
const COMANDOS = LINHAS.filter((l) => !l.trim().startsWith("#")).map((l) => l.trim());

function indiceDe(pred: (linha: string) => boolean): number {
  return COMANDOS.findIndex(pred);
}

/** A declaração da constante na spec: é ela quem nomeia o dono. */
function constanteDaSpec(nome: string): string {
  const m = spec.match(new RegExp(`const ${nome} = "([^"]+)";`));
  expect(m, `a spec deixou de declarar ${nome} — este guard virou peso morto`).toBeTruthy();
  return m![1]!;
}

/** A linha do gerador, lida DENTRO do heredoc que escreve o `.env.e2e`. */
function linhaDoGerador(nome: string): string {
  const corpo = gerador.slice(gerador.indexOf("<<EOF") + 5, gerador.indexOf("\nEOF"));
  const m = corpo.match(new RegExp(`^${nome}=(.*)$`, "m"));
  expect(m, `${nome} não está dentro do heredoc do .env.e2e — o job não a receberia`).toBeTruthy();
  return m![1]!;
}

describe("o CI cria o dono que a spec da instalação fresca exige", () => {
  it("a spec exige mesmo o dono do bootstrap (guarda de vacuidade)", () => {
    // Sem isto, o dia em que a spec parar de exigir o dono os casos abaixo
    // continuariam verdes vigiando uma regra que não existe mais.
    expect(spec).toMatch(/scripts\/bootstrap-owner\.ts/);
    expect(constanteDaSpec("OWNER_EMAIL")).toContain("@");
    expect(constanteDaSpec("OWNER_PASSWORD").length).toBeGreaterThanOrEqual(12);
  });

  it("o workflow publica o .env.e2e no job — é de lá que o dono sai", () => {
    expect(workflow).toMatch(/\.env\.e2e >> "\$GITHUB_ENV"/);
  });

  it("algum passo do workflow cria o dono (bootstrap-owner.ts)", () => {
    const dono = indiceDe((l) => l.includes("scripts/bootstrap-owner.ts"));
    expect(
      dono,
      "nenhum passo roda scripts/bootstrap-owner.ts: a parte 4 vai morrer no beforeAll da spec, " +
        "antes do primeiro teste, com 'nao achou o dono'",
    ).toBeGreaterThan(-1);
  });

  it("o passo do dono vale para a parte 4 — as outras três já nascem semeadas", () => {
    // Fora de comentário: a menção em prosa (`SPECS_PARTE_4`, este arquivo) não é passo.
    const i = LINHAS.findIndex(
      (l) => l.includes("scripts/bootstrap-owner.ts") && !l.trim().startsWith("#"),
    );
    expect(i, "nenhum passo cria o dono — o caso acima já reprovou por este motivo").toBeGreaterThan(
      -1,
    );
    const guarda = LINHAS.slice(0, i)
      .reverse()
      .find((l) => /^\s*-?\s*if:/.test(l));
    expect(
      guarda,
      "o passo do dono ficou sem `if:` — rodaria também nas partes 1 a 3, cujo banco tem os " +
        "donos semeados e NÃO tem o dono do bootstrap",
    ).toBeTruthy();
    expect(guarda).toMatch(/matrix\.parte == 4/);
  });

  it("o dono nasce ANTES de a suíte rodar — existir não basta, tem de vir antes", () => {
    const dono = indiceDe((l) => l.includes("scripts/bootstrap-owner.ts"));
    // `playwright install` também casa com /playwright/; o que roda a suíte é o `test`.
    const suite = indiceDe((l) => /playwright test/.test(l) && !/install/.test(l));
    expect(suite, "nenhum passo roda a suíte — o padrão envelheceu").toBeGreaterThan(-1);
    expect(dono, "nenhum passo cria o dono — não há o que ordenar").toBeGreaterThan(-1);
    expect(
      dono,
      "o dono é criado DEPOIS de a suíte rodar — a spec não espera a corrida",
    ).toBeLessThan(suite);
  });

  it("as credenciais do dono têm uma fonte só, e ela concorda com a spec", () => {
    for (const nome of ["OWNER_EMAIL", "OWNER_PASSWORD"]) {
      expect(
        workflow,
        `${nome} redigitado no workflow — a fonte única é o .env.e2e, que o job publica`,
      ).not.toMatch(new RegExp(`^\\s*-?\\s*${nome}[:=]`, "m"));
      expect(
        linhaDoGerador(nome),
        `${nome} diverge entre o gerador do .env.e2e e a spec — duas fontes que concordam por ` +
          "coincidência duram até a primeira divergência",
      ).toBe(constanteDaSpec(nome));
    }
  });

  it("o .env.e2e que o gerador escreve sobrevive ao `source` do build", () => {
    // O build lê o arquivo com `set -a; . ./.env.e2e` (scripts/e2e-build.sh), e o
    // passo "Publicar o .env.e2e no ambiente do job" copia as mesmas linhas —
    // LITERAIS — para o `$GITHUB_ENV`. Só um valor sem espaço satisfaz os dois:
    // com espaço, o `source` executa o resto como comando; com aspas, a aspa vai
    // embora dentro do valor. Foi assim que `OWNER_ORG_NAME=Loja QA VPS` deixou o
    // e2e vermelho nas quatro partes — este caso CARREGA o arquivo para que a
    // próxima linha dessas não precise ser descoberta em log de CI.
    const corpo = gerador.slice(gerador.indexOf("<<EOF") + 5, gerador.indexOf("\nEOF"));
    const valores = corpo
      .split("\n")
      .filter((l) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(l))
      .map((l) => l.slice(l.indexOf("=") + 1));
    expect(valores.length, "o heredoc do .env.e2e sumiu — o padrão envelheceu").toBeGreaterThan(5);
    for (const valor of valores) {
      expect(
        valor,
        "valor com espaço no .env.e2e: o `source` do build quebra e o `$GITHUB_ENV` " +
          "leva a aspa junto — use um token só",
      ).not.toMatch(/\s/);
    }

    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "env-e2e-"));
    const arquivo = path.join(pasta, ".env.e2e");
    fs.writeFileSync(arquivo, corpo.replace(/\\`/g, "`"), "utf8");
    const r = spawnSync(
      "bash",
      [
        "-c",
        'set -a; . "$1"; set +a; printf "%s\\n" "$OWNER_EMAIL" "$OWNER_PASSWORD" "$OWNER_ORG_NAME"',
        "bash",
        arquivo,
      ],
      { encoding: "utf8" },
    );
    expect(r.stderr, "o .env.e2e não carrega com `source` — é assim que o build lê").not.toMatch(
      /command not found/,
    );
    expect(r.status, `source falhou: ${r.stderr}`).toBe(0);
    expect(r.stdout.trim().split("\n")).toEqual([
      linhaDoGerador("OWNER_EMAIL"),
      linhaDoGerador("OWNER_PASSWORD"),
      linhaDoGerador("OWNER_ORG_NAME"),
    ]);
  });

  it("os comentários do heredoc não expandem nada — ele é `<<EOF` sem aspas", () => {
    // Sem aspas no delimitador, o shell expande `$` e crase ANTES de escrever o
    // arquivo: um `$GITHUB_ENV` cru vira o caminho do job — e, com `set -u` e a
    // variável ausente (máquina de quem desenvolve, fora do Actions), o gerador
    // morre em `unbound variable` e o `pnpm e2e:env` nunca escreve o arquivo.
    // Medido nos dois lados. Comentário aqui tem de ser inerte.
    const corpo = gerador.slice(gerador.indexOf("<<EOF") + 5, gerador.indexOf("\nEOF"));
    const comentarios = corpo.split("\n").filter((l) => l.trimStart().startsWith("#"));
    expect(comentarios.length, "nenhum comentário no heredoc — o padrão envelheceu").toBeGreaterThan(
      3,
    );
    for (const linha of comentarios) {
      expect(
        linha,
        "`$` ou crase crus em comentário dentro do heredoc: o shell expande isto ao escrever " +
          "o .env.e2e — escape (`\\$`, `\\``)",
      ).not.toMatch(/[^\\][$`]/);
    }
  });
});
