// Universe-level evaluation of the technical score: the shape of lib/signal-evaluation.json, the verdict helpers the
// app uses, and the pure core of scripts/evaluate-signal.ts.
//
// The script loads daily bars (from Yahoo or a cache), calls evaluateSignalModel and writes lib/signal-evaluation.json
// and docs/evaluation.md; lib/evaluation-data.ts loads the JSON for the app. Nothing here reads the clock or the
// network, so the same bars and config always produce the same JSON (lib/evaluation.test.ts checks this). The script
// can import the types without loading the JSON it is about to write.

import type { DailyBar } from "@/lib/bars";
import type { FactorKey, SignalCode } from "@/types/api";

import { drawBlocks, holm, mulberry32, neweyWest, normalCdf, percentileInterval, spearman, tTest } from "./research-stats";
import {
  FACTOR_WEIGHTS,
  labelForScore,
  MODEL_VERSION,
  SIGNAL_THRESHOLDS,
  TECHNICAL_FACTORS,
  technicalFactorSeries,
  type TechnicalFactorKey,
} from "./signal";
import { mean, median } from "./stats";

// ---------------------------------------------------------------------------
// Shape of lib/signal-evaluation.json
// ---------------------------------------------------------------------------

export type Interval = [number, number];

export interface LabelOutcome {
  code: SignalCode;
  /** Stock-sessions with this reading and a forward return (overlapping, across all stocks). */
  n: number;
  /** Distinct signal dates. */
  dates: number;
  /** Runs of signal dates; a gap of more than `settings.episodeGapSessions` sessions starts a new one. */
  episodes: number;
  /** Share of the observations that fall in the largest episode. */
  largestEpisodeShare: number | null;
  /** Mean forward return after the reading. */
  mean: number | null;
  /** Mean forward return minus the mean of all observations (= timing + selection). Includes market moves. */
  excess: number | null;
  /** Mean same-day universe return on the reading's dates minus the mean of all observations: when it occurred. */
  timing: number | null;
  /** Mean of the forward return minus the same-day equal-weight universe mean: which stocks did better that day. */
  selection: number | null;
  /** Share of forward returns above zero. */
  hitRate: number | null;
  /** Share of forward returns above the same-day universe median. */
  beatMedian: number | null;
  /** 95% moving-block bootstrap intervals over dates (they keep the clustering of readings in time). */
  ci: { excess: Interval | null; selection: Interval | null; hitRate: Interval | null };
}

export interface IcSummary {
  /** Mean of the daily cross-sectional Spearman ICs over all dates. */
  mean: number | null;
  /** Newey-West t of that mean (Bartlett kernel, lag = the horizon): the primary statistic. */
  t: number | null;
  /** Newey-West t with lag twice the horizon, a robustness check. */
  t2: number | null;
  /** Dates with an IC. */
  dates: number;
  /** Lowest and highest classical t over the non-overlapping grids (every h-th date, one grid per starting phase). */
  phaseT: Interval | null;
  /** True when the grids disagree on the verdict, so a single grid could have reported a different one. */
  fragile: boolean;
}

export interface PeriodIc {
  from: string;
  to: string;
  mean: number | null;
  /** Newey-West t, lag = the horizon. */
  t: number | null;
  dates: number;
}

export interface HorizonOutcome {
  /** Holding period in sessions. */
  days: number;
  base: { n: number; mean: number | null; hitRate: number | null };
  ic: IcSummary;
  /** The IC within each calendar subperiod of the window (descriptive). */
  subperiods: PeriodIc[];
  labels: LabelOutcome[];
}

export interface HoldoutTest {
  key: "composite" | TechnicalFactorKey;
  mean: number | null;
  /** Newey-West t, lag = the horizon. */
  t: number | null;
  dates: number;
  /** One-sided p-value in the designed direction (higher score, higher return), normal approximation. */
  p: number | null;
  /** Holm-adjusted p across the five technical factors; null for the composite, which is tested on its own. */
  holmP: number | null;
  /** p (composite) or holmP (factors) below alpha. */
  pass: boolean;
}

export interface HoldoutResult {
  /** The decade before the window the model was first evaluated on, pinned in scripts/evaluation.config.json. */
  period: { from: string; to: string };
  /** First and last signal date used. */
  from: string;
  to: string;
  horizon: number;
  alpha: number;
  composite: HoldoutTest & { ci: Interval | null };
  factors: HoldoutTest[];
  /** The composite at every evaluated horizon, descriptive only. */
  horizons: Array<{ days: number; mean: number | null; t: number | null; dates: number }>;
}

