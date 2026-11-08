import { describe, expect, it } from "vitest";

import type { FactorHorizonResult, FactorResearch, Interval } from "@/lib/evaluation";
import { FACTOR_WEIGHTS, labelForScore, TECHNICAL_FACTORS } from "@/lib/signal";

import factorResearchJson from "@/lib/factor-research.json";

import {
  backtestTiming,
  betaFlips,
  findResearch,
  isConcentrated,
  nearestHorizon,
  rateDomain,
  rawEvidence,
  readingWeights,
  researchTally,
  rsiState,
  scoreText,
  selectionTone,
  symmetricDomain,
} from "./evidence";

function result(days: number, ic: number | null, extra: Partial<FactorHorizonResult> = {}): FactorHorizonResult {
  return {
    days,
    dates: 100,
    ic,
    t: ic === null ? null : ic * 40,
    p: 0.5,
    holmP: 1,
    bhQ: 0.9,
    allDates: { ic, t: null, dates: 500 },
    subperiodIc: [ic, ic, ic],
    signs: [1, 1, 1],
    spread: null,
    spreadT: null,
    turnover: null,
    sectorNeutralIc: null,
    betaAdjustedIc: null,
    exWinnersIc: null,
    verdict: "not_predictive",
    ...extra,
  };
}

const RESEARCH: FactorResearch = {
  window: { from: "2016-01-01", to: "2026-11-06" },
  from: "2016-01-04",
  to: "2026-10-28",
  universe: 78,
  model: 4,
  rule: "rule",
  alpha: 0.05,
  horizons: [5, 21],
  subperiods: [],
  factors: [
    { key: "momentum", label: "12-1 momentum", direction: 1, results: [result(5, 0.001, { p: 0.9 }), result(21, 0.015, { p: 0.53 })] },
    {
      key: "volatility",
      label: "Low volatility",
      direction: -1,
      results: [result(5, -0.021, { p: 0.081, holmP: 0.9 }), result(21, -0.041, { p: 0.08, betaAdjustedIc: 0.006 })],
    },
    { key: "beta", label: "Low beta", direction: -1, results: [result(5, -0.027, { p: 0.063 }), result(21, -0.048, { betaAdjustedIc: 0.026, verdict: "predictive" })] },
  ],
  power: [],
  bias: { benchmarks: { market: "SPY", equalWeight: "RSP" }, universeVsBenchmarks: [], exWinners: [], technicalVsMonthReturn: null },
  dataHash: "00000000",
};

describe("scoreText", () => {
  it("rounds to a whole number unless that would cross a cut-off", () => {
    expect(scoreText(46.3)).toBe("46");
    expect(scoreText(58)).toBe("58");
    expect(scoreText(42)).toBe("42");
    expect(scoreText(27.6)).toBe("28");
    // 57.6 reads Neutral; "58" would sit on the Strong cut-off.
    expect(scoreText(57.6)).toBe("57.6");
    expect(scoreText(42.1)).toBe("42.1");
    expect(scoreText(71.6)).toBe("71.6");
    expect(scoreText(28.4)).toBe("28.4");
  });

  it("keeps the tenth on the score's side when it would land on a cut-off", () => {
    // ">=" cut-offs (Strong at 58, Very strong at 72): just below them, step down.
    expect(scoreText(57.96)).toBe("57.9");
    expect(scoreText(57.95)).toBe("57.9");
    expect(scoreText(57.99)).toBe("57.9");
    expect(scoreText(71.96)).toBe("71.9");
    // ">" cut-offs (Weak at 42 and below, Very weak at 28 and below): just above them, step up.
    expect(scoreText(42.04)).toBe("42.1");
    expect(scoreText(42.01)).toBe("42.1");
    expect(scoreText(28.03)).toBe("28.1");
    // Floating-point neighbours of a cut-off.
    expect(scoreText(57.99999999999999)).toBe("57.9");
    expect(scoreText(42.00000000000001)).toBe("42.1");
  });

  it("never prints a number that reads as a different reading", () => {
    for (const cut of [28, 42, 58, 72]) {
      for (let step = -100; step <= 100; step++) {
        const score = cut + step / 1000;
        expect(labelForScore(Number(scoreText(score))), `score ${score}`).toBe(labelForScore(score));
      }
    }
    for (let score = 0; score <= 100; score += 0.01) {
      expect(labelForScore(Number(scoreText(score))), `score ${score}`).toBe(labelForScore(score));
    }
  });
});

describe("rsiState", () => {
  it("names the conventional bounds and the five points next to them", () => {
    expect(rsiState(25)).toBe("oversold");
    expect(rsiState(30)).toBe("oversold");
    expect(rsiState(33)).toBe("nearOversold");
    expect(rsiState(35)).toBe("nearOversold");
    expect(rsiState(65)).toBe("nearOverbought");
    expect(rsiState(69.9)).toBe("nearOverbought");
    expect(rsiState(70)).toBe("overbought");
    expect(rsiState(84)).toBe("overbought");
  });

  it("says nothing in the middle of the range or without a value", () => {
    expect(rsiState(36)).toBeNull();
    expect(rsiState(50)).toBeNull();
    expect(rsiState(64.9)).toBeNull();
    expect(rsiState(null)).toBeNull();
  });
});

describe("readingWeights", () => {
  it("rescales the directional technical weights to sum to 1 and drops the risk factor", () => {
    const weights = readingWeights(FACTOR_WEIGHTS, TECHNICAL_FACTORS);
    expect(weights.map((w) => w.key)).toEqual(["momentum", "trend", "rsi", "volume"]);
    expect(weights.reduce((sum, w) => sum + w.share, 0)).toBeCloseTo(1, 10);
    expect(weights[0].share).toBeCloseTo(0.2 / 0.55, 10);
  });
});

