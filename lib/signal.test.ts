import { describe, expect, it } from "vitest";

import type { DailyBar } from "@/lib/bars";
import type { ConfidenceLevel, SignalReport } from "@/types/api";

import {
  BACKTEST_SETTINGS,
  computeSignalReport,
  computeTechnicalFactors,
  CONFIDENCE_RULES,
  CONSENSUS_DEAD_BAND,
  FACTOR_WEIGHTS,
  fairPe,
  type Fundamentals,
  labelForScore,
  MIN_BARS,
  qualityFactor,
  rsiToScore,
  runBacktest,
  TECHNICAL_FACTORS,
  technicalScoreSeries,
  valueFactor,
  wilderRsiSeries,
} from "./signal";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const START = Date.UTC(2024, 0, 2);
const AS_OF = "2026-11-07T00:00:00.000Z";
const COST = BACKTEST_SETTINGS.costBps / 10_000;

const NO_FUNDAMENTALS: Fundamentals = {
  pe: null,
  eps: null,
  roe: null,
  profitMargin: null,
  revenueGrowth: null,
  debtToEquity: null,
  sector: null,
};

const GOOD_FUNDAMENTALS: Fundamentals = {
  pe: 20,
  eps: 5,
  roe: 0.18,
  profitMargin: 0.15,
  revenueGrowth: 0.08,
  debtToEquity: 0.8,
  sector: "Technology",
};

const POOR_FUNDAMENTALS: Fundamentals = {
  pe: null,
  eps: -1.5,
  roe: -0.05,
  profitMargin: -0.05,
  revenueGrowth: -0.12,
  debtToEquity: 2.5,
  sector: "Industrials",
};

/** Deterministic uniform [0, 1) generator (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/**
 * Driftless geometric random walk (zero-mean log returns) with overnight gaps and log-normal volume. For a given seed
 * the random draws are the same at every volatility level, so the log returns only differ by a constant factor.
 */
function randomWalk(n: number, annualVol: number, seed: number): DailyBar[] {
  const rand = mulberry32(seed);
  const daily = annualVol / Math.sqrt(252);
  const bars: DailyBar[] = [];
  let previous = 100;
  for (let i = 0; i < n; i++) {
    const o = previous * Math.exp(0.3 * daily * gaussian(rand));
    const c = o * Math.exp(0.95 * daily * gaussian(rand));
    const v = Math.round(1e6 * Math.exp(0.35 * gaussian(rand)));
    bars.push({ t: START + i * DAY_MS, o, h: Math.max(o, c), l: Math.min(o, c), c, adjClose: c, v });
    previous = c;
  }
  return bars;
}

/** Bars with the given closes, opening at the previous close, with constant volume unless given. */
function barsFromCloses(closes: readonly number[], volumes?: readonly (number | null)[]): DailyBar[] {
  return closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1];
    return { t: START + i * DAY_MS, o, h: Math.max(o, c), l: Math.min(o, c), c, adjClose: c, v: volumes ? volumes[i] : 1e6 };
  });
}

/** Geometric path with a constant daily log return. */
function steadyPath(n: number, dailyLogReturn: number): number[] {
  return Array.from({ length: n }, (_, i) => 100 * Math.exp(dailyLogReturn * i));
}

function pathFromLogReturns(logReturns: readonly number[]): number[] {
  const closes = [100];
  for (const r of logReturns) closes.push(closes[closes.length - 1] * Math.exp(r));
  return closes;
}

/** Reflects a path around its first close in log space: ln p' = 2 ln p0 - ln p. */
function reflectLog(bars: readonly DailyBar[]): DailyBar[] {
  const k = bars[0].c * bars[0].c;
  return bars.map((b) => ({ ...b, o: k / b.o, h: k / b.l, l: k / b.h, c: k / b.c, adjClose: k / b.adjClose }));
}

/** Reflects a path around its first close arithmetically: p' = 2 p0 - p (RSI is defined on price differences). */
function reflectLinear(bars: readonly DailyBar[]): DailyBar[] {
  const k = 2 * bars[0].c;
  return bars.map((b) => ({ ...b, o: k - b.o, h: k - b.l, l: k - b.h, c: k - b.c, adjClose: k - b.adjClose }));
}

/** Paths of every non-finite number inside a JSON-like value. */
function nonFinitePaths(value: unknown, path = "$"): string[] {
  if (typeof value === "number") return Number.isFinite(value) ? [] : [path];
  if (Array.isArray(value)) return value.flatMap((item, i) => nonFinitePaths(item, `${path}[${i}]`));
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => nonFinitePaths(item, `${path}.${key}`));
  }
  return [];
}

/** Largest step between neighbours and the number of steps against `direction` (1 = rising, -1 = falling). */
function stepStats(values: readonly number[], direction: 1 | -1): { maxStep: number; wrongWay: number } {
  let maxStep = 0;
  let wrongWay = 0;
  for (let k = 1; k < values.length; k++) {
    const step = values[k] - values[k - 1];
    maxStep = Math.max(maxStep, Math.abs(step));
    if (step * direction < -1e-9) wrongWay += 1;
  }
  return { maxStep, wrongWay };
}

function grid(from: number, to: number, step: number): number[] {
  return Array.from({ length: Math.round((to - from) / step) + 1 }, (_, k) => from + k * step);
}

// Independent re-statements of the documented rules, used to check the report against its own factors.
function expectedConsensus(report: SignalReport): number | null {
  if (report.score === null || report.score === 50) return null;
  const side = Math.sign(report.score - 50);
  const informative = report.factors.filter((f) => !f.imputed && Math.abs(f.score - 50) >= CONSENSUS_DEAD_BAND);
  const total = informative.reduce((sum, f) => sum + f.weight, 0);
  if (total === 0) return null;
  const agreeing = informative.filter((f) => Math.sign(f.score - 50) === side).reduce((sum, f) => sum + f.weight, 0);
  return Math.round((100 * agreeing) / total);
}

function expectedConfidence(report: SignalReport): ConfidenceLevel {
  const { consensus, coverage, score } = report;
  if (consensus === null || coverage === null || score === null) return "low";
  const { high, medium } = CONFIDENCE_RULES;
  if (consensus >= high.minConsensus && coverage >= high.minCoverage && Math.abs(score - 50) >= high.minDistanceFrom50) {
    return "high";
  }
  return consensus >= medium.minConsensus && coverage >= medium.minCoverage ? "medium" : "low";
}

