// InvestSeek quant signal engine (model v3).
//
// Pure and deterministic: no I/O and no clock reads (the caller passes `asOf`), so the same inputs always produce
// the same report. Every factor value at session i reads only data up to i, which lets the live signal and the
// backtest share one code path without look-ahead. docs/signal-model.md documents the method and refers to the
// constants below by name; keep the two in sync.

import type { DailyBar } from "@/lib/bars";
import type {
  BacktestResult,
  ConfidenceLevel,
  FactorKey,
  FactorResult,
  SignalCode,
  SignalReport,
} from "@/types/api";

import {
  clamp,
  downsideDeviation,
  interpolate,
  isFiniteNumber,
  type Knot,
  mean,
  median,
  percentileRank,
  round,
  sampleStd,
  wilsonInterval,
} from "./stats";

// ---------------------------------------------------------------------------
// Public model constants
// ---------------------------------------------------------------------------

/** Bump when a weight, threshold or factor formula changes, then re-run `npm run evaluate`. */
export const MODEL_VERSION = 3;

/** Minimum daily history for a signal: enough for MA100 plus a buffer for the volatility regime. */
export const MIN_BARS = 120;

/** Composite weights (they sum to 1). */
export const FACTOR_WEIGHTS: Readonly<Record<FactorKey, number>> = {
  momentum: 0.2,
  trend: 0.15,
  rsi: 0.1,
  volume: 0.1,
  value: 0.18,
  quality: 0.12,
  volatility: 0.15,
};

export const TECHNICAL_FACTORS = ["momentum", "trend", "rsi", "volume", "volatility"] as const satisfies readonly FactorKey[];
export type TechnicalFactorKey = (typeof TECHNICAL_FACTORS)[number];

/** Composite cut-offs, symmetric around 50 (see labelForScore). */
export const SIGNAL_THRESHOLDS = { strongBullish: 72, bullish: 58, bearish: 42, strongBearish: 28 } as const;

/** Factors closer to 50 than this many points count as having no opinion in the consensus. */
export const CONSENSUS_DEAD_BAND = 5;

export const CONFIDENCE_RULES = {
  high: { minConsensus: 70, minCoverage: 80, minDistanceFrom50: 8 },
  medium: { minConsensus: 55, minCoverage: 60 },
} as const;

export const BACKTEST_SETTINGS = {
  holdPeriods: [3, 5, 10],
  /** Maximum number of signal sessions evaluated. */
  maxWindow: 250,
  /** With fewer signal sessions than this no backtest is reported. */
  minWindow: 20,
  /** Round-trip transaction cost in basis points, subtracted once from every trade and baseline return. */
  costBps: 10,
  /** Fewer trades than this flags a result as lowSample. */
  minTrades: 20,
} as const;

export const RSI_PERIOD = 14;

// ---------------------------------------------------------------------------
// Factor calibration (documented in docs/signal-model.md)
// ---------------------------------------------------------------------------

const TRADING_DAYS = 252;
/** Window, in sessions, of the realized-volatility estimates. */
const VOL_WINDOW = 20;
/** Floor on the daily volatility used to scale returns (about 8% annualized), so near-flat series never divide by ~0. */
const SIGMA_FLOOR = 0.005;

const MOMENTUM_HORIZONS = [
  { days: 5, weight: 0.35 },
  { days: 20, weight: 0.4 },
  { days: 60, weight: 0.25 },
] as const;
/** Return, in standard deviations over the horizon, at which a horizon's sub-score saturates at 0 or 100. */
const MOMENTUM_FULL_Z = 3;
/** Conflict (points from 50 of the weaker of the 5- and 60-day sub-scores) at which the damping is at its maximum. */
const DIVERGENCE_FULL_CONFLICT = 25;
const DIVERGENCE_MAX_DAMPING = 0.3;
/** Horizon of the simple return shown as the momentum factor's raw value. */
const MOMENTUM_RAW_DAYS = 20;

/** Trend distances saturate at this many noise units (daily volatility x sqrt(effective horizon)). */
const TREND_FULL_UNITS = 2;
const TREND_SLOPE_DAYS = 5;

/** RSI -> score: symmetric around 50, oversold scores high and overbought low, with the extremes damped back toward 50. */
const RSI_SCORE_KNOTS: readonly [Knot, ...Knot[]] = [
  [0, 55],
  [10, 65],
  [20, 80],
  [30, 75],
  [40, 60],
  [50, 50],
  [60, 40],
  [70, 25],
  [80, 20],
  [90, 35],
  [100, 45],
];

