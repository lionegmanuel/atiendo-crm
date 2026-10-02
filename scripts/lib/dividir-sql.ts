/**
 * Divide um arquivo SQL em sentenças, do jeito que o `psql` divide.
 *
 * Existe para `scripts/aplicar-baseline.ts`, que aplica o `baseline.sql` sem
 * `psql` instalado. Mandar o arquivo inteiro numa única consulta (o que
 * `scripts/migrar-supabase.js` faz) é uma transação só: numa base que já existe,
 * o primeiro `already exists` do corpo do dump desfaz TUDO — e re-aplicar o
 * baseline é justamente o caminho de atualização do produto. Sentença por
 * sentença, o erro de uma não derruba as outras, como no `update.sh`.
 *
 * O `;` só fecha sentença fora de: comentário de linha (`--`), comentário de
 * bloco (`/* *\/`, que no Postgres aninha), string (`'...'`, com `''`), string
 * com escape (`E'...'`, com `\'`), identificador entre aspas (`"..."`) e corpo
 * entre cifrões (`$$...$$`, `$tag$...$tag$`). Meta-comando do `psql` (`\...`)
 * não é SQL: é recusado com a linha, em vez de virar erro de sintaxe calado.
 */
export interface Sentenca {
  /** O texto, sem o `;` final e sem espaço nas pontas. */
  sql: string;
  /** Linha (1-based) onde a sentença começa — para o erro apontar o arquivo. */
  linha: number;
}

const IDENT = /[A-Za-z0-9_$]/;
const INICIO_DE_TAG = /[A-Za-z_]/;

export function dividirSql(texto: string): Sentenca[] {
  const sentencas: Sentenca[] = [];
  let linhaAtual = 1;
  let linhaDoConteudo = -1;
  let offsetDoConteudo = 0;
  let i = 0;
  const n = texto.length;

  const marcarConteudo = () => {
    if (linhaDoConteudo === -1) {
      linhaDoConteudo = linhaAtual;
      offsetDoConteudo = i;
    }
  };
  const fechar = (fim: number) => {
    if (linhaDoConteudo !== -1) {
      const sql = texto.slice(offsetDoConteudo, fim).trim();
      if (sql) sentencas.push({ sql, linha: linhaDoConteudo });
    }
    linhaDoConteudo = -1;
  };
  /** Avança até `fim` (exclusivo) contando as quebras de linha do trecho. */
  const pular = (fim: number) => {
    for (let k = i; k < fim && k < n; k++) if (texto[k] === "\n") linhaAtual++;
    i = fim;
  };

  while (i < n) {
    const c = texto[i]!;
    const prox = texto[i + 1];

    if (c === "\n") {
      linhaAtual++;
      i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      i++;
      continue;
    }
    // Comentário de linha.
    if (c === "-" && prox === "-") {
      const fim = texto.indexOf("\n", i);
      pular(fim === -1 ? n : fim);
      continue;
    }
    // Comentário de bloco — aninha no Postgres.
    if (c === "/" && prox === "*") {
      let profundidade = 0;
      let k = i;
      while (k < n) {
        if (texto[k] === "/" && texto[k + 1] === "*") {
          profundidade++;
          k += 2;
        } else if (texto[k] === "*" && texto[k + 1] === "/") {
          profundidade--;
          k += 2;
          if (profundidade === 0) break;
        } else k++;
      }
      pular(k);
      continue;
    }
    // Meta-comando do psql no começo de uma sentença.
    if (c === "\\" && linhaDoConteudo === -1) {
      throw new Error(`linha ${linhaAtual}: meta-comando do psql (${texto.slice(i, texto.indexOf("\n", i))}) não é SQL`);
    }

    marcarConteudo();

    if (c === ";") {
      fechar(i);
      i++;
      continue;
    }
    // String com escape: E'...' (o E não pode ser o fim de um identificador).
    if ((c === "'" && (texto[i - 1] === "E" || texto[i - 1] === "e") && !IDENT.test(texto[i - 2] ?? ""))) {
      let k = i + 1;
      while (k < n) {
        if (texto[k] === "\\") k += 2;
        else if (texto[k] === "'" && texto[k + 1] === "'") k += 2;
        else if (texto[k] === "'") break;
        else k++;
      }
      pular(k + 1);
      continue;
    }
    // String comum e identificador entre aspas: a aspa dobrada é escape.
    if (c === "'" || c === '"') {
      let k = i + 1;
      while (k < n) {
        if (texto[k] === c && texto[k + 1] === c) k += 2;
        else if (texto[k] === c) break;
        else k++;
      }
      pular(k + 1);
      continue;
    }
    // Corpo entre cifrões. `$1` (parâmetro) e `nome$x` (identificador) não abrem.
    if (c === "$" && !IDENT.test(texto[i - 1] ?? "")) {
      let k = i + 1;
      if (texto[k] === "$" || INICIO_DE_TAG.test(texto[k] ?? "")) {
        while (k < n && texto[k] !== "$" && IDENT.test(texto[k]!)) k++;
        if (texto[k] === "$") {
          const tag = texto.slice(i, k + 1);
          const fim = texto.indexOf(tag, k + 1);
          pular(fim === -1 ? n : fim + tag.length);
          continue;
        }
      }
    }
    i++;
  }
  // Sobra sem `;` final (o psql executa assim mesmo).
  if (linhaDoConteudo !== -1) {
    const sql = texto.slice(offsetDoConteudo).trim();
    if (sql) sentencas.push({ sql, linha: linhaDoConteudo });
  }
  return sentencas;
}
