// Statistics for the offline research and evaluation scripts (scripts/evaluate-signal.ts, scripts/research-factors.ts).
//
// Every function is pure. The only randomness is the seeded generator below, so a run with the same inputs and seed
// reproduces every bootstrap interval to the last digit. Statistics the input cannot support (too few observations,
// no variation) return null, as in lib/stats.ts, never NaN.

import { mean } from "./stats";

// ---------------------------------------------------------------------------
// Ranks and correlation
// ---------------------------------------------------------------------------

/** Ranks 1..n in ascending order; tied values share the average of their ranks. */
export function ranks(values: readonly number[]): number[] {
  const order = values.map((value, index) => [value, index] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = new Array<number>(values.length);
  for (let k = 0; k < order.length; ) {
    let j = k;
    while (j + 1 < order.length && order[j + 1][0] === order[k][0]) j++;
    const average = (k + j) / 2 + 1;
    for (let m = k; m <= j; m++) out[order[m][1]] = average;
    k = j + 1;
  }
  return out;
}

/** Pearson correlation of equally long samples; null below two pairs or when either side does not vary. */
export function pearson(x: readonly number[], y: readonly number[]): number | null {
  if (x.length !== y.length || x.length < 2) return null;
  const mx = mean(x) as number;
  const my = mean(y) as number;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

/** Spearman rank correlation (the rank IC when x is a signal and y a forward return); null below three pairs. */
export function spearman(x: readonly number[], y: readonly number[]): number | null {
  return x.length >= 3 && x.length === y.length ? pearson(ranks(x), ranks(y)) : null;
}

// ---------------------------------------------------------------------------
// Inference on a mean
// ---------------------------------------------------------------------------

export interface MeanTest {
  n: number;
  mean: number;
  /** Standard error of the mean; null when the variance estimate is not positive. */
  se: number | null;
  t: number | null;
}

/** Classical t-test of a mean (sample standard deviation, n - 1 degrees of freedom); null below two observations. */
export function tTest(xs: readonly number[]): MeanTest | null {
  if (xs.length < 2) return null;
  const m = mean(xs) as number;
  let squares = 0;
  for (const x of xs) squares += (x - m) ** 2;
  const se = Math.sqrt(squares / (xs.length - 1) / xs.length);
  return { n: xs.length, mean: m, se: se > 0 ? se : null, t: se > 0 ? m / se : null };
}

/**
 * Newey-West (1987) test of a mean with a Bartlett kernel: the long-run variance adds the autocovariances up to `lag`
 * with weights 1 - l / (lag + 1), which keeps it non-negative. Overlapping h-period returns make consecutive daily
 * statistics correlated up to h - 1 sessions apart, so a lag of at least h is needed. The lag is capped at n - 1.
 */
export function neweyWest(xs: readonly number[], lag: number): MeanTest | null {
  const n = xs.length;
  if (n < 2 || !Number.isFinite(lag) || lag < 0) return null;
  const m = mean(xs) as number;
  const e = xs.map((x) => x - m);
  let longRun = 0;
  for (const v of e) longRun += v * v;
  longRun /= n;
  const maxLag = Math.min(Math.floor(lag), n - 1);
  for (let l = 1; l <= maxLag; l++) {
    let gamma = 0;
    for (let i = l; i < n; i++) gamma += e[i] * e[i - l];
    longRun += 2 * (1 - l / (maxLag + 1)) * (gamma / n);
  }
  const se = longRun > 0 ? Math.sqrt(longRun / n) : 0;
  return { n, mean: m, se: se > 0 ? se : null, t: se > 0 ? m / se : null };
}

// ---------------------------------------------------------------------------
// Distributions
// ---------------------------------------------------------------------------

/** Complementary error function (Numerical Recipes erfcc, fractional error below 1.2e-7). */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}

/** Standard normal distribution function. */
export function normalCdf(z: number): number {
  if (Number.isNaN(z)) return Number.NaN;
  return 0.5 * erfc(-z / Math.SQRT2);
}

/** Standard normal quantile (Acklam's rational approximation, relative error below 1.2e-9). */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : p === 1 ? Infinity : Number.NaN;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - low) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function logGamma(z: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  const x = z - 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction of the incomplete beta function (modified Lentz). */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 500; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a - 1 + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + 1 + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const step = d * c;
    h *= step;
    if (Math.abs(step - 1) < 1e-15) break;
  }
  return h;
}

/** Regularized incomplete beta function I_x(a, b). */
function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (front * betaContinuedFraction(a, b, x)) / a : 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** Two-sided p-value of a Student t statistic with `df` degrees of freedom. */
export function studentTPValue(t: number, df: number): number | null {
  if (!Number.isFinite(t) || !(df >= 1)) return null;
  return incompleteBeta(df / 2, 0.5, df / (df + t * t));
}

/** Two-sided p-value of a statistic that is standard normal under the null (e.g. a Newey-West t). */
export function normalPValue(z: number): number | null {
  return Number.isFinite(z) ? 2 * normalCdf(-Math.abs(z)) : null;
}

/** Quantile of the Student t distribution (bisection on the two-sided p-value). */
export function studentTQuantile(p: number, df: number): number | null {
  if (!(p > 0 && p < 1) || !(df >= 1)) return null;
  if (p === 0.5) return 0;
  const target = 2 * Math.min(p, 1 - p);
  let lo = 0;
  let hi = 1e3;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if ((studentTPValue(mid, df) as number) > target) lo = mid;
    else hi = mid;
  }
  const magnitude = (lo + hi) / 2;
  return p > 0.5 ? magnitude : -magnitude;
}

