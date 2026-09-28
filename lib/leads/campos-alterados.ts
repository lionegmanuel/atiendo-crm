/**
 * Quais campos REALMENTE mudaram numa edição de negócio.
 *
 * POR QUE ISTO EXISTE: a atividade `lead_edited` nomeava as chaves ENVIADAS
 * (`Object.keys(input)`), e o formulário do dossiê envia o form INTEIRO a cada
 * salvamento — react-hook-form não manda só o campo tocado. Resultado medido:
 * mudei apenas a descrição e a timeline registrou "Alterou o título, a
 * descrição, o valor, a data prevista de fechamento e as tags".
 *
 * Um registro que afirma o que não aconteceu é pior que registro nenhum: ele é
 * lido como verdade, entra em auditoria, e quem investigar "quem mexeu no
 * título?" acusa a pessoa errada. É a mesma família de defeito das outras waves
 * — um lado do contrato mudou (o formulário passou a mandar tudo) e o outro não
 * acompanhou (o handler continuou lendo envio como alteração).
 *
 * ⚠️ Esta função COMPARA valores mas NÃO os devolve: a saída são NOMES DE
 * CAMPO. O reason é renderizado na tela e o §9 proíbe PII nova ali.
 */

/**
 * Campos que a máquina escreve junto e que NUNCA são "o que a pessoa alterou".
 * Nomeá-los seria mentir de novo, só que na outra direção.
 */
const DERIVADOS = new Set(["updated_at", "assigned_at", "owner_kind"]);

/** Igualdade para o que aparece num lead: escalares, arrays de tag, jsonb. */
function igual(a: unknown, b: unknown): boolean {
  // `null` e `undefined` são o mesmo estado aqui: "não preenchido". A coluna
  // volta `null` do banco e o form manda `undefined`/`""` — tratar como
  // diferentes marcaria alteração em todo salvamento de campo vazio.
  const vazio = (v: unknown): boolean => v === null || v === undefined || v === "";
  if (vazio(a) && vazio(b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    // Tags são conjunto, não sequência: reordenar não é alterar.
    if (a.length !== b.length) return false;
    const sa = [...a].map(String).sort();
    const sb = [...b].map(String).sort();
    return sa.every((v, i) => v === sb[i]);
  }
  if (a instanceof Date || b instanceof Date) {
    return new Date(a as string).getTime() === new Date(b as string).getTime();
  }
  if (typeof a === "object" && typeof b === "object" && a !== null && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return a === b;
}

/**
 * Os campos do `patch` cujo valor difere do estado anterior.
 *
 * `anterior` deve vir de um `select("*")`: com lista explícita de colunas, um
 * campo novo no patch cairia contra `undefined` e seria marcado como alterado
 * em TODA edição — o mesmo defeito reaparecendo por outra porta.
 */
export function camposAlterados(
  patch: Record<string, unknown>,
  anterior: Record<string, unknown>,
): string[] {
  return Object.keys(patch)
    .filter((k) => !DERIVADOS.has(k))
    .filter((k) => !igual(patch[k], anterior[k]));
}