export interface BenchmarkGap {
  from: string;
  to: string;
  sessions: number;
  /** Annualized returns: the universe equal-weighted and rebalanced daily, the equal-weight S&P 500 (RSP) and SPY. */
  universe: number | null;
  equalWeight: number | null;
  market: number | null;
}

export interface SignalEvaluation {
  /** The window pinned in scripts/evaluation.config.json: the JSON never depends on the day the script runs. */
  period: { from: string; to: string };
  /** First and last signal date in the window. */
  from: string;
  to: string;
  /** Stocks with at least one signal in the window. */
  universe: number;
  observations: number;
  /** The model settings the evaluation ran with; a test fails when they drift from lib/signal.ts. */
  model: {
    version: number;
    thresholds: { strongBullish: number; bullish: number; bearish: number; strongBearish: number };
    weights: Record<FactorKey, number>;
  };
  settings: { minStocksPerDate: number; episodeGapSessions: number; bootstrap: BootstrapSettings };
  horizons: HorizonOutcome[];
  holdout: HoldoutResult;
  /** How far the hand-picked universe beat broad benchmarks: a gauge of hindsight in its selection. */
  hindsight: { main: BenchmarkGap; holdout: BenchmarkGap };
  /** Bars per symbol and the last bar date, after the window cut; symbols without bars are listed as missing. */
  data: { missing: string[]; fingerprint: Record<string, [number, string | null]> };
}

// ---------------------------------------------------------------------------
// Shapes of lib/factor-research.json and lib/risk-calibration.json (lib/research.ts, scripts/research-factors.ts)
// ---------------------------------------------------------------------------

/** The seven pre-registered factors: the five style factors of lib/factors.ts, the technical score and their composite. */
export const RESEARCH_FACTORS = ["momentum", "reversal", "high52", "volatility", "beta", "technical", "composite"] as const;
export type ResearchFactor = (typeof RESEARCH_FACTORS)[number];

export interface FactorHorizonResult {
  days: number;
  /** Non-overlapping dates (every h sessions from the first signal date). */
  dates: number;
  /** Mean cross-sectional Spearman IC with same-day excess returns on those dates, its classical t and two-sided p. */
  ic: number | null;
  t: number | null;
  p: number | null;
  /** p adjusted over all pre-registered tests (Holm controls the family-wise error, Benjamini-Hochberg the false discovery rate). */
  holmP: number | null;
  bhQ: number | null;
  /** The IC on all dates with a Newey-West t (lag h), a robustness check. */
  allDates: { ic: number | null; t: number | null; dates: number };
  /** Mean IC in each configured subperiod and its sign (0 when missing). */
  subperiodIc: Array<number | null>;
  signs: Array<1 | -1 | 0>;
  /** Mean highest-minus-lowest quintile of same-day excess returns per holding period (decimal) and its t. */
  spread: number | null;
  spreadT: number | null;
  /** Mean share of the top quintile replaced at each rebalance. */
  turnover: number | null;
  /** On the same dates: ranks demeaned within sectors, returns net of trailing beta times SPY, and without the biggest ex-post winners. */
  sectorNeutralIc: number | null;
  betaAdjustedIc: number | null;
  exWinnersIc: number | null;
  /**
   * "predictive" only when holmP < alpha and the IC has the same sign in every subperiod. The test is two-sided, so
   * read the verdict with the sign of `ic`: a negative IC means the factor worked against its literature direction.
   */
  verdict: "predictive" | "not_predictive";
}

export interface FactorResearch {
  window: DateRange;
  /** First and last signal date. */
  from: string;
  to: string;
  universe: number;
  /** Model version of the technical score that was tested. */
  model: number;
  /** The adoption rule, in words. */
  rule: string;
  alpha: number;
  horizons: number[];
  subperiods: DateRange[];
  /** Factors in their literature direction: `direction` is -1 when the raw value (e.g. volatility) is expected to do worse. */
  factors: Array<{ key: ResearchFactor; label: string; direction: 1 | -1; results: FactorHorizonResult[] }>;
  /** The smallest mean IC the design detects with 80% power at the 5% level. */
  power: Array<{ days: number; dates: number; sdIc: number | null; minimumDetectableIc: number | null }>;
  bias: {
    benchmarks: { market: string; equalWeight: string };
    /** The universe against its benchmarks over the window and each subperiod (selection bias gauge). */
    universeVsBenchmarks: BenchmarkGap[];
    /** The stocks with the highest annual return over the window, excluded in exWinnersIc. */
    exWinners: Array<{ symbol: string; annualReturn: number }>;
    /** Mean cross-sectional rank correlation of the technical score with the trailing 21-session return. */
    technicalVsMonthReturn: number | null;
  };
}

