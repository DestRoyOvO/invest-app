// Forward-looking risk from daily bars: a volatility forecast, the price ranges it implies, the stock's volatility
// against its own past year, its beta to the market and its 63-session volatility.
//
// Risk is what daily prices forecast well (docs/factor-research.md): trailing volatility and beta rank next quarter's
// volatility and beta with rank correlations around 0.7 in every subperiod, unlike the return signals. The estimator is
// fixed in advance, not tuned: an equal blend of the 20- and 252-session variance, the simplest form of the mix of
// short and long memory in HAR models (Corsi 2009). scripts/research-factors.ts measures its calibration with these
// same functions and writes lib/risk-calibration.json. Every function is pure.

import type { DailyBar } from "@/lib/bars";
import type { PriceRange, SignalRisk } from "@/types/api";

import { alignBenchmarkReturns, betaAt, returnsOf, volatilityAt } from "./factors";
import { isFiniteNumber, percentileRank, round } from "./stats";

export const RISK_SETTINGS = {
  /** Windows, in daily returns, of the two variances the forecast blends. */
  shortWindow: 20,
  longWindow: 252,
  /** Weight of the short-window variance (the long window gets the rest). */
  shortWeight: 0.5,
  /** Sessions the reported price ranges cover. */
  horizonDays: 10,
  /** The own-history percentile compares today's 20-session volatility with its daily values over this many sessions. */
  ownHistory: 252,
  tradingDays: 252,
} as const;

function isPrice(value: number | null | undefined): value is number {
  return isFiniteNumber(value) && value > 0;
}

/** A price for the report: six significant digits, but never fewer than two decimals, so cents survive at any level. */
export function roundPrice(price: number): number {
  const integerDigits = Math.max(1, Math.floor(Math.log10(Math.abs(price))) + 1);
  return Number(price.toPrecision(Math.min(100, Math.max(6, integerDigits + 2))));
}

/** Daily log returns; entry k is ln(closes[k] / closes[k - 1]) and entry 0 is NaN, as are returns around bad prices. */
export function logReturns(closes: readonly number[]): number[] {
  return closes.map((c, k) => (k > 0 && isPrice(closes[k - 1]) && isPrice(c) ? Math.log(c / closes[k - 1]) : Number.NaN));
}

/** Sample variance of the `window` values ending at index i; null when the window is incomplete or holds a NaN. */
function trailingVariance(values: readonly number[], i: number, window: number): number | null {
  if (i - window + 1 < 0 || i >= values.length || window < 2) return null;
  let sum = 0;
  for (let k = i - window + 1; k <= i; k++) {
    if (!Number.isFinite(values[k])) return null;
    sum += values[k];
  }
  const m = sum / window;
  let squares = 0;
  for (let k = i - window + 1; k <= i; k++) squares += (values[k] - m) ** 2;
  return squares / (window - 1);
}

/**
 * Daily volatility forecast at index i of a log-return series: sqrt(w * var20 + (1 - w) * var252) with w = 0.5.
 * Null until 252 returns are available.
 */
export function forecastDailyVolatility(returns: readonly number[], i = returns.length - 1): number | null {
  const { shortWindow, longWindow, shortWeight } = RISK_SETTINGS;
  const short = trailingVariance(returns, i, shortWindow);
  const long = trailingVariance(returns, i, longWindow);
  if (short === null || long === null) return null;
  return Math.sqrt(shortWeight * short + (1 - shortWeight) * long);
}

/** Daily volatility from the 20-session variance alone, the benchmark the blend is compared with. */
export function shortWindowDailyVolatility(returns: readonly number[], i = returns.length - 1): number | null {
  const variance = trailingVariance(returns, i, RISK_SETTINGS.shortWindow);
  return variance === null ? null : Math.sqrt(variance);
}

/** The price moved down and up by `sigmas` standard deviations of the log return over `horizonDays` sessions. */
export function priceRange(price: number, dailyVolatility: number, horizonDays: number, sigmas: number): PriceRange | null {
  if (!isPrice(price) || !isFiniteNumber(dailyVolatility) || dailyVolatility < 0 || !(horizonDays > 0)) return null;
  const move = sigmas * dailyVolatility * Math.sqrt(horizonDays);
  return { low: price * Math.exp(-move), high: price * Math.exp(move) };
}

/**
 * Mid-rank percentile (0..100) of the 20-session volatility at index i among its values at each of the last 252
 * sessions (today included). Null until all 252 values exist.
 */
