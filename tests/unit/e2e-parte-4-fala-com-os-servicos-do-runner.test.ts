/**
 * A PARTE 4 DO E2E TEM DE FALAR COM OS SERVIÇOS QUE ELA MESMA SOBE.
 *
 * ## Os defeitos
 *
 * A parte 4 (`vps-fresh-onboarding`) sobe WAHA, redis e serverless-redis-http
 * (hoje por `docker run` no passo "Subir WAHA e o par Redis da VPS fresca";
 * no run citado, como `services:` do job) e publica as URLs deles no passo
 * "Ligar a VPS fresca". No run 35124188017 três coisas estavam erradas ao mesmo tempo, e
 * NENHUMA dizia o próprio nome:
 *
 * 1. **O app falava com outras portas.** O passo anexava
 *    `WAHA_API_BASE_URL=…:3000` ao `$GITHUB_ENV`, mas o servidor recebe o
 *    ambiente pelo `webServer.env` do `playwright.config.ts`, que é o ARQUIVO
 *    `.env.e2e` — e ali, em colisão, vence o arquivo (`…:3999`, porta vazia).
 *    O contêiner do WAHA registrou duas requisições no job inteiro, nenhuma do
 *    app; o QR nunca apareceu.
 * 2. **A espera pelo Redis falhava aberto.** O laço terminava sem `exit 1`, e
 *    a sonda nunca teria passado: sem `Content-Type: application/json` o
 *    serverless-redis-http responde 400 (medido contra o digest do compose).
 * 3. **O WAHA rodava WEBJS**, e `compatibleSession()` recusa qualquer engine
 *    que não seja NOWEB.
 *
 * O item 1 é uma classe, não uma instância: toda chave nova que o gerador do
 * `.env.e2e` escrever e o passo da parte 4 sobrepuser repete o defeito. Por
 * isso o caso dele EXECUTA o trecho do passo contra as linhas reais do gerador
 * e lê o resultado como o `playwright.config.ts` lê — em vez de procurar a
 * forma de um comando.
 */
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = path.resolve(__dirname, "../..");
const ler = (rel: string) => fs.readFileSync(path.join(RAIZ, rel), "utf8");

const workflow = ler(".github/workflows/e2e.yml");
const compose = ler("docker-compose.prod.yml");
const gerador = ler("scripts/gerar-env-e2e.sh");

/** O corpo do `run: |` de um passo, sem a indentação do YAML. */
function runDoPasso(nome: string): string {
  const linhas = workflow.split("\n");
  const i = linhas.findIndex((l) => l.includes(`name: ${nome}`));
  expect(i, `o passo "${nome}" sumiu do e2e.yml — este guard virou peso morto`).toBeGreaterThan(-1);
  const r = linhas.findIndex((l, j) => j > i && /^\s*run: \|\s*$/.test(l));
  expect(r, `o passo "${nome}" não tem mais um bloco run: |`).toBeGreaterThan(i);
  const corpo: string[] = [];
  let recuo = -1;
  for (const l of linhas.slice(r + 1)) {
    if (l.trim() === "") {
      corpo.push("");
      continue;
    }
    const n = l.length - l.trimStart().length;
    if (recuo === -1) recuo = n;
    if (n < recuo) break;
    corpo.push(l.slice(recuo));
  }
  return corpo.join("\n");
}

function secao(script: string, inicio: string, fim: string): string {
  const a = script.indexOf(inicio);
  const b = script.indexOf(fim);
  expect(a, `o trecho "${inicio}" sumiu do passo`).toBeGreaterThan(-1);
  expect(b, `o trecho "${fim}" sumiu do passo`).toBeGreaterThan(a);
  return `set -euo pipefail\n${script.slice(a, b)}`;
}

/** Mesma leitura do `envDoE2E()` do playwright.config.ts: a última atribuição vence. */
function lerComoOPlaywright(bruto: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const linha of bruto.split("\n")) {
    const limpa = linha.trim();
    if (limpa === "" || limpa.startsWith("#")) continue;
    const i = limpa.indexOf("=");
    if (i <= 0) continue;
    env[limpa.slice(0, i)] = limpa.slice(i + 1);
  }
  return env;
}

const PASSO = runDoPasso("Ligar a VPS fresca (WAHA, Redis e dublê de SaaS)");

const NOME_DO_PASSO_DOS_SERVICOS = "Subir WAHA e o par Redis da VPS fresca";

/** O passo INTEIRO (env: e run:), da linha do nome até o passo seguinte. */
function passoInteiro(nome: string): string {
  const linhas = workflow.split("\n");
  const i = linhas.findIndex((l) => l.includes(`name: ${nome}`));
  expect(i, `o passo "${nome}" sumiu do e2e.yml — este guard virou peso morto`).toBeGreaterThan(-1);
  const fim = linhas.findIndex((l, j) => j > i && /^ {6}- /.test(l));
  return linhas.slice(i, fim === -1 ? undefined : fim).join("\n");
}