export interface BandCoverage {
  n: number;
  /** Share of moves inside plus/minus one and two forecast standard deviations. */
  within1: number | null;
  within2: number | null;
}

export interface QuintileRow {
  /** 1 = lowest volatility, 5 = highest. */
  quintile: number;
  /** Stock-months. */
  n: number;
  medianVolatility: number | null;
  /** Share of stock-months with a peak-to-trough drop at or beyond the threshold within the horizon. */
  drawdown: number | null;
  /** Share of stock-months whose return over the horizon was at or below the threshold. */
  loss: number | null;
}

export interface RiskCalibration {
  window: DateRange;
  subperiods: DateRange[];
  /** The forecast of lib/risk-forecast.ts: sqrt(w * var(short) + (1 - w) * var(long)) of daily log returns. */
  estimator: { shortWindow: number; longWindow: number; shortWeight: number };
  bands: { horizon: number; overall: BandCoverage; shortWindowOnly: BandCoverage; subperiods: Array<DateRange & BandCoverage> };
  /** Mean QLIKE loss of the blend and of the short-window estimate alone (lower is better). */
  qlike: { n: number; blend: number | null; shortWindowOnly: number | null };
  /** Rank correlation of trailing volatility and beta with their realized values over the next `horizon` sessions. */
  persistence: {
    horizon: number;
    dates: number;
    volatility: { mean: number | null; min: number | null; t: number | null };
    beta: { mean: number | null; min: number | null; t: number | null };
  };
  /** How bad a normal month was, by quintile of trailing 63-session volatility across the universe. */
  quintiles: {
    horizon: number;
    threshold: number;
    measure: string;
    /** The four boundaries between quintiles (annualized volatility, lowest first): median over dates and at the window end. */
    breakpoints: { median: number[]; latest: { date: string; values: number[] } | null };
    overall: QuintileRow[];
    subperiods: Array<DateRange & { rows: QuintileRow[] }>;
  };
}

// ---------------------------------------------------------------------------
// Verdict helpers used by the app
// ---------------------------------------------------------------------------

/** |t| at or above which the rank IC counts as a reliable relationship (about the two-sided 5% level). */
export const IC_T_RELIABLE = 2;

export type EvaluationVerdict = "predictive" | "inverse" | "none";

/** Reads the Newey-West t of the rank IC: a sign only counts with |t| >= IC_T_RELIABLE. */
export function evaluationVerdict(horizon: { ic: { mean: number | null; t: number | null } }): EvaluationVerdict {
  const { mean: m, t } = horizon.ic;
  if (m === null || t === null || !Number.isFinite(t)) return "none";
  if (t >= IC_T_RELIABLE && m > 0) return "predictive";
  if (t <= -IC_T_RELIABLE && m < 0) return "inverse";
  return "none";
}

export function findHorizon(evaluation: SignalEvaluation, days: number): HorizonOutcome | null {
  return evaluation.horizons.find((h) => h.days === days) ?? null;
}

export function findLabel(horizon: HorizonOutcome, code: SignalCode): LabelOutcome | null {
  return horizon.labels.find((l) => l.code === code) ?? null;
}

/** True when a bootstrap interval lies entirely above or entirely below zero. */
export function excludesZero(interval: Interval | null): boolean {
  return interval !== null && (interval[0] > 0 || interval[1] < 0);
}

// ---------------------------------------------------------------------------
// Evaluation core
// ---------------------------------------------------------------------------

export interface BootstrapSettings {
  blockLength: number;
  reps: number;
  seed: number;
}

export interface DateRange {
  /** ISO dates, inclusive. */
  from: string;
  to: string;
}

export interface EvaluationConfig {
  main: DateRange;
  holdout: DateRange;
  /** Holding periods in sessions. */
  horizons: number[];
  /** A date enters the statistics only with at least this many stocks that have a forward return. */
  minStocksPerDate: number;
  episodeGapSessions: number;
  bootstrap: BootstrapSettings;
  holdoutTest: { horizon: number; alpha: number };
  subperiods: DateRange[];
}

