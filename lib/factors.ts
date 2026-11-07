// Cross-sectional style factors with published evidence, computed from daily adjusted closes.
//
// The same definitions feed three places: the live factor profile and screener (lib/server/screener.ts), the offline
// factor research (scripts/research-factors.ts) and the AI context. What the app shows is therefore exactly what the
// research measured. Each raw value is computed at a session index i from closes up to and including i only.
//
// Definitions (sessions, not calendar days):
// - momentum:   12-1 month momentum, close[i-21] / close[i-252] - 1 (Jegadeesh & Titman 1993; the skipped month
//               avoids the short-term reversal effect).
// - reversal:   1-month return, close[i] / close[i-21] - 1. Short-term reversal predicts the opposite sign
//               (Jegadeesh 1990; Lehmann 1990).
// - high52:     close[i] / highest close of the last 252 sessions (George & Hwang 2004).
// - volatility: annualized standard deviation of the last 63 daily returns (Ang, Hodrick, Xing & Zhang 2006; Baker,
//               Bradley & Wurgler 2011 on the low-volatility anomaly).
// - beta:       beta of the last 252 daily returns to the benchmark (SPY) on matching sessions (Frazzini & Pedersen 2014).
//
// Raw values keep their natural sign (a high "volatility" is a volatile stock). FACTOR_DIRECTION says which side the
// literature expects to outperform; research and composites multiply by it. In this universe none of the five has
// predicted returns under the pre-registered test (docs/factor-research.md), so the app treats them as descriptive.

import type { StyleFactorKey } from "@/types/api";

import { isFiniteNumber, mean, sampleStd } from "./stats";

export type { StyleFactorKey } from "@/types/api";

export const FACTOR_KEYS = ["momentum", "reversal", "high52", "volatility", "beta"] as const satisfies readonly StyleFactorKey[];

/** +1 when higher raw values are expected to outperform, -1 when lower values are. */
export const FACTOR_DIRECTION: Readonly<Record<StyleFactorKey, 1 | -1>> = {
  momentum: 1,
  reversal: -1,
  high52: 1,
  volatility: -1,
  beta: -1,
};

/** Sessions of history each factor needs at index i (i must be at least this). */
export const FACTOR_LOOKBACK: Readonly<Record<StyleFactorKey, number>> = {
  momentum: 252,
  reversal: 21,
  high52: 251,
  volatility: 63,
  beta: 252,
};

export const FACTOR_WINDOWS = { momentumSkip: 21, momentumLookback: 252, reversal: 21, high52: 252, volatility: 63, beta: 252 } as const;

const TRADING_DAYS = 252;
/** Beta needs at least this share of the window's sessions to match the benchmark. */
const BETA_MIN_OVERLAP = 0.8;

export type StyleFactorValues = Record<StyleFactorKey, number | null>;

function isPrice(value: number | undefined): value is number {
  return isFiniteNumber(value) && value > 0;
}

export function momentumAt(closes: readonly number[], i: number): number | null {
  const { momentumSkip, momentumLookback } = FACTOR_WINDOWS;
  if (i < momentumLookback || i >= closes.length) return null;
  const from = closes[i - momentumLookback];
  const to = closes[i - momentumSkip];
  return isPrice(from) && isPrice(to) ? to / from - 1 : null;
}

export function reversalAt(closes: readonly number[], i: number): number | null {
  const n = FACTOR_WINDOWS.reversal;
  if (i < n || i >= closes.length) return null;
  const from = closes[i - n];
  const to = closes[i];
  return isPrice(from) && isPrice(to) ? to / from - 1 : null;
}

export function high52At(closes: readonly number[], i: number): number | null {
  const n = FACTOR_WINDOWS.high52;
  if (i < n - 1 || i >= closes.length || !isPrice(closes[i])) return null;
  let high = 0;
  for (let k = i - n + 1; k <= i; k++) {
    if (!isPrice(closes[k])) return null;
    high = Math.max(high, closes[k]);
  }
  return closes[i] / high;
}

/** Simple daily returns; entry k is the return into session k (entry 0 is NaN). */
export function returnsOf(closes: readonly number[]): number[] {
  return closes.map((c, k) => (k > 0 && isPrice(closes[k - 1]) && isPrice(c) ? c / closes[k - 1] - 1 : Number.NaN));
}

export function volatilityAt(returns: readonly number[], i: number): number | null {
  const n = FACTOR_WINDOWS.volatility;
  if (i < n || i >= returns.length) return null;
  const window = returns.slice(i - n + 1, i + 1);
  if (window.some((r) => !Number.isFinite(r))) return null;
  const sd = sampleStd(window);
  return sd === null ? null : sd * Math.sqrt(TRADING_DAYS);
}

/**
 * Beta of the stock's daily returns to the benchmark's over the last 252 sessions. `benchmarkReturns` is aligned to
 * the stock's sessions (NaN where the benchmark has no matching session).
 */
