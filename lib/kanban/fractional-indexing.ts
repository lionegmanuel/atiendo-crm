const STEP = 1000;

/**
 * Compute a numeric position between two siblings. Returns NaN if both args
 * are equal (caller should trigger global rebalance — Wave 8 concern).
 */
export function midpoint(prev: number | null, next: number | null): number {
  if (prev == null && next == null) return STEP;
  if (prev == null) return (next as number) - STEP;
  if (next == null) return prev + STEP;
  if (prev === next) return NaN;
  return (prev + next) / 2;
}

/**
 * Returns the fractional precision (digits after decimal) of a number.
 * Used to detect when global rebalance is needed (>20 levels per spec P-05).
 */
export function fractionalPrecision(n: number): number {
  if (!isFinite(n)) return Infinity;
  const s = Math.abs(n).toString();
  const dot = s.indexOf(".");
  if (dot < 0) return 0;
  return s.length - dot - 1;
}