export interface EvaluationInput {
  config: EvaluationConfig;
  /** Completed daily bars per universe symbol (any order; invalid and repeated rows are cleaned here). */
  bars: Readonly<Record<string, readonly DailyBar[]>>;
  /** Benchmarks for the hindsight gap: SPY (market) and RSP (equal-weight S&P 500). */
  market: { symbol: string; bars: readonly DailyBar[] };
  equalWeight: { symbol: string; bars: readonly DailyBar[] };
}

export const LABEL_CODES: readonly SignalCode[] = ["strong_bullish", "bullish", "neutral", "bearish", "strong_bearish"];

const TRADING_DAYS = 252;

/** UTC midnight of an ISO date (YYYY-MM-DD). */
export function isoToTime(date: string): number {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t)) throw new Error(`Not an ISO date: ${date}`);
  return t;
}

export function timeToIso(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

function isPositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Valid bars in session order, the last row winning when a session repeats (the engine validates the same way). */
export function cleanDailyBars(bars: readonly DailyBar[]): DailyBar[] {
  const valid = bars.filter((bar) => isPositive(bar.c) && Number.isFinite(bar.t)).sort((a, b) => a.t - b.t);
  const out: DailyBar[] = [];
  for (const bar of valid) {
    if (out.length > 0 && out[out.length - 1].t === bar.t) out[out.length - 1] = bar;
    else out.push(bar);
  }
  return out;
}

/** Bars dated on or before `to`: data after the window end must not reach the evaluation, not even as an exit price. */
export function cutBars(bars: readonly DailyBar[], to: string): DailyBar[] {
  const end = isoToTime(to);
  return bars.filter((bar) => bar.t <= end);
}

/** Minutes after midnight in New York when the cash session's daily bar is final (16:00 close plus a margin). */
const SESSION_FINAL_MINUTES = 16 * 60 + 30;

/**
 * Drops the last bar when it is the still-forming session of the day the data was fetched: Yahoo dates the live
 * session's bar with today's date during market hours. `fetchedAt` is the ISO time of the download.
 */
export function dropFormingBar(bars: readonly DailyBar[], fetchedAt: string): DailyBar[] {
  const fetched = Date.parse(fetchedAt);
  const last = bars[bars.length - 1];
  if (!last || Number.isNaN(fetched)) return [...bars];
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(fetched));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const sessionDate = Date.UTC(part("year"), part("month") - 1, part("day"));
  const minutes = part("hour") * 60 + part("minute");
  return last.t === sessionDate && minutes < SESSION_FINAL_MINUTES ? bars.slice(0, -1) : [...bars];
}

function adjustedClose(bar: DailyBar): number {
  return isPositive(bar.adjClose) ? bar.adjClose : bar.c;
}

/**
 * Return of a signal formed at the close of session i: bought at the adjusted open of i + 1, sold at the adjusted
 * close of i + h (dividend and split adjusted, before costs). Null when a bar or a price is missing.
 */
export function forwardReturn(bars: readonly DailyBar[], i: number, h: number): number | null {
  const entry = bars[i + 1];
  const exit = bars[i + h];
  if (!entry || !exit || h < 1 || !isPositive(entry.o)) return null;
  const open = entry.o * (adjustedClose(entry) / entry.c);
  const close = adjustedClose(exit);
  return isPositive(open) && isPositive(close) ? close / open - 1 : null;
}

export interface LabelDecomposition {
  n: number;
  mean: number | null;
  excess: number | null;
  timing: number | null;
  selection: number | null;
  hitRate: number | null;
  beatMedian: number | null;
}

/**
 * Splits a reading's mean excess return into timing and selection. Each observation carries its forward return and
 * the same-day universe mean and median; `base` is the mean of all observations. excess = timing + selection exactly:
 * mean(r) - base = (mean(dayMean) - base) + mean(r - dayMean).
 */
export function decomposeLabel(observations: ReadonlyArray<{ r: number; dayMean: number; dayMedian: number }>, base: number | null): LabelDecomposition {
  const n = observations.length;
  if (n === 0 || base === null) return { n, mean: null, excess: null, timing: null, selection: null, hitRate: null, beatMedian: null };
  let sumR = 0;
  let sumDay = 0;
  let up = 0;
  let beat = 0;
  for (const o of observations) {
    sumR += o.r;
    sumDay += o.dayMean;
    if (o.r > 0) up += 1;
    if (o.r > o.dayMedian) beat += 1;
  }
  const m = sumR / n;
  return { n, mean: m, excess: m - base, timing: sumDay / n - base, selection: (sumR - sumDay) / n, hitRate: up / n, beatMedian: beat / n };
}

