import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * Varredura dos motivos de parada que as ações de automação EMITEM.
 *
 * Por que existe (issue #1090): o mapa de frases da aba Atividade é escrito à
 * mão, e nada ligava o mapa ao código que emite os motivos. Um motivo novo — ou
 * um motivo que já existia e nunca ganhou frase — chegava na tela como CÓDIGO
 * CRU (`membro_indeterminado` na cara de quem atende). Este helper é a ponte:
 * ele lê os `*.ts` de `lib/automation` e devolve todo motivo que pode virar
 * `detail.reason` ou `action.error` de um run.
 *
 * O que ele cobra (e o que ele NÃO cobra):
 *
 *   - motivo LITERAL (string) → cobrado: precisa de frase no mapa;
 *   - motivo DINÂMICO (`guarda.reason`, `acesso.motivo`, …) → precisa de uma
 *     declaração de origem (`DeclaracaoDeOrigem`) dizendo de onde ele vem, com
 *     `porque` escrito; quando a origem é um arquivo, o produtor é varrido e os
 *     literais de lá entram na cobrança;
 *   - texto de gente no canal `error` (`err.message`, `result.message`,
 *     `String(err)`) → NÃO é cobrado por nome: por contrato é a mensagem crua do
 *     erro, não um código. É a fronteira declarada desta guarda — o que ela
 *     garante é que nenhum CÓDIGO literal chegue sem frase.
 *   - resultado que traz `detail.explicacao` → isento: quem escreve o desfecho
 *     já montou a frase ali (é o que `desfecho-do-envio.ts` faz).
 */

export type Ocorrencia = { motivo: string; arquivo: string; linha: number };

export type Dinamica = {
  expressao: string;
  arquivo: string;
  linha: number;
  canal: "reason" | "error";
};

export type Varredura = {
  arquivosVarridos: number;
  resultados: number;
  literais: Ocorrencia[];
  dinamicas: Dinamica[];
  isentos: Ocorrencia[];
};

export type Produtor = {
  arquivo: string;
  /** Literais do produtor que NÃO têm frase, com o motivo declarado. */
  excecoes?: { motivo: string; porque: string }[];
};

export type DeclaracaoDeOrigem = {
  arquivo: string;
  expressao: string;
  porque: string;
  produtor?: Produtor;
};

export type OpcoesDaVarredura = {
  raizDoProjeto: string;
  raizes: string[];
};

export type Cobranca = {
  /** Motivos que chegam na tela e não têm frase no mapa. */
  faltando: Ocorrencia[];
  /** Origens dinâmicas usadas no código e não declaradas. */
  dinamicasSemDeclaracao: Dinamica[];
  /** Declaração que não bate mais com o código (origem, `porque` ou exceção). */
  declaracoesQuebradas: string[];
};

/** Formato de código: `membro_indeterminado`, `no_tags`, `unknown_action`. */
const CODIGO = /^[a-z][a-z0-9_]*$/;

/** Canal `error`: o que tem cara de código por contrato. */
const SUFIXO_DE_CODIGO = /\.(reason|code|motivo)$/;

const MINIMO_DE_PORQUE = 20;

function ehArquivoFonte(nome: string): boolean {
  if (!nome.endsWith(".ts") || nome.endsWith(".d.ts")) return false;
  if (nome.includes(".test.")) return false;
  return true;
}

function listarFontes(dir: string): string[] {
  const saida: string[] = [];
  if (!fs.existsSync(dir)) return saida;
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const caminho = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name === "__tests__" || entrada.name === "node_modules") continue;
      saida.push(...listarFontes(caminho));
      continue;
    }
    if (ehArquivoFonte(entrada.name)) saida.push(caminho);
  }
  return saida;
}

function textoLiteral(no: ts.Expression): string | null {
  if (ts.isStringLiteral(no)) return no.text;
  if (ts.isNoSubstitutionTemplateLiteral(no)) return no.text;
  return null;
}

function propriedades(obj: ts.ObjectLiteralExpression): Map<string, ts.Expression> {
  const props = new Map<string, ts.Expression>();
  for (const membro of obj.properties) {
    if (!ts.isPropertyAssignment(membro)) continue;
    if (ts.isIdentifier(membro.name) || ts.isStringLiteral(membro.name)) {
      props.set(membro.name.text, membro.initializer);
    }
  }
  return props;
}

