// Price-series and portfolio risk statistics for the portfolio page and the AI context.
//
// Inputs are daily closes aligned to one session calendar, with null where a symbol has no bar that session (before
// its listing, or a market holiday that other symbols traded through). Every function is pure. A statistic the data
// cannot support (too few overlapping sessions, zero variance) is null rather than NaN or 0, as in lib/stats.ts.

import { isFiniteNumber, mean, sampleStd } from "./stats";

export const TRADING_DAYS = 252;
/** With fewer overlapping daily returns than this, volatility, beta, correlation and VaR are not reported. */
export const MIN_RETURNS = 20;
/** Standard deviations below this are rounding noise (a constant series), not variation. */
const MIN_STD = 1e-12;

export interface AlignedCloses {
  /** Session dates (epoch ms, UTC midnight), ascending. */
  dates: readonly number[];
  /** Closes per symbol aligned to `dates`; null where the symbol has no bar that session. */
  closes: Readonly<Record<string, ReadonlyArray<number | null>>>;
}

type Series = ReadonlyArray<number | null>;

function isPrice(value: number | null | undefined): value is number {
  return isFiniteNumber(value) && value > 0;
}

function present(values: Series): number[] {
  return values.filter(isFiniteNumber);
}

/** Simple daily returns on the shared calendar: entry i is the return from session i-1 to i, so entry 0 is null. */
export function dailyReturns(closes: Series): Array<number | null> {
  return closes.map((close, i) => {
    const prev = i > 0 ? closes[i - 1] : null;
    return isPrice(prev) && isPrice(close) ? close / prev - 1 : null;
  });
}

/** The returns both series have on the same sessions. */
export function pairedReturns(a: Series, b: Series): [number[], number[]] {
  const x: number[] = [];
  const y: number[] = [];
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const ai = a[i];
    const bi = b[i];
    if (isFiniteNumber(ai) && isFiniteNumber(bi)) {
      x.push(ai);
      y.push(bi);
    }
  }
  return [x, y];
}

/** Sample covariance (n - 1 denominator) of equally long samples; null for fewer than two pairs. */
export function covariance(x: readonly number[], y: readonly number[]): number | null {
  if (x.length !== y.length || x.length < 2) return null;
  const mx = mean(x) as number;
  const my = mean(y) as number;
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += (x[i] - mx) * (y[i] - my);
  return sum / (x.length - 1);
}

/** Annualized standard deviation of daily returns. */
export function annualizedVolatility(returns: Series): number | null {
  const values = present(returns);
  if (values.length < MIN_RETURNS) return null;
  const sd = sampleStd(values);
  return sd === null ? null : sd * Math.sqrt(TRADING_DAYS);
}

/** Pearson correlation of daily returns over the sessions both series have. */
export function correlation(a: Series, b: Series): number | null {
  const [x, y] = pairedReturns(a, b);
  if (x.length < MIN_RETURNS) return null;
  const sx = sampleStd(x);
  const sy = sampleStd(y);
  const cov = covariance(x, y);
  if (sx === null || sy === null || cov === null || sx < MIN_STD || sy < MIN_STD) return null;
  return Math.max(-1, Math.min(1, cov / (sx * sy)));
}

/** Beta of an asset's daily returns to a benchmark's: cov(asset, benchmark) / var(benchmark). */
export function beta(asset: Series, benchmark: Series): number | null {
  const [x, y] = pairedReturns(asset, benchmark);
  if (x.length < MIN_RETURNS) return null;
  const cov = covariance(x, y);
  const varY = covariance(y, y);
  if (cov === null || varY === null || varY < MIN_STD ** 2) return null;
  return cov / varY;
}

/** Annualized Sharpe ratio of daily returns against a constant annual risk-free rate. */
export function sharpeRatio(returns: Series, riskFreeAnnual = 0): number | null {
  const values = present(returns);
  if (values.length < MIN_RETURNS) return null;
  const sd = sampleStd(values);
  const m = mean(values);
  if (sd === null || m === null || sd < MIN_STD) return null;
  return ((m - riskFreeAnnual / TRADING_DAYS) / sd) * Math.sqrt(TRADING_DAYS);
}

/**
 * One-day historical value at risk: the daily return that only (1 - confidence) of the observed sessions fell below,
 * as a negative decimal (-0.024 = a 2.4% loss). Linear interpolation between order statistics.
 */
export function historicalVar(returns: Series, confidence = 0.95): number | null {
  const values = present(returns).sort((a, b) => a - b);
  if (values.length < MIN_RETURNS || !(confidence > 0 && confidence < 1)) return null;
  const position = (1 - confidence) * (values.length - 1);
  const lo = Math.floor(position);
  const hi = Math.ceil(position);
  return values[lo] + (values[hi] - values[lo]) * (position - lo);
}

/** Return from the first to the last value present. */
export function periodReturn(values: Series): number | null {
  const prices = values.filter(isPrice);
  if (prices.length < 2) return null;
  return prices[prices.length - 1] / prices[0] - 1;
}

/** Compound annual growth rate between the first and the last value present, counting the sessions between them. */
export function annualizedReturn(values: Series): number | null {
  const first = values.findIndex(isPrice);
  let last = -1;
  for (let i = values.length - 1; i >= 0; i--) {
    if (isPrice(values[i])) {
      last = i;
      break;
    }
  }
  if (first < 0 || last - first < MIN_RETURNS) return null;
  const growth = (values[last] as number) / (values[first] as number);
  return growth ** (TRADING_DAYS / (last - first)) - 1;
}

