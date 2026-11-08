import "server-only";

import { gaussian } from "./random";
import { PROFILES, isTradingDay } from "./sessions";

// The synthetic US Treasury curve: three Nelson-Siegel factors (level, slope, curvature), each a slow mean-reverting
// walk over NYSE sessions from 2000 on. ^IRX, ^FVX, ^TNX and ^TYX read their yields from it and the Treasury CSV
// fixture (treasury.ts) prints it, so every rate the app shows agrees. A day's curve depends only on the sessions up to
// that day, so it never changes once written.

const LAMBDA_YEARS = 1.8;
const MEANS = { level: 5.06, slope: -1.03, curvature: -3.28 } as const;
const DAILY_VOL = { level: 0.035, slope: 0.03, curvature: 0.08 } as const;
/** Pull back to the mean per session: a half-life of about 170 sessions. */
const REVERSION = 0.004;

export interface CurveFactors {
  level: number;
  slope: number;
  curvature: number;
}

interface FactorSeries {
  days: number[];
  factors: CurveFactors[];
}

const series: FactorSeries = { days: [], factors: [] };

function extendTo(day: number): void {
  const profile = PROFILES.us;
  const start = (series.days.at(-1) ?? profile.epoch - 1) + 1;
  let current: CurveFactors = series.factors.at(-1) ?? { ...MEANS };
  for (let d = start; d <= day; d++) {
    if (!isTradingDay(profile, d)) continue;
    current = {
      level: current.level + REVERSION * (MEANS.level - current.level) + DAILY_VOL.level * gaussian("rates", "level", d),
      slope: current.slope + REVERSION * (MEANS.slope - current.slope) + DAILY_VOL.slope * gaussian("rates", "slope", d),
      curvature: current.curvature + REVERSION * (MEANS.curvature - current.curvature) + DAILY_VOL.curvature * gaussian("rates", "curvature", d),
    };
    series.days.push(d);
    series.factors.push(current);
  }
}

/** The curve factors of the latest NYSE session on or before `day` (the means before 2000). */
export function curveFactors(day: number): CurveFactors {
  if (day < PROFILES.us.epoch) return { ...MEANS };
  if ((series.days.at(-1) ?? -Infinity) < day) extendTo(day);
  let lo = 0;
  let hi = series.days.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (series.days[mid] <= day) lo = mid;
    else hi = mid - 1;
  }
  return series.factors[lo];
}

/** Yield in percent for a maturity in years (Nelson-Siegel), never below 0.01%. */
export function yieldFor(factors: CurveFactors, years: number): number {
  const x = Math.max(years, 1 / 365) / LAMBDA_YEARS;
  const decay = Math.exp(-x);
  const loading = (1 - decay) / x;
  return Math.max(0.01, factors.level + factors.slope * loading + factors.curvature * (loading - decay));
}

/** The yield of a maturity on a day. */
export function yieldOn(day: number, years: number): number {
  return yieldFor(curveFactors(day), years);
}
