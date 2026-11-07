import { describe, expect, it } from "vitest";

import {
  benjaminiHochberg,
  drawBlocks,
  holm,
  minimumDetectableIc,
  movingBlockBootstrap,
  mulberry32,
  neweyWest,
  normalCdf,
  normalPValue,
  normalQuantile,
  pearson,
  percentileInterval,
  quantile,
  quintileSort,
  ranks,
  spearman,
  studentTPValue,
  studentTQuantile,
  tTest,
  turnover,
} from "./research-stats";

/** Standard normal draws from a seeded generator (Box-Muller). */
function normals(n: number, seed: number): number[] {
  const random = mulberry32(seed);
  return Array.from({ length: n }, () => Math.sqrt(-2 * Math.log(Math.max(random(), 1e-12))) * Math.cos(2 * Math.PI * random()));
}

describe("ranks and correlation", () => {
  it("averages the ranks of ties", () => {
    expect(ranks([10, 20, 20, 5])).toEqual([2, 3.5, 3.5, 1]);
    expect(ranks([])).toEqual([]);
  });

  it("computes Pearson and Spearman correlations", () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 12);
    expect(pearson([1, 2, 3], [1, 1, 1])).toBeNull();
    // Monotone but not linear: Spearman is exactly 1, Pearson is not.
    const x = [1, 2, 3, 4, 5];
    const y = x.map((v) => v ** 3);
    expect(spearman(x, y)).toBeCloseTo(1, 12);
    expect(pearson(x, y)).toBeLessThan(1);
    expect(spearman(x, [...y].reverse())).toBeCloseTo(-1, 12);
  });

  it("matches the textbook Spearman formula without ties", () => {
    const x = [86, 97, 99, 100, 101, 103, 106, 110, 112, 113];
    const y = [2, 20, 28, 27, 50, 29, 7, 17, 6, 12];
    // 1 - 6 * sum(d^2) / (n (n^2 - 1)) with sum(d^2) = 194 (the IQ and TV-hours example on Wikipedia).
    expect(spearman(x, y)).toBeCloseTo(1 - (6 * 194) / (10 * 99), 12);
  });

  it("needs three pairs for a rank correlation", () => {
    expect(spearman([1, 2], [1, 2])).toBeNull();
    expect(spearman([1, 2, 3], [1, 2])).toBeNull();
  });
});

describe("tests of a mean", () => {
  it("computes the classical t statistic", () => {
    const test = tTest([1, 2, 3, 4, 5]);
    expect(test?.mean).toBe(3);
    expect(test?.se).toBeCloseTo(Math.sqrt(2.5 / 5), 12);
    expect(test?.t).toBeCloseTo(3 / Math.sqrt(0.5), 12);
    expect(tTest([1])).toBeNull();
    expect(tTest([2, 2, 2])?.t).toBeNull();
  });

  it("reduces to the n-denominator variance at lag 0 and adds Bartlett-weighted autocovariances", () => {
    const xs = [1, 3, 2, 5, 4];
    const m = 3;
    const e = xs.map((x) => x - m);
    const gamma0 = e.reduce((sum, v) => sum + v * v, 0) / 5;
    const gamma1 = (e[1] * e[0] + e[2] * e[1] + e[3] * e[2] + e[4] * e[3]) / 5;
    expect(neweyWest(xs, 0)?.se).toBeCloseTo(Math.sqrt(gamma0 / 5), 12);
    expect(neweyWest(xs, 1)?.se).toBeCloseTo(Math.sqrt((gamma0 + 2 * 0.5 * gamma1) / 5), 12);
    // The lag is capped at n - 1.
    expect(neweyWest(xs, 99)?.t).toBeCloseTo(neweyWest(xs, 4)?.t ?? Number.NaN, 12);
    expect(neweyWest([1], 3)).toBeNull();
  });

  it("widens the standard error for overlapping sums", () => {
    // 5-day sums of iid noise overlap by four days; the naive standard error ignores that and is far too small.
    const daily = normals(3000, 7).map((v) => v + 0.02);
    const sums = daily.slice(4).map((_, i) => daily.slice(i, i + 5).reduce((a, b) => a + b, 0));
    const naive = tTest(sums)?.se ?? 0;
    const nw = neweyWest(sums, 5)?.se ?? 0;
    expect(nw / naive).toBeGreaterThan(1.6);
    expect(nw / naive).toBeLessThan(2.6);
  });
});

describe("distributions", () => {
  it("computes normal probabilities and quantiles", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 6);
    expect(normalCdf(-1.644854)).toBeCloseTo(0.05, 6);
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5);
    expect(normalQuantile(0.8)).toBeCloseTo(0.841621, 5);
    expect(normalQuantile(0.001)).toBeCloseTo(-3.090232, 5);
    expect(normalPValue(1.959964)).toBeCloseTo(0.05, 6);
  });

  it("computes Student t p-values and quantiles", () => {
    expect(studentTPValue(2.228139, 10)).toBeCloseTo(0.05, 5);
    expect(studentTPValue(0, 5)).toBeCloseTo(1, 10);
    expect(studentTPValue(Number.NaN, 5)).toBeNull();
    expect(studentTQuantile(0.975, 10)).toBeCloseTo(2.228139, 5);
    expect(studentTQuantile(0.025, 30)).toBeCloseTo(-2.042272, 5);
    expect(studentTQuantile(0.975, 1e6)).toBeCloseTo(1.959964, 4);
  });
});