describe("track record rows", () => {
  const TOTAL = 2718;

  it("greys a rare reading when one episode holds more than 30% of it", () => {
    expect(isConcentrated({ largestEpisodeShare: 0.5, dates: 400 }, TOTAL)).toBe(true);
    expect(isConcentrated({ largestEpisodeShare: 0.3, dates: 400 }, TOTAL)).toBe(false);
    expect(isConcentrated({ largestEpisodeShare: 0.105, dates: 410 }, TOTAL)).toBe(false);
    expect(isConcentrated({ largestEpisodeShare: null, dates: 400 }, TOTAL)).toBe(false);
  });

  it("does not treat the long runs of common readings as one market stretch", () => {
    // Neutral occurs on every date, so all of it is one run; Strong is seen on 98% of dates.
    expect(isConcentrated({ largestEpisodeShare: 1, dates: 2718 }, TOTAL)).toBe(false);
    expect(isConcentrated({ largestEpisodeShare: 0.57, dates: 2660 }, TOTAL)).toBe(false);
  });

  it("colors a reading only when its interval excludes zero and it is not concentrated", () => {
    const row = (selection: Interval | null, largestEpisodeShare = 0.1, dates = 400) => ({ ci: { excess: null, selection, hitRate: null }, largestEpisodeShare, dates });
    expect(selectionTone(row([0.0001, 0.002]), TOTAL)).toBe("up");
    expect(selectionTone(row([-0.003, -0.001]), TOTAL)).toBe("down");
    expect(selectionTone(row([-0.001, 0.002]), TOTAL)).toBe("neutral");
    expect(selectionTone(row(null), TOTAL)).toBe("neutral");
    expect(selectionTone(row([0.0001, 0.002], 0.5), TOTAL)).toBe("neutral");
  });

  it("finds a symmetric whisker domain that holds every interval", () => {
    const intervals: Interval[] = [
      [-0.00225, 0.00567],
      [-0.00122, 0.00097],
      [-0.00943, 0.00961],
    ];
    expect(symmetricDomain(intervals)).toEqual([-0.01, 0.01]);
    expect(symmetricDomain([[-0.005, 0.005]])).toEqual([-0.005, 0.005]);
    expect(symmetricDomain([null])).toEqual([-0.0025, 0.0025]);
  });

  it("finds a rate domain on a 5-point grid inside 0..1", () => {
    expect(rateDomain([0.54, 0.31, 0.75, 0.55])).toEqual([0.25, 0.8]);
    expect(rateDomain([0.98, 1])).toEqual([0.9, 1]);
    expect(rateDomain([null, undefined])).toEqual([0, 1]);
  });
});

describe("backtestTiming", () => {
  it("separates edges unlikely under random timing from the rest", () => {
    expect(backtestTiming({ pValue: 0.004, lowSample: false })).toBe("unlikely");
    expect(backtestTiming({ pValue: 0.01, lowSample: false })).toBe("random");
    expect(backtestTiming({ pValue: 0.42, lowSample: false })).toBe("random");
  });

  it("does not test small samples or reports without a p-value", () => {
    expect(backtestTiming({ pValue: 0.001, lowSample: true })).toBe("lowSample");
    expect(backtestTiming({ pValue: null, lowSample: false })).toBe("untested");
    expect(backtestTiming({ lowSample: false })).toBe("untested");
  });
});

describe("factor research", () => {
  it("finds a result with its literature direction", () => {
    const found = findResearch(RESEARCH, "volatility", 21);
    expect(found?.direction).toBe(-1);
    expect(found?.result.ic).toBe(-0.041);
    expect(findResearch(RESEARCH, "volatility", 63)).toBeNull();
    expect(findResearch(RESEARCH, "reversal", 21)).toBeNull();
  });

  it("turns the published statistics into the raw value's", () => {
    expect(rawEvidence({ ic: -0.04075, t: -1.76 }, -1)).toEqual({ ic: 0.04075, t: 1.76 });
    expect(rawEvidence({ ic: 0.015, t: 0.62 }, 1)).toEqual({ ic: 0.015, t: 0.62 });
    expect(Object.is(rawEvidence({ ic: 0, t: 0 }, -1).ic, 0)).toBe(true);
    expect(rawEvidence({ ic: null, t: null }, -1)).toEqual({ ic: null, t: null });
  });

  it("counts the tests that pass and the smallest p-values", () => {
    expect(researchTally(RESEARCH)).toEqual({ tests: 6, passed: 1, minP: 0.063, minHolmP: 0.9 });
  });

  it("lists the factors that flip sign once returns are net of beta", () => {
    expect(betaFlips(RESEARCH, 21)).toEqual(["volatility", "beta"]);
    expect(betaFlips(RESEARCH, 5)).toEqual([]);
  });

  it("picks the nearest horizon", () => {
    expect(nearestHorizon([5, 21, 63], 21)).toBe(21);
    expect(nearestHorizon([5, 21, 63], 30)).toBe(21);
    expect(nearestHorizon([], 21)).toBeNull();
  });

  it("reads the committed research file: every factor at every horizon, none adopted", () => {
    const committed = factorResearchJson as unknown as FactorResearch;
    const tally = researchTally(committed);
    expect(tally.tests).toBe(committed.factors.length * committed.horizons.length);
    expect(tally.passed).toBe(committed.factors.flatMap((f) => f.results).filter((r) => r.verdict === "predictive").length);
    expect(nearestHorizon(committed.horizons, 21)).toBe(21);
  });
});
