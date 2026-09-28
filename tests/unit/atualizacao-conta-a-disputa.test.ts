/**
 * A rodada de atualização passa a contar o que aconteceu com o banco, e a tela
 * de atualização mostra isso em português de gente quando a atualização
 * termina. O achado veio do PR #997: o baseline reaplicado sobrevive a uma
 * disputa com o sistema no ar — o kit tenta de novo e fecha. Até aqui essa
 * parte da história morria no log do servidor: quem clicou via "terminou" sem
 * saber que o banco estava ocupado, que a primeira passada não fechou, nem em
 * qual passada a coisa terminou.
 *
 * O que este teste trava:
 *  1. o texto que a tela conta para cada combinação de disputa, retentativas e
 *     passada — é o que a pessoa lê no fim;
 *  2. que "não medido" NÃO vira texto nenhum: sem registro, a tela fica calada
 *     em vez de afirmar uma passada que ninguém contou;
 *  3. que as três colunas existem nos três lugares (migration versionada,
 *     apêndice idempotente do baseline e tipos gerados) — separadas, a tela lê
 *     coluna que não existe.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { rodadaDoBancoDaLinha, textoDaRodadaDoBanco } from "../../lib/system/update-run";

describe("o que a tela conta da rodada de banco", () => {
  it("não conta nada quando ninguém mediu", () => {
    expect(textoDaRodadaDoBanco(null)).toBeNull();
    expect(textoDaRodadaDoBanco(undefined)).toBeNull();
  });

  it("fechou de primeira: diz que foi de uma vez", () => {
    const texto = textoDaRodadaDoBanco({ disputa: false, retentativas: 0, passada: 1 });

    expect(texto).not.toBeNull();
    expect(texto).toContain("primeira passada");
    expect(texto).not.toContain("retentativa");
  });

  it("disputa com retentativa: conta o banco ocupado e em qual passada fechou", () => {
    const texto = textoDaRodadaDoBanco({ disputa: true, retentativas: 1, passada: 2 });

    expect(texto).toContain("disputa");
    expect(texto).toContain("duas passadas");
    expect(texto).toContain("retentativa");
  });

  it("mais de uma retentativa: conta o número certo de passadas e retentativas", () => {
    const texto = textoDaRodadaDoBanco({ disputa: true, retentativas: 2, passada: 3 });

    expect(texto).toContain("3 passadas");
    expect(texto).toContain("2 retentativas");
  });

  it("retentativa SEM disputa é estado que ninguém produz: silêncio, não uma frase para um caso que não existe", () => {
    // Quem grava tira os dois do MESMO contador de passadas:
    // `disputa = passadas > 1` e `retentativas = passadas - 1` — retentativa
    // implica disputa por construção (`_common.sh`). A frase que existia para
    // esta combinação dava à tela a impressão de cobrir um estado impossível, e
    // o caso de teste, a de que estava coberto.
    expect(textoDaRodadaDoBanco({ disputa: false, retentativas: 1, passada: 2 })).toBeNull();
  });

  it("número impossível vira silêncio, não mentira", () => {
    expect(textoDaRodadaDoBanco({ disputa: true, retentativas: 5, passada: 2 })).toBeNull();
    expect(textoDaRodadaDoBanco({ disputa: false, retentativas: -1, passada: 1 })).toBeNull();
    expect(textoDaRodadaDoBanco({ disputa: false, retentativas: 0, passada: 0 })).toBeNull();
    expect(textoDaRodadaDoBanco({ disputa: false, retentativas: 1.5, passada: 2 })).toBeNull();
  });
});

describe("a leitura da linha do banco não inventa o que falta", () => {
  it("linha ausente ou sem as três colunas é 'não medido'", () => {
    expect(rodadaDoBancoDaLinha(null)).toBeNull();
    expect(rodadaDoBancoDaLinha(undefined)).toBeNull();
    expect(rodadaDoBancoDaLinha({})).toBeNull();
    expect(
      rodadaDoBancoDaLinha({
        disputa_de_banco: true,
        retentativas_do_banco: null,
        passada_do_banco: null,
      }),
    ).toBeNull();
  });

  it("linha medida vira o estado que a tela conta", () => {
    expect(
      rodadaDoBancoDaLinha({
        disputa_de_banco: true,
        retentativas_do_banco: 1,
        passada_do_banco: 2,
      }),
    ).toEqual({ disputa: true, retentativas: 1, passada: 2 });
  });
});

describe("as colunas da rodada existem nos três lugares", () => {
  const colunas = ["disputa_de_banco", "retentativas_do_banco", "passada_do_banco"];
  const raiz = process.cwd();

  it("migration versionada + apêndice idempotente do baseline + tipos gerados", () => {
    const migrations = readdirSync(join(raiz, "supabase", "migrations")).filter((nome) =>
      nome.includes("_0276_"),
    );
    expect(migrations).toHaveLength(1);

    const [arquivo] = migrations;
    expect(arquivo).toBeTruthy();

    const migration = readFileSync(
      join(raiz, "supabase", "migrations", arquivo ?? ""),
      "utf8",
    );
    const baseline = readFileSync(join(raiz, "supabase", "baseline.sql"), "utf8");
    const tipos = readFileSync(join(raiz, "lib", "database.types.ts"), "utf8");

    for (const coluna of colunas) {
      expect(migration).toContain(coluna);
      expect(baseline).toContain(coluna);
      expect(tipos).toContain(coluna);
    }
  });

  it("o MANIFEST carrega a rodada como carga, não como opcional", () => {
    const manifest = readFileSync(
      join(raiz, "supabase", "migrations", "MANIFEST.md"),
      "utf8",
    );

    expect(manifest).toContain("0276");
    expect(manifest).toContain("disputa_de_banco");
  });
});

describe("o fio entre o kit e a rota fala a MESMA língua", () => {
  // O defeito que este bloco tranca: o `agent.sh` mandava um objeto aninhado
  // (`rodada_do_banco: { disputa, retentativas, passada }`) e a rota lê três
  // campos PLANOS com outros nomes. O `z.object` descarta chave desconhecida em
  // silêncio, então o parse passava, os três chegavam `undefined` e as colunas
  // eram gravadas nulas em toda rodada — a tela calada para sempre, que é o
  // silêncio que o PR veio eliminar. Nenhum gate pegava porque o fio não tinha
  // teste em lugar nenhum: ele mora entre o shell e o Zod.
  const raiz = process.cwd();
  const nomesDaRota = ["disputa_de_banco", "retentativas_do_banco", "passada_do_banco"];

  it("o kit imprime as três chaves com os nomes da rota, planas", () => {
    const comum = readFileSync(join(raiz, "hostgator-setup-kit", "_common.sh"), "utf8");

    for (const nome of nomesDaRota) expect(comum).toContain(nome);
    // O objeto aninhado era exatamente o que a rota descartava.
    expect(comum).not.toContain('{"disputa":');
  });

  it("o agent.sh manda o corpo PLANO — nenhum `rodada_do_banco` aninhado", () => {
    const agente = readFileSync(join(raiz, "hostgator-setup-kit", "agent.sh"), "utf8");

    expect(agente).toContain("${RODADA_DO_BANCO}");
    // A chave ANINHADA antiga (`"rodada_do_banco":`) saiu do corpo do run_result —
    // é ela que o `z.object` da rota descartava em silêncio. A linha do corpo é
    // localizada pelo próprio `run_result` para o teste não depender do nome da
    // função que lê o arquivo (`ler_rodada_do_banco`).
    const corpoDoRunResult = agente.split("\n").find((l) => l.includes("run_result")) ?? "";
    expect(corpoDoRunResult).not.toContain("rodada_do_banco");
  });

  it("a rota lê exatamente esses três nomes", () => {
    const rota = readFileSync(
      join(raiz, "app", "api", "v1", "system", "agent", "route.ts"),
      "utf8",
    );

    for (const nome of nomesDaRota) expect(rota).toContain(`${nome}:`);
  });
});