function analisarResultado(
  obj: ts.ObjectLiteralExpression,
  arquivo: string,
  sf: ts.SourceFile,
  saida: Varredura,
): void {
  const props = propriedades(obj);
  const detalhe = props.get("detail");
  const temError = props.has("error");
  // Resultado de ação: tem `status` e tem ou o detalhe ou o erro.
  if (!props.has("status") || (!detalhe && !temError)) return;
  saida.resultados += 1;

  const linhaDe = (no: ts.Node) => sf.getLineAndCharacterOfPosition(no.getStart(sf)).line + 1;
  const detalheObj = detalhe && ts.isObjectLiteralExpression(detalhe) ? detalhe : null;
  const propsDoDetalhe = detalheObj ? propriedades(detalheObj) : new Map<string, ts.Expression>();
  // Quem monta `explicacao` já escreveu a frase: não há o que cobrar do mapa.
  const isento = propsDoDetalhe.has("explicacao");

  const motivo = propsDoDetalhe.get("reason");
  if (motivo) {
    const texto = textoLiteral(motivo);
    if (texto !== null) {
      const ocorrencia = { motivo: texto, arquivo, linha: linhaDe(motivo) };
      if (isento) saida.isentos.push(ocorrencia);
      else if (CODIGO.test(texto)) saida.literais.push(ocorrencia);
    } else if (!isento) {
      saida.dinamicas.push({
        expressao: motivo.getText(sf),
        arquivo,
        linha: linhaDe(motivo),
        canal: "reason",
      });
    }
  }

  const erro = props.get("error");
  if (erro && !isento) {
    const texto = textoLiteral(erro);
    if (texto !== null) {
      if (CODIGO.test(texto)) saida.literais.push({ motivo: texto, arquivo, linha: linhaDe(erro) });
    } else {
      const expressao = erro.getText(sf);
      if (ts.isTemplateExpression(erro) || SUFIXO_DE_CODIGO.test(expressao)) {
        saida.dinamicas.push({ expressao, arquivo, linha: linhaDe(erro), canal: "error" });
      }
    }
  }
}

function varrerArquivo(caminho: string, raizDoProjeto: string, saida: Varredura): void {
  const conteudo = fs.readFileSync(caminho, "utf8");
  const tipo = caminho.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(caminho, conteudo, ts.ScriptTarget.Latest, true, tipo);
  const arquivo = path.relative(raizDoProjeto, caminho).split(path.sep).join("/");
  const visitar = (no: ts.Node): void => {
    if (ts.isObjectLiteralExpression(no)) analisarResultado(no, arquivo, sf, saida);
    ts.forEachChild(no, visitar);
  };
  visitar(sf);
}

export function varrerMotivosDeParada(opcoes: OpcoesDaVarredura): Varredura {
  const saida: Varredura = { arquivosVarridos: 0, resultados: 0, literais: [], dinamicas: [], isentos: [] };
  const arquivos = opcoes.raizes
    .flatMap((raiz) => listarFontes(path.join(opcoes.raizDoProjeto, raiz)))
    .sort();
  for (const arquivo of arquivos) {
    saida.arquivosVarridos += 1;
    varrerArquivo(arquivo, opcoes.raizDoProjeto, saida);
  }
  return saida;
}

/** Literais que o produtor de uma origem dinâmica pode devolver como código. */
export function literaisDoProdutor(
  raizDoProjeto: string,
  arquivoDoProdutor: string,
): Ocorrencia[] {
  const caminho = path.join(raizDoProjeto, arquivoDoProdutor);
  const conteudo = fs.readFileSync(caminho, "utf8");
  const tipo = caminho.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(caminho, conteudo, ts.ScriptTarget.Latest, true, tipo);
  const saida: Ocorrencia[] = [];
  const visitar = (no: ts.Node): void => {
    if (ts.isObjectLiteralExpression(no)) {
      for (const [nome, valor] of propriedades(no)) {
        if (nome !== "reason" && nome !== "motivo") continue;
        const texto = textoLiteral(valor);
        if (texto === null || !CODIGO.test(texto)) continue;
        saida.push({
          motivo: texto,
          arquivo: arquivoDoProdutor,
          linha: sf.getLineAndCharacterOfPosition(valor.getStart(sf)).line + 1,
        });
      }
    }
    ts.forEachChild(no, visitar);
  };
  visitar(sf);
  return saida;
}