/**
 * Episodes of a reading: its dates as positions in the evaluation calendar with the observations on each, in
 * ascending order. A gap of more than `gap` sessions starts a new episode.
 */
export function countEpisodes(positions: readonly number[], counts: readonly number[], gap: number): { episodes: number; largestShare: number | null } {
  let episodes = 0;
  let current = 0;
  let largest = 0;
  let total = 0;
  for (let k = 0; k < positions.length; k++) {
    if (k === 0 || positions[k] - positions[k - 1] > gap) {
      episodes += 1;
      current = 0;
    }
    current += counts[k];
    total += counts[k];
    largest = Math.max(largest, current);
  }
  return { episodes, largestShare: total > 0 ? largest / total : null };
}

/** Mean daily IC with its Newey-West t at lags h and 2h, and the spread of t over the h non-overlapping grids. */
export function summarizeIc(dailyIcs: readonly number[], h: number): IcSummary {
  const nw = neweyWest(dailyIcs, h);
  const nw2 = neweyWest(dailyIcs, 2 * h);
  const phaseTs: number[] = [];
  const verdicts = new Set<EvaluationVerdict>();
  for (let phase = 0; phase < h && phase < dailyIcs.length; phase++) {
    const grid = dailyIcs.filter((_, i) => i % h === phase);
    const test = tTest(grid);
    if (test === null || test.t === null) continue;
    phaseTs.push(test.t);
    verdicts.add(evaluationVerdict({ ic: { mean: test.mean, t: test.t } }));
  }
  return {
    mean: mean(dailyIcs),
    t: nw?.t ?? null,
    t2: nw2?.t ?? null,
    dates: dailyIcs.length,
    phaseT: phaseTs.length > 0 ? [Math.min(...phaseTs), Math.max(...phaseTs)] : null,
    fragile: verdicts.size > 1,
  };
}

interface Observation {
  symbol: string;
  t: number;
  score: number;
  label: SignalCode;
  factors: Record<TechnicalFactorKey, number>;
  /** Forward return for each configured horizon (same order), null when the window ends first. */
  forward: Array<number | null>;
}

/** Scored sessions of one stock inside a window, joined to its bars by timestamp. */
function observationsFor(symbol: string, bars: readonly DailyBar[], range: DateRange, horizons: readonly number[]): Observation[] {
  const index = new Map(bars.map((bar, i) => [bar.t, i] as const));
  const from = isoToTime(range.from);
  const to = isoToTime(range.to);
  const out: Observation[] = [];
  for (const point of technicalFactorSeries(bars)) {
    if (point.t < from || point.t > to) continue;
    const i = index.get(point.t);
    if (i === undefined) continue;
    out.push({ symbol, t: point.t, score: point.score, label: labelForScore(point.score), factors: point.factors, forward: horizons.map((h) => forwardReturn(bars, i, h)) });
  }
  return out;
}

interface Day {
  t: number;
  rows: Observation[];
  returns: number[];
  mean: number;
  median: number;
}

/** Dates with at least `minStocks` forward returns at horizon index `hi`, in order, with their universe mean and median. */
function daysFor(byDate: ReadonlyMap<number, Observation[]>, hi: number, minStocks: number): Day[] {
  const days: Day[] = [];
  for (const t of [...byDate.keys()].sort((a, b) => a - b)) {
    const rows = (byDate.get(t) ?? []).filter((o) => o.forward[hi] !== null);
    if (rows.length < minStocks) continue;
    const returns = rows.map((o) => o.forward[hi] as number);
    days.push({ t, rows, returns, mean: mean(returns) as number, median: median(returns) as number });
  }
  return days;
}

/** The cross-sectional rank IC of `value` with the forward return on each date that has one. */
function dailyIcs(days: readonly Day[], value: (o: Observation) => number): Array<{ t: number; ic: number }> {
  const out: Array<{ t: number; ic: number }> = [];
  for (const day of days) {
    const ic = spearman(day.rows.map(value), day.returns);
    if (ic !== null) out.push({ t: day.t, ic });
  }
  return out;
}

