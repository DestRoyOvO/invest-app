import { describe, expect, it } from "vitest";

import type { DailyBar } from "@/lib/bars";

import config from "../scripts/evaluation.config.json";
import {
  benchmarkGap,
  cleanDailyBars,
  countEpisodes,
  cutBars,
  decomposeLabel,
  dropFormingBar,
  evaluateSignalModel,
  evaluationVerdict,
  excludesZero,
  findHorizon,
  findLabel,
  forwardReturn,
  IC_T_RELIABLE,
  LABEL_CODES,
  summarizeIc,
  type EvaluationConfig,
  type EvaluationInput,
} from "./evaluation";
import { EVALUATION_DAYS, SIGNAL_EVALUATION } from "./evaluation-data";
import { mulberry32 } from "./research-stats";
import { FACTOR_WEIGHTS, MODEL_VERSION, SIGNAL_THRESHOLDS, TECHNICAL_FACTORS } from "./signal";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** Weekday session dates from a start date. */
function sessions(n: number, start = Date.UTC(2019, 0, 1)): number[] {
  const out: number[] = [];
  for (let t = start; out.length < n; t += DAY_MS) {
    const day = new Date(t).getUTCDay();
    if (day !== 0 && day !== 6) out.push(t);
  }
  return out;
}

function gaussian(random: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(random(), 1e-12))) * Math.cos(2 * Math.PI * random());
}

/** A random walk sharing a market factor, with trending stretches so every reading occurs. */
function walk(dates: readonly number[], seed: number, market: readonly number[]): DailyBar[] {
  const random = mulberry32(seed);
  const vol = 0.01 + 0.02 * random();
  const beta = 0.5 + random();
  let price = 50 + 100 * random();
  let drift = 0;
  return dates.map((t, i) => {
    if (i % 60 === 0) drift = 0.004 * gaussian(random);
    const open = price * Math.exp(0.002 * gaussian(random));
    price = open * Math.exp(drift + beta * market[i] + vol * gaussian(random));
    const c = price;
    return { t, o: open, h: Math.max(open, c), l: Math.min(open, c), c, adjClose: c * 0.98, v: Math.round(1e6 * Math.exp(0.3 * gaussian(random))) };
  });
}

const DATES = sessions(700);
const MARKET_RETURNS = (() => {
  const random = mulberry32(99);
  return DATES.map(() => 0.0004 + 0.01 * gaussian(random));
})();

function indexBars(returns: readonly number[]): DailyBar[] {
  let price = 100;
  return DATES.map((t, i) => {
    const o = price;
    price *= Math.exp(returns[i]);
    return { t, o, h: Math.max(o, price), l: Math.min(o, price), c: price, adjClose: price, v: 1e6 };
  });
}

const FIXTURE_CONFIG: EvaluationConfig = {
  main: { from: "2020-01-01", to: "2021-06-30" },
  holdout: { from: "2019-07-01", to: "2020-06-30" },
  horizons: [5, 10],
  minStocksPerDate: 20,
  episodeGapSessions: 10,
  bootstrap: { blockLength: 20, reps: 200, seed: 7 },
  holdoutTest: { horizon: 10, alpha: 0.05 },
  subperiods: [
    { from: "2020-01-01", to: "2020-12-31" },
    { from: "2021-01-01", to: "2021-12-31" },
  ],
};

function fixtureInput(): EvaluationInput {
  const bars: Record<string, DailyBar[]> = {};
  for (let k = 0; k < 24; k++) bars[`S${String(k).padStart(2, "0")}`] = walk(DATES, 1000 + k, MARKET_RETURNS);
  return {
    config: FIXTURE_CONFIG,
    bars,
    market: { symbol: "SPY", bars: indexBars(MARKET_RETURNS) },
    equalWeight: { symbol: "RSP", bars: indexBars(MARKET_RETURNS.map((r) => r * 0.9)) },
  };
}

// ---------------------------------------------------------------------------
// Verdict helpers
// ---------------------------------------------------------------------------

describe("evaluationVerdict", () => {
  it("needs a Newey-West |t| >= 2 with a matching sign", () => {
    expect(evaluationVerdict({ ic: { mean: 0.05, t: 2.4 } })).toBe("predictive");
    expect(evaluationVerdict({ ic: { mean: -0.05, t: -2.1 } })).toBe("inverse");
    expect(evaluationVerdict({ ic: { mean: -0.044, t: -1.69 } })).toBe("none");
    expect(evaluationVerdict({ ic: { mean: 0.03, t: IC_T_RELIABLE - 0.01 } })).toBe("none");
    expect(evaluationVerdict({ ic: { mean: null, t: null } })).toBe("none");
    expect(evaluationVerdict({ ic: { mean: 0.01, t: Number.NaN } })).toBe("none");
  });

  it("tells whether an interval excludes zero", () => {
    expect(excludesZero([0.001, 0.02])).toBe(true);
    expect(excludesZero([-0.02, -0.001])).toBe(true);
    expect(excludesZero([-0.01, 0.02])).toBe(false);
    expect(excludesZero(null)).toBe(false);
  });
});

