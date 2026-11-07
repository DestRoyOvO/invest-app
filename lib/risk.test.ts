import { describe, expect, it } from "vitest";

import {
  annualizedReturn,
  annualizedVolatility,
  beta,
  correlation,
  covarianceMatrix,
  dailyReturns,
  drawdownSeries,
  effectivePositions,
  historicalVar,
  holdingsValueSeries,
  maxDrawdown,
  pairedReturns,
  periodReturn,
  portfolioVolatility,
  rebase,
  riskContributions,
  sharpeRatio,
  TRADING_DAYS,
} from "./risk";

/** Deterministic, irregular daily returns around zero. */
function noise(n: number, seed = 1): number[] {
  return Array.from({ length: n }, (_, i) => Math.sin((i + 1) * 12.9898 * seed) * 0.02);
}

/** +1, -1, +1, -1 ... and +1, +1, -1, -1 ... scaled to 1%: exactly uncorrelated over multiples of four sessions. */
const ALTERNATING = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.01));
const PAIRED = Array.from({ length: 40 }, (_, i) => (i % 4 < 2 ? 0.01 : -0.01));

describe("dailyReturns", () => {
  it("returns null at the start, across gaps and around non-positive prices", () => {
    const returns = dailyReturns([100, 110, null, 121, 0, 50]);
    expect(returns[0]).toBeNull();
    expect(returns[1]).toBeCloseTo(0.1);
    expect(returns.slice(2)).toEqual([null, null, null, null]);
  });

  it("keeps the input length", () => {
    expect(dailyReturns([])).toEqual([]);
    expect(dailyReturns([5])).toEqual([null]);
  });
});

describe("pairedReturns", () => {
  it("keeps only sessions both series have", () => {
    expect(pairedReturns([0.1, null, 0.3, 0.4], [0.2, 0.5, null, 0.1])).toEqual([
      [0.1, 0.4],
      [0.2, 0.1],
    ]);
  });
});

describe("volatility, correlation and beta", () => {
  it("annualizes the sample standard deviation and needs enough returns", () => {
    expect(annualizedVolatility(ALTERNATING)).toBeCloseTo(0.01 * Math.sqrt(40 / 39) * Math.sqrt(TRADING_DAYS), 10);
    expect(annualizedVolatility(ALTERNATING.slice(0, 19))).toBeNull();
    expect(annualizedVolatility([...ALTERNATING.slice(0, 19), null, null])).toBeNull();
  });

  it("measures a levered copy as beta 2 and correlation 1", () => {
    const market = noise(60);
    const asset = market.map((r) => 2 * r + 0.001);
    expect(beta(asset, market)).toBeCloseTo(2, 10);
    expect(correlation(asset, market)).toBeCloseTo(1, 10);
  });

  it("measures an inverse copy as beta -1 and correlation -1, ignoring unmatched sessions", () => {
    const market: Array<number | null> = noise(60);
    const asset: Array<number | null> = market.map((r) => (r === null ? null : -r));
    asset[5] = null;
    market[9] = null;
    expect(beta(asset, market)).toBeCloseTo(-1, 10);
    expect(correlation(asset, market)).toBeCloseTo(-1, 10);
  });

  it("returns null for a flat benchmark or too little overlap", () => {
    const flat = Array.from({ length: 40 }, () => 0);
    expect(beta(noise(40), flat)).toBeNull();
    expect(correlation(noise(40), flat)).toBeNull();
    expect(beta(noise(10), noise(10, 2))).toBeNull();
  });
});

describe("sharpeRatio and historicalVar", () => {
  it("annualizes mean over standard deviation", () => {
    const returns = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 0.02 : 0));
    const sd = 0.01 * Math.sqrt(40 / 39);
    expect(sharpeRatio(returns)).toBeCloseTo((0.01 / sd) * Math.sqrt(TRADING_DAYS), 10);
    expect(sharpeRatio(returns, 0.0252)).toBeCloseTo(((0.01 - 0.0001) / sd) * Math.sqrt(TRADING_DAYS), 10);
  });

  it("is null for constant returns", () => {
    expect(sharpeRatio(Array.from({ length: 30 }, () => 0.001))).toBeNull();
  });

  it("reads the loss quantile with interpolation", () => {
    const returns = Array.from({ length: 21 }, (_, i) => (i - 10) / 100);
    expect(historicalVar(returns, 0.95)).toBeCloseTo(-0.09, 10);
    expect(historicalVar(returns, 0.9)).toBeCloseTo(-0.08, 10);
    expect(historicalVar(returns.slice(0, 10))).toBeNull();
    expect(historicalVar(returns, 1)).toBeNull();
  });
});