// ---------------------------------------------------------------------------
// RSI
// ---------------------------------------------------------------------------

// StockCharts ChartSchool RSI example. The table there shows the closes rounded to two decimals, so the published RSI
// values (computed from unrounded closes) agree with a recomputation from this table to within 0.1.
const CHARTSCHOOL_CLOSES = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03,
  46.41, 46.22, 45.64, 46.21, 46.25, 45.71, 46.45, 45.78, 45.35, 44.03, 44.18, 44.22, 44.57, 43.42, 42.66, 43.13,
];
const CHARTSCHOOL_RSI = [
  70.53, 66.32, 66.55, 69.41, 66.36, 57.97, 62.93, 63.26, 56.06, 62.38, 54.71, 50.42, 39.99, 41.46, 41.87, 45.46, 37.3,
  33.08, 37.77,
];

/** Wilder RSI from the closed form of the smoothing: avg_i = (1 - a)^(i - p) * seed + sum_k a (1 - a)^(i - k) x_k. */
function referenceRsi(closes: readonly number[], period: number): (number | null)[] {
  const gains = closes.map((c, i) => (i === 0 ? 0 : Math.max(c - closes[i - 1], 0)));
  const losses = closes.map((c, i) => (i === 0 ? 0 : Math.max(closes[i - 1] - c, 0)));
  const alpha = 1 / period;
  const smoothed = (xs: readonly number[], i: number) => {
    let seed = 0;
    for (let k = 1; k <= period; k++) seed += xs[k] / period;
    let value = (1 - alpha) ** (i - period) * seed;
    for (let k = period + 1; k <= i; k++) value += alpha * (1 - alpha) ** (i - k) * xs[k];
    return value;
  };
  return closes.map((_, i) => {
    if (i < period) return null;
    const gain = smoothed(gains, i);
    const loss = smoothed(losses, i);
    return gain + loss === 0 ? 50 : (100 * gain) / (gain + loss);
  });
}

describe("wilderRsiSeries", () => {
  it("reproduces the published ChartSchool example", () => {
    const rsi = wilderRsiSeries(CHARTSCHOOL_CLOSES);
    expect(rsi.slice(0, 14).every((v) => v === null)).toBe(true);
    const computed = rsi.slice(14);
    expect(computed).toHaveLength(CHARTSCHOOL_RSI.length);
    computed.forEach((value, k) => expect(Math.abs((value ?? Number.NaN) - CHARTSCHOOL_RSI[k])).toBeLessThan(0.1));
  });

  it("matches an independent closed-form implementation", () => {
    const closes = randomWalk(300, 0.35, 5).map((bar) => bar.c);
    const expected = referenceRsi(closes, 14);
    const actual = wilderRsiSeries(closes);
    actual.forEach((value, i) => {
      if (expected[i] === null) expect(value).toBeNull();
      else expect(value).toBeCloseTo(expected[i] ?? Number.NaN, 9);
    });
  });

  it("returns 50 without movement, 100 for a one-way rise and 0 for a one-way fall", () => {
    expect(wilderRsiSeries(Array<number>(40).fill(10)).slice(14)).toEqual(Array<number>(26).fill(50));
    expect(wilderRsiSeries(steadyPath(40, 0.01)).slice(14).every((v) => v === 100)).toBe(true);
    expect(wilderRsiSeries(steadyPath(40, -0.01)).slice(14).every((v) => v === 0)).toBe(true);
  });

  it("yields nulls, never NaN, for short or broken input", () => {
    expect(wilderRsiSeries([])).toEqual([]);
    expect(wilderRsiSeries(Array<number>(14).fill(1))).toEqual(Array<null>(14).fill(null));
    const broken = [...steadyPath(20, 0.01), Number.NaN, ...steadyPath(20, 0.01)];
    expect(wilderRsiSeries(broken).every((v) => v === null || Number.isFinite(v))).toBe(true);
  });
});