const VOLUME_RECENT = 5;
const VOLUME_BASELINE = 20;
const VOLUME_MIN_RECENT = 3;
const VOLUME_MIN_BASELINE = 10;
const VOLUME_MAX_SWING = 35;
/** Recent/baseline volume ratio -> confirmation: expanding volume confirms the 5-day move, thin volume contradicts it. */
const VOLUME_CONFIRMATION_KNOTS: readonly [Knot, ...Knot[]] = [
  [0.6, -0.4],
  [0.8, 0],
  [1, 0.3],
  [1.3, 0.8],
  [1.6, 1],
];

/** Weight of the (sqrt(2)-scaled) downside semideviation in the volatility-regime measure; the rest is total volatility. */
const RISK_DOWNSIDE_WEIGHT = 0.7;
const VOL_REGIME_LOOKBACK = 250;
const VOL_REGIME_MIN_VALUES = 100;
/** Fallback for histories too short for a regime percentile: annualized blended volatility -> score. */
const ABSOLUTE_VOL_KNOTS: readonly [Knot, ...Knot[]] = [
  [0.1, 75],
  [0.3, 50],
  [0.8, 25],
];

const FAIR_PE_BASE = 15;
const FAIR_PE_PER_GROWTH = 60;
const FAIR_PE_MIN = 8;
const FAIR_PE_MAX = 40;
const GROWTH_MIN = -0.1;
const GROWTH_MAX = 0.4;
/** Revenue growth assumed when Yahoo reports none (roughly long-run nominal GDP growth). */
const DEFAULT_GROWTH = 0.05;
const LOSS_MAKER_SCORE = 20;
/** Shrinking revenue caps the value score: no cap at 0% growth, falling linearly to 60 at -10% and below. */
const SHRINKING_REVENUE_CAP_KNOTS: readonly [Knot, ...Knot[]] = [
  [-0.1, 60],
  [0, 100],
];
const ROE_RANGE = [-0.05, 0.35] as const;
const MARGIN_RANGE = [-0.05, 0.3] as const;
const MAX_DEBT_TO_EQUITY = 2.5;

const SHARPE_MIN_STD = 1e-12;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Fundamental inputs; every field may be missing. Ratios are decimals (0.25 = 25%), debtToEquity is a ratio. */
export interface Fundamentals {
  /** Trailing P/E. */
  pe: number | null;
  /** Trailing twelve-month EPS. */
  eps: number | null;
  roe: number | null;
  profitMargin: number | null;
  /** Latest quarter, year over year. */
  revenueGrowth: number | null;
  debtToEquity: number | null;
  /** Yahoo sector name, e.g. "Financial Services". */
  sector: string | null;
}

export interface FactorScore {
  /** 0..100, 50 = neutral, higher = more bullish. */
  score: number;
  /** True when the inputs were missing and the neutral 50 was used. */
  imputed: boolean;
  raw: number | null;
  rawUnit: FactorResult["rawUnit"];
  /** Share of the factor's inputs that were available, 0..1 (feeds the report's coverage). */
  availability: number;
}

export interface SignalInput {
  symbol: string;
  /** Daily bars, oldest first. Rows with a missing or non-positive close are ignored. */
  bars: readonly DailyBar[];
  fundamentals: Fundamentals;
  /** ISO timestamp of the computation (the engine never reads the clock). */
  asOf: string;
  /** Set by the caller when it removed today's still-forming bar. */
  droppedPartialBar?: boolean;
}

// ---------------------------------------------------------------------------
// Price series
// ---------------------------------------------------------------------------

interface PriceSeries {
  /** Session timestamps (epoch ms). */
  t: number[];
  /** Dividend- and split-adjusted open and close. */
  open: number[];
  close: number[];
  /** Positive volume, or null when missing. */
  volume: (number | null)[];
  /** Prefix sums of `close`: closeSum[k] = close[0] + ... + close[k - 1]. */
  closeSum: number[];
  /** Prefix sums of ln(close), for moving averages in log space. */
  logCloseSum: number[];
  /** Sample standard deviation of the VOL_WINDOW daily log returns ending at i. */
  sigma: (number | null)[];
  /** Volatility-regime measure ending at i: blend of downside semideviation and total volatility (daily units). */
  riskVol: (number | null)[];
  /** Wilder RSI at i. */
  rsi: (number | null)[];
}

/** Largest timestamp a Date can represent. */
const MAX_TIME_MS = 8.64e15;

function isPositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Valid bars in ascending session order; when a session repeats, the last row wins. */
function cleanBars(bars: readonly DailyBar[]): DailyBar[] {
  const valid = bars
    .filter((bar) => isPositive(bar.c) && Number.isFinite(bar.t) && Math.abs(bar.t) <= MAX_TIME_MS)
    .sort((a, b) => a.t - b.t);
  const out: DailyBar[] = [];
  for (const bar of valid) {
    if (out.length > 0 && out[out.length - 1].t === bar.t) out[out.length - 1] = bar;
    else out.push(bar);
  }
  return out;
}