export function ownVolatilityPercentile(returns: readonly number[], i = returns.length - 1): number | null {
  const { shortWindow, ownHistory } = RISK_SETTINGS;
  const history: number[] = [];
  for (let k = i - ownHistory + 1; k <= i; k++) {
    const variance = k >= 0 ? trailingVariance(returns, k, shortWindow) : null;
    if (variance === null) return null;
    history.push(variance);
  }
  // Variances rank exactly like volatilities, without the square roots.
  return percentileRank(history, history[history.length - 1]);
}

/**
 * QLIKE loss of a variance forecast against the realized variance (Patton 2011): RV / F - ln(RV / F) - 1. Zero for
 * a perfect forecast, and robust to noise in the realized variance when ranking forecasts. Null for non-positive input.
 */
export function qlike(realizedVariance: number, forecastVariance: number): number | null {
  if (!(realizedVariance > 0) || !(forecastVariance > 0)) return null;
  const ratio = realizedVariance / forecastVariance;
  return ratio - Math.log(ratio) - 1;
}

/**
 * Worst peak-to-trough decline of closes over the `horizon` sessions after index i, starting from the close at i
 * (a negative decimal, 0 when the price never fell below a running high). Null when the window is incomplete.
 */
export function drawdownWithin(closes: readonly number[], i: number, horizon: number): number | null {
  if (i < 0 || i + horizon >= closes.length || !isPrice(closes[i])) return null;
  let peak = closes[i];
  let worst = 0;
  for (let k = i + 1; k <= i + horizon; k++) {
    if (!isPrice(closes[k])) return null;
    peak = Math.max(peak, closes[k]);
    worst = Math.min(worst, closes[k] / peak - 1);
  }
  return worst;
}

interface AdjustedSeries {
  t: number[];
  /** Dividend- and split-adjusted closes. */
  closes: number[];
  /** The last raw close, the price a reader sees. */
  lastPrice: number | null;
}

/** Valid bars in session order (a repeated session keeps the last row), with adjusted closes. */
function adjustedSeries(bars: readonly DailyBar[]): AdjustedSeries {
  const valid = bars.filter((bar) => isPrice(bar.c) && Number.isFinite(bar.t)).sort((a, b) => a.t - b.t);
  const clean: DailyBar[] = [];
  for (const bar of valid) {
    if (clean.length > 0 && clean[clean.length - 1].t === bar.t) clean[clean.length - 1] = bar;
    else clean.push(bar);
  }
  return {
    t: clean.map((bar) => bar.t),
    closes: clean.map((bar) => (isPrice(bar.adjClose) ? bar.adjClose : bar.c)),
    lastPrice: clean.length > 0 ? clean[clean.length - 1].c : null,
  };
}

/**
 * The risk block of a signal report from completed daily bars (oldest first) and, for beta, the benchmark's bars.
 * Each number is null when the history is too short for it.
 */
export function riskSnapshot(bars: readonly DailyBar[], benchmark: readonly DailyBar[] | null): SignalRisk {
  const { horizonDays, tradingDays } = RISK_SETTINGS;
  const series = adjustedSeries(bars);
  const last = series.closes.length - 1;
  const returns = logReturns(series.closes);
  const daily = last >= 0 ? forecastDailyVolatility(returns, last) : null;
  const price = series.lastPrice;

  let beta: number | null = null;
  if (benchmark && last >= 0) {
    const reference = adjustedSeries(benchmark);
    const stock = series.t.map((t, k) => ({ t, c: series.closes[k] }));
    const market = reference.t.map((t, k) => ({ t, c: reference.closes[k] }));
    beta = betaAt(returnsOf(series.closes), alignBenchmarkReturns(stock, market), last);
  }

  // Rounded for the report like the engine's other numbers; prices (the close and the ranges) go through roundPrice.
  const decimals = (x: number | null, digits: number) => (x === null ? null : round(x, digits));
  const range = (sigmas: number) => {
    const r = daily === null || price === null ? null : priceRange(price, daily, horizonDays, sigmas);
    return r === null ? null : { low: roundPrice(r.low), high: roundPrice(r.high) };
  };
  return {
    forecastVolatility: decimals(daily === null ? null : daily * Math.sqrt(tradingDays), 4),
    horizonDays,
    price: price === null ? null : roundPrice(price),
    range1: range(1),
    range2: range(2),
    ownPercentile: decimals(last >= 0 ? ownVolatilityPercentile(returns, last) : null, 1),
    beta: decimals(beta, 4),
    volatility63: decimals(last >= 0 ? volatilityAt(returnsOf(series.closes), last) : null, 4),
  };
}