describe("summarizeIc", () => {
  it("reports the Newey-West t and the spread over grid phases", () => {
    const random = mulberry32(3);
    const ics = Array.from({ length: 400 }, () => 0.01 + 0.1 * gaussian(random));
    const summary = summarizeIc(ics, 5);
    expect(summary.dates).toBe(400);
    expect(summary.mean).toBeCloseTo(ics.reduce((a, b) => a + b, 0) / 400, 12);
    expect(summary.phaseT?.[0]).toBeLessThanOrEqual(summary.phaseT?.[1] ?? -Infinity);
    expect(summary.t).not.toBeNull();
    expect(summary.t2).not.toBeNull();
  });

  it("flags a verdict that depends on the grid phase", () => {
    // Every fifth date carries a strong positive IC: one grid sees an edge, the others see nothing.
    const ics = Array.from({ length: 300 }, (_, i) => (i % 5 === 0 ? 0.3 + 0.01 * Math.sin(i) : 0.02 * Math.sin(i * 7)));
    const summary = summarizeIc(ics, 5);
    expect(summary.fragile).toBe(true);
    expect(summary.phaseT?.[1]).toBeGreaterThan(IC_T_RELIABLE);
    const steady = summarizeIc(
      ics.map((_, i) => 0.02 * Math.sin(i * 7)),
      5,
    );
    expect(steady.fragile).toBe(false);
  });
});

describe("decomposeLabel", () => {
  it("splits the excess return exactly into timing and selection", () => {
    const random = mulberry32(11);
    for (let trial = 0; trial < 20; trial++) {
      const observations = Array.from({ length: 50 }, () => {
        const dayMean = 0.01 * gaussian(random);
        return { r: dayMean + 0.02 * gaussian(random), dayMean, dayMedian: dayMean + 0.001 * gaussian(random) };
      });
      const base = 0.003 * gaussian(random);
      const parts = decomposeLabel(observations, base);
      expect((parts.timing ?? 0) + (parts.selection ?? 0)).toBeCloseTo(parts.excess ?? Number.NaN, 12);
      expect(parts.excess).toBeCloseTo((parts.mean ?? 0) - base, 12);
    }
  });

  it("counts up and beat-median shares", () => {
    const parts = decomposeLabel(
      [
        { r: 0.02, dayMean: 0.01, dayMedian: 0.015 },
        { r: -0.01, dayMean: -0.02, dayMedian: -0.015 },
        { r: 0.005, dayMean: 0.01, dayMedian: 0.01 },
      ],
      0.001,
    );
    expect(parts.hitRate).toBeCloseTo(2 / 3, 12);
    expect(parts.beatMedian).toBeCloseTo(2 / 3, 12);
    expect(parts.selection).toBeCloseTo((0.01 + 0.01 - 0.005) / 3, 12);
    expect(decomposeLabel([], 0.001)).toMatchObject({ n: 0, mean: null, excess: null, selection: null });
  });
});

describe("countEpisodes", () => {
  it("starts a new episode after a gap of more than the limit", () => {
    expect(countEpisodes([0, 3, 13, 30, 31], [5, 1, 2, 10, 2], 10)).toEqual({ episodes: 2, largestShare: 12 / 20 });
    expect(countEpisodes([0, 11], [1, 1], 10)).toEqual({ episodes: 2, largestShare: 0.5 });
    expect(countEpisodes([], [], 10)).toEqual({ episodes: 0, largestShare: null });
  });
});

// ---------------------------------------------------------------------------
// Bars
// ---------------------------------------------------------------------------