describe("returns of a value series", () => {
  it("computes the period return and the compound annual rate", () => {
    const values = Array.from({ length: 253 }, (_, i) => 100 * 1.01 ** i);
    expect(periodReturn(values)).toBeCloseTo(1.01 ** 252 - 1, 8);
    expect(annualizedReturn(values)).toBeCloseTo(1.01 ** 252 - 1, 8);
    expect(annualizedReturn([null, ...values.slice(0, 127)])).toBeCloseTo(1.01 ** 252 - 1, 8);
  });

  it("needs at least two prices, and enough sessions to annualize", () => {
    expect(periodReturn([null, 100])).toBeNull();
    expect(annualizedReturn([100, 110, 120])).toBeNull();
  });
});

describe("drawdowns", () => {
  it("finds the deepest decline and when it recovered", () => {
    expect(maxDrawdown([100, 120, 90, 130, 100])).toEqual({ depth: -0.25, peakIndex: 1, troughIndex: 2, recoveryIndex: 3 });
  });

  it("reports an unrecovered decline and skips nulls", () => {
    const drawdown = maxDrawdown([100, null, 80, null, 90]);
    expect(drawdown).toMatchObject({ peakIndex: 0, troughIndex: 2, recoveryIndex: null });
    expect(drawdown?.depth).toBeCloseTo(-0.2);
  });

  it("is zero for a rising series and null without prices", () => {
    expect(maxDrawdown([1, 2, 3])).toEqual({ depth: 0, peakIndex: 0, troughIndex: 0, recoveryIndex: null });
    expect(maxDrawdown([null, null])).toBeNull();
  });

  it("tracks the running decline", () => {
    expect(drawdownSeries([100, 120, null, 90, 130])).toEqual([0, 0, null, -0.25, 0]);
  });
});

describe("rebase", () => {
  it("starts at the base from the first price present", () => {
    expect(rebase([null, 50, 100, null])).toEqual([null, 100, 200, null]);
    expect(rebase([null, null])).toEqual([null, null]);
  });
});

describe("portfolio risk", () => {
  const cov = covarianceMatrix([ALTERNATING, PAIRED]);

  it("builds a symmetric pairwise covariance matrix", () => {
    const variance = 0.0001 * (40 / 39);
    expect(cov[0][0]).toBeCloseTo(variance, 12);
    expect(cov[1][1]).toBeCloseTo(variance, 12);
    expect(cov[0][1]).toBeCloseTo(0, 12);
    expect(cov[1][0]).toBeCloseTo(0, 12);
    expect(covarianceMatrix([ALTERNATING.slice(0, 5), PAIRED])[0][1]).toBeNull();
  });

  it("splits variance by weight for uncorrelated, equally volatile positions", () => {
    expect(riskContributions([0.5, 0.5], cov)?.map((c) => Number(c.toFixed(10)))).toEqual([0.5, 0.5]);
    const tilted = riskContributions([0.75, 0.25], cov);
    expect(tilted?.[0]).toBeCloseTo(0.9, 10);
    expect(tilted?.[1]).toBeCloseTo(0.1, 10);
  });

  it("refuses missing covariances and mismatched sizes", () => {
    expect(riskContributions([0.5, 0.5], [[1, null], [null, 1]])).toBeNull();
    expect(riskContributions([1], cov)).toBeNull();
    expect(portfolioVolatility([0.5, 0.5], [[0.0001, null], [null, 0.0001]])).toBeNull();
  });

  it("annualizes the portfolio volatility", () => {
    const variance = 0.0001 * (40 / 39);
    expect(portfolioVolatility([0.5, 0.5], cov)).toBeCloseTo(Math.sqrt(0.5 * variance * TRADING_DAYS), 10);
  });

  it("counts effective positions", () => {
    expect(effectivePositions([0.5, 0.5])).toBeCloseTo(2);
    expect(effectivePositions([1, 1, 2])).toBeCloseTo(1 / 0.375);
    expect(effectivePositions([1, -1])).toBeNull();
    expect(effectivePositions([])).toBeNull();
  });
});

describe("holdingsValueSeries", () => {
  it("values fixed shares once every symbol has a close, carrying gaps forward", () => {
    const aligned = {
      dates: [1, 2, 3, 4],
      closes: { A: [10, 11, null, 12], B: [null, 20, 21, 22] },
    };
    expect(holdingsValueSeries(aligned, { A: 2, B: 1 })).toEqual([null, 42, 43, 46]);
  });

  it("ignores non-positive share counts and handles an empty portfolio", () => {
    const aligned = { dates: [1, 2], closes: { A: [10, 11] } };
    expect(holdingsValueSeries(aligned, { A: 1, B: 0 })).toEqual([10, 11]);
    expect(holdingsValueSeries(aligned, {})).toEqual([null, null]);
  });
});