/** Um diretório com `docker` e `sleep` de mentira: a sonda roda sem esperar nem sujar nada. */
function pathComShims(): { pasta: string; PATH: string } {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "parte4-"));
  const bin = path.join(pasta, "bin");
  fs.mkdirSync(bin);
  for (const nome of ["docker", "sleep"]) {
    fs.writeFileSync(path.join(bin, nome), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  }
  return { pasta, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` };
}

describe("a parte 4 do e2e fala com os serviços que ela sobe", () => {
  it("o SERVIDOR recebe as URLs do runner — o .env.e2e é reescrito, não só o $GITHUB_ENV", () => {
    const trecho = secao(PASSO, "# 2. O que a spec fresca", "# 3. A cadeia de Redis");
    const { pasta, PATH } = pathComShims();

    // As linhas que o GERADOR escreve para as chaves que o passo sobrepõe — as
    // mesmas que, em colisão, venciam no servidor.
    const corpoDoGerador = gerador.slice(gerador.indexOf("<<EOF") + 5, gerador.indexOf("\nEOF"));
    const doGerador = lerComoOPlaywright(corpoDoGerador);
    const chavesDoPasso = [...trecho.matchAll(/echo "([A-Z0-9_]+)=/g)].map((m) => m[1]!);
    const colisoes = chavesDoPasso.filter((k) => k in doGerador);
    expect(
      colisoes,
      "nenhuma chave do passo existe no gerador — sem colisão, este caso não mede nada",
    ).toContain("WAHA_API_BASE_URL");

    const envE2e = path.join(pasta, ".env.e2e");
    fs.writeFileSync(
      envE2e,
      ["# gerado", "SENTINELA=fica", ...colisoes.map((k) => `${k}=${doGerador[k]}`), ""].join("\n"),
    );
    const githubEnv = path.join(pasta, "github_env");
    fs.writeFileSync(githubEnv, "");

    const r = spawnSync("bash", ["-c", trecho.replaceAll("/tmp/", `${pasta}/`)], {
      cwd: pasta,
      encoding: "utf8",
      env: { ...process.env, PATH, GITHUB_ENV: githubEnv },
    });
    expect(r.status, `o trecho do passo falhou: ${r.stderr}`).toBe(0);

    const doPasso = lerComoOPlaywright(fs.readFileSync(githubEnv, "utf8"));
    const servidor = lerComoOPlaywright(fs.readFileSync(envE2e, "utf8"));
    for (const chave of chavesDoPasso) {
      expect(
        servidor[chave],
        `${chave}: o processo de teste recebe "${doPasso[chave]}" e o servidor (webServer.env ← .env.e2e) ` +
          `recebe "${servidor[chave]}" — em colisão vence o arquivo`,
      ).toBe(doPasso[chave]);
    }
    expect(servidor.SENTINELA, "a reescrita apagou linhas que não eram da parte 4").toBe("fica");
  });

  it("a espera pelo Redis falha FECHADO quando o serviço não responde", () => {
    const trecho = secao(PASSO, "# 3. A cadeia de Redis", "# 4. Alguns scripts");
    expect(trecho, "a sonda deixou de mirar a porta publicada do redis-http").toContain(
      "127.0.0.1:8079",
    );
    const { PATH } = pathComShims();
    // A porta 1 não tem ninguém escutando: a sonda recebe "connection refused"
    // na hora, e o `sleep` de mentira faz as voltas custarem nada.
    const r = spawnSync(
      "bash",
      ["-c", `${trecho.replaceAll("127.0.0.1:8079", "127.0.0.1:1")}\necho SEGUIU`],
      { encoding: "utf8", env: { ...process.env, PATH } },
    );
    expect(r.stdout, "a espera terminou e o passo SEGUIU sem Redis — falha aberta").not.toContain(
      "SEGUIU",
    );
    expect(r.status).not.toBe(0);
  });

  it("a sonda do Redis fala o protocolo do serverless-redis-http (JSON, com Content-Type)", async () => {
    const trecho = secao(PASSO, "# 3. A cadeia de Redis", "# 4. Alguns scripts");
    const { PATH } = pathComShims();

    // O contrato medido contra o digest do compose: sem `application/json`, 400.
    // Conta os PONGs: "o passo seguiu" sozinho também é o que uma espera que
    // falha aberto faz, e aí este caso passaria sem a sonda nunca ter acertado.
    let pongs = 0;
    const srh = http.createServer((req, res) => {
      const json = (req.headers["content-type"] ?? "").startsWith("application/json");
      if (json) pongs += 1;
      res.writeHead(json ? 200 : 400, { "content-type": "application/json" });
      res.end(
        json
          ? JSON.stringify({ result: "PONG" })
          : JSON.stringify({ error: "Invalid content type. Expected application/json." }),
      );
    });
    await new Promise<void>((ok) => srh.listen(0, "127.0.0.1", ok));
    const porta = (srh.address() as AddressInfo).port;

    const r = await new Promise<{ status: number | null; stdout: string }>((ok) => {
      const p = spawn(
        "bash",
        ["-c", `${trecho.replaceAll("127.0.0.1:8079", `127.0.0.1:${porta}`)}\necho SEGUIU`],
        { env: { ...process.env, PATH } },
      );
      let stdout = "";
      p.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      p.on("close", (status) => ok({ status, stdout }));
    });
    await new Promise<void>((ok) => srh.close(() => ok()));

    expect(pongs, "a sonda nunca mandou uma requisição que o serverless-redis-http aceita").toBeGreaterThan(0);
    expect(r.stdout, `o passo não seguiu com o Redis de pé: ${r.stdout}`).toContain("SEGUIU");
    expect(r.status).toBe(0);
  });

  it("o WAHA do CI roda NOWEB — o único engine que o produto aceita", () => {
    // Guarda de vacuidade: se o produto deixar de exigir NOWEB, este caso passa
    // a vigiar uma regra que não existe mais.
    expect(ler("lib/waha/client.ts")).toMatch(/actualEngine !== "NOWEB"/);
    const passo = passoInteiro(NOME_DO_PASSO_DOS_SERVICOS);
    expect(passo, "sem a linha o contêiner cai no default WEBJS e o createSession lança").toMatch(
      /^\s*WHATSAPP_DEFAULT_ENGINE:\s*["']?NOWEB["']?\s*$/m,
    );
    // A variável só chega ao contêiner se o `docker run` a repassar.
    expect(passo, "o docker run do WAHA não repassa o engine ao contêiner").toMatch(
      /docker run[^\n]*(\\\n[^\n]*)*-e WHATSAPP_DEFAULT_ENGINE/,
    );
  });

  it("o serverless-redis-http do CI é a MESMA imagem do docker-compose.prod.yml", () => {
    const doCompose = compose.match(/image:\s*(hiett\/serverless-redis-http\S*)/)?.[1];
    const doCi = passoInteiro(NOME_DO_PASSO_DOS_SERVICOS).match(
      /SRH_IMAGE:\s*(hiett\/serverless-redis-http\S*)/,
    )?.[1];
    expect(doCompose, "o compose deixou de declarar o serverless-redis-http").toBeTruthy();
    expect(doCi, "tag móvel ou imagem diferente da que o self-hoster recebe").toBe(doCompose);
  });

  it("os contêineres sobem SÓ na parte 4 — nada de `services:` no job da matriz", () => {
    // `services:` é chave do JOB: sobe nas quatro pernas. Custou ~51 s de
    // "Initialize containers" a cada parte que não usa nenhum deles (run
    // 35124188017), com as partes a ~2 min do teto de 30.
    const job = workflow.slice(workflow.indexOf("\n  e2e-parte:"), workflow.indexOf("\n    steps:", workflow.indexOf("\n  e2e-parte:")));
    expect(job, "o recorte do job e2e-parte saiu vazio — este caso virou peso morto").toContain("timeout-minutes");
    expect(job, "`services:` voltou ao job: os contêineres da parte 4 sobem nas quatro pernas").not.toMatch(/^ {4}services:/m);

    const passo = passoInteiro(NOME_DO_PASSO_DOS_SERVICOS);
    const linhas = workflow.split("\n");
    const i = linhas.findIndex((l) => l.includes(`name: ${NOME_DO_PASSO_DOS_SERVICOS}`));
    expect(linhas[i - 1], "o passo dos contêineres perdeu o `if: matrix.parte == 4`").toMatch(
      /^\s*- if: matrix\.parte == 4\s*$/,
    );
    for (const imagem of ["WAHA_IMAGE", "REDIS_IMAGE", "SRH_IMAGE"]) {
      expect(passo, `o passo não sobe ${imagem}`).toContain(`"$${imagem}"`);
    }
    // O srh fala com `redis://redis:6379`: sem a rede e o alias, o nome não resolve.
    expect(passo).toMatch(/--network-alias redis\b/);
    expect(passo).toContain("SRH_CONNECTION_STRING=redis://redis:6379");

    // E antes de quem espera por eles: a sonda do passo "Ligar a VPS fresca"
    // não tem o que achar se os contêineres subirem depois.
    const ligar = linhas.findIndex((l) => l.includes("name: Ligar a VPS fresca"));
    expect(i, "os contêineres sobem DEPOIS do passo que espera por eles").toBeLessThan(ligar);
  });
});