describe("bar handling", () => {
  const bars: DailyBar[] = sessions(5).map((t, i) => ({ t, o: 10 + i, h: 11 + i, l: 9 + i, c: 10 + i, adjClose: 5 + i / 2, v: 100 }));

  it("cleans, orders and cuts bars at the window end", () => {
    const messy = [bars[3], bars[0], { ...bars[1], c: Number.NaN }, bars[1], bars[2], { ...bars[2], c: 99 }, bars[4]];
    const clean = cleanDailyBars(messy);
    expect(clean.map((b) => b.t)).toEqual(bars.map((b) => b.t));
    expect(clean[2].c).toBe(99); // the last row of a repeated session wins
    expect(cutBars(bars, new Date(bars[2].t).toISOString().slice(0, 10))).toEqual(bars.slice(0, 3));
  });

  it("buys the next adjusted open and sells the adjusted close h sessions later", () => {
    // Adjusted prices are half the raw ones here, so the open is scaled by adjClose / close.
    const entryOpen = bars[1].o * (bars[1].adjClose / bars[1].c);
    expect(forwardReturn(bars, 0, 3)).toBeCloseTo(bars[3].adjClose / entryOpen - 1, 12);
    expect(forwardReturn(bars, 2, 3)).toBeNull();
    expect(forwardReturn([bars[0], { ...bars[1], o: 0 }, bars[2]], 0, 2)).toBeNull();
  });

  it("drops a bar still forming when it was downloaded", () => {
    const last = bars[bars.length - 1];
    const day = new Date(last.t).toISOString().slice(0, 10);
    // 15:00 in New York (UTC-4 in summer, UTC-5 in winter) is during the session either way.
    expect(dropFormingBar(bars, `${day}T19:30:00Z`)).toEqual(bars.slice(0, -1));
    // After the close the bar is final.
    expect(dropFormingBar(bars, `${day}T22:30:00Z`)).toEqual(bars);
    // The next morning before the open there is no bar for the new day yet.
    expect(dropFormingBar(bars, new Date(last.t + DAY_MS + 12 * 3_600_000).toISOString())).toEqual(bars);
    expect(dropFormingBar([], `${day}T19:30:00Z`)).toEqual([]);
  });
});

describe("benchmarkGap", () => {
  it("annualizes the daily-rebalanced universe and the benchmarks on the market's sessions", () => {
    const dates = sessions(253);
    const series = (daily: number) => dates.map((t, i) => ({ t, o: 1, h: 1, l: 1, c: (1 + daily) ** i, adjClose: (1 + daily) ** i, v: 1 }));
    const gap = benchmarkGap([series(0.001), series(0.003)], series(0.002), series(0.0005), {
      from: new Date(dates[0]).toISOString().slice(0, 10),
      to: new Date(dates[252]).toISOString().slice(0, 10),
    });
    expect(gap.sessions).toBe(253);
    expect(gap.market).toBeCloseTo(1.002 ** 252 - 1, 10);
    expect(gap.equalWeight).toBeCloseTo(1.0005 ** 252 - 1, 10);
    expect(gap.universe).toBeCloseTo(1.002 ** 252 - 1, 10); // the mean of 0.1% and 0.3% each day
  });
});

// ---------------------------------------------------------------------------
// The evaluation core
// ---------------------------------------------------------------------------