function prepareSeries(bars: readonly DailyBar[]): PriceSeries {
  const clean = cleanBars(bars);
  const t = clean.map((bar) => bar.t);
  // Yahoo's adjusted close folds splits and dividends into the price. Scaling the open by the same per-bar factor
  // keeps overnight and intraday returns consistent with it.
  const close = clean.map((bar) => (isPositive(bar.adjClose) ? bar.adjClose : bar.c));
  const open = clean.map((bar, i) => (isPositive(bar.o) ? bar.o : bar.c) * (close[i] / bar.c));
  const volume = clean.map((bar) => (isPositive(bar.v) ? bar.v : null));

  const n = close.length;
  const logReturns = close.map((c, i) => (i === 0 ? 0 : Math.log(c / close[i - 1])));
  const closeSum = [0];
  const logCloseSum = [0];
  for (const c of close) {
    closeSum.push(closeSum[closeSum.length - 1] + c);
    logCloseSum.push(logCloseSum[logCloseSum.length - 1] + Math.log(c));
  }

  const sigma = new Array<number | null>(n).fill(null);
  const riskVol = new Array<number | null>(n).fill(null);
  for (let i = VOL_WINDOW; i < n; i++) {
    const window = logReturns.slice(i - VOL_WINDOW + 1, i + 1);
    const sd = sampleStd(window);
    const downside = downsideDeviation(window);
    sigma[i] = sd;
    if (sd === null || downside === null) continue;
    // sqrt(2) puts the semideviation on the scale of a standard deviation (they are equal for symmetric returns).
    // Rounding keeps float residue on perfectly regular stretches from faking an order in the regime percentile.
    riskVol[i] = round(RISK_DOWNSIDE_WEIGHT * Math.SQRT2 * downside + (1 - RISK_DOWNSIDE_WEIGHT) * sd, 12);
  }

  return { t, open, close, volume, closeSum, logCloseSum, sigma, riskVol, rsi: wilderRsiSeries(close) };
}

/** Arithmetic moving average of the close over `window` sessions ending at i. */
function smaAt(s: PriceSeries, i: number, window: number): number | null {
  if (i < window - 1 || i >= s.close.length) return null;
  return (s.closeSum[i + 1] - s.closeSum[i + 1 - window]) / window;
}

/** Mean of ln(close) over `window` sessions ending at i, i.e. the log of the geometric moving average. */
function logMaAt(s: PriceSeries, i: number, window: number): number | null {
  if (i < window - 1 || i >= s.close.length) return null;
  return (s.logCloseSum[i + 1] - s.logCloseSum[i + 1 - window]) / window;
}

/** Daily volatility used to scale returns, floored at SIGMA_FLOOR. */
function sigmaAt(s: PriceSeries, i: number): number | null {
  const sd = s.sigma[i];
  return sd === null || sd === undefined ? null : Math.max(sd, SIGMA_FLOOR);
}

/** Typical random-walk move over `horizonDays` sessions for a daily volatility `sigma`. */
function noiseUnit(sigma: number, horizonDays: number): number {
  return sigma * Math.sqrt(horizonDays);
}

/** x measured in units of `unit`, clipped to [-1, 1]. */
function strength(x: number, unit: number): number {
  return unit > 0 ? clamp(x / unit, -1, 1) : 0;
}

// ---------------------------------------------------------------------------
// RSI
// ---------------------------------------------------------------------------

/**
 * Wilder's RSI at every index: seeded with the simple average gain and loss of the first `period` changes, then
 * smoothed as avg = (avg * (period - 1) + current) / period. Indices before `period` are null. Returns 50 when the
 * price did not move at all (average gain and loss both 0) and 100 when it only rose.
 */
export function wilderRsiSeries(closes: readonly number[], period = RSI_PERIOD): (number | null)[] {
  const out = new Array<number | null>(closes.length).fill(null);
  if (!Number.isInteger(period) || period < 1 || closes.length <= period) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain += Math.max(change, 0);
    avgLoss += Math.max(-change, 0);
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = rsiFromAverages(avgGain, avgLoss, closes[period]);
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    out[i] = rsiFromAverages(avgGain, avgLoss, closes[i]);
  }
  return out;
}

