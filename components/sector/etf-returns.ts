// Trailing returns of the sector ETFs from /api/history's aligned, dividend-adjusted daily closes. Pure, for tests.

export interface TrailingReturns {
  /** Ratios (0.012 = +1.2%) over 5, 21 and 63 sessions and since the last close of the previous year. */
  w1: number | null;
  m1: number | null;
  m3: number | null;
  ytd: number | null;
}

export const EMPTY_RETURNS: TrailingReturns = { w1: null, m1: null, m3: null, ytd: null };

function ratio(last: number, base: number | undefined): number | null {
  return base !== undefined && base > 0 && last > 0 ? last / base - 1 : null;
}

/**
 * Returns of one symbol from closes aligned to `dates` (epoch ms at UTC midnight, oldest first; null where the symbol
 * has no bar). Sessions are counted on the symbol's own bars, and year to date starts from its last close before
 * January 1 of the latest bar's year.
 */
export function trailingReturns(dates: readonly number[], closes: ReadonlyArray<number | null>): TrailingReturns {
  const points: Array<{ t: number; c: number }> = [];
  dates.forEach((t, i) => {
    const c = closes[i];
    if (typeof c === "number" && Number.isFinite(c)) points.push({ t, c });
  });
  const last = points[points.length - 1];
  if (!last) return { ...EMPTY_RETURNS };
  const back = (sessions: number) => ratio(last.c, points[points.length - 1 - sessions]?.c);
  const yearStart = Date.UTC(new Date(last.t).getUTCFullYear(), 0, 1);
  const base = points.filter((point) => point.t < yearStart).pop();
  return { w1: back(5), m1: back(21), m3: back(63), ytd: ratio(last.c, base?.c) };
}