export interface Drawdown {
  /** Peak-to-trough decline as a negative decimal (0 when the values never fell below an earlier peak). */
  depth: number;
  peakIndex: number;
  troughIndex: number;
  /** First index after the trough at which the earlier peak was regained; null if it has not been. */
  recoveryIndex: number | null;
}

/** Largest peak-to-trough decline of a value series; null values are skipped. */
export function maxDrawdown(values: Series): Drawdown | null {
  let peak = -Infinity;
  let peakIndex = -1;
  let worst: Drawdown | null = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!isPrice(v)) continue;
    if (v > peak) {
      peak = v;
      peakIndex = i;
    }
    const depth = v / peak - 1;
    if (worst === null || depth < worst.depth) worst = { depth, peakIndex, troughIndex: i, recoveryIndex: null };
  }
  if (worst === null) return null;
  if (worst.depth < 0) {
    const peakValue = values[worst.peakIndex] as number;
    for (let i = worst.troughIndex + 1; i < values.length; i++) {
      const v = values[i];
      if (isPrice(v) && v >= peakValue) {
        worst.recoveryIndex = i;
        break;
      }
    }
  }
  return worst;
}

/** Decline from the running peak at each session (0 at new highs, negative below); null where the value is null. */
export function drawdownSeries(values: Series): Array<number | null> {
  let peak = -Infinity;
  return values.map((v) => {
    if (!isPrice(v)) return null;
    peak = Math.max(peak, v);
    return v / peak - 1;
  });
}

/** Rebases a series so that its first value present equals `base` (100 by default). */
export function rebase(values: Series, base = 100): Array<number | null> {
  const first = values.find(isPrice);
  if (first === undefined) return values.map(() => null);
  return values.map((v) => (isPrice(v) ? (v / first) * base : null));
}

/** Pairwise-complete sample covariance matrix of daily return series. */
export function covarianceMatrix(series: ReadonlyArray<Series>): Array<Array<number | null>> {
  return series.map((a, i) =>
    series.map((b, j) => {
      const [x, y] = pairedReturns(a, b);
      if (x.length < MIN_RETURNS) return null;
      return i === j ? covariance(x, x) : covariance(x, y);
    }),
  );
}

/**
 * Each position's share of portfolio variance (Euler allocation): w_i * (Cov w)_i / (w' Cov w). The shares sum to 1;
 * a negative share means the position lowers the portfolio's variance. Null when a needed covariance is missing or
 * the portfolio variance is not positive.
 */
export function riskContributions(weights: readonly number[], cov: ReadonlyArray<ReadonlyArray<number | null>>): number[] | null {
  const n = weights.length;
  if (n === 0 || cov.length !== n) return null;
  const marginal: number[] = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      const c = cov[i]?.[j];
      if (!isFiniteNumber(c)) return null;
      sum += c * weights[j];
    }
    marginal.push(sum);
  }
  const variance = weights.reduce((sum, w, i) => sum + w * marginal[i], 0);
  if (!(variance > 0)) return null;
  return weights.map((w, i) => (w * marginal[i]) / variance);
}

/** Annualized volatility of a weighted portfolio from a daily covariance matrix. */
export function portfolioVolatility(weights: readonly number[], cov: ReadonlyArray<ReadonlyArray<number | null>>): number | null {
  if (weights.length === 0 || cov.length !== weights.length) return null;
  let variance = 0;
  for (let i = 0; i < weights.length; i++) {
    for (let j = 0; j < weights.length; j++) {
      const c = cov[i]?.[j];
      if (!isFiniteNumber(c)) return null;
      variance += weights[i] * weights[j] * c;
    }
  }
  return variance >= 0 ? Math.sqrt(variance * TRADING_DAYS) : null;
}

/** 1 / sum(w^2): how many equally weighted positions would be as concentrated. Weights are normalized first. */
export function effectivePositions(weights: readonly number[]): number | null {
  if (weights.some((w) => !isFiniteNumber(w) || w < 0)) return null;
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (!(total > 0)) return null;
  const hhi = weights.reduce((sum, w) => sum + (w / total) ** 2, 0);
  return 1 / hhi;
}

/**
 * Value of fixed share counts on the shared calendar: what today's holdings would have been worth on each session.
 * Sessions before every held symbol has a close are null; later gaps carry that symbol's last close forward.
 */
export function holdingsValueSeries(aligned: AlignedCloses, shares: Readonly<Record<string, number>>): Array<number | null> {
  const symbols = Object.keys(shares).filter((symbol) => isFiniteNumber(shares[symbol]) && shares[symbol] > 0);
  if (symbols.length === 0) return aligned.dates.map(() => null);
  const lastClose: Record<string, number | undefined> = {};
  return aligned.dates.map((_, i) => {
    let value = 0;
    let complete = true;
    for (const symbol of symbols) {
      const close = aligned.closes[symbol]?.[i];
      if (isPrice(close)) lastClose[symbol] = close;
      const price = lastClose[symbol];
      if (price === undefined) complete = false;
      else value += price * shares[symbol];
    }
    return complete ? value : null;
  });
}
