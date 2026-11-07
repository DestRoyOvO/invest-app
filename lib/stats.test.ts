import { describe, expect, it } from "vitest";

import {
  clamp,
  downsideDeviation,
  interpolate,
  isFiniteNumber,
  mean,
  median,
  percentileRank,
  round,
  sampleStd,
  wilsonInterval,
} from "./stats";

describe("basic helpers", () => {
  it("clamps into the range", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.25, 0, 1)).toBe(0.25);
  });

  it("rounds to the requested decimals", () => {
    expect(round(1.23456, 2)).toBe(1.23);
    expect(round(1.235, 1)).toBe(1.2);
    expect(round(12.5)).toBe(13);
  });

  it("never returns negative zero", () => {
    expect(Object.is(round(-0.00001, 4), 0)).toBe(true);
    expect(Object.is(round(-0.4), 0)).toBe(true);
    expect(round(-0.00006, 4)).toBe(-0.0001);
  });

  it("recognizes finite numbers only", () => {
    expect(isFiniteNumber(1.5)).toBe(true);
    expect(isFiniteNumber(Number.NaN)).toBe(false);
    expect(isFiniteNumber(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isFiniteNumber("1")).toBe(false);
    expect(isFiniteNumber(null)).toBe(false);
  });
});

describe("mean, sampleStd, median", () => {
  it("returns null for samples that are too small", () => {
    expect(mean([])).toBeNull();
    expect(sampleStd([])).toBeNull();
    expect(sampleStd([3])).toBeNull();
    expect(median([])).toBeNull();
  });

  it("computes the textbook values", () => {
    const xs = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(mean(xs)).toBe(5);
    // Population variance is 4; the sample variance is 32 / 7.
    expect(sampleStd(xs)).toBeCloseTo(Math.sqrt(32 / 7), 12);
    expect(sampleStd([1, 1, 1])).toBe(0);
  });

  it("takes the middle value or the mean of the two middle values", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("does not reorder its input", () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
});

describe("downsideDeviation", () => {
  it("is sqrt(sum(min(r, 0)^2) / N) over all observations", () => {
    const returns = [0.01, -0.02, 0.03, -0.04];
    expect(downsideDeviation(returns)).toBeCloseTo(Math.sqrt((0.02 ** 2 + 0.04 ** 2) / 4), 15);
  });

  it("divides by the number of observations, not by the number of losing days", () => {
    expect(downsideDeviation([-0.02, 0, 0, 0])).toBeCloseTo(0.01, 15);
  });

  it("gives a single crash day a small non-zero value instead of zero", () => {
    const window = [...Array<number>(19).fill(0.001), -0.1];
    expect(downsideDeviation(window)).toBeCloseTo(Math.sqrt(0.01 / 20), 15);
  });

  it("weights loss frequency and loss size through the squared shortfall only", () => {
    // Four losses of 1% and one loss of 2% have the same squared shortfall, so the same semideviation.
    const frequent = [-0.01, -0.01, -0.01, -0.01, 0.01];
    const rare = [-0.02, 0.01, 0.01, 0.01, 0.01];
    expect(downsideDeviation(frequent)).toBeCloseTo(downsideDeviation(rare) ?? Number.NaN, 15);
  });

  it("is zero without losses, honours the target and is null for an empty sample", () => {
    expect(downsideDeviation([0.01, 0.02])).toBe(0);
    expect(downsideDeviation([0.01, 0.03], 0.02)).toBeCloseTo(Math.sqrt(0.0001 / 2), 15);
    expect(downsideDeviation([])).toBeNull();
  });
});

describe("percentileRank", () => {
  it("uses mid-ranks", () => {
    expect(percentileRank([1, 2, 3, 4], 3)).toBe(62.5);
    expect(percentileRank([1, 2, 3, 4], 0)).toBe(0);
    expect(percentileRank([1, 2, 3, 4], 10)).toBe(100);
  });

  it("ranks a value of a constant sample at 50", () => {
    expect(percentileRank([7, 7, 7], 7)).toBe(50);
  });

  it("is symmetric: the rank of the mirrored value is 100 minus the rank", () => {
    const xs = [0.3, 0.1, 0.4, 0.15, 0.9, 0.26];
    const mirrored = xs.map((x) => -x);
    for (const x of xs) {
      expect(percentileRank(mirrored, -x)).toBeCloseTo(100 - (percentileRank(xs, x) ?? Number.NaN), 12);
    }
  });

  it("is null for an empty sample", () => {
    expect(percentileRank([], 1)).toBeNull();
  });
});

describe("interpolate", () => {
  const knots = [
    [0, 10],
    [10, 20],
    [20, 0],
  ] as const;

  it("is linear between knots and flat outside them", () => {
    expect(interpolate(5, knots)).toBe(15);
    expect(interpolate(15, knots)).toBe(10);
    expect(interpolate(-3, knots)).toBe(10);
    expect(interpolate(99, knots)).toBe(0);
  });

  it("hits the knots exactly and is continuous across them", () => {
    expect(interpolate(10, knots)).toBe(20);
    expect(interpolate(10 - 1e-9, knots)).toBeCloseTo(20, 6);
    expect(interpolate(10 + 1e-9, knots)).toBeCloseTo(20, 6);
  });

  it("works with a single knot", () => {
    expect(interpolate(3, [[1, 7]])).toBe(7);
  });

  it("propagates NaN and stays flat toward the infinities", () => {
    expect(interpolate(Number.NaN, knots)).toBeNaN();
    expect(interpolate(Number.NEGATIVE_INFINITY, knots)).toBe(10);
    expect(interpolate(Number.POSITIVE_INFINITY, knots)).toBe(0);
  });
});

describe("wilsonInterval", () => {
  it("matches the published 95% interval for 8 of 10", () => {
    const ci = wilsonInterval(8, 10);
    expect(ci?.[0]).toBeCloseTo(0.4902, 4);
    expect(ci?.[1]).toBeCloseTo(0.9433, 4);
  });

  it("stays inside [0, 1] at the extremes", () => {
    const none = wilsonInterval(0, 10);
    expect(none?.[0]).toBe(0);
    expect(none?.[1]).toBeCloseTo(0.2775, 4);
    const all = wilsonInterval(10, 10);
    expect(all?.[0]).toBeCloseTo(0.7225, 4);
    expect(all?.[1]).toBe(1);
  });

  it("always contains the observed rate and narrows as the sample grows", () => {
    for (const [wins, trials] of [
      [1, 3],
      [7, 20],
      [55, 100],
      [530, 1000],
    ]) {
      const ci = wilsonInterval(wins, trials);
      expect(ci).not.toBeNull();
      if (!ci) continue;
      expect(ci[0]).toBeLessThanOrEqual(wins / trials);
      expect(ci[1]).toBeGreaterThanOrEqual(wins / trials);
    }
    const small = wilsonInterval(6, 10);
    const large = wilsonInterval(600, 1000);
    expect(small && large && large[1] - large[0] < small[1] - small[0]).toBe(true);
  });

  it("rejects impossible inputs", () => {
    expect(wilsonInterval(0, 0)).toBeNull();
    expect(wilsonInterval(5, 4)).toBeNull();
    expect(wilsonInterval(-1, 4)).toBeNull();
    expect(wilsonInterval(1.5, 4)).toBeNull();
  });
});