describe("multiple testing", () => {
  const ps = [0.01, 0.04, 0.03, 0.005];

  it("adjusts with the Holm step-down procedure", () => {
    // Sorted: 0.005 * 4, 0.01 * 3, 0.03 * 2, 0.04 * 1, kept monotone.
    const adjusted = holm(ps);
    [0.03, 0.06, 0.06, 0.02].forEach((p, i) => expect(adjusted[i]).toBeCloseTo(p, 12));
    expect(holm([0.5, 0.9])).toEqual([1, 1]);
  });

  it("adjusts with the Benjamini-Hochberg step-up procedure", () => {
    const q = benjaminiHochberg(ps);
    [0.02, 0.04, 0.04, 0.02].forEach((p, i) => expect(q[i]).toBeCloseTo(p, 12));
    expect(benjaminiHochberg([])).toEqual([]);
  });
});

describe("moving-block bootstrap", () => {
  it("is reproducible from its seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const first = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(first);
    expect(first.every((u) => u >= 0 && u < 1)).toBe(true);
    expect(Array.from({ length: 5 }, mulberry32(43))).not.toEqual(first);
  });

  it("draws blocks that cover exactly n indices inside the series", () => {
    const random = mulberry32(1);
    for (const [n, length] of [
      [100, 20],
      [101, 20],
      [7, 20],
      [1, 5],
    ]) {
      const blocks = drawBlocks(n, length, random);
      expect(blocks.reduce((sum, block) => sum + block.length, 0)).toBe(n);
      for (const block of blocks) {
        expect(block.start).toBeGreaterThanOrEqual(0);
        expect(block.start + block.length).toBeLessThanOrEqual(n);
      }
    }
    expect(drawBlocks(0, 20, random)).toEqual([]);
  });

  it("gives about the textbook interval for the mean of iid data", () => {
    const xs = normals(2000, 3);
    const prefix = [0];
    for (const x of xs) prefix.push(prefix[prefix.length - 1] + x);
    const replicates = movingBlockBootstrap(xs.length, { blockLength: 20, reps: 1000, seed: 9 }, (blocks) => {
      let sum = 0;
      for (const { start, length } of blocks) sum += prefix[start + length] - prefix[start];
      return sum / xs.length;
    });
    expect(replicates).toHaveLength(1000);
    const interval = percentileInterval(replicates) ?? [0, 0];
    const halfWidth = (interval[1] - interval[0]) / 2;
    // 1.96 / sqrt(2000) = 0.0438 for unit-variance draws; blocks add some noise to the estimate.
    expect(halfWidth).toBeGreaterThan(0.035);
    expect(halfWidth).toBeLessThan(0.053);
    const again = movingBlockBootstrap(xs.length, { blockLength: 20, reps: 1000, seed: 9 }, (blocks) => blocks[0].start);
    expect(again).toEqual(movingBlockBootstrap(xs.length, { blockLength: 20, reps: 1000, seed: 9 }, (blocks) => blocks[0].start));
  });

  it("interpolates quantiles between order statistics", () => {
    expect(quantile([3, 1, 2, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(quantile([], 0.5)).toBeNull();
    const interval = percentileInterval(Array.from({ length: 101 }, (_, i) => i)) ?? [0, 0];
    expect(interval[0]).toBeCloseTo(2.5, 12);
    expect(interval[1]).toBeCloseTo(97.5, 12);
  });
});

describe("portfolio sorts", () => {
  it("averages y within quintiles of x", () => {
    const x = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
    const sort = quintileSort(x, x);
    expect(sort?.means).toEqual([1.5, 3.5, 5.5, 7.5, 9.5]);
    expect(sort?.spread).toBe(8);
    expect(sort?.top.sort()).toEqual([0, 1]);
    expect(quintileSort([1, 2, 3, 4], [1, 2, 3, 4])).toBeNull();
  });

  it("measures turnover as the share of new members", () => {
    expect(turnover(new Set(["A", "B", "C", "D"]), ["A", "B", "E", "F"])).toBe(0.5);
    expect(turnover(new Set<string>(), ["A"])).toBe(1);
    expect(turnover(new Set(["A"]), [])).toBeNull();
  });
});

describe("minimumDetectableIc", () => {
  it("adds the critical t value and the power quantile", () => {
    const expected = ((studentTQuantile(0.975, 99) as number) + normalQuantile(0.8)) * (0.2 / 10);
    expect(minimumDetectableIc(0.2, 100)).toBeCloseTo(expected, 12);
    // With many dates the factor approaches 1.96 + 0.84 = 2.80.
    expect((minimumDetectableIc(1, 1e6) as number) * 1e3).toBeCloseTo(2.8016, 3);
    expect(minimumDetectableIc(0, 100)).toBeNull();
    expect(minimumDetectableIc(0.2, 1)).toBeNull();
  });
});
