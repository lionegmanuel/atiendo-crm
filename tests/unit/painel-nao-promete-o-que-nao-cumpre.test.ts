/**
 * O painel não oferece campo que não muda nada.
 *
 * Uma chave marcada `edita` no catálogo promete à pessoa que digitar ali troca o
 * comportamento do sistema. Isso só é verdade se o código de produção LER pelo
 * resolvedor (`valorDaInstalacao`). Enquanto o call site continuar em `env.X`, a
 * gravação vai para o banco e o programa segue usando o valor antigo do arquivo
 * de instalação — com a tela dizendo "salvo".
 *
 * É o defeito que este projeto já pagou: cinco controles decorativos num PR, em
 * que a tela oferecia e o motor ignorava. A diferença entre aquele caso e este é
 * que aqui existe uma catraca.
 *
 * As DUAS direções importam, e por isso são dois casos:
 *   1. toda `edita` tem leitor pelo resolvedor;
 *   2. nenhuma `edita` continua sendo lida direto do ambiente fora dos módulos
 *      que têm o direito de fazê-lo. Sem (2), alguém adiciona a chamada nova sem
 *      remover a velha, o caso (1) fica verde, e quem vence é a leitura antiga.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CATALOGO_DA_INSTALACAO, chavesEditaveis } from "@/lib/instalacao/catalogo";

const RAIZ = path.resolve(__dirname, "..", "..");

/** Onde ler do ambiente é legítimo: o contrato de env e o próprio resolvedor. */
const PODEM_LER_O_AMBIENTE = ["lib/env.ts", "lib/instalacao/config.ts"];

function grep(padrao: string, escopo: string[]): string[] {
  try {
    const saida = execFileSync(
      "grep",
      ["-rlnE", "--include=*.ts", "--include=*.tsx", "-e", padrao, ...escopo],
      { cwd: RAIZ, encoding: "utf8" },
    );
    return saida.split("\n").filter(Boolean);
  } catch {
    // grep sai 1 quando não casa nada. Ausência é resultado, não erro — mas só
    // vale como resultado porque o controle positivo abaixo prova que a sonda vê.
    return [];
  }
}

const ESCOPO = ["lib", "app", "components", "workers", "hooks"];

describe("a sonda enxerga (controle positivo)", () => {
  it("acha uma leitura de ambiente que sabidamente existe", () => {
    // Se este caso ficar vermelho, os dois testes abaixo estão cegos e o verde
    // deles não significa nada.
    expect(grep("env\\.NODE_ENV", ESCOPO).length).toBeGreaterThan(0);
    // com parênteses: é a classe que a sonda real usa, e a que já me enganou uma vez
    expect(grep("createAdminClient\\(\\s*\\)", ESCOPO).length).toBeGreaterThan(0);
  });
});

describe("toda chave que o painel diz editar é lida pelo resolvedor", () => {
  const editaveis = chavesEditaveis();

  it("o catálogo tem ao menos uma chave editável", () => {
    expect(editaveis.length).toBeGreaterThan(0);
  });

  it.each(editaveis.map((c) => c.chave))(
    "%s tem leitor por valorDaInstalacao()",
    (chave) => {
      const leitores = grep(`valorDaInstalacao\\(\\s*"${chave}"`, ESCOPO);
      expect(
        leitores,
        `"${chave}" está marcada como editável no catálogo, mas nenhum arquivo de ` +
          `produção a lê por valorDaInstalacao("${chave}"). Ou troque o call site, ` +
          `ou marque a chave como "diagnostico" — campo que aceita e ignora é pior ` +
          `que campo ausente.`,
      ).not.toEqual([]);
    },
  );

  it.each(editaveis.map((c) => c.chave))(
    "%s não é mais lida direto do ambiente fora dos módulos autorizados",
    (chave) => {
      const diretos = grep(`env\\.${chave}\\b`, ESCOPO).filter(
        (arquivo) => !PODEM_LER_O_AMBIENTE.includes(arquivo) && !arquivo.endsWith(".test.ts"),
      );
      expect(
        diretos,
        `"${chave}" ainda é lida direto do ambiente em: ${diretos.join(", ")}. ` +
          `Enquanto essa leitura existir, ela vence a do banco e o campo da tela ` +
          `não muda nada.`,
      ).toEqual([]);
    },
  );
});

describe("o catálogo é coerente consigo mesmo", () => {
  it("toda chave de diagnóstico explica por que não dá para editar", () => {
    const semMotivo = CATALOGO_DA_INSTALACAO.filter(
      (c) => c.controle === "diagnostico" && (!c.motivo || !c.comoTrocar),
    ).map((c) => c.chave);
    expect(
      semMotivo,
      `estas chaves aparecem como não-editáveis sem dizer o porquê nem como trocar: ` +
        `${semMotivo.join(", ")}. A tela mostra esse texto para a pessoa.`,
    ).toEqual([]);
  });

  it("não há chave repetida", () => {
    const chaves = CATALOGO_DA_INSTALACAO.map((c) => c.chave);
    expect(new Set(chaves).size).toBe(chaves.length);
  });
});