/** Percentile intervals of raw excess, selection and up-rate per label from a moving-block bootstrap over dates. */
function labelIntervals(days: readonly Day[], hi: number, settings: BootstrapSettings, seed: number): Map<SignalCode, LabelOutcome["ci"]> {
  const D = days.length;
  const L = LABEL_CODES.length;
  // Prefix sums over dates turn each block's contribution into two lookups.
  const prefix = (values: (d: number) => number) => {
    const out = new Float64Array(D + 1);
    for (let d = 0; d < D; d++) out[d + 1] = out[d] + values(d);
    return out;
  };
  const allN = prefix((d) => days[d].rows.length);
  const allS = prefix((d) => days[d].returns.reduce((a, b) => a + b, 0));
  const perLabel = LABEL_CODES.map((code) => {
    const n = new Float64Array(D);
    const s = new Float64Array(D);
    const sel = new Float64Array(D);
    const up = new Float64Array(D);
    days.forEach((day, d) => {
      for (const o of day.rows) {
        if (o.label !== code) continue;
        const r = o.forward[hi] as number;
        n[d] += 1;
        s[d] += r;
        sel[d] += r - day.mean;
        if (r > 0) up[d] += 1;
      }
    });
    return { n: prefix((d) => n[d]), s: prefix((d) => s[d]), sel: prefix((d) => sel[d]), up: prefix((d) => up[d]) };
  });

  const samples = LABEL_CODES.map(() => ({ excess: [] as number[], selection: [] as number[], hitRate: [] as number[] }));
  const random = mulberry32(seed);
  const n = new Float64Array(L);
  const s = new Float64Array(L);
  const sel = new Float64Array(L);
  const up = new Float64Array(L);
  for (let rep = 0; rep < settings.reps && D > 0; rep++) {
    let totalN = 0;
    let totalS = 0;
    n.fill(0);
    s.fill(0);
    sel.fill(0);
    up.fill(0);
    for (const { start, length } of drawBlocks(D, settings.blockLength, random)) {
      const end = start + length;
      totalN += allN[end] - allN[start];
      totalS += allS[end] - allS[start];
      for (let l = 0; l < L; l++) {
        const p = perLabel[l];
        n[l] += p.n[end] - p.n[start];
        s[l] += p.s[end] - p.s[start];
        sel[l] += p.sel[end] - p.sel[start];
        up[l] += p.up[end] - p.up[start];
      }
    }
    for (let l = 0; l < L; l++) {
      if (n[l] === 0 || totalN === 0) continue;
      samples[l].excess.push(s[l] / n[l] - totalS / totalN);
      samples[l].selection.push(sel[l] / n[l]);
      samples[l].hitRate.push(up[l] / n[l]);
    }
  }
  return new Map(
    LABEL_CODES.map((code, l) => [
      code,
      { excess: percentileInterval(samples[l].excess), selection: percentileInterval(samples[l].selection), hitRate: percentileInterval(samples[l].hitRate) },
    ]),
  );
}

function horizonOutcome(byDate: ReadonlyMap<number, Observation[]>, hi: number, h: number, config: EvaluationConfig): HorizonOutcome {
  const days = daysFor(byDate, hi, config.minStocksPerDate);
  const all = days.flatMap((day) => day.returns);
  const base = mean(all);
  const ics = dailyIcs(days, (o) => o.score);

  const subperiods = config.subperiods.map((range) => {
    const from = isoToTime(range.from);
    const to = isoToTime(range.to);
    const inside = ics.filter((point) => point.t >= from && point.t <= to).map((point) => point.ic);
    return { from: range.from, to: range.to, mean: mean(inside), t: neweyWest(inside, h)?.t ?? null, dates: inside.length };
  });

  const intervals = labelIntervals(days, hi, config.bootstrap, config.bootstrap.seed + h);
  const labels = LABEL_CODES.map((code): LabelOutcome => {
    const observations: Array<{ r: number; dayMean: number; dayMedian: number }> = [];
    const positions: number[] = [];
    const counts: number[] = [];
    days.forEach((day, d) => {
      let count = 0;
      for (const o of day.rows) {
        if (o.label !== code) continue;
        observations.push({ r: o.forward[hi] as number, dayMean: day.mean, dayMedian: day.median });
        count += 1;
      }
      if (count > 0) {
        positions.push(d);
        counts.push(count);
      }
    });
    const parts = decomposeLabel(observations, base);
    const runs = countEpisodes(positions, counts, config.episodeGapSessions);
    return {
      code,
      n: parts.n,
      dates: positions.length,
      episodes: runs.episodes,
      largestEpisodeShare: runs.largestShare,
      mean: parts.mean,
      excess: parts.excess,
      timing: parts.timing,
      selection: parts.selection,
      hitRate: parts.hitRate,
      beatMedian: parts.beatMedian,
      ci: intervals.get(code) ?? { excess: null, selection: null, hitRate: null },
    };
  });

  return {
    days: h,
    base: { n: all.length, mean: base, hitRate: all.length > 0 ? all.filter((r) => r > 0).length / all.length : null },
    ic: summarizeIc(
      ics.map((point) => point.ic),
      h,
    ),
    subperiods,
    labels,
  };
}

