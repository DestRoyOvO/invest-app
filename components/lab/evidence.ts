// The rules that decide what the quant panels may claim and when a number may carry color, kept free of React and of
// the research JSON files (callers pass the data in, so each page bundles only what it shows). See docs/evaluation.md
// and docs/factor-research.md for the statistics behind them.

import { excludesZero, type FactorHorizonResult, type FactorResearch, type Interval, type LabelOutcome, type ResearchFactor } from "@/lib/evaluation";
import { labelForScore } from "@/lib/signal";
import type { BacktestResult, FactorKey } from "@/types/api";

function isNum(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// ---------------------------------------------------------------------------
// The reading
// ---------------------------------------------------------------------------

/**
 * The score as the headline prints it: a whole number, unless rounding would cross a reading's cut-off (57.6 stays
 * "57.6" rather than "58" next to a Neutral label, because Strong starts at 58).
 */
export function scoreText(score: number): string {
  const whole = Math.round(score);
  return labelForScore(whole) === labelForScore(score) ? String(whole) : score.toFixed(1);
}

export type RsiState = "oversold" | "nearOversold" | "nearOverbought" | "overbought";

/** The conventional RSI bounds (30 and 70) and how close counts as "near" them. */
export const RSI_BOUNDS = { oversold: 30, overbought: 70, near: 5 } as const;

/** A word for where RSI(14) sits against the conventional 30 / 70 bounds; null in the middle of the range. */
export function rsiState(rsi: number | null | undefined): RsiState | null {
  if (!isNum(rsi)) return null;
  const { oversold, overbought, near } = RSI_BOUNDS;
  if (rsi <= oversold) return "oversold";
  if (rsi <= oversold + near) return "nearOversold";
  if (rsi >= overbought) return "overbought";
  if (rsi >= overbought - near) return "nearOverbought";
  return null;
}

/** Inputs of the reading: directional factor weights rescaled to sum to 1 (zero-weight risk factors drop out). */
export function readingWeights(weights: Readonly<Record<FactorKey, number>>, keys: readonly FactorKey[]): Array<{ key: FactorKey; share: number }> {
  const kept = keys.filter((key) => weights[key] > 0);
  const total = kept.reduce((sum, key) => sum + weights[key], 0);
  return kept.map((key) => ({ key, share: total > 0 ? weights[key] / total : 0 }));
}

// ---------------------------------------------------------------------------
// Track record rows
// ---------------------------------------------------------------------------

/** One episode holding more than this share of a reading's observations makes its row grey. */
export const EPISODE_SHARE_LIMIT = 0.3;

/**
 * Readings seen on at least this share of all dates form long runs by construction (Neutral occurs every session, so
 * all of it is one "episode"); the episode rule only applies to the rarer readings, where a run is one market stretch.
 */
export const COMMON_READING_DATE_SHARE = 0.5;

/**
 * True when one market stretch dominates a reading: its largest episode (a run of dates with short gaps) holds more
 * than 30% of the observations, and the reading is rare enough for runs to mean something (see
 * COMMON_READING_DATE_SHARE).
 */
export function isConcentrated(label: Pick<LabelOutcome, "largestEpisodeShare" | "dates">, totalDates: number): boolean {
  if (!isNum(label.largestEpisodeShare) || !(totalDates > 0)) return false;
  if (label.dates / totalDates >= COMMON_READING_DATE_SHARE) return false;
  return label.largestEpisodeShare > EPISODE_SHARE_LIMIT;
}

/**
 * Color of a reading's return against the same-day universe: up or down only when the bootstrap interval excludes
 * zero and the row is not dominated by one market stretch; neutral otherwise.
 */
export function selectionTone(label: Pick<LabelOutcome, "ci" | "largestEpisodeShare" | "dates">, totalDates: number): "up" | "down" | "neutral" {
  const interval = label.ci.selection;
  if (interval === null || !excludesZero(interval) || isConcentrated(label, totalDates)) return "neutral";
  return interval[0] > 0 ? "up" : "down";
}

/** A domain symmetric around zero that holds every interval, rounded up to a step (for whiskers of signed returns). */
export function symmetricDomain(intervals: ReadonlyArray<Interval | null | undefined>, step = 0.0025): [number, number] {
  let max = step;
  for (const interval of intervals) {
    if (!interval) continue;
    for (const bound of interval) if (isNum(bound)) max = Math.max(max, Math.abs(bound));
  }
  const bound = Math.ceil(max / step - 1e-9) * step;
  return [-bound, bound];
}

/** A domain within 0..1 that holds the values with a margin, on a 5-point grid (for whiskers of rates). */
export function rateDomain(values: ReadonlyArray<number | null | undefined>, margin = 0.05): [number, number] {
  const finite = values.filter(isNum);
  if (finite.length === 0) return [0, 1];
  const lo = Math.max(0, Math.floor((Math.min(...finite) - margin) * 20 + 1e-9) / 20);
  const hi = Math.min(1, Math.ceil((Math.max(...finite) + margin) * 20 - 1e-9) / 20);
  return hi > lo ? [lo, hi] : [0, 1];
}

// ---------------------------------------------------------------------------
// Per-stock backtest
// ---------------------------------------------------------------------------

/** Below this permutation p a backtest edge may carry color: three hold periods are tested per stock. */
export const BACKTEST_ALPHA = 0.01;

/**
 * What the circular-shift permutation test says about one hold period: "unlikely" to be random timing (p < 0.01),
 * "random" (within the range of random timing), "lowSample" (fewer than 20 trades) or "untested" (no p-value, e.g. a
 * report computed before model v4).
 */
export type TimingVerdict = "unlikely" | "random" | "lowSample" | "untested";

export function backtestTiming(result: Pick<BacktestResult, "pValue" | "lowSample">): TimingVerdict {
  if (result.lowSample) return "lowSample";
  if (!isNum(result.pValue)) return "untested";
  return result.pValue < BACKTEST_ALPHA ? "unlikely" : "random";
}

// ---------------------------------------------------------------------------
// Factor research
// ---------------------------------------------------------------------------

/** One factor's result at one horizon, with the factor's literature direction. */
export function findResearch(research: FactorResearch, key: ResearchFactor, days: number): { direction: 1 | -1; result: FactorHorizonResult } | null {
  const factor = research.factors.find((f) => f.key === key);
  const result = factor?.results.find((r) => r.days === days);
  return factor && result ? { direction: factor.direction, result } : null;
}

/**
 * IC and t for the raw value. The research signs each factor in its literature direction (low volatility is minus
 * the volatility), so the raw value's statistics are the published ones times the direction.
 */
export function rawEvidence(result: Pick<FactorHorizonResult, "ic" | "t">, direction: 1 | -1): { ic: number | null; t: number | null } {
  // "+ 0" turns a negative zero into 0.
  const flip = (value: number | null) => (isNum(value) ? value * direction + 0 : null);
  return { ic: flip(result.ic), t: flip(result.t) };
}

/** How many pre-registered tests pass the adoption rule, and the smallest raw and Holm-adjusted p-values. */
export function researchTally(research: FactorResearch): { tests: number; passed: number; minP: number | null; minHolmP: number | null } {
  let tests = 0;
  let passed = 0;
  let minP: number | null = null;
  let minHolmP: number | null = null;
  for (const factor of research.factors) {
    for (const result of factor.results) {
      tests += 1;
      if (result.verdict === "predictive") passed += 1;
      if (isNum(result.p)) minP = minP === null ? result.p : Math.min(minP, result.p);
      if (isNum(result.holmP)) minHolmP = minHolmP === null ? result.holmP : Math.min(minHolmP, result.holmP);
    }
  }
  return { tests, passed, minP, minHolmP };
}

/**
 * Factors whose IC runs against their literature direction on raw returns but turns positive once returns are net of
 * trailing beta times SPY: the raw pattern is market exposure, not stock selection.
 */
export function betaFlips(research: FactorResearch, days: number): ResearchFactor[] {
  return research.factors
    .filter((factor) => {
      const result = factor.results.find((r) => r.days === days);
      return result !== undefined && isNum(result.ic) && isNum(result.betaAdjustedIc) && result.ic < 0 && result.betaAdjustedIc > 0;
    })
    .map((factor) => factor.key);
}

/** The research horizon closest to a number of sessions (the factor profile quotes 21, the primary horizon). */
export function nearestHorizon(horizons: readonly number[], days: number): number | null {
  if (horizons.length === 0) return null;
  return horizons.reduce((best, h) => (Math.abs(h - days) < Math.abs(best - days) ? h : best), horizons[0]);
}