export function cobrarFrases(
  varredura: Varredura,
  mapa: Record<string, string> | Map<string, string>,
  origens: DeclaracaoDeOrigem[],
  raizDoProjeto: string,
): Cobranca {
  // O mapa pode chegar como objeto literal (chave técnica) ou como `Map` (leitura
  // por AST da tela). `in` não enxerga entrada de `Map`, então a presença é
  // sempre perguntada por aqui — foi essa a diferença que fez uma versão anterior
  // acusar motivo que já tinha frase.
  const temFrase = (motivo: string): boolean =>
    mapa instanceof Map ? mapa.has(motivo) : Object.prototype.hasOwnProperty.call(mapa, motivo);
  const faltando = varredura.literais.filter((ocorrencia) => !temFrase(ocorrencia.motivo));
  const dinamicasSemDeclaracao = varredura.dinamicas.filter(
    (dinamica) =>
      !origens.some(
        (origem) => origem.arquivo === dinamica.arquivo && origem.expressao === dinamica.expressao,
      ),
  );

  const declaracoesQuebradas: string[] = [];
  for (const origem of origens) {
    const usada = varredura.dinamicas.some(
      (dinamica) => dinamica.arquivo === origem.arquivo && dinamica.expressao === origem.expressao,
    );
    if (!usada) {
      declaracoesQuebradas.push(
        `${origem.arquivo}: declaração de \`${origem.expressao}\`, que o código não emite mais`,
      );
    }
    if (origem.porque.trim().length < MINIMO_DE_PORQUE) {
      declaracoesQuebradas.push(
        `${origem.arquivo}: \`${origem.expressao}\` está declarada sem dizer por quê`,
      );
    }
    if (!origem.produtor) continue;

    const doProdutor = literaisDoProdutor(raizDoProjeto, origem.produtor.arquivo);
    const excecoes = origem.produtor.excecoes ?? [];
    for (const ocorrencia of doProdutor) {
      const isenta = excecoes.some((excecao) => excecao.motivo === ocorrencia.motivo);
      if (!isenta && !temFrase(ocorrencia.motivo)) faltando.push(ocorrencia);
    }
    for (const excecao of excecoes) {
      if (!doProdutor.some((ocorrencia) => ocorrencia.motivo === excecao.motivo)) {
        declaracoesQuebradas.push(
          `${origem.produtor.arquivo}: exceção declarada para "${excecao.motivo}", que o produtor não emite mais`,
        );
      }
      if (excecao.porque.trim().length < MINIMO_DE_PORQUE) {
        declaracoesQuebradas.push(
          `${origem.produtor.arquivo}: a exceção "${excecao.motivo}" está declarada sem dizer por quê`,
        );
      }
    }
  }

  return { faltando, dinamicasSemDeclaracao, declaracoesQuebradas };
}

/**
 * As chaves do mapa de frases da aba Atividade, LIDAS DO ARQUIVO DA TELA.
 *
 * A guarda não importa o componente: importar a tela traria React, os hooks de
 * dados e o cliente de API para dentro de um teste de varredura. O mapa é
 * estático, então ler o AST responde a mesma pergunta sem arrastar runtime — e é
 * o que o gate de espanhol já faz com as tabelas de rótulo
 * (`tests/unit/i18n-espanhol-cobre-a-tela.test.ts`).
 *
 * Devolve as chaves com o valor, para a guarda também poder cobrar que ninguém
 * deixe frase vazia.
 */
export function lerMapaDeMotivos(
  raizDoProjeto: string,
  arquivoDaTela: string,
  nomeDaTabela = "MOTIVO_DA_PARADA",
): Map<string, string> {
  const caminho = path.join(raizDoProjeto, arquivoDaTela);
  const sf = ts.createSourceFile(
    caminho,
    fs.readFileSync(caminho, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const mapa = new Map<string, string>();
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.name.text !== nomeDaTabela) continue;
      if (!decl.initializer) continue;
      let init: ts.Node = decl.initializer;
      while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init)) init = init.expression;
      if (!ts.isObjectLiteralExpression(init)) continue;
      for (const [chave, valor] of propriedades(init)) {
        mapa.set(chave, textoLiteral(valor) ?? "");
      }
    }
  }
  return mapa;
}

/** Lista `motivo → arquivo:linha` para a mensagem de reprovação. */
export function descrever(ocorrencias: Ocorrencia[]): string {
  const porMotivo = new Map<string, string[]>();
  for (const ocorrencia of ocorrencias) {
    const lugares = porMotivo.get(ocorrencia.motivo) ?? [];
    lugares.push(`${ocorrencia.arquivo}:${ocorrencia.linha}`);
    porMotivo.set(ocorrencia.motivo, lugares);
  }
  return [...porMotivo.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([motivo, lugares]) => `  ${motivo} → ${[...new Set(lugares)].join(", ")}`)
    .join("\n");
}