// ---------------------------------------------------------------------------
// Multiple testing
// ---------------------------------------------------------------------------

/** Holm (1979) step-down adjusted p-values, in the input order; they control the family-wise error rate. */
export function holm(pValues: readonly number[]): number[] {
  const m = pValues.length;
  const order = pValues.map((p, i) => [p, i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = new Array<number>(m);
  let running = 0;
  order.forEach(([p, i], rank) => {
    running = Math.max(running, Math.min(1, (m - rank) * p));
    out[i] = running;
  });
  return out;
}

/** Benjamini-Hochberg (1995) step-up q-values, in the input order; they control the false discovery rate. */
export function benjaminiHochberg(pValues: readonly number[]): number[] {
  const m = pValues.length;
  const order = pValues.map((p, i) => [p, i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = new Array<number>(m);
  let running = 1;
  for (let rank = m - 1; rank >= 0; rank--) {
    const [p, i] = order[rank];
    running = Math.min(running, Math.min(1, (m * p) / (rank + 1)));
    out[i] = running;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

/** Deterministic uniform [0, 1) generator (mulberry32): the same seed always yields the same sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A run of consecutive indices [start, start + length) drawn by the moving-block bootstrap. */
export interface Block {
  start: number;
  length: number;
}

/**
 * One moving-block bootstrap resample of a series of length n (Kunsch 1989): ceil(n / blockLength) blocks of
 * consecutive indices with uniformly drawn starts, the last block cut so the resample has exactly n indices. Blocks
 * keep the serial dependence within them, which an independent resample of single days would destroy.
 */
export function drawBlocks(n: number, blockLength: number, random: () => number): Block[] {
  if (n <= 0) return [];
  const length = Math.max(1, Math.min(Math.floor(blockLength), n));
  const starts = n - length + 1;
  const blocks: Block[] = [];
  for (let covered = 0; covered < n; covered += length) {
    blocks.push({ start: Math.floor(random() * starts), length: Math.min(length, n - covered) });
  }
  return blocks;
}

export interface BootstrapOptions {
  blockLength: number;
  reps: number;
  seed: number;
}

/**
 * Moving-block bootstrap over a series of length n: `statistic` receives the blocks of each replicate and returns the
 * replicate's value (null to skip it). Returns the replicate values in draw order.
 */
export function movingBlockBootstrap(n: number, options: BootstrapOptions, statistic: (blocks: readonly Block[]) => number | null): number[] {
  const random = mulberry32(options.seed);
  const out: number[] = [];
  for (let rep = 0; rep < options.reps; rep++) {
    const value = statistic(drawBlocks(n, options.blockLength, random));
    if (value !== null && Number.isFinite(value)) out.push(value);
  }
  return out;
}

/** Quantile of a sample with linear interpolation between order statistics (Hyndman and Fan type 7). */
export function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0 || !(q >= 0 && q <= 1)) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lo = Math.floor(position);
  const hi = Math.ceil(position);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (position - lo);
}

/** Two-sided percentile interval of bootstrap replicates (0.95 gives the 2.5% and 97.5% quantiles). */
export function percentileInterval(values: readonly number[], level = 0.95): [number, number] | null {
  const lo = quantile(values, (1 - level) / 2);
  const hi = quantile(values, 1 - (1 - level) / 2);
  return lo === null || hi === null ? null : [lo, hi];
}

// ---------------------------------------------------------------------------
// Portfolio sorts
// ---------------------------------------------------------------------------

export interface QuintileSort {
  /** Mean of y in each quintile of x, lowest x first. */
  means: [number, number, number, number, number];
  /** Highest minus lowest quintile. */
  spread: number;
  /** Input indices in the highest quintile of x (for turnover). */
  top: number[];
}

/**
 * Sorts by x (ties by input order) into five groups of near-equal size and averages y in each; null below five
 * observations.
 */
export function quintileSort(x: readonly number[], y: readonly number[]): QuintileSort | null {
  const n = x.length;
  if (n < 5 || y.length !== n) return null;
  const order = x.map((_, i) => i).sort((a, b) => x[a] - x[b] || a - b);
  const sums = [0, 0, 0, 0, 0];
  const counts = [0, 0, 0, 0, 0];
  const top: number[] = [];
  order.forEach((i, position) => {
    const q = Math.floor((position * 5) / n);
    sums[q] += y[i];
    counts[q] += 1;
    if (q === 4) top.push(i);
  });
  const means = sums.map((s, q) => s / counts[q]) as QuintileSort["means"];
  return { means, spread: means[4] - means[0], top };
}

/** Share of the current members that were not members before (one rebalance of a top-quintile portfolio). */
export function turnover<T>(previous: ReadonlySet<T>, current: readonly T[]): number | null {
  if (current.length === 0) return null;
  let replaced = 0;
  for (const member of current) if (!previous.has(member)) replaced += 1;
  return replaced / current.length;
}

// ---------------------------------------------------------------------------
// Power
// ---------------------------------------------------------------------------

/**
 * Smallest true mean IC a two-sided t-test at level `alpha` detects with the given power, for per-date ICs with
 * standard deviation `sdIc` over `n` independent dates: (t_{1-alpha/2, n-1} + z_power) * sdIc / sqrt(n).
 */
export function minimumDetectableIc(sdIc: number, n: number, options: { alpha?: number; power?: number } = {}): number | null {
  const { alpha = 0.05, power = 0.8 } = options;
  if (!(sdIc > 0) || !(n >= 2)) return null;
  const critical = studentTQuantile(1 - alpha / 2, n - 1);
  if (critical === null) return null;
  return ((critical + normalQuantile(power)) * sdIc) / Math.sqrt(n);
}
