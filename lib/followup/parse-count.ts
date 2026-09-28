/**
 * Lê um inteiro da resposta do contato para o nó `repeat`.
 * Palavras curtas em pt-BR cobrem o caso "nenhum"/"dois" sem chamar modelo.
 */
const PALAVRAS: ReadonlyArray<readonly [RegExp, number]> = [
  [/\bnenhum(a)?\b/, 0],
  [/\bzero\b/, 0],
  [/\buma?\b/, 1],
  [/\bdois\b/, 2],
  [/\bduas\b/, 2],
  [/\btr[eê]s\b/, 3],
  [/\bquatro\b/, 4],
  [/\bcinco\b/, 5],
  [/\bseis\b/, 6],
  [/\bsete\b/, 7],
  [/\boito\b/, 8],
  [/\bnove\b/, 9],
  [/\bdez\b/, 10],
];

export function parseReplyCount(body: string | null | undefined, maxCount: number): number | null {
  if (body == null) return null;
  const texto = body.trim().toLowerCase();
  if (texto.length === 0) return null;
  const digitos = texto.match(/\d{1,2}/);
  if (digitos) {
    const n = Number.parseInt(digitos[0]!, 10);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.min(n, maxCount);
  }
  for (const [rx, n] of PALAVRAS) {
    if (rx.test(texto)) return Math.min(n, maxCount);
  }
  return null;
}
