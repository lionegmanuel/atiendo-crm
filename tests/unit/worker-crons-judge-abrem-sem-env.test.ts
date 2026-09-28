/**
 * QUEM DESENVOLVE SÓ COM `.env.local` NÃO PODE SER BARRADO POR UM `--env-file`
 * QUE EXIGE UM ARQUIVO QUE ELE NÃO TEM.
 *
 * ## O defeito (#1812)
 *
 * Três scripts do `package.json` pedem ao `tsx` dois arquivos de ambiente
 * `--env-file=.env --env-file=.env.local`. O `--env-file` é uma EXIGÊNCIA: se o
 * arquivo não existe o Node aborta antes de carregar uma linha do alvo.
 *
 * Medido no Node v22.23.1 (a `.nvmrc` diz 22) e no `tsx` do próprio repo:
 *
 * ```
 * $ tsx --env-file=.env --env-file=.env.local t.ts   # só existe .env.local
 * node: .env: not found
 * rc = 9
 * ```
 *
 * Sai com 9 e sem executar nada — o `worker`, os `dev:crons` e o
 * `flywheel:judge` morrem na porta. E o repo MANDA você estar nesse caso:
 * `CLAUDE.md` e `README.md` dizem para clonar e rodar
 * `cp .env.example .env.local` — nenhum dos dois manda criar `.env`.
 *
 * ## O conserto
 *
 * `--env-file-if-exists` existe desde o Node 22.9 (a `.nvmrc` pede 22; o CI
 * instala 22) e faz exatamente o que o script quer: lê se der, e avisa
 * `.env not found. Continuing without it.` se não der, saindo com 0.
 *
 * ## O que se guarda — e por que é estático
 *
 * Duas propriedades, não uma.
 *
 * **A flag**: qualquer script que passe `--env-file` ao `tsx` tem de ser
 * `--env-file-if-exists`. A assertiva é sobre a FLAG e não sobre os três nomes:
 * o quarto script com o mesmo defeito é pego sozinho, que é o que aconteceu
 * quando a issue citou dois e eram três (`flywheel:judge`).
 *
 * **A ordem**: medido — o arquivo declarado DEPOIS sobrepõe o anterior. O par
 * `--env-file=.env --env-file=.env.local` só tem sentido se o `.env.local`
 * ficar por cima, que era (e é) a precedência declarada. Trocar a ordem não
 * derruba o processo, derruba a configuração: quem tem as duas chaves passaria
 * a rodar com as do `.env` na frente do `.env.local`.
 *
 * O caminho certificado aqui é o do disco, não o do processo: rodar os três
 * scripts custa um `tsx` por um e não prova nada que a flag não prove, porque o
 * que pode voltar a quebrar é o TEXTO do `package.json`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();

const PACKAGE_JSON = JSON.parse(
  readFileSync(join(RAIZ, "package.json"), "utf8"),
) as { scripts: Record<string, string> };

/** Todo script que passa `--env-file` ao `tsx`, na ordem em que ele os declara. */
const COM_Env_FILE = Object.entries(PACKAGE_JSON.scripts).filter(([, cmd]) =>
  cmd.includes("--env-file"),
);

/**
 * Os dois nomes que a issue #1812 cita. O terceiro (`flywheel:judge`) não está
 * na lista de propósito: ele tem o MESMO defeito e é pego pela asserção geral,
 * que é o que prova que a guarda não foi escrita à mão contra o texto do issue.
 */
const CITADOS_NA_ISSUE = ["worker", "dev:crons"];

describe("scripts com --env-file sobrevivem a um checkout sem .env", () => {
  it("encontra os scripts da issue (a guarda não ficou órfã)", () => {
    for (const nome of CITADOS_NA_ISSUE) {
      expect(PACKAGE_JSON.scripts[nome], `script ${nome} sumiu do package.json`)
        .toBeTypeOf("string");
    }
    expect(COM_Env_FILE.length, "nenhum script usa --env-file — a guarda não mede nada")
      .toBeGreaterThanOrEqual(CITADOS_NA_ISSUE.length);
  });

  it("nenhum script exige um .env que pode não existir", () => {
    const infratores = COM_Env_FILE.filter(([, cmd]) => cmd.includes("--env-file="));
    expect(
      infratores,
      `scripts que ainda usam --env-file= (rc 9, "node: .env: not found"):\n` +
        infratores.map(([nome, cmd]) => `  ${nome}: ${cmd}`).join("\n"),
    ).toEqual([]);
  });

  it("declara --env-file-if-exists para cada arquivo, na ordem certa", () => {
    for (const [nome, cmd] of COM_Env_FILE) {
      const flags = [...cmd.matchAll(/--env-file(?:-if-exists)?=\S+/g)].map((m) => m[0]);

      expect(flags, `${nome}: sem nenhum arquivo de ambiente declarado`).not.toEqual([]);

      for (const flag of flags) {
        expect(flag, `${nome}: ${flag} ainda exige o arquivo`).toMatch(
          /^--env-file-if-exists=/,
        );
      }

      // A ordem é o contrato: o `.env.local` tem de vir depois para sobrescrever.
      const arquivos = flags.map((f) => f.replace(/^--env-file-if-exists=/, ""));
      const iEnv = arquivos.indexOf(".env");
      const iLocal = arquivos.indexOf(".env.local");
      if (iEnv !== -1 && iLocal !== -1) {
        expect(
          iLocal,
          `${nome}: .env.local está antes de .env (${arquivos.join(", ")}) — ` +
            `o .env passaria a mandar`,
        ).toBeGreaterThan(iEnv);
      }
    }
  });
});