/** One-sided p-value of a Newey-West t in the designed (positive) direction. */
function oneSidedP(t: number | null): number | null {
  return t === null ? null : 1 - normalCdf(t);
}

function holdoutResult(byDate: ReadonlyMap<number, Observation[]>, config: EvaluationConfig, first: number, last: number): HoldoutResult {
  const { horizon, alpha } = config.holdoutTest;
  const hi = config.horizons.indexOf(horizon);
  if (hi < 0) throw new Error(`The holdout horizon ${horizon} must be one of the evaluated horizons.`);
  const days = daysFor(byDate, hi, config.minStocksPerDate);

  const test = (key: HoldoutTest["key"], value: (o: Observation) => number) => {
    const ics = dailyIcs(days, value).map((point) => point.ic);
    const nw = neweyWest(ics, horizon);
    return { key, mean: mean(ics), t: nw?.t ?? null, se: nw?.se ?? null, dates: ics.length, p: oneSidedP(nw?.t ?? null) };
  };

  const composite = test("composite", (o) => o.score);
  const factorTests = TECHNICAL_FACTORS.map((key) => test(key, (o) => o.factors[key]));
  const adjusted = holm(factorTests.map((f) => f.p ?? 1));
  const ci: Interval | null = composite.mean !== null && composite.se !== null ? [composite.mean - 1.96 * composite.se, composite.mean + 1.96 * composite.se] : null;

  return {
    period: { ...config.holdout },
    from: Number.isFinite(first) ? timeToIso(first) : config.holdout.from,
    to: Number.isFinite(last) ? timeToIso(last) : config.holdout.to,
    horizon,
    alpha,
    composite: {
      key: "composite",
      mean: composite.mean,
      t: composite.t,
      dates: composite.dates,
      p: composite.p,
      holmP: null,
      pass: composite.p !== null && composite.p < alpha,
      ci,
    },
    factors: factorTests.map((f, k) => ({ key: f.key, mean: f.mean, t: f.t, dates: f.dates, p: f.p, holmP: adjusted[k], pass: f.p !== null && adjusted[k] < alpha })),
    horizons: config.horizons.map((h, k) => {
      const ics = dailyIcs(daysFor(byDate, k, config.minStocksPerDate), (o) => o.score).map((point) => point.ic);
      return { days: h, mean: mean(ics), t: neweyWest(ics, h)?.t ?? null, dates: ics.length };
    }),
  };
}

/** Annualized log-compounded return of daily returns. */
function annualize(logSum: number, sessions: number): number | null {
  return sessions > 0 ? Math.exp((logSum * TRADING_DAYS) / sessions) - 1 : null;
}

/**
 * The universe's equal-weight return (rebalanced daily over the stocks with a close on both sessions) against RSP
 * and SPY on the market's sessions inside the window.
 */
export function benchmarkGap(
  stocks: ReadonlyArray<readonly DailyBar[]>,
  market: readonly DailyBar[],
  equalWeight: readonly DailyBar[],
  range: DateRange,
): BenchmarkGap {
  const from = isoToTime(range.from);
  const to = isoToTime(range.to);
  const calendar = market.filter((bar) => bar.t >= from && bar.t <= to).map((bar) => bar.t);
  const closes = (bars: readonly DailyBar[]) => new Map(bars.map((bar) => [bar.t, adjustedClose(bar)] as const));
  const stockCloses = stocks.map(closes);
  const marketCloses = closes(market);
  const ewCloses = closes(equalWeight);
  const sums = { universe: 0, market: 0, equalWeight: 0 };
  const counts = { universe: 0, market: 0, equalWeight: 0 };
  const step = (series: ReadonlyMap<number, number>, a: number, b: number) => {
    const p0 = series.get(a);
    const p1 = series.get(b);
    return p0 !== undefined && p1 !== undefined ? p1 / p0 - 1 : null;
  };
  for (let k = 1; k < calendar.length; k++) {
    const [a, b] = [calendar[k - 1], calendar[k]];
    const returns = stockCloses.map((series) => step(series, a, b)).filter((r): r is number => r !== null);
    if (returns.length > 0) {
      sums.universe += Math.log(1 + (mean(returns) as number));
      counts.universe += 1;
    }
    const m = step(marketCloses, a, b);
    if (m !== null) {
      sums.market += Math.log(1 + m);
      counts.market += 1;
    }
    const e = step(ewCloses, a, b);
    if (e !== null) {
      sums.equalWeight += Math.log(1 + e);
      counts.equalWeight += 1;
    }
  }
  return {
    from: range.from,
    to: range.to,
    sessions: calendar.length,
    universe: annualize(sums.universe, counts.universe),
    equalWeight: annualize(sums.equalWeight, counts.equalWeight),
    market: annualize(sums.market, counts.market),
  };
}