export function betaAt(returns: readonly number[], benchmarkReturns: readonly number[], i: number): number | null {
  const n = FACTOR_WINDOWS.beta;
  if (i < n || i >= returns.length || i >= benchmarkReturns.length) return null;
  const x: number[] = [];
  const y: number[] = [];
  for (let k = i - n + 1; k <= i; k++) {
    if (Number.isFinite(returns[k]) && Number.isFinite(benchmarkReturns[k])) {
      x.push(returns[k]);
      y.push(benchmarkReturns[k]);
    }
  }
  if (x.length < n * BETA_MIN_OVERLAP) return null;
  const mx = mean(x) as number;
  const my = mean(y) as number;
  let cov = 0;
  let varY = 0;
  for (let k = 0; k < x.length; k++) {
    cov += (x[k] - mx) * (y[k] - my);
    varY += (y[k] - my) ** 2;
  }
  return varY > 1e-18 ? cov / varY : null;
}

/** A dated close series, e.g. from daily bars: t = session date (epoch ms), c = adjusted close. */
export interface DatedClose {
  t: number;
  c: number;
}

/** The benchmark's daily returns on the stock's session dates (NaN where the dates do not line up). */
export function alignBenchmarkReturns(stock: readonly DatedClose[], benchmark: readonly DatedClose[]): number[] {
  const index = new Map(benchmark.map((bar, k) => [bar.t, k]));
  return stock.map((bar, k) => {
    if (k === 0) return Number.NaN;
    const j = index.get(bar.t);
    const jPrev = index.get(stock[k - 1].t);
    // Both sessions must exist in the benchmark and be consecutive there, so the two returns span the same days.
    if (j === undefined || jPrev === undefined || j !== jPrev + 1) return Number.NaN;
    const prev = benchmark[jPrev].c;
    const cur = benchmark[j].c;
    return isPrice(prev) && isPrice(cur) ? cur / prev - 1 : Number.NaN;
  });
}

/** All five raw factor values at session index i (default: the last session). */
export function styleFactorsAt(stock: readonly DatedClose[], benchmark: readonly DatedClose[] | null, i = stock.length - 1): StyleFactorValues {
  const closes = stock.map((bar) => bar.c);
  const returns = returnsOf(closes);
  return {
    momentum: momentumAt(closes, i),
    reversal: reversalAt(closes, i),
    high52: high52At(closes, i),
    volatility: volatilityAt(returns, i),
    beta: benchmark ? betaAt(returns, alignBenchmarkReturns(stock, benchmark), i) : null,
  };
}

/**
 * All five raw factor values at every session, in the stock's order (the offline research ranks them across stocks
 * date by date). Entry i equals styleFactorsAt(stock, benchmark, i); the shared inputs are prepared once.
 */
export function styleFactorSeries(stock: readonly DatedClose[], benchmark: readonly DatedClose[] | null): StyleFactorValues[] {
  const closes = stock.map((bar) => bar.c);
  const returns = returnsOf(closes);
  const aligned = benchmark ? alignBenchmarkReturns(stock, benchmark) : null;
  return stock.map((_, i) => ({
    momentum: momentumAt(closes, i),
    reversal: reversalAt(closes, i),
    high52: high52At(closes, i),
    volatility: volatilityAt(returns, i),
    beta: aligned ? betaAt(returns, aligned, i) : null,
  }));
}

/**
 * Mid-rank percentiles (0..100) of each symbol's value within the group; symbols without a value get null.
 * Ties share the average rank, so a group of equal values ranks everyone at 50.
 */
export function crossSectionalPercentiles(values: ReadonlyMap<string, number | null>): Map<string, number | null> {
  const present = [...values.entries()].filter((entry): entry is [string, number] => isFiniteNumber(entry[1]));
  const sorted = present.map(([, v]) => v).sort((a, b) => a - b);
  const out = new Map<string, number | null>();
  for (const [symbol, value] of values) {
    if (!isFiniteNumber(value) || sorted.length === 0) {
      out.set(symbol, null);
      continue;
    }
    let below = 0;
    let equal = 0;
    for (const v of sorted) {
      if (v < value) below++;
      else if (v === value) equal++;
    }
    out.set(symbol, ((below + equal / 2) / sorted.length) * 100);
  }
  return out;
}

/** Cross-sectional z-scores (mean 0, sample sd 1) of the values present; null when fewer than three are present. */
export function crossSectionalZ(values: ReadonlyMap<string, number | null>): Map<string, number | null> {
  const present = [...values.values()].filter(isFiniteNumber);
  const m = mean(present);
  const sd = sampleStd(present);
  const out = new Map<string, number | null>();
  for (const [symbol, value] of values) {
    out.set(symbol, present.length >= 3 && m !== null && sd !== null && sd > 0 && isFiniteNumber(value) ? (value - m) / sd : null);
  }
  return out;
}
