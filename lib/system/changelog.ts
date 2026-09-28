/**
 * Extrai a seção de UMA versão do CHANGELOG.md (Keep a Changelog, pt-BR).
 *
 * Mora no app, e não em `awk` dentro do agente do host, por um motivo só:
 * aqui é função pura e testável. O agente manda o arquivo cru; quem interpreta
 * é quem exibe.
 */

export interface ChangelogSection {
  version: string;
  body: string;
  requiresAttention: string | null;
}

/** Teto do que o agente pode mandar. O CHANGELOG real tem ~4 KB. */
export const CHANGELOG_MAX_BYTES = 64_000;

/** `## [1.1.0] — 2026-08-02` e também `## [Não lançado]`. */
const VERSION_HEADING = /^##\s+\[([^\]]+)\]/;
/** Casa tanto com heading (`### ⚠️ Requer atenção`) quanto com negrito (`**⚠️ Requer atenção**`). */
const ATTENTION_HEADING = /^(#{2,4}\s+)?(\*{1,2})?⚠️?\s*Requer atenção(\*{1,2})?$/i;

function normalize(version: string): string {
  return version.trim().replace(/^v/i, "");
}

export function extractChangelogSection(raw: string, version: string): ChangelogSection | null {
  const wanted = normalize(version);
  if (!raw || !wanted) return null;

  const lines = raw.split("\n");
  let start = -1;
  let end = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const match = VERSION_HEADING.exec(lines[i] ?? "");
    if (!match) continue;
    if (start === -1) {
      if (normalize(match[1] ?? "") === wanted) start = i + 1;
    } else {
      end = i;
      break;
    }
  }

  if (start === -1) return null;

  return montarSecao(lines, start, end, wanted);
}

/** O miolo de `extractChangelogSection`, reusado pela faixa. */
function montarSecao(
  lines: readonly string[],
  start: number,
  end: number,
  versao: string,
): ChangelogSection {
  const bodyLines = lines.slice(start, end);
  const attention = findAttentionRange(bodyLines);

  // `body` é a seção MENOS o bloco de atenção (heading + texto). Sem isto, o
  // mesmo aviso aparece duas vezes na tela: uma na caixa destacada (que é o
  // ponto do bloco separado) e outra dentro de "O que muda" — pior ainda,
  // pra quem precisa agir à mão, porque some a diferença entre "aviso" e
  // "changelog geral".
  const bodyWithoutAttention = attention
    ? [...bodyLines.slice(0, attention.start), ...bodyLines.slice(attention.end)]
    : bodyLines;
  const body = cleanBody(bodyWithoutAttention.join("\n").trim());

  const requiresAttention = attention
    ? cleanBody(bodyLines.slice(attention.start + 1, attention.end).join("\n").trim()) || null
    : null;

  return { version: versao, body, requiresAttention };
}

export interface ChangelogRange {
  /** Da mais NOVA para a mais antiga, como o arquivo. */
  secoes: ChangelogSection[];
  /**
   * Achei o cabeçalho da versão instalada no texto recebido?
   *
   * `false` significa "este histórico pode não alcançar a sua versão" — e a tela
   * precisa DIZER isso. O agente da VPS manda o CHANGELOG cortado em bytes, e um
   * corpo truncado no meio da frase é indistinguível de um corpo inteiro: sem
   * este sinal, a tela afirmaria completude que não tem.
   */
  completa: boolean;
}

/**
 * Todas as seções entre a versão-alvo e a instalada.
 *
 * Existe porque mostrar só a seção-alvo perde aviso: quem pula da 1.4.0 para a
 * 1.6.0 nunca lia a 1.4.1 nem a 1.5.0 — e a 1.4.1 existia justamente para
 * corrigir uma instrução invertida que mandava o operador apagar a conexão que
 * estava funcionando. O contorno da época foi carregar o aviso órfão para a
 * versão seguinte, à mão (commit ac9472c5); isto o aposenta.
 *
 * A seleção é POSICIONAL, não semver: o arquivo já vem do mais novo para o mais
 * antigo, e comparar número exigiria um comparador que não existe no projeto —
 * que tropeçaria em `v1.1.1-jmpo.1`, tag de fork que este repo carrega.
 */