function rsiFromAverages(avgGain: number, avgLoss: number, price: number): number | null {
  if (!Number.isFinite(avgGain) || !Number.isFinite(avgLoss) || !Number.isFinite(price)) return null;
  // Float residue on an unchanged price counts as no movement.
  if (avgGain + avgLoss <= Math.abs(price) * 1e-12) return 50;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** Maps an RSI value to a factor score (see RSI_SCORE_KNOTS). */
export function rsiToScore(rsi: number): number {
  return Number.isFinite(rsi) ? interpolate(clamp(rsi, 0, 100), RSI_SCORE_KNOTS) : 50;
}

// ---------------------------------------------------------------------------
// Technical factors at session i (each reads only data up to i)
// ---------------------------------------------------------------------------

function neutral(rawUnit: FactorResult["rawUnit"]): FactorScore {
  return { score: 50, imputed: true, raw: null, rawUnit, availability: 0 };
}

/** Last line of defence against NaN: a non-finite score becomes an imputed neutral, a non-finite raw value null. */
function sanitize(factor: FactorScore): FactorScore {
  if (!Number.isFinite(factor.score)) return neutral(factor.rawUnit);
  return {
    ...factor,
    score: clamp(factor.score, 0, 100),
    raw: isFiniteNumber(factor.raw) ? factor.raw : null,
    availability: Number.isFinite(factor.availability) ? clamp(factor.availability, 0, 1) : 0,
  };
}

/** 5/20/60-day log returns in units of their expected noise, averaged, and damped toward 50 when 5d and 60d disagree. */
function momentumAt(s: PriceSeries, i: number): FactorScore {
  const sigma = sigmaAt(s, i);
  if (sigma === null) return neutral("percent");
  const subScores: (number | null)[] = [];
  let weighted = 0;
  let weightSum = 0;
  for (const { days, weight } of MOMENTUM_HORIZONS) {
    if (i < days) {
      subScores.push(null);
      continue;
    }
    const z = Math.log(s.close[i] / s.close[i - days]) / noiseUnit(sigma, days);
    const sub = 50 + 50 * strength(z, MOMENTUM_FULL_Z);
    subScores.push(sub);
    weighted += weight * sub;
    weightSum += weight;
  }
  if (weightSum === 0) return neutral("percent");

  let score = weighted / weightSum;
  const short = subScores[0];
  const long = subScores[subScores.length - 1];
  if (short !== null && long !== null && (short - 50) * (long - 50) < 0) {
    const conflict = Math.min(Math.abs(short - 50), Math.abs(long - 50));
    const keep = 1 - DIVERGENCE_MAX_DAMPING * clamp(conflict / DIVERGENCE_FULL_CONFLICT, 0, 1);
    score = 50 + (score - 50) * keep;
  }
  return {
    score,
    imputed: false,
    raw: i >= MOMENTUM_RAW_DAYS ? s.close[i] / s.close[i - MOMENTUM_RAW_DAYS] - 1 : null,
    rawUnit: "percent",
    availability: weightSum,
  };
}

/**
 * Overextension component: grows with the distance from MA20 up to one saturation unit, then fades back to 0 at two
 * units, so a healthy distance counts fully and an overstretched one does not (mirror-symmetric for downtrends).
 */
function extension(units: number): number {
  const a = Math.abs(units);
  return Math.sign(units) * (a <= 1 ? a : Math.max(0, 2 - a));
}

/**
 * Price vs. MA20/50/100, MA alignment, distance from MA20 and MA20 slope; all symmetric around 50. The averages are
 * taken over log prices (geometric means) so that a path and its mirror image score exactly 100 - each other.
 */
function trendAt(s: PriceSeries, i: number): FactorScore {
  const sigma = sigmaAt(s, i);
  const ma20 = logMaAt(s, i, 20);
  if (sigma === null || ma20 === null) return neutral("percent");
  const ma50 = logMaAt(s, i, 50);
  const ma100 = logMaAt(s, i, 100);
  const ma20Before = logMaAt(s, i - TREND_SLOPE_DAYS, 20);
  const logPrice = Math.log(s.close[i]);

  // Distances are measured in noise units: daily volatility x sqrt(effective horizon of the comparison), which is
  // about window / 3 for price vs. an average, half the window gap for two averages and 1 for the 5-day MA20 slope.
  const unit = (horizonDays: number) => TREND_FULL_UNITS * noiseUnit(sigma, horizonDays);
  const gap20 = (logPrice - ma20) / unit(20 / 3);
  const components: ReadonlyArray<readonly [weight: number, value: number | null]> = [
    [2, clamp(gap20, -1, 1)],
    [2, ma50 === null ? null : strength(logPrice - ma50, unit(50 / 3))],
    [2, ma100 === null ? null : strength(logPrice - ma100, unit(100 / 3))],
    [1.5, ma50 === null ? null : strength(ma20 - ma50, unit(15))],
    [1.5, ma50 === null || ma100 === null ? null : strength(ma50 - ma100, unit(25))],
    [1, extension(gap20)],
    [1, ma20Before === null ? null : strength(ma20 - ma20Before, unit(1))],
  ];

  let weighted = 0;
  let available = 0;
  let total = 0;
  for (const [weight, value] of components) {
    total += weight;
    if (value === null) continue;
    weighted += weight * value;
    available += weight;
  }
  // The displayed distance uses the conventional arithmetic MA50 so it matches price charts.
  const sma50 = smaAt(s, i, 50);
  return {
    score: 50 + (50 * weighted) / available,
    imputed: false,
    raw: sma50 === null ? null : s.close[i] / sma50 - 1,
    rawUnit: "percent",
    availability: available / total,
  };
}

function rsiAt(s: PriceSeries, i: number): FactorScore {
  const rsi = s.rsi[i];
  if (rsi === null || rsi === undefined) return neutral("number");
  return { score: rsiToScore(rsi), imputed: false, raw: rsi, rawUnit: "number", availability: 1 };
}

function positiveVolumes(s: PriceSeries, from: number, to: number): number[] {
  const out: number[] = [];
  for (let k = Math.max(0, from); k <= to; k++) {
    const v = s.volume[k];
    if (v !== null) out.push(v);
  }
  return out;
}

/** Median 5-day vs. prior 20-day volume, signed by the 5-day price move: volume confirms or contradicts the move. */
function volumeAt(s: PriceSeries, i: number): FactorScore {
  const sigma = sigmaAt(s, i);
  if (sigma === null || i < VOLUME_RECENT + VOLUME_BASELINE - 1) return neutral("multiple");
  const recent = positiveVolumes(s, i - VOLUME_RECENT + 1, i);
  const baseline = positiveVolumes(s, i - VOLUME_RECENT - VOLUME_BASELINE + 1, i - VOLUME_RECENT);
  const recentMedian = recent.length >= VOLUME_MIN_RECENT ? median(recent) : null;
  const baselineMedian = baseline.length >= VOLUME_MIN_BASELINE ? median(baseline) : null;
  if (recentMedian === null || baselineMedian === null) return neutral("multiple");

  const ratio = recentMedian / baselineMedian;
  const direction = strength(Math.log(s.close[i] / s.close[i - VOLUME_RECENT]), noiseUnit(sigma, VOLUME_RECENT));
  return {
    score: 50 + VOLUME_MAX_SWING * direction * interpolate(ratio, VOLUME_CONFIRMATION_KNOTS),
    imputed: false,
    raw: ratio,
    rawUnit: "multiple",
    availability: 1,
  };
}

/** 100 minus the percentile of today's 20-day risk measure within the stock's own trailing year of such values. */
function volatilityAt(s: PriceSeries, i: number): FactorScore {
  const current = s.riskVol[i];
  const sd = s.sigma[i];
  if (current === null || current === undefined || sd === null || sd === undefined) return neutral("percent");
  const raw = sd * Math.sqrt(TRADING_DAYS);

  const history: number[] = [];
  for (let k = Math.max(VOL_WINDOW, i - VOL_REGIME_LOOKBACK + 1); k <= i; k++) {
    const v = s.riskVol[k];
    if (v !== null) history.push(v);
  }
  const availability = Math.min(1, history.length / VOL_REGIME_LOOKBACK);
  const percentile = history.length >= VOL_REGIME_MIN_VALUES ? percentileRank(history, current) : null;
  const score =
    percentile === null ? interpolate(current * Math.sqrt(TRADING_DAYS), ABSOLUTE_VOL_KNOTS) : 100 - percentile;
  return { score, imputed: false, raw, rawUnit: "percent", availability };
}

function technicalFactorsAt(s: PriceSeries, i: number): Record<TechnicalFactorKey, FactorScore> {
  if (i < 0 || i >= s.close.length) {
    return {
      momentum: neutral("percent"),
      trend: neutral("percent"),
      rsi: neutral("number"),
      volume: neutral("multiple"),
      volatility: neutral("percent"),
    };
  }
  return {
    momentum: sanitize(momentumAt(s, i)),
    trend: sanitize(trendAt(s, i)),
    rsi: sanitize(rsiAt(s, i)),
    volume: sanitize(volumeAt(s, i)),
    volatility: sanitize(volatilityAt(s, i)),
  };
}

const TECHNICAL_WEIGHT = TECHNICAL_FACTORS.reduce((sum, key) => sum + FACTOR_WEIGHTS[key], 0);

/** Technical-only composite at i (rounded to 0.1): the five price factors re-weighted to sum to 1. */
function technicalScoreAt(s: PriceSeries, i: number): number {
  const factors = technicalFactorsAt(s, i);
  let total = 0;
  for (const key of TECHNICAL_FACTORS) total += FACTOR_WEIGHTS[key] * factors[key].score;
  return round(total / TECHNICAL_WEIGHT, 1);
}

/** The five technical factors at the last bar (each imputed neutral when the history is too short for it). */
export function computeTechnicalFactors(bars: readonly DailyBar[]): Record<TechnicalFactorKey, FactorScore> {
  const s = prepareSeries(bars);
  return technicalFactorsAt(s, s.close.length - 1);
}

/**
 * Technical-only composite (rounded to 0.1) for every session with at least MIN_BARS of history, null before that.
 * Entries follow the bars that survive validation, which is the input itself for clean data.
 */
export function technicalScoreSeries(bars: readonly DailyBar[]): Array<{ t: number; score: number | null }> {
  const s = prepareSeries(bars);
  return s.t.map((t, i) => ({ t, score: i >= MIN_BARS - 1 ? technicalScoreAt(s, i) : null }));
}

/** Technical-only composite at the last bar (rounded to 0.1), as in the report; null with fewer than MIN_BARS bars. */
export function latestTechnicalScore(bars: readonly DailyBar[]): number | null {
  const s = prepareSeries(bars);
  const n = s.close.length;
  return n >= MIN_BARS ? technicalScoreAt(s, n - 1) : null;
}

// ---------------------------------------------------------------------------
// Fundamental factors
// ---------------------------------------------------------------------------

function finiteOrNull(value: number | null | undefined): number | null {
  return isFiniteNumber(value) ? value : null;
}

/** Linear 0..100 score of x over [lo, hi], clipped. */
function linearScore(x: number, lo: number, hi: number): number {
  return 100 * clamp((x - lo) / (hi - lo), 0, 1);
}

/**
 * Growth-adjusted fair P/E: clamp(15 + 60 * g, 8, 40) with g = revenue growth clipped to [-10%, +40%]. Missing or
 * non-finite growth assumes DEFAULT_GROWTH.
 */
export function fairPe(revenueGrowth: number | null): number {
  const g = clamp(isFiniteNumber(revenueGrowth) ? revenueGrowth : DEFAULT_GROWTH, GROWTH_MIN, GROWTH_MAX);
  return clamp(FAIR_PE_BASE + FAIR_PE_PER_GROWTH * g, FAIR_PE_MIN, FAIR_PE_MAX);
}

/** Valuation: P/E against a growth-adjusted fair P/E on a log scale; loss-makers score a fixed 20. */
export function valueFactor(fundamentals: Fundamentals): FactorScore {
  const pe = finiteOrNull(fundamentals.pe);
  const eps = finiteOrNull(fundamentals.eps);
  const growth = finiteOrNull(fundamentals.revenueGrowth);

  // Yahoo omits the P/E of companies with negative earnings, so EPS is the reliable loss signal.
  if ((eps !== null && eps <= 0) || (pe !== null && pe <= 0)) {
    return { score: LOSS_MAKER_SCORE, imputed: false, raw: null, rawUnit: "multiple", availability: 1 };
  }
  if (pe === null) return neutral("multiple");

  let score = clamp(50 - 50 * Math.log2(pe / fairPe(growth)), 0, 100);
  if (growth !== null && growth < 0) score = Math.min(score, interpolate(growth, SHRINKING_REVENUE_CAP_KNOTS));
  return sanitize({ score, imputed: false, raw: pe, rawUnit: "multiple", availability: growth === null ? 0.75 : 1 });
}

/** Profitability and balance-sheet strength: mean of the available ROE, net margin and inverse debt/equity scores. */
export function qualityFactor(fundamentals: Fundamentals): FactorScore {
  const roe = finiteOrNull(fundamentals.roe);
  const margin = finiteOrNull(fundamentals.profitMargin);
  const debtToEquity = finiteOrNull(fundamentals.debtToEquity);
  // Leverage is the business model of banks and insurers, so debt/equity says little about their quality.
  const financial = fundamentals.sector !== null && /financial/i.test(fundamentals.sector);

  const parts: number[] = [];
  if (roe !== null) parts.push(linearScore(roe, ROE_RANGE[0], ROE_RANGE[1]));
  if (margin !== null) parts.push(linearScore(margin, MARGIN_RANGE[0], MARGIN_RANGE[1]));
  // A negative D/E means negative equity; it is treated as missing rather than as "no debt".
  if (!financial && debtToEquity !== null && debtToEquity >= 0) {
    parts.push(100 - linearScore(debtToEquity, 0, MAX_DEBT_TO_EQUITY));
  }

  const score = mean(parts);
  if (score === null) return neutral("percent");
  return sanitize({ score, imputed: false, raw: roe, rawUnit: "percent", availability: parts.length / (financial ? 2 : 3) });
}

// ---------------------------------------------------------------------------
// Composite, label, consensus, coverage, confidence
// ---------------------------------------------------------------------------

/** Report order of the factors. */
const FACTOR_KEYS: readonly FactorKey[] = ["momentum", "trend", "rsi", "volume", "value", "quality", "volatility"];

const TECHNICAL_KEYS: ReadonlySet<FactorKey> = new Set<FactorKey>(TECHNICAL_FACTORS);

/** >= 72 strong_bullish, >= 58 bullish, > 42 neutral, > 28 bearish, else strong_bearish. */
export function labelForScore(score: number): SignalCode {
  if (!Number.isFinite(score)) return "neutral";
  if (score >= SIGNAL_THRESHOLDS.strongBullish) return "strong_bullish";
  if (score >= SIGNAL_THRESHOLDS.bullish) return "bullish";
  if (score > SIGNAL_THRESHOLDS.bearish) return "neutral";
  if (score > SIGNAL_THRESHOLDS.strongBearish) return "bearish";
  return "strong_bearish";
}

/**
 * Weight share of the informative factors (non-imputed, at least CONSENSUS_DEAD_BAND from 50) that sit on the same
 * side of 50 as the composite. Null when no factor is informative or the composite is exactly 50.
 */
function consensusOf(factors: readonly FactorResult[], score: number): number | null {
  const side = Math.sign(score - 50);
  if (side === 0) return null;
  let agreeing = 0;
  let informative = 0;
  for (const factor of factors) {
    if (factor.imputed || Math.abs(factor.score - 50) < CONSENSUS_DEAD_BAND) continue;
    informative += factor.weight;
    if (Math.sign(factor.score - 50) === side) agreeing += factor.weight;
  }
  return informative > 0 ? Math.round((100 * agreeing) / informative) : null;
}

function confidenceFor(consensus: number | null, coverage: number, score: number): ConfidenceLevel {
  if (consensus === null) return "low";
  const { high, medium } = CONFIDENCE_RULES;
  if (consensus >= high.minConsensus && coverage >= high.minCoverage && Math.abs(score - 50) >= high.minDistanceFrom50) {
    return "high";
  }
  if (consensus >= medium.minConsensus && coverage >= medium.minCoverage) return "medium";
  return "low";
}

function toFactorResult(key: FactorKey, factor: FactorScore): FactorResult {
  return {
    key,
    group: TECHNICAL_KEYS.has(key) ? "technical" : "fundamental",
    score: round(factor.score, 1),
    weight: FACTOR_WEIGHTS[key],
    imputed: factor.imputed,
    raw: factor.raw === null ? null : round(factor.raw, factor.rawUnit === "percent" ? 4 : 2),
    rawUnit: factor.rawUnit,
  };
}

function insufficientData(input: SignalInput, meta: SignalReport["meta"], reason: string): SignalReport {
  return {
    symbol: input.symbol,
    asOf: input.asOf,
    status: "insufficient_data",
    reason,
    code: null,
    score: null,
    technicalScore: null,
    consensus: null,
    coverage: null,
    confidence: null,
    factors: [],
    backtest: null,
    meta,
  };
}

/** Builds the full signal report for one symbol. */
export function computeSignalReport(input: SignalInput): SignalReport {
  const s = prepareSeries(input.bars);
  const n = s.close.length;
  const meta: SignalReport["meta"] = {
    bars: n,
    droppedPartialBar: input.droppedPartialBar ?? false,
    lastBarDate: n > 0 ? new Date(s.t[n - 1]).toISOString() : null,
  };
  if (n < MIN_BARS) {
    return insufficientData(input, meta, `Not enough price history: ${n} of the ${MIN_BARS} daily bars the model needs.`);
  }

  const scores: Record<FactorKey, FactorScore> = {
    ...technicalFactorsAt(s, n - 1),
    value: valueFactor(input.fundamentals),
    quality: qualityFactor(input.fundamentals),
  };
  const factors = FACTOR_KEYS.map((key) => toFactorResult(key, scores[key]));
  // The composite is built from the rounded factor scores, so it can be reproduced from the report itself.
  const composite = factors.reduce((sum, factor) => sum + factor.weight * factor.score, 0);
  if (!Number.isFinite(composite)) return insufficientData(input, meta, "The price history could not be evaluated.");

  const score = round(composite, 1);
  const consensus = consensusOf(factors, score);
  const coverage = Math.round(100 * FACTOR_KEYS.reduce((sum, key) => sum + FACTOR_WEIGHTS[key] * scores[key].availability, 0));
  return {
    symbol: input.symbol,
    asOf: input.asOf,
    status: "ok",
    code: labelForScore(score),
    score,
    technicalScore: technicalScoreAt(s, n - 1),
    consensus,
    coverage,
    confidence: confidenceFor(consensus, coverage, score),
    factors,
    backtest: backtestSeries(s),
    meta,
  };
}

// ---------------------------------------------------------------------------
// Backtest (technical factors only)
// ---------------------------------------------------------------------------

interface Trade {
  /** Index of the signal session; the trade runs from the open of signal + 1 to the close of signal + hold. */
  signal: number;
  /** Net return after the round-trip cost. */
  ret: number;
}

function roundOrNull(value: number | null, decimals: number): number | null {
  return value === null ? null : round(value, decimals);
}

/**
 * Worst peak-to-trough of the strategy's equity, marked to market at every close while a trade is open (flat in
 * between). The round-trip cost is charged when the trade opens, so the exit mark equals the trade's net return.
 */
function strategyMaxDrawdown(s: PriceSeries, trades: readonly Trade[], hold: number, cost: number): number {
  let equity = 1;
  let peak = 1;
  let worst = 0;
  for (const trade of trades) {
    const entry = s.open[trade.signal + 1];
    for (let d = trade.signal + 1; d <= trade.signal + hold; d++) {
      const mark = equity * (s.close[d] / entry - cost);
      peak = Math.max(peak, mark);
      worst = Math.min(worst, mark / peak - 1);
    }
    equity *= 1 + trade.ret;
  }
  return worst;
}

function evaluateHold(s: PriceSeries, first: number, labels: readonly SignalCode[], hold: number): BacktestResult {
  const cost = BACKTEST_SETTINGS.costBps / 10_000;
  const baseline: number[] = [];
  const bearish: number[] = [];
  const trades: Trade[] = [];
  let nextSignal = first;

  for (let k = 0; k < labels.length; k++) {
    const i = first + k;
    const forward = s.close[i + hold] / s.open[i + 1] - 1 - cost;
    baseline.push(forward);
    const label = labels[k];
    if (label === "bearish" || label === "strong_bearish") bearish.push(forward);
    if ((label === "bullish" || label === "strong_bullish") && i >= nextSignal) {
      trades.push({ signal: i, ret: forward });
      // The position is held through the close of i + hold; a signal formed at that close trades the next morning.
      nextSignal = i + hold;
    }
  }

  const returns = trades.map((trade) => trade.ret);
  const wins = returns.filter((r) => r > 0).length;
  const meanReturn = mean(returns);
  const sd = sampleStd(returns);
  const ci = wilsonInterval(wins, returns.length);
  // The edge is the difference of the averages as reported, so it can be reproduced exactly from the report.
  const avgReturn = roundOrNull(meanReturn, 5);
  const baselineAvgReturn = roundOrNull(mean(baseline), 5);

  return {
    holdDays: hold,
    windowDays: labels.length,
    trades: trades.length,
    winRate: returns.length > 0 ? round(wins / returns.length, 4) : null,
    winRateCI: ci === null ? null : [round(ci[0], 4), round(ci[1], 4)],
    avgReturn,
    baselineWinRate: baseline.length > 0 ? round(baseline.filter((r) => r > 0).length / baseline.length, 4) : null,
    baselineAvgReturn,
    edge: avgReturn !== null && baselineAvgReturn !== null ? round(avgReturn - baselineAvgReturn, 5) : null,
    // Annualized by the observed trade frequency (trades per year of window), not by 252 / hold: the strategy is flat
    // between trades, and scaling as if it were always invested would overstate the ratio by sqrt(window / (hold x trades)).
    sharpe:
      meanReturn !== null && sd !== null && sd > SHARPE_MIN_STD
        ? round((meanReturn / sd) * Math.sqrt((trades.length * TRADING_DAYS) / labels.length), 2)
        : null,
    maxDrawdown: trades.length > 0 ? roundOrNull(strategyMaxDrawdown(s, trades, hold, cost), 4) : null,
    bearishSignals: bearish.length,
    bearishHitRate: bearish.length > 0 ? round(bearish.filter((r) => r < 0).length / bearish.length, 4) : null,
    bearishAvgForwardReturn: roundOrNull(mean(bearish), 5),
    lowSample: trades.length < BACKTEST_SETTINGS.minTrades,
  };
}

function backtestSeries(s: PriceSeries): SignalReport["backtest"] {
  const maxHold = Math.max(...BACKTEST_SETTINGS.holdPeriods);
  // One window for every hold period: the last signal session must have complete forward data for the longest hold.
  const last = s.close.length - 1 - maxHold;
  const first = Math.max(MIN_BARS - 1, last - BACKTEST_SETTINGS.maxWindow + 1);
  if (last - first + 1 < BACKTEST_SETTINGS.minWindow) return null;

  // The technical score series is computed once and shared by all hold periods.
  const labels: SignalCode[] = [];
  for (let i = first; i <= last; i++) labels.push(labelForScore(technicalScoreAt(s, i)));
  return {
    technicalOnly: true,
    costBps: BACKTEST_SETTINGS.costBps,
    results: BACKTEST_SETTINGS.holdPeriods.map((hold) => evaluateHold(s, first, labels, hold)),
  };
}

/**
 * Technical-only backtest over the last BACKTEST_SETTINGS.maxWindow signal sessions (after a MIN_BARS warm-up) that
 * have complete forward data for the longest hold. A signal formed at the close of session i is bought at the
 * adjusted open of i + 1 and sold at the adjusted close of i + h. Null when fewer than minWindow sessions qualify.
 */
export function runBacktest(bars: readonly DailyBar[]): SignalReport["backtest"] {
  return backtestSeries(prepareSeries(bars));
}
