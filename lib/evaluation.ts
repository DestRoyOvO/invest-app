// Universe-level evaluation of the technical score, produced offline by scripts/evaluate-signal.ts.
//
// The script writes lib/signal-evaluation.json; lib/evaluation-data.ts loads it for the app. This module holds only
// the shape and the pure helpers, so the script can import its types without loading a JSON file it is about to write.

import type { FactorKey, SignalCode } from "@/types/api";

export interface LabelOutcome {
  code: SignalCode;
  /** Signal sessions with this label (overlapping, across all stocks). */
  n: number;
  /** Mean forward return after the label. */
  mean: number | null;
  /** Mean forward return minus the unconditional mean of the same universe and period. */
  excess: number | null;
  /** Share of forward returns above zero. */
  hitRate: number | null;
  hitCI: [number, number] | null;
}

export interface HorizonOutcome {
  /** Holding period in sessions. */
  days: number;
  base: { n: number; mean: number | null; hitRate: number | null };
  /** Mean cross-sectional Spearman rank IC on non-overlapping dates, with its t-statistic. */
  ic: { mean: number | null; t: number | null; dates: number };
  labels: LabelOutcome[];
}

export interface SignalEvaluation {
  /** ISO date the evaluation was generated. */
  generated: string;
  /** First and last signal date (ISO). */
  from: string;
  to: string;
  /** Stocks that loaded. */
  universe: number;
  observations: number;
  /** The model settings the evaluation ran with; a test fails when they drift from lib/signal.ts. */
  model: {
    version: number;
    thresholds: { strongBullish: number; bullish: number; bearish: number; strongBearish: number };
    weights: Record<FactorKey, number>;
  };
  horizons: HorizonOutcome[];
}

/** |t| at or above which the rank IC counts as a reliable relationship (about the two-sided 5% level). */
export const IC_T_RELIABLE = 2;

export type EvaluationVerdict = "predictive" | "inverse" | "none";

export function evaluationVerdict(horizon: Pick<HorizonOutcome, "ic">): EvaluationVerdict {
  const { mean, t } = horizon.ic;
  if (mean === null || t === null || !Number.isFinite(t)) return "none";
  if (t >= IC_T_RELIABLE && mean > 0) return "predictive";
  if (t <= -IC_T_RELIABLE && mean < 0) return "inverse";
  return "none";
}

export function findHorizon(evaluation: SignalEvaluation, days: number): HorizonOutcome | null {
  return evaluation.horizons.find((h) => h.days === days) ?? null;
}

export function findLabel(horizon: HorizonOutcome, code: SignalCode): LabelOutcome | null {
  return horizon.labels.find((l) => l.code === code) ?? null;
}
