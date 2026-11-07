import { describe, expect, it } from "vitest";

import {
  alignBenchmarkReturns,
  betaAt,
  crossSectionalPercentiles,
  crossSectionalZ,
  FACTOR_DIRECTION,
  FACTOR_KEYS,
  FACTOR_LOOKBACK,
  high52At,
  momentumAt,
  returnsOf,
  reversalAt,
  styleFactorsAt,
  volatilityAt,
  type DatedClose,
} from "./factors";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2025, 0, 1);

/** Closes compounding the given daily returns from 100. */
function fromReturns(returns: readonly number[]): number[] {
  const closes = [100];
  for (const r of returns) closes.push(closes[closes.length - 1] * (1 + r));
  return closes;
}

function dated(closes: readonly number[], offset = 0): DatedClose[] {
  return closes.map((c, k) => ({ t: T0 + (k + offset) * DAY, c }));
}

/** Deterministic, irregular daily returns. */
function noise(n: number, seed = 1): number[] {
  return Array.from({ length: n }, (_, k) => Math.sin((k + 1) * 12.9898 * seed) * 0.015);
}

describe("single factors", () => {
  const linear = Array.from({ length: 300 }, (_, k) => k + 1);

  it("measures 12-1 momentum, skipping the last month", () => {
    expect(momentumAt(linear, 299)).toBeCloseTo(279 / 48 - 1);
    expect(momentumAt(linear, 251)).toBeNull();
    expect(momentumAt(linear, 300)).toBeNull();
  });

  it("measures the one-month return used for reversal", () => {
    expect(reversalAt(linear, 299)).toBeCloseTo(300 / 279 - 1);
    expect(reversalAt(linear, 20)).toBeNull();
  });

  it("compares the close with the 52-week high", () => {
    const series = [...Array.from({ length: 200 }, (_, k) => 100 + k), ...Array.from({ length: 60 }, () => 150)];
    expect(high52At(series, 259)).toBeCloseTo(150 / 299);
    expect(high52At(series, 250)).toBeNull();
    expect(high52At(linear, 299)).toBe(1);
  });

  it("annualizes the 63-session volatility and needs a full window", () => {
    const returns = returnsOf(fromReturns(Array.from({ length: 70 }, (_, k) => (k % 2 === 0 ? 0.01 : -0.01))));
    // 63 alternating returns: 32 of one sign and 31 of the other, so the window mean is 0.01 / 63.
    const m = 0.01 / 63;
    const variance = (32 * (0.01 - m) ** 2 + 31 * (-0.01 - m) ** 2) / 62;
    expect(volatilityAt(returns, 70)).toBeCloseTo(Math.sqrt(variance) * Math.sqrt(252), 6);
    expect(volatilityAt(returns, 62)).toBeNull();
  });

  it("measures beta on matching sessions", () => {
    const bench = noise(300);
    const benchCloses = fromReturns(bench);
    const stockCloses = fromReturns(bench.map((r) => 2 * r));
    const aligned = alignBenchmarkReturns(dated(stockCloses), dated(benchCloses));
    expect(betaAt(returnsOf(stockCloses), aligned, 300)).toBeCloseTo(2, 6);
    expect(betaAt(returnsOf(stockCloses), aligned, 251)).toBeNull();
  });
});

describe("alignBenchmarkReturns", () => {
  it("uses the benchmark's return between the same consecutive sessions", () => {
    const stock = dated([10, 11, 12, 13]);
    const bench = [
      { t: T0, c: 100 },
      { t: T0 + DAY, c: 110 },
      // the benchmark has an extra session the stock did not trade, so the stock's next return spans two of its days
      { t: T0 + 1.5 * DAY, c: 115 },
      { t: T0 + 2 * DAY, c: 121 },
      { t: T0 + 3 * DAY, c: 133.1 },
    ];
    const aligned = alignBenchmarkReturns(stock, bench);
    expect(Number.isNaN(aligned[0])).toBe(true);
    expect(aligned[1]).toBeCloseTo(0.1);
    expect(Number.isNaN(aligned[2])).toBe(true);
    expect(aligned[3]).toBeCloseTo(0.1);
  });

  it("returns NaN where the benchmark lacks the session", () => {
    const aligned = alignBenchmarkReturns(dated([10, 11, 12]), dated([100, 101], 5));
    expect(aligned.every((r) => Number.isNaN(r))).toBe(true);
  });
});

describe("styleFactorsAt", () => {
  it("computes every factor at the last session, and no beta without a benchmark", () => {
    const stock = dated(fromReturns(noise(320, 2)));
    const bench = dated(fromReturns(noise(320, 3)));
    const withBench = styleFactorsAt(stock, bench);
    for (const key of FACTOR_KEYS) expect(withBench[key]).not.toBeNull();
    expect(styleFactorsAt(stock, null).beta).toBeNull();
  });

  it("returns null for factors the history is too short for", () => {
    const short = styleFactorsAt(dated(fromReturns(noise(100))), null);
    expect(short).toMatchObject({ momentum: null, high52: null, beta: null });
    expect(short.reversal).not.toBeNull();
    expect(short.volatility).not.toBeNull();
  });

  it("documents a direction and a lookback for every factor", () => {
    for (const key of FACTOR_KEYS) {
      expect(Math.abs(FACTOR_DIRECTION[key])).toBe(1);
      expect(FACTOR_LOOKBACK[key]).toBeGreaterThan(0);
    }
  });
});

describe("cross-sectional transforms", () => {
  it("ranks with mid-rank percentiles and leaves missing values null", () => {
    const pct = crossSectionalPercentiles(new Map([["A", 1], ["B", 2], ["C", 3], ["D", null]]));
    expect(pct.get("A")).toBeCloseTo(100 / 6);
    expect(pct.get("B")).toBeCloseTo(50);
    expect(pct.get("C")).toBeCloseTo(500 / 6);
    expect(pct.get("D")).toBeNull();
    const ties = crossSectionalPercentiles(new Map([["A", 5], ["B", 5]]));
    expect([...ties.values()]).toEqual([50, 50]);
  });

  it("standardizes values present and needs at least three", () => {
    const z = crossSectionalZ(new Map([["A", 1], ["B", 2], ["C", 3], ["D", null]]));
    expect(z.get("A")).toBeCloseTo(-1);
    expect(z.get("B")).toBeCloseTo(0);
    expect(z.get("C")).toBeCloseTo(1);
    expect(z.get("D")).toBeNull();
    expect([...crossSectionalZ(new Map([["A", 1], ["B", 2]])).values()]).toEqual([null, null]);
  });
});