export function extractChangelogRange(
  raw: string,
  alvo: string,
  instalada: string,
): ChangelogRange {
  const vazio: ChangelogRange = { secoes: [], completa: false };
  if (!raw || !alvo) return vazio;

  const lines = raw.split("\n");
  const cabs: Array<{ rotulo: string; i: number }> = [];
  lines.forEach((linha, i) => {
    const m = VERSION_HEADING.exec(linha);
    if (m) cabs.push({ rotulo: normalize(m[1] ?? ""), i });
  });

  const iAlvo = cabs.findIndex((c) => c.rotulo === normalize(alvo));
  if (iAlvo === -1) return vazio;

  const iInst = cabs.findIndex((c) => c.rotulo === normalize(instalada));

  // Os quatro casos são escritos um a um de propósito. Um `slice(iAlvo, iInst)`
  // ingênuo devolve lista VAZIA quando `iInst < iAlvo`, e ainda assim diria
  // `completa: true` — a tela ficaria sem corpo nenhum afirmando estar inteira.
  let fim: number;
  let completa: boolean;
  if (iInst === -1) {
    // Instalação fora de release (a versão é um SHA) ou texto cortado antes de
    // alcançá-la. Mostra o que veio e admite que pode não alcançar.
    fim = cabs.length;
    completa = false;
  } else if (iInst === iAlvo) {
    return { secoes: [], completa: true }; // está em dia: nada entre as duas
  } else if (iInst < iAlvo) {
    // A instalada é MAIS NOVA que a alvo (rollback pendente, canal trocado).
    // Só a seção-alvo faz sentido aqui.
    fim = iAlvo + 1;
    completa = true;
  } else {
    fim = iInst;
    completa = true;
  }

  const secoes = cabs.slice(iAlvo, fim).map((c, k, arr) => {
    const proximo = arr[k + 1]?.i ?? cabs[iAlvo + arr.length]?.i ?? lines.length;
    return montarSecao(lines, c.i + 1, proximo, c.rotulo);
  });

  return { secoes, completa };
}

/**
 * Limpa referências de link do final do corpo (formato `[algo]: http://...`).
 * Isso evita que o rodapé do arquivo apareça na seção antes do botão "Atualizar".
 */
function cleanBody(body: string): string {
  const lines = body.split("\n");
  // Remove linhas de referência de link do final: `[algo]: http...`
  while (lines.length > 0) {
    const lastLine = lines[lines.length - 1];
    if (lastLine && /^\[.+\]:\s+https?:\/\//.test(lastLine)) {
      lines.pop();
    } else {
      break;
    }
  }
  return lines.join("\n").trim();
}

/**
 * `body`/`requiresAttention` chegam à tela como Markdown cru (o CHANGELOG.md
 * real usa heading, negrito, itálico, crase e lista em quase toda linha).
 * Sem renderizador de Markdown instalado no projeto (checado: sem
 * `react-markdown`/`marked`/`remark`/`markdown-to-jsx` no `package.json` nem
 * em uso em nenhuma tela) — instalar um pra meia dúzia de linhas de
 * changelog seria dependência nova pra pouco ganho. Isto vira texto legível
 * (não JSX rico): heading e ênfase somem mantendo o conteúdo, lista vira
 * bullet visível.
 */
export function markdownParaTextoSimples(texto: string): string {
  return texto
    .split("\n")
    .map((linha) => {
      let l = linha.replace(/^#{1,6}\s+/, "");
      l = l.replace(/^[-*]\s+/, "• ");
      l = l.replace(/\*\*([^*]+)\*\*/g, "$1");
      l = l.replace(/__([^_]+)__/g, "$1");
      l = l.replace(/`([^`]+)`/g, "$1");
      // Ênfase de asterisco/underscore só conta fora de palavra — do
      // contrário identificadores como `fn_user_org_ids()` (comum no
      // CHANGELOG real, que cita nomes de função) perdem os `_` internos
      // pra virar "fnuserorg_ids()". Mesma regra do CommonMark: delimitador
      // não pode colar em letra/dígito por fora.
      l = l.replace(/(?<!\*)(?<!\w)\*([^*\n]+)\*(?!\*)(?!\w)/g, "$1");
      l = l.replace(/(?<!_)(?<!\w)_([^_\n]+)_(?!_)(?!\w)/g, "$1");
      return l;
    })
    .join("\n");
}

/**
 * Acha onde o bloco de atenção começa (a linha do heading/negrito) e termina
 * (o próximo heading de verdade, não negrito aleatório no meio do aviso) —
 * em índices de `bodyLines`, pra quem chama poder tanto extrair o texto
 * quanto EXCLUIR o intervalo do corpo geral.
 */
function findAttentionRange(bodyLines: string[]): { start: number; end: number } | null {
  const start = bodyLines.findIndex((line) => ATTENTION_HEADING.test(line.trim()));
  if (start === -1) return null;

  const rest = bodyLines.slice(start + 1);
  const nextHeading = rest.findIndex((line) => /^#{2,4}\s/.test(line));
  const end = nextHeading === -1 ? bodyLines.length : start + 1 + nextHeading;
  return { start, end };
}