describe("evaluateSignalModel", () => {
  const input = fixtureInput();
  const result = evaluateSignalModel(input);

  it("is reproducible: the same bars and config give identical JSON", () => {
    expect(JSON.stringify(evaluateSignalModel(fixtureInput()))).toBe(JSON.stringify(result));
  });

  it("does not depend on the order, duplicates or future of the input bars", () => {
    const shuffled: Record<string, DailyBar[]> = {};
    for (const symbol of Object.keys(input.bars).reverse()) {
      const bars = input.bars[symbol];
      shuffled[symbol] = [...bars].reverse().concat(bars.slice(0, 3));
    }
    // Bars after the window end (here: a crash) must reach neither the signals nor the exit prices.
    const later = sessions(30, DATES[DATES.length - 1] + DAY_MS);
    for (const symbol of Object.keys(shuffled)) {
      const last = input.bars[symbol][input.bars[symbol].length - 1];
      shuffled[symbol].push(...later.map((t) => ({ ...last, t, o: last.c * 0.5, c: last.c * 0.5, adjClose: last.adjClose * 0.5 })));
    }
    const lastIncluded = new Date(DATES.filter((t) => t <= Date.parse("2021-06-30T00:00:00Z")).at(-1) as number).toISOString().slice(0, 10);
    const trimmed = evaluateSignalModel({ ...input, config: { ...FIXTURE_CONFIG, main: { ...FIXTURE_CONFIG.main, to: lastIncluded } } });
    const messy = evaluateSignalModel({ ...input, bars: shuffled, config: { ...FIXTURE_CONFIG, main: { ...FIXTURE_CONFIG.main, to: lastIncluded } } });
    expect(JSON.stringify(messy)).toBe(JSON.stringify(trimmed));
  });

  it("splits every reading's excess into timing and selection", () => {
    for (const horizon of result.horizons) {
      for (const label of horizon.labels) {
        if (label.n === 0) continue;
        expect((label.timing ?? 0) + (label.selection ?? 0)).toBeCloseTo(label.excess ?? Number.NaN, 12);
        expect(label.dates).toBeLessThanOrEqual(label.n);
        expect(label.episodes).toBeLessThanOrEqual(label.dates);
        for (const ci of [label.ci.excess, label.ci.selection, label.ci.hitRate]) {
          if (ci) expect(ci[0]).toBeLessThanOrEqual(ci[1]);
        }
      }
      expect(horizon.labels.map((l) => l.code)).toEqual(LABEL_CODES);
      expect(horizon.labels.reduce((sum, l) => sum + l.n, 0)).toBe(horizon.base.n);
    }
  });

  it("bases the verdict on the Newey-West t and covers the window and the holdout", () => {
    expect(result.period).toEqual(FIXTURE_CONFIG.main);
    expect(result.from >= FIXTURE_CONFIG.main.from && result.to <= FIXTURE_CONFIG.main.to).toBe(true);
    expect(result.universe).toBe(24);
    for (const horizon of result.horizons) {
      expect(horizon.ic.dates).toBeGreaterThan(200);
      expect(horizon.subperiods).toHaveLength(2);
      expect(evaluationVerdict(horizon)).toBe(evaluationVerdict({ ic: { mean: horizon.ic.mean, t: horizon.ic.t } }));
    }
    expect(result.holdout.factors.map((f) => f.key)).toEqual([...TECHNICAL_FACTORS]);
    expect(result.holdout.from >= FIXTURE_CONFIG.holdout.from && result.holdout.to <= FIXTURE_CONFIG.holdout.to).toBe(true);
    for (const factor of result.holdout.factors) {
      expect(factor.holmP).toBeGreaterThanOrEqual(factor.p ?? 0);
      expect(factor.pass).toBe((factor.holmP ?? 1) < FIXTURE_CONFIG.holdoutTest.alpha);
    }
    expect(result.holdout.composite.holmP).toBeNull();
    expect(result.holdout.horizons.map((h) => h.days)).toEqual(FIXTURE_CONFIG.horizons);
    expect(result.hindsight.main.sessions).toBeGreaterThan(300);
    expect(result.data.fingerprint.S00).toEqual([DATES.filter((t) => t <= Date.parse("2021-06-30T00:00:00Z")).length, "2021-06-30"]);
    expect(result.data.fingerprint.SPY?.[0]).toBeGreaterThan(0);
    expect(result.data.missing).toEqual([]);
  });

  it("lists symbols without bars as missing", () => {
    const sparse = evaluateSignalModel({ ...input, bars: { ...input.bars, NONE: [] } });
    expect(sparse.data.missing).toEqual(["NONE"]);
    expect(sparse.data.fingerprint.NONE).toEqual([0, null]);
    expect(sparse.universe).toBe(24);
  });
});

// ---------------------------------------------------------------------------
// The committed evaluation
// ---------------------------------------------------------------------------

describe("committed evaluation (lib/signal-evaluation.json)", () => {
  it("matches the current model settings; re-run npm run evaluate after changing the model", () => {
    expect(SIGNAL_EVALUATION.model.version).toBe(MODEL_VERSION);
    expect(SIGNAL_EVALUATION.model.thresholds).toEqual(SIGNAL_THRESHOLDS);
    // The JSON rounds to 5 decimals.
    for (const [key, weight] of Object.entries(FACTOR_WEIGHTS)) {
      expect(SIGNAL_EVALUATION.model.weights[key as keyof typeof FACTOR_WEIGHTS]).toBeCloseTo(weight, 5);
    }
  });

  it("uses the pinned window, the default horizon and every reading", () => {
    expect(SIGNAL_EVALUATION.period).toEqual(config.signal.main);
    expect(SIGNAL_EVALUATION.holdout.period).toEqual(config.signal.holdout);
    const horizon = findHorizon(SIGNAL_EVALUATION, EVALUATION_DAYS);
    if (!horizon) throw new Error("default horizon missing");
    for (const code of LABEL_CODES) expect(findLabel(horizon, code)?.n).toBeGreaterThan(0);
    expect(horizon.ic.dates).toBeGreaterThan(0);
    expect(SIGNAL_EVALUATION.universe).toBeGreaterThan(0);
    expect(SIGNAL_EVALUATION.from < SIGNAL_EVALUATION.to).toBe(true);
    expect(SIGNAL_EVALUATION.holdout.horizon).toBe(EVALUATION_DAYS);
  });
});

