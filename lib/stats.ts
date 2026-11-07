// Generic statistics helpers used by the signal engine (lib/signal.ts).
// All functions are pure. Statistics that are undefined for the given input (an empty sample, a single
// observation, zero trials) return null instead of NaN, so callers have to handle the missing case explicitly.

/** A knot of a piecewise-linear function: [x, y]. */
export type Knot = readonly [x: number, y: number];

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Restricts x to [lo, hi]. */
export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Rounds to a fixed number of decimal places (halves round up). Never returns -0. */
export function round(x: number, decimals = 0): number {
  const factor = 10 ** decimals;
  // "+ 0" turns the -0 of e.g. round(-0.00001, 4) into 0; Intl.NumberFormat would print -0 as "-0".
  return Math.round(x * factor) / factor + 0;
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Sample standard deviation (n - 1 denominator); null for fewer than two observations. */
export function sampleStd(values: readonly number[]): number | null {
  const m = mean(values);
  if (m === null || values.length < 2) return null;
  let squares = 0;
  for (const v of values) squares += (v - m) ** 2;
  return Math.sqrt(squares / (values.length - 1));
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Downside semideviation below `target`: sqrt(sum(min(x - target, 0)^2) / N), averaged over all N observations
 * (not only the losing ones), so a single loss in a quiet window gives a small, non-zero value.
 */
export function downsideDeviation(values: readonly number[], target = 0): number | null {
  if (values.length === 0) return null;
  let squares = 0;
  for (const v of values) {
    const shortfall = Math.min(v - target, 0);
    squares += shortfall * shortfall;
  }
  return Math.sqrt(squares / values.length);
}

/**
 * Mid-rank percentile of `x` within `values`, in 0..100: (count below + half the count equal) / n.
 * Ties count half, so a constant sample ranks any of its own values at exactly 50.
 */
export function percentileRank(values: readonly number[], x: number): number | null {
  if (values.length === 0) return null;
  let below = 0;
  let equal = 0;
  for (const v of values) {
    if (v < x) below += 1;
    else if (v === x) equal += 1;
  }
  return ((below + equal / 2) / values.length) * 100;
}

/**
 * Piecewise-linear interpolation through knots sorted by x; constant beyond the first and the last knot.
 * NaN in gives NaN out, so a broken input cannot pass for a confident value.
 */
export function interpolate(x: number, knots: readonly [Knot, ...Knot[]]): number {
  if (Number.isNaN(x)) return Number.NaN;
  const [firstX, firstY] = knots[0];
  if (x <= firstX) return firstY;
  for (let k = 1; k < knots.length; k++) {
    const [x1, y1] = knots[k];
    if (x <= x1) {
      const [x0, y0] = knots[k - 1];
      return x1 === x0 ? y1 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return knots[knots.length - 1][1];
}

/**
 * Wilson score interval for a binomial proportion (z = 1.96 gives 95%).
 * Unlike the normal approximation it stays inside [0, 1] and behaves well for small samples and rates near 0 or 1.
 */
export function wilsonInterval(successes: number, trials: number, z = 1.96): [number, number] | null {
  if (!Number.isInteger(trials) || trials <= 0 || !Number.isInteger(successes) || successes < 0 || successes > trials) {
    return null;
  }
  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denominator;
  const halfWidth = (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denominator;
  return [Math.max(0, center - halfWidth), Math.min(1, center + halfWidth)];
}