interface PeriodPanel {
  byDate: Map<number, Observation[]>;
  symbols: Set<string>;
  observations: number;
  first: number;
  last: number;
}

function panelFor(bars: ReadonlyMap<string, DailyBar[]>, range: DateRange, horizons: readonly number[]): PeriodPanel {
  const byDate = new Map<number, Observation[]>();
  const symbols = new Set<string>();
  let observations = 0;
  let first = Infinity;
  let last = -Infinity;
  for (const [symbol, series] of bars) {
    for (const o of observationsFor(symbol, cutBars(series, range.to), range, horizons)) {
      const list = byDate.get(o.t);
      if (list) list.push(o);
      else byDate.set(o.t, [o]);
      symbols.add(symbol);
      observations += 1;
      first = Math.min(first, o.t);
      last = Math.max(last, o.t);
    }
  }
  return { byDate, symbols, observations, first, last };
}

/**
 * Evaluates the technical score on the configured window and holdout: rank ICs with Newey-West t, the label table with
 * its timing and selection parts and bootstrap intervals, the holdout tests of the composite and each technical factor,
 * and the hindsight gap of the universe. Deterministic: symbols are processed in sorted order and the bootstrap is
 * seeded from the config.
 */
export function evaluateSignalModel(input: EvaluationInput): SignalEvaluation {
  const { config } = input;
  const symbols = Object.keys(input.bars).sort();
  const clean = new Map<string, DailyBar[]>();
  const missing: string[] = [];
  const fingerprint: Record<string, [number, string | null]> = {};
  for (const symbol of symbols) {
    const bars = cutBars(cleanDailyBars(input.bars[symbol] ?? []), config.main.to);
    fingerprint[symbol] = [bars.length, bars.length > 0 ? timeToIso(bars[bars.length - 1].t) : null];
    if (bars.length === 0) missing.push(symbol);
    else clean.set(symbol, bars);
  }
  const market = cleanDailyBars(input.market.bars);
  const equalWeight = cleanDailyBars(input.equalWeight.bars);
  for (const [symbol, bars] of [
    [input.market.symbol, market],
    [input.equalWeight.symbol, equalWeight],
  ] as const) {
    const cut = cutBars(bars, config.main.to);
    fingerprint[symbol] = [cut.length, cut.length > 0 ? timeToIso(cut[cut.length - 1].t) : null];
  }

  const main = panelFor(clean, config.main, config.horizons);
  const holdout = panelFor(clean, config.holdout, config.horizons);
  const stockSeries = [...clean.values()];

  return {
    period: { ...config.main },
    from: Number.isFinite(main.first) ? timeToIso(main.first) : config.main.from,
    to: Number.isFinite(main.last) ? timeToIso(main.last) : config.main.to,
    universe: main.symbols.size,
    observations: main.observations,
    model: { version: MODEL_VERSION, thresholds: { ...SIGNAL_THRESHOLDS }, weights: { ...FACTOR_WEIGHTS } },
    settings: { minStocksPerDate: config.minStocksPerDate, episodeGapSessions: config.episodeGapSessions, bootstrap: { ...config.bootstrap } },
    horizons: config.horizons.map((h, hi) => horizonOutcome(main.byDate, hi, h, config)),
    holdout: holdoutResult(holdout.byDate, config, holdout.first, holdout.last),
    hindsight: {
      main: benchmarkGap(stockSeries, market, equalWeight, config.main),
      holdout: benchmarkGap(stockSeries, market, equalWeight, config.holdout),
    },
    data: { missing, fingerprint },
  };
}