describe("rsiToScore", () => {
  it("is symmetric around 50: oversold scores high, overbought low", () => {
    for (const rsi of grid(0, 100, 0.5)) expect(rsiToScore(100 - rsi)).toBeCloseTo(100 - rsiToScore(rsi), 10);
    expect(rsiToScore(50)).toBe(50);
    expect(rsiToScore(30)).toBeGreaterThan(70);
    expect(rsiToScore(70)).toBeLessThan(30);
  });

  it("damps the most extreme readings back toward 50", () => {
    expect(rsiToScore(5)).toBeLessThan(rsiToScore(20));
    expect(rsiToScore(95)).toBeGreaterThan(rsiToScore(80));
    expect(rsiToScore(0)).toBeGreaterThan(50);
    expect(rsiToScore(100)).toBeLessThan(50);
  });

  it("is continuous and falls back to 50 for non-finite input", () => {
    expect(stepStats(grid(0, 100, 0.01).map(rsiToScore), -1).maxStep).toBeLessThan(0.02);
    expect(rsiToScore(Number.NaN)).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Fundamental factors
// ---------------------------------------------------------------------------

describe("valueFactor", () => {
  const value = (pe: number | null, revenueGrowth: number | null, eps: number | null = 1) =>
    valueFactor({ ...NO_FUNDAMENTALS, pe, eps, revenueGrowth });

  it("uses a growth-adjusted fair P/E", () => {
    expect(fairPe(0)).toBe(15);
    expect(fairPe(0.1)).toBeCloseTo(21, 10);
    expect(fairPe(0.4)).toBeCloseTo(39, 10);
    expect(fairPe(2)).toBeCloseTo(39, 10); // growth is clipped at +40%
    expect(fairPe(-0.5)).toBeCloseTo(9, 10); // and at -10%
    expect(fairPe(null)).toBeCloseTo(18, 10); // unknown growth assumes 5%
    expect(fairPe(Number.NaN)).toBeCloseTo(18, 10);
  });

  it("scores 50 at the fair P/E, 100 at half of it and 0 at twice it", () => {
    expect(value(21, 0.1)).toMatchObject({ imputed: false, raw: 21 });
    expect(value(21, 0.1).score).toBeCloseTo(50, 10);
    expect(value(10.5, 0.1).score).toBeCloseTo(100, 10);
    expect(value(42, 0.1).score).toBeCloseTo(0, 10);
  });

  it("is continuous and non-increasing in P/E", () => {
    for (const growth of [-0.2, -0.05, 0, 0.1, 0.3, 0.6, null]) {
      const pes: number[] = [];
      for (let pe = 1; pe < 400; pe *= 1.002) pes.push(pe);
      const { maxStep, wrongWay } = stepStats(
        pes.map((pe) => value(pe, growth).score),
        -1,
      );
      expect(maxStep).toBeLessThan(0.2);
      expect(wrongWay).toBe(0);
    }
  });

  it("is continuous and non-decreasing in revenue growth", () => {
    for (const pe of [5, 10, 15, 25, 40, 80]) {
      const { maxStep, wrongWay } = stepStats(
        grid(-0.3, 0.6, 0.0005).map((g) => value(pe, g).score),
        1,
      );
      expect(maxStep).toBeLessThan(0.3);
      expect(wrongWay).toBe(0);
    }
  });

  it("caps the score gently when revenue shrinks", () => {
    // A P/E of 5 is far below fair (uncapped score 100); the cap falls from 100 at 0% growth to 60 at -10%.
    expect(value(5, -0.0001).score).toBeCloseTo(99.96, 6);
    expect(value(5, -0.05).score).toBeCloseTo(80, 10);
    expect(value(5, -0.1).score).toBeCloseTo(60, 10);
    expect(value(5, -0.3).score).toBeCloseTo(60, 10);
  });

  it("scores loss-makers 20 without imputing", () => {
    for (const factor of [value(null, 0.1, -1.2), value(35, 0.1, -0.5), value(-12, 0.1, null), value(null, null, 0)]) {
      expect(factor).toMatchObject({ score: 20, imputed: false, raw: null });
    }
  });

  it("imputes a neutral 50 when no usable P/E or EPS exists", () => {
    const cases = [value(null, 0.1, null), value(Number.NaN, 0.1, Number.NaN), value(Number.POSITIVE_INFINITY, null, null), value(null, 0.2, 2)];
    for (const factor of cases) expect(factor).toMatchObject({ score: 50, imputed: true, raw: null, availability: 0 });
  });
});

describe("qualityFactor", () => {
  const quality = (roe: number | null, profitMargin: number | null, debtToEquity: number | null, sector: string | null = "Industrials") =>
    qualityFactor({ ...NO_FUNDAMENTALS, roe, profitMargin, debtToEquity, sector });

  it("puts a median company at 50 and spans 0 to 100", () => {
    expect(quality(0.15, 0.125, 1.25).score).toBeCloseTo(50, 10);
    expect(quality(0.35, 0.3, 0).score).toBeCloseTo(100, 10);
    expect(quality(-0.05, -0.05, 2.5).score).toBeCloseTo(0, 10);
  });

  it("averages only the available metrics and reports ROE as raw", () => {
    expect(quality(0.35, null, null)).toMatchObject({ score: 100, imputed: false, raw: 0.35 });
    expect(quality(null, 0.125, null).score).toBeCloseTo(50, 10);
    expect(quality(null, 0.125, null).availability).toBeCloseTo(1 / 3, 10);
  });

  it("treats a negative debt/equity as missing and ignores leverage for financials", () => {
    expect(quality(0.15, 0.125, -3).score).toBeCloseTo(quality(0.15, 0.125, null).score, 10);
    expect(quality(0.15, 0.125, 9).score).toBeCloseTo(100 / 3, 10);
    const bank = quality(0.15, 0.125, 9, "Financial Services");
    expect(bank.score).toBeCloseTo(50, 10);
    expect(bank.availability).toBe(1);
  });

  it("imputes a neutral 50 when nothing is usable", () => {
    expect(quality(null, null, null)).toMatchObject({ score: 50, imputed: true, raw: null });
    expect(quality(Number.NaN, Number.POSITIVE_INFINITY, -1)).toMatchObject({ score: 50, imputed: true });
  });

  it("is continuous and monotonic in every metric", () => {
    const checks = [
      stepStats(grid(-0.5, 1, 0.0005).map((roe) => quality(roe, 0.1, 1).score), 1),
      stepStats(grid(-0.5, 1, 0.0005).map((margin) => quality(0.15, margin, 1).score), 1),
      stepStats(grid(0, 5, 0.0005).map((de) => quality(0.15, 0.1, de).score), -1),
    ];
    for (const { maxStep, wrongWay } of checks) {
      expect(maxStep).toBeLessThan(0.1);
      expect(wrongWay).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Technical factors
// ---------------------------------------------------------------------------

describe("technical factors", () => {
  it("never produce NaN for empty, short, flat or corrupt input", () => {
    const flat = barsFromCloses(Array<number>(300).fill(50));
    const corrupt = randomWalk(260, 0.3, 7).map((bar, i) => {
      if (i % 37 === 0) return { ...bar, c: Number.NaN };
      if (i % 41 === 0) return { ...bar, adjClose: Number.POSITIVE_INFINITY, v: Number.NaN };
      if (i % 43 === 0) return { ...bar, o: -1, v: null };
      if (i % 47 === 0) return { ...bar, c: 0 };
      return bar;
    });
    const noVolume = barsFromCloses(Array<number>(200).fill(10), Array<null>(200).fill(null));
    const inputs = [[], flat.slice(0, 1), flat.slice(0, 15), flat.slice(0, 30), flat.slice(0, MIN_BARS - 1), flat, corrupt, noVolume];
    const fundamentals = { ...NO_FUNDAMENTALS, pe: Number.NaN, eps: Number.POSITIVE_INFINITY, roe: Number.NaN };

    for (const bars of inputs) {
      const factors = computeTechnicalFactors(bars);
      expect(nonFinitePaths(factors)).toEqual([]);
      for (const key of TECHNICAL_FACTORS) {
        expect(factors[key].score).toBeGreaterThanOrEqual(0);
        expect(factors[key].score).toBeLessThanOrEqual(100);
      }
      expect(nonFinitePaths(computeSignalReport({ symbol: "T", bars, fundamentals, asOf: AS_OF }))).toEqual([]);
      expect(nonFinitePaths(technicalScoreSeries(bars))).toEqual([]);
    }
  });

  it("scores a perfectly flat series as neutral", () => {
    const factors = computeTechnicalFactors(barsFromCloses(Array<number>(300).fill(50)));
    for (const key of TECHNICAL_FACTORS) expect(factors[key].score).toBeCloseTo(50, 9);
    expect(factors.rsi.raw).toBe(50);
    expect(factors.momentum.raw).toBe(0);
    expect(factors.volatility.raw).toBe(0);
  });

  it("reads a steady uptrend as bullish and its mirror image as bearish", () => {
    const up = computeTechnicalFactors(barsFromCloses(steadyPath(300, 0.002)));
    const down = computeTechnicalFactors(barsFromCloses(steadyPath(300, -0.002)));
    expect(up.momentum.score).toBeGreaterThan(70);
    expect(up.trend.score).toBeGreaterThan(85);
    expect(down.momentum.score).toBeLessThan(30);
    expect(down.trend.score).toBeLessThan(15);
    expect(up.momentum.raw).toBeCloseTo(Math.exp(0.04) - 1, 10);
  });

  it("damps a 5-day versus 60-day divergence toward 50, never past it", () => {
    /** The documented momentum formula, restated: horizon z-scores, their weighted mean and the damping factor. */
    const restate = (closes: readonly number[]) => {
      const t = closes.length - 1;
      const returns = closes.slice(t - 19, t + 1).map((c, k) => Math.log(c / closes[t - 20 + k]));
      const m = returns.reduce((sum, r) => sum + r, 0) / returns.length;
      const sigma = Math.max(Math.sqrt(returns.reduce((sum, r) => sum + (r - m) ** 2, 0) / (returns.length - 1)), 0.005);
      const sub = (h: number) =>
        50 + 50 * Math.max(-1, Math.min(1, Math.log(closes[t] / closes[t - h]) / (sigma * Math.sqrt(h) * 3)));
      const [s5, s20, s60] = [sub(5), sub(20), sub(60)];
      const undamped = 0.35 * s5 + 0.4 * s20 + 0.25 * s60;
      const divergent = (s5 - 50) * (s60 - 50) < 0;
      const keep = divergent ? 1 - 0.3 * Math.min(1, Math.min(Math.abs(s5 - 50), Math.abs(s60 - 50)) / 25) : 1;
      return { divergent, undamped, score: 50 + (undamped - 50) * keep };
    };
    const zigzag = (n: number, drift: number) => Array.from({ length: n }, (_, k) => drift + (k % 2 ? 0.01 : -0.01));

    for (const [drift, drop] of [
      [0.008, -0.025],
      [0.003, -0.012],
    ] as const) {
      // A 55-session advance that ends in a sharp five-session drop, and its mirror image.
      const logReturns = [...zigzag(200, 0), ...zigzag(55, drift), ...Array<number>(5).fill(drop)];
      for (const sign of [1, -1]) {
        const closes = pathFromLogReturns(logReturns.map((r) => sign * r));
        const expected = restate(closes);
        const actual = computeTechnicalFactors(barsFromCloses(closes)).momentum.score;
        expect(expected.divergent).toBe(true);
        expect(actual).toBeCloseTo(expected.score, 9);
        // Shrunk toward 50 and kept on the same side (model v2 multiplied the score toward 0 instead).
        expect(Math.abs(actual - 50)).toBeLessThan(Math.abs(expected.undamped - 50));
        expect(Math.sign(actual - 50)).toBe(Math.sign(expected.undamped - 50));
      }
    }

    // Without a divergence nothing is damped.
    const steady = pathFromLogReturns([...zigzag(200, 0), ...zigzag(60, 0.004)]);
    expect(restate(steady).divergent).toBe(false);
    expect(computeTechnicalFactors(barsFromCloses(steady)).momentum.score).toBeCloseTo(restate(steady).undamped, 9);
  });

  it("mirrors momentum, trend and volume exactly when the path is reflected in log space", () => {
    let opinionated = 0;
    for (const seed of [11, 12, 13, 14, 15, 16]) {
      const bars = randomWalk(260, 0.35, seed);
      const mirrored = reflectLog(bars);
      for (const end of [140, 200, 259]) {
        const a = computeTechnicalFactors(bars.slice(0, end + 1));
        const b = computeTechnicalFactors(mirrored.slice(0, end + 1));
        for (const key of ["momentum", "trend", "volume"] as const) {
          expect(a[key].score + b[key].score).toBeCloseTo(100, 6);
          if (Math.abs(a[key].score - 50) > 5) opinionated += 1;
        }
      }
    }
    expect(opinionated).toBeGreaterThan(10);
  });

  it("mirrors RSI exactly when the path is reflected arithmetically", () => {
    for (const seed of [21, 22, 23, 24]) {
      const bars = randomWalk(260, 0.15, seed);
      expect(Math.max(...bars.map((b) => Math.max(b.o, b.c)))).toBeLessThan(2 * bars[0].c);
      const mirrored = reflectLinear(bars);
      for (const end of [140, 259]) {
        const a = computeTechnicalFactors(bars.slice(0, end + 1)).rsi;
        const b = computeTechnicalFactors(mirrored.slice(0, end + 1)).rsi;
        expect((a.raw ?? Number.NaN) + (b.raw ?? Number.NaN)).toBeCloseTo(100, 6);
        expect(a.score + b.score).toBeCloseTo(100, 6);
      }
    }
  });

  it("does not depend on the absolute volatility level", () => {
    // Same random draws, three times the volatility: only RSI (defined on price differences) may differ.
    for (const seed of [31, 32, 33]) {
      const calm = computeTechnicalFactors(randomWalk(300, 0.2, seed));
      const wild = computeTechnicalFactors(randomWalk(300, 0.6, seed));
      for (const key of ["momentum", "trend", "volume", "volatility"] as const) {
        expect(wild[key].score).toBeCloseTo(calm[key].score, 6);
      }
      expect(wild.volatility.raw ?? 0).toBeCloseTo(3 * (calm.volatility.raw ?? 0), 6);
    }
  });

  it("reads volatility relative to the stock's own history, penalizing downside more", () => {
    const rand = mulberry32(42);
    const history = Array.from({ length: 280 }, () => 0.02 * gaussian(rand));
    const ending = (returns: number[]) => computeTechnicalFactors(barsFromCloses(pathFromLogReturns([...history, ...returns]))).volatility;
    const calm = ending(Array.from({ length: 20 }, () => 0.004 * gaussian(rand)));
    const storm = ending(Array.from({ length: 20 }, () => 0.06 * gaussian(rand)));
    expect(calm.score).toBeGreaterThan(85);
    expect(storm.score).toBeLessThan(15);

    const spikes = [0.04, 0.001, 0.001, 0.001, 0.04, 0.001, 0.001, 0.001, 0.04, 0.001, 0.001, 0.001, 0.04, 0.001, 0.001, 0.001, 0.04, 0.001, 0.001, 0.001];
    const upSpikes = ending(spikes);
    const downSpikes = ending(spikes.map((r) => -r));
    expect(upSpikes.raw ?? 0).toBeCloseTo(downSpikes.raw ?? 0, 12); // same total volatility
    expect(upSpikes.score).toBeGreaterThan(downSpikes.score);
  });

  it("uses dividend- and split-adjusted prices", () => {
    const adjusted = randomWalk(300, 0.25, 41);
    // Same adjusted history, but raw prices carry a 2:1 split before session 100 and a 3% dividend before session 200.
    const raw = adjusted.map((bar, i) => {
      const k = (i < 100 ? 2 : 1) * (i < 200 ? 1.03 : 1);
      return { ...bar, o: bar.o * k, h: bar.h * k, l: bar.l * k, c: bar.c * k, adjClose: bar.c };
    });
    expect(computeTechnicalFactors(raw)).toEqual(computeTechnicalFactors(adjusted));
    const a = runBacktest(raw)?.results ?? [];
    const b = runBacktest(adjusted)?.results ?? [];
    expect(a.map((r) => r.trades)).toEqual(b.map((r) => r.trades));
    a.forEach((r, k) => expect(r.baselineAvgReturn ?? Number.NaN).toBeCloseTo(b[k].baselineAvgReturn ?? Number.NaN, 8));
  });

  it("imputes the volume factor when volume is missing", () => {
    const factors = computeTechnicalFactors(randomWalk(200, 0.25, 51).map((bar) => ({ ...bar, v: null })));
    expect(factors.volume).toMatchObject({ score: 50, imputed: true, raw: null });
    expect(factors.momentum.imputed).toBe(false);
  });

  it("lets volume confirm or contradict the 5-day move", () => {
    const rand = mulberry32(61);
    const quiet = Array.from({ length: 200 }, () => 0.01 * gaussian(rand));
    const closesUp = pathFromLogReturns([...quiet, 0.02, 0.02, 0.02, 0.02, 0.02]);
    const closesDown = pathFromLogReturns([...quiet, -0.02, -0.02, -0.02, -0.02, -0.02]);
    const volumes = (recent: number) => closesUp.map((_, i) => (i >= closesUp.length - 5 ? recent : 1e6));
    const score = (closes: number[], recent: number) => computeTechnicalFactors(barsFromCloses(closes, volumes(recent))).volume;
    expect(score(closesUp, 2e6).score).toBeCloseTo(85, 6); // rally on doubled volume: full confirmation
    expect(score(closesDown, 2e6).score).toBeCloseTo(15, 6); // selloff on doubled volume
    expect(score(closesUp, 5e5).score).toBeLessThan(50); // rally on thin volume is suspect
    expect(score(closesDown, 5e5).score).toBeGreaterThan(50); // selloff drying up
    expect(score(closesUp, 2e6).raw).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Labels and the composite
// ---------------------------------------------------------------------------

describe("labelForScore", () => {
  it("uses symmetric cut-offs at 28 / 42 / 58 / 72", () => {
    const cases: Array<[number, string]> = [
      [100, "strong_bullish"],
      [72, "strong_bullish"],
      [71.9, "bullish"],
      [58, "bullish"],
      [57.9, "neutral"],
      [50, "neutral"],
      [42.1, "neutral"],
      [42, "bearish"],
      [28.1, "bearish"],
      [28, "strong_bearish"],
      [0, "strong_bearish"],
      [Number.NaN, "neutral"],
    ];
    for (const [score, label] of cases) expect(labelForScore(score)).toBe(label);
  });
});

describe("label mix on driftless random walks", () => {
  // Model v2 scored absolute volatility, so a 25%-volatility random walk was labelled bullish on 37% of days and
  // bearish on 1%. On noise the bullish and bearish shares must now be balanced at every volatility level.
  const technicalWeight = TECHNICAL_FACTORS.reduce((sum, key) => sum + FACTOR_WEIGHTS[key], 0);
  const isBullish = (score: number) => labelForScore(score).endsWith("bullish");
  const isBearish = (score: number) => labelForScore(score).endsWith("bearish");

  for (const annualVol of [0.1, 0.25, 0.5, 0.8]) {
    it(`is balanced at ${Math.round(annualVol * 100)}% annualized volatility`, () => {
      const counts = { days: 0, bullish: 0, bearish: 0, technicalBullish: 0, technicalBearish: 0 };
      for (let seed = 1; seed <= 8; seed++) {
        for (const { score } of technicalScoreSeries(randomWalk(1500, annualVol, seed * 1009))) {
          if (score === null) continue;
          // The full composite of a stock without fundamentals: value and quality are imputed at 50.
          const composite = technicalWeight * score + (1 - technicalWeight) * 50;
          counts.days += 1;
          if (isBullish(composite)) counts.bullish += 1;
          if (isBearish(composite)) counts.bearish += 1;
          if (isBullish(score)) counts.technicalBullish += 1;
          if (isBearish(score)) counts.technicalBearish += 1;
        }
      }
      expect(counts.bullish / counts.days).toBeGreaterThan(0.05);
      expect(counts.bearish / counts.days).toBeGreaterThan(0.05);
      expect(Math.max(counts.bullish, counts.bearish) / Math.min(counts.bullish, counts.bearish)).toBeLessThan(2);
      const technicalRatio =
        Math.max(counts.technicalBullish, counts.technicalBearish) / Math.min(counts.technicalBullish, counts.technicalBearish);
      expect(technicalRatio).toBeLessThan(2);
    });
  }
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

describe("computeSignalReport", () => {
  it("reports insufficient data below MIN_BARS", () => {
    for (const n of [0, 1, MIN_BARS - 1]) {
      const bars = randomWalk(n, 0.3, 61);
      const report = computeSignalReport({ symbol: "NEW", bars, fundamentals: GOOD_FUNDAMENTALS, asOf: AS_OF, droppedPartialBar: true });
      expect(report).toMatchObject({
        symbol: "NEW",
        asOf: AS_OF,
        status: "insufficient_data",
        code: null,
        score: null,
        consensus: null,
        coverage: null,
        confidence: null,
        factors: [],
        backtest: null,
      });
      expect(report.reason).toContain(`${n} of the ${MIN_BARS}`);
      expect(report.meta).toEqual({
        bars: n,
        droppedPartialBar: true,
        lastBarDate: n > 0 ? new Date(bars[n - 1].t).toISOString() : null,
      });
    }
  });

  it("builds a complete, internally consistent report", () => {
    const bars = randomWalk(400, 0.3, 71);
    const report = computeSignalReport({ symbol: "AAA", bars, fundamentals: GOOD_FUNDAMENTALS, asOf: AS_OF });
    expect(report.status).toBe("ok");
    expect(report.reason).toBeUndefined();
    expect(report.factors.map((f) => f.key)).toEqual(["momentum", "trend", "rsi", "volume", "value", "quality", "volatility"]);
    expect(report.factors.filter((f) => f.group === "fundamental").map((f) => f.key)).toEqual(["value", "quality"]);
    expect(report.factors.reduce((sum, f) => sum + f.weight, 0)).toBeCloseTo(1, 12);
    expect(report.factors.map((f) => f.rawUnit)).toEqual(["percent", "percent", "number", "multiple", "multiple", "percent", "percent"]);
    const composite = report.factors.reduce((sum, f) => sum + f.weight * f.score, 0);
    expect(Math.abs((report.score ?? Number.NaN) - composite)).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(report.code).toBe(labelForScore(report.score ?? Number.NaN));
    expect(report.coverage).toBe(100);
    expect(report.consensus).toBe(expectedConsensus(report));
    expect(report.confidence).toBe(expectedConfidence(report));
    expect(report.backtest?.results.map((r) => r.holdDays)).toEqual([3, 5, 10]);
    expect(report.meta).toEqual({ bars: 400, droppedPartialBar: false, lastBarDate: new Date(bars[399].t).toISOString() });
    expect(nonFinitePaths(report)).toEqual([]);
  });

  it("is deterministic", () => {
    const input = { symbol: "AAA", bars: randomWalk(380, 0.3, 72), fundamentals: GOOD_FUNDAMENTALS, asOf: AS_OF };
    expect(computeSignalReport(input)).toEqual(computeSignalReport(input));
  });

  it("derives consensus and confidence from the informative factors only", () => {
    for (const [seed, fundamentals] of [
      [73, GOOD_FUNDAMENTALS],
      [74, POOR_FUNDAMENTALS],
      [75, NO_FUNDAMENTALS],
      [76, GOOD_FUNDAMENTALS],
    ] as const) {
      const report = computeSignalReport({ symbol: "X", bars: randomWalk(400, 0.4, seed), fundamentals, asOf: AS_OF });
      expect(report.consensus).toBe(expectedConsensus(report));
      expect(report.confidence).toBe(expectedConfidence(report));
    }
  });

  it("is confident when trend, momentum and fundamentals line up", () => {
    const bull = computeSignalReport({ symbol: "UP", bars: barsFromCloses(steadyPath(400, 0.002)), fundamentals: GOOD_FUNDAMENTALS, asOf: AS_OF });
    expect(bull.code === "bullish" || bull.code === "strong_bullish").toBe(true);
    expect(bull.confidence).toBe("high");
    const bear = computeSignalReport({ symbol: "DOWN", bars: barsFromCloses(steadyPath(400, -0.002)), fundamentals: POOR_FUNDAMENTALS, asOf: AS_OF });
    expect(bear.code === "bearish" || bear.code === "strong_bearish").toBe(true);
    expect(bear.confidence).toBe("high");
  });

  it("has no consensus and low confidence when every factor is neutral", () => {
    const report = computeSignalReport({ symbol: "FLAT", bars: barsFromCloses(Array<number>(300).fill(20)), fundamentals: NO_FUNDAMENTALS, asOf: AS_OF });
    expect(report).toMatchObject({ status: "ok", code: "neutral", score: 50, consensus: null, confidence: "low" });
  });

  it("lowers coverage for missing inputs and short histories", () => {
    const bars = randomWalk(400, 0.3, 77);
    const etf = computeSignalReport({ symbol: "ETF", bars, fundamentals: NO_FUNDAMENTALS, asOf: AS_OF });
    expect(etf.coverage).toBe(70);
    expect(etf.factors.filter((f) => f.imputed).map((f) => f.key)).toEqual(["value", "quality"]);
    expect(etf.confidence).not.toBe("high");

    const fx = computeSignalReport({ symbol: "FX", bars: bars.map((b) => ({ ...b, v: null })), fundamentals: NO_FUNDAMENTALS, asOf: AS_OF });
    expect(fx.coverage).toBe(60);

    // 150 bars give 130 rolling volatility values of the 250 the regime percentile wants.
    const young = computeSignalReport({ symbol: "IPO", bars: bars.slice(0, 150), fundamentals: GOOD_FUNDAMENTALS, asOf: AS_OF });
    expect(young.coverage).toBe(Math.round(100 * (1 - FACTOR_WEIGHTS.volatility * (1 - 130 / 250))));
  });
});

// ---------------------------------------------------------------------------
// Look-ahead
// ---------------------------------------------------------------------------

describe("no look-ahead", () => {
  it("never changes a technical score when later bars change", () => {
    const bars = randomWalk(420, 0.35, 81);
    const cut = 260;
    const rand = mulberry32(82);
    const perturbed = bars.map((bar, i) => {
      if (i <= cut) return bar;
      const k = Math.exp(0.2 * gaussian(rand));
      return { ...bar, o: bar.o * k, h: bar.h * k, l: bar.l * k, c: bar.c * k, adjClose: bar.adjClose * k, v: (bar.v ?? 0) * 3 };
    });
    const original = technicalScoreSeries(bars);
    const changed = technicalScoreSeries(perturbed);
    expect(changed.slice(0, cut + 1)).toEqual(original.slice(0, cut + 1));
    expect(changed.slice(cut + 1).some((entry, k) => entry.score !== original[cut + 1 + k].score)).toBe(true);
  });

  it("computes the live factors of a past session exactly as the series does", () => {
    const bars = randomWalk(400, 0.3, 83);
    const series = technicalScoreSeries(bars);
    for (const i of [150, 275, 399]) {
      const report = computeSignalReport({ symbol: "X", bars: bars.slice(0, i + 1), fundamentals: NO_FUNDAMENTALS, asOf: AS_OF });
      const technical = report.factors.filter((f) => f.group === "technical");
      const weight = technical.reduce((sum, f) => sum + f.weight, 0);
      const score = technical.reduce((sum, f) => sum + f.weight * f.score, 0) / weight;
      expect(Math.abs(score - (series[i].score ?? Number.NaN))).toBeLessThan(0.15);
    }
  });
});

// ---------------------------------------------------------------------------
// Backtest
// ---------------------------------------------------------------------------

describe("runBacktest", () => {
  // Signals need MIN_BARS of history and complete forward data for the longest hold, so the window holds n - 129
  // sessions (at most 250) and at least minWindow sessions are required.
  const maxHold = Math.max(...BACKTEST_SETTINGS.holdPeriods);
  const windowFor = (n: number) => Math.min(BACKTEST_SETTINGS.maxWindow, n - maxHold - MIN_BARS + 1);

  it("needs a minimum window", () => {
    const shortest = MIN_BARS + maxHold + BACKTEST_SETTINGS.minWindow - 1;
    expect(runBacktest(randomWalk(shortest - 1, 0.3, 90))).toBeNull();
    expect(runBacktest(randomWalk(shortest, 0.3, 90))?.results[0].windowDays).toBe(BACKTEST_SETTINGS.minWindow);
  });

  it("keeps its statistics consistent", () => {
    let totalTrades = 0;
    for (const [seed, vol, n] of [
      [91, 0.2, 400],
      [92, 0.4, 400],
      [93, 0.6, 300],
      [94, 0.3, 600],
    ] as const) {
      const backtest = runBacktest(randomWalk(n, vol, seed));
      expect(backtest).not.toBeNull();
      if (!backtest) continue;
      expect(backtest).toMatchObject({ technicalOnly: true, costBps: BACKTEST_SETTINGS.costBps });
      expect(backtest.results.map((r) => r.holdDays)).toEqual([...BACKTEST_SETTINGS.holdPeriods]);
      for (const r of backtest.results) {
        totalTrades += r.trades;
        expect(r.windowDays).toBe(windowFor(n));
        expect(r.trades).toBeLessThanOrEqual(Math.ceil(r.windowDays / r.holdDays));
        expect(r.lowSample).toBe(r.trades < BACKTEST_SETTINGS.minTrades);
        expect(r.bearishSignals).toBeLessThanOrEqual(r.windowDays);
        expect(r.baselineWinRate).not.toBeNull();
        if (r.trades === 0) {
          expect(r).toMatchObject({ winRate: null, winRateCI: null, avgReturn: null, edge: null, sharpe: null, maxDrawdown: null });
          continue;
        }
        const winRate = r.winRate ?? Number.NaN;
        const [low, high] = r.winRateCI ?? [Number.NaN, Number.NaN];
        expect(low).toBeLessThanOrEqual(winRate);
        expect(high).toBeGreaterThanOrEqual(winRate);
        // The edge is the difference of the reported averages, exactly.
        expect(r.edge).toBeCloseTo((r.avgReturn ?? Number.NaN) - (r.baselineAvgReturn ?? Number.NaN), 12);
        expect(r.maxDrawdown).toBeLessThanOrEqual(0);
        if (r.bearishSignals > 0) {
          expect(r.bearishHitRate).toBeGreaterThanOrEqual(0);
          expect(r.bearishHitRate).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(totalTrades).toBeGreaterThan(0);
  });

  /** Asserts that `actual` is `exact` rounded to `decimals` places. */
  function expectRounded(actual: number | null, exact: number, decimals: number): void {
    expect(actual).not.toBeNull();
    expect(Math.abs((actual ?? Number.NaN) - exact)).toBeLessThanOrEqual(0.5 * 10 ** -decimals + 1e-12);
  }

  /**
   * Independent re-statement of the documented backtest (docs/signal-model.md, section 6) on top of the public
   * technical score series: entry at the next adjusted open, exit at the adjusted close of signal + hold, no
   * overlapping trades, 10 bps per round trip, and the drawdown of an explicit daily equity curve. Expects clean bars
   * in ascending order.
   */
  function referenceBacktest(bars: readonly DailyBar[], hold: number) {
    const open = bars.map((b) => b.o * (b.adjClose / b.c));
    const close = bars.map((b) => b.adjClose);
    const labels = technicalScoreSeries(bars).map(({ score }) => (score === null ? "none" : labelForScore(score)));
    const last = bars.length - 1 - maxHold;
    const first = Math.max(MIN_BARS - 1, last - BACKTEST_SETTINGS.maxWindow + 1);
    const forward = (i: number) => close[i + hold] / open[i + 1] - 1 - COST;

    const signals: number[] = [];
    const baseline: number[] = [];
    const bearish: number[] = [];
    for (let i = first; i <= last; i++) {
      baseline.push(forward(i));
      if (labels[i].endsWith("bearish")) bearish.push(forward(i));
      const flat = signals.length === 0 || i >= signals[signals.length - 1] + hold;
      if (labels[i].endsWith("bullish") && flat) signals.push(i);
    }
    const returns = signals.map(forward);

    // Equity at the close of session d: completed trades compounded, times the open trade marked to market.
    const equityAt = (d: number) =>
      signals.reduce((value, s) => {
        if (s + hold < d) return value * (1 + forward(s));
        if (s < d) return value * (close[d] / open[s + 1] - COST);
        return value;
      }, 1);
    let peak = 1;
    let maxDrawdown = 0;
    for (let d = first + 1; d <= last + hold; d++) {
      const equity = equityAt(d);
      peak = Math.max(peak, equity);
      maxDrawdown = Math.min(maxDrawdown, equity / peak - 1);
    }

    const avg = (xs: readonly number[]) => xs.reduce((sum, x) => sum + x, 0) / xs.length;
    const share = (xs: readonly number[], keep: (x: number) => boolean) => xs.filter(keep).length / xs.length;
    const sd = Math.sqrt(returns.reduce((sum, r) => sum + (r - avg(returns)) ** 2, 0) / (returns.length - 1));
    return {
      windowDays: last - first + 1,
      trades: returns.length,
      winRate: share(returns, (r) => r > 0),
      avgReturn: avg(returns),
      baselineWinRate: share(baseline, (r) => r > 0),
      baselineAvgReturn: avg(baseline),
      sharpe: (avg(returns) / sd) * Math.sqrt((returns.length * 252) / (last - first + 1)),
      maxDrawdown,
      bearishSignals: bearish.length,
      bearishHitRate: share(bearish, (r) => r < 0),
      bearishAvgForwardReturn: avg(bearish),
    };
  }

  it("matches an independent re-statement of the documented rules", () => {
    const totals = { trades: 0, bearishSignals: 0, drawdowns: 0 };
    for (const [seed, vol, n] of [
      [101, 0.25, 420],
      [102, 0.45, 400],
      [103, 0.7, 380],
      [104, 0.35, 450],
    ] as const) {
      // Raw prices carry a 3:1 split and a 2% dividend inside the window; only adjusted prices give the right returns.
      const bars = randomWalk(n, vol, seed).map((bar, i) => {
        const k = (i < 150 ? 3 : 1) * (i < 300 ? 1.02 : 1);
        return { ...bar, o: bar.o * k, h: bar.h * k, l: bar.l * k, c: bar.c * k, adjClose: bar.c };
      });
      const results = runBacktest(bars)?.results ?? [];
      expect(results.map((r) => r.holdDays)).toEqual([...BACKTEST_SETTINGS.holdPeriods]);
      for (const r of results) {
        const expected = referenceBacktest(bars, r.holdDays);
        expect(r.windowDays).toBe(expected.windowDays);
        expect(r.trades).toBe(expected.trades);
        expect(r.bearishSignals).toBe(expected.bearishSignals);
        expectRounded(r.baselineWinRate, expected.baselineWinRate, 4);
        expectRounded(r.baselineAvgReturn, expected.baselineAvgReturn, 5);
        if (expected.trades > 0) {
          expectRounded(r.winRate, expected.winRate, 4);
          expectRounded(r.avgReturn, expected.avgReturn, 5);
          expectRounded(r.maxDrawdown, expected.maxDrawdown, 4);
        }
        if (expected.trades > 1) expectRounded(r.sharpe, expected.sharpe, 2);
        if (expected.bearishSignals > 0) {
          expectRounded(r.bearishHitRate, expected.bearishHitRate, 4);
          expectRounded(r.bearishAvgForwardReturn, expected.bearishAvgForwardReturn, 5);
        }
        totals.trades += r.trades;
        totals.bearishSignals += r.bearishSignals;
        if ((r.maxDrawdown ?? 0) < 0) totals.drawdowns += 1;
      }
    }
    expect(totals.trades).toBeGreaterThan(40);
    expect(totals.bearishSignals).toBeGreaterThan(100);
    expect(totals.drawdowns).toBeGreaterThan(3);
  });

  it("trades every bullish session it can in a steady uptrend", () => {
    const daily = 0.002;
    const backtest = runBacktest(barsFromCloses(steadyPath(400, daily)));
    expect(backtest?.results).toHaveLength(3);
    for (const r of backtest?.results ?? []) {
      const expected = Math.exp(daily * r.holdDays) - 1 - COST;
      expect(r.windowDays).toBe(windowFor(400));
      expect(r.trades).toBe(Math.ceil(r.windowDays / r.holdDays));
      expect(r.winRate).toBe(1);
      expect(r.avgReturn).toBeCloseTo(expected, 5);
      expect(r.baselineAvgReturn).toBeCloseTo(expected, 5);
      expect(r.edge).toBe(0);
      expect(r.sharpe).toBeNull(); // identical returns have no dispersion
      expect(r.maxDrawdown).toBe(0);
      expect(r.bearishSignals).toBe(0);
      expect(r.bearishHitRate).toBeNull();
    }
  });

  it("enters at the next session's open and marks drawdowns to market daily", () => {
    // Every session opens 1% above the previous close and then drifts back, so buying the next open loses the gap.
    const daily = 0.002;
    const closes = steadyPath(400, daily);
    const bars = barsFromCloses(closes).map((bar, i) => (i === 0 ? bar : { ...bar, o: closes[i - 1] * 1.01 }));
    for (const r of runBacktest(bars)?.results ?? []) {
      expect(r.avgReturn).toBeCloseTo(Math.exp(daily * r.holdDays) / 1.01 - 1 - COST, 5);
      if (r.holdDays === 10) {
        // Winning trades: the worst mark is the first close of each trade, relative to the equity at entry.
        expect(r.winRate).toBe(1);
        expect(r.maxDrawdown).toBeCloseTo(Math.exp(daily) / 1.01 - COST - 1, 4);
      } else {
        expect(r.winRate).toBe(0);
      }
    }
  });

  it("opens no trades and counts every session as bearish in a steady downtrend", () => {
    const daily = -0.002;
    for (const r of runBacktest(barsFromCloses(steadyPath(400, daily)))?.results ?? []) {
      expect(r).toMatchObject({
        trades: 0,
        winRate: null,
        winRateCI: null,
        avgReturn: null,
        edge: null,
        sharpe: null,
        maxDrawdown: null,
        lowSample: true,
        baselineWinRate: 0,
      });
      expect(r.bearishSignals).toBe(r.windowDays);
      expect(r.bearishHitRate).toBe(1);
      expect(r.bearishAvgForwardReturn).toBeCloseTo(Math.exp(daily * r.holdDays) - 1 - COST, 5);
    }
  });
});
