import { describe, expect, it } from "vitest";

import type { ValuedPosition } from "./portfolio";
import {
  alignByDate,
  analyzeRisk,
  assetClassExposure,
  assetClassOf,
  currencyExposure,
  currencyUnit,
  effectivePositionCount,
  foldSlices,
  fxPairSymbol,
  fxSymbolsFor,
  HIGH_CORRELATION,
  historySymbols,
  largestRiskGap,
  lastSessions,
  onBenchmarkSessions,
  performanceWindow,
  projectedDividends,
  RISK_SESSIONS,
  sectorExposure,
  selectAnalyzed,
  type PositionRisk,
} from "./portfolio-analytics";
import { annualizedVolatility, dailyReturns } from "./risk";

const DAY = 86_400_000;

function pos(symbol: string, shares: number, price: number, currency = "USD", cost = price): ValuedPosition {
  const value = shares * price;
  return { symbol, shares, cost, price, currency, value, costBasis: shares * cost, pnl: value - shares * cost, pnlPct: null, dayPnl: null, weight: null };
}

/** Deterministic pseudo-random returns in [-2%, 2%]. */
function noise(seed: number, n: number): number[] {
  let x = seed;
  return Array.from({ length: n }, () => {
    x = (x * 16807) % 2147483647;
    return ((x / 2147483647) * 2 - 1) * 0.02;
  });
}

/** Closes from a start price and daily returns (the first close has no return). */
function closesFrom(start: number, returns: number[]): number[] {
  const out = [start];
  for (const r of returns) out.push(out[out.length - 1] * (1 + r));
  return out;
}

describe("selection", () => {
  it("analyzes the largest positions and lists the rest", () => {
    const rows = Array.from({ length: 30 }, (_, i) => pos(`S${i}`, 1, 100 + i));
    const { analyzed, beyond } = selectAnalyzed(rows);
    expect(analyzed).toHaveLength(24);
    expect(analyzed[0].symbol).toBe("S29");
    expect(beyond.map((p) => p.symbol)).toEqual(["S5", "S4", "S3", "S2", "S1", "S0"]);
    expect(historySymbols([{ symbol: "AAPL" }, { symbol: "SPY" }])).toEqual(["AAPL", "SPY"]);
    expect(historySymbols([{ symbol: "AAPL" }])).toEqual(["AAPL", "SPY"]);
  });
});

describe("onBenchmarkSessions and alignByDate", () => {
  const history = {
    dates: [0, 1, 2, 3, 4].map((i) => i * DAY),
    closes: {
      SPY: [100, null, 101, 102, null],
      BTC: [10, 11, 12, 13, 14],
      HK: [5, 5.5, null, 6, 6.5],
      NEW: [null, null, null, 7, 8],
    },
  };

  it("keeps the benchmark sessions and carries other closes forward", () => {
    const aligned = onBenchmarkSessions(history, "SPY");
    expect(aligned.dates).toEqual([0, 2 * DAY, 3 * DAY]);
    expect(aligned.closes.SPY).toEqual([100, 101, 102]);
    // The weekend close counts on the next session; a holiday carries the last close.
    expect(aligned.closes.BTC).toEqual([10, 12, 13]);
    expect(aligned.closes.HK).toEqual([5, 5.5, 6]);
    expect(aligned.closes.NEW).toEqual([null, null, 7]);
  });

  it("leaves the history alone without benchmark closes", () => {
    expect(onBenchmarkSessions(history, "QQQ")).toBe(history);
  });

  it("looks a series up by date", () => {
    expect(alignByDate([0, DAY, 2 * DAY], { dates: [DAY, 2 * DAY, 5 * DAY], closes: [3, null, 9] })).toEqual([null, 3, null]);
  });
});

describe("analyzeRisk", () => {
  const n = 80;
  const market = noise(7, n - 1);
  const dates = Array.from({ length: n }, (_, i) => i * DAY);
  const spy = closesFrom(400, market);
  // A moves exactly twice the market, B exactly with it, C on its own.
  const a = closesFrom(50, market.map((r) => 2 * r));
  const b = closesFrom(20, market);
  const c = closesFrom(30, noise(99, n - 1));
  const history = { dates, closes: { SPY: spy, A: a, B: b, C: c } };

  it("measures beta, volatility and VaR of today's holdings", () => {
    const report = analyzeRisk([pos("A", 10, a[n - 1])], history);
    expect(report.symbols).toEqual(["A"]);
    expect(report.sessions).toBe(n - 1);
    expect(report.since).toBe(0);
    expect(report.beta).toBeCloseTo(2, 6);
    expect(report.volatility).toBeCloseTo(2 * (annualizedVolatility(dailyReturns(spy)) as number), 6);
    expect(report.varRatio).toBeLessThan(0);
    expect(report.varAmount).toBeCloseTo(-(report.varRatio as number) * report.value, 6);
    expect(report.value).toBeCloseTo(10 * a[n - 1]);
    const dd = report.maxDrawdown;
    expect(dd?.depth).toBeLessThanOrEqual(0);
    expect(dd?.troughDate).toBe(dates[dd?.troughIndex ?? 0]);
  });

  it("splits risk by contribution and flags pairs that move together", () => {
    // Equal values in A (beta 2) and B (beta 1): A carries 2/3 of the variance.
    const report = analyzeRisk([pos("A", 1000 / a[n - 1], a[n - 1]), pos("B", 1000 / b[n - 1], b[n - 1]), pos("C", 1, c[n - 1])], history);
    const byId = Object.fromEntries(report.positions.map((p) => [p.symbol, p]));
    expect(byId.A.weight).toBeCloseTo(1000 / (2000 + c[n - 1]), 6);
    const shares = report.positions.map((p) => p.riskShare as number);
    expect(shares.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 8);
    expect(byId.A.riskShare as number).toBeGreaterThan(byId.A.weight);
    expect(byId.A.beta).toBeCloseTo(2, 6);
    expect(byId.B.beta).toBeCloseTo(1, 6);
    expect(report.correlation.symbols).toEqual(["A", "B", "C"]);
    expect(report.correlation.matrix[0][0]).toBe(1);
    expect(report.correlation.matrix[0][1]).toBeCloseTo(1, 8);
    expect(Math.abs(report.correlation.matrix[0][2] as number)).toBeLessThan(HIGH_CORRELATION);
    expect(report.correlation.high).toEqual([{ a: "A", b: "B", r: expect.closeTo(1, 8) }]);
    expect(report.correlation.average).not.toBeNull();
  });

  it("gives exactly 2/3 of the risk to the position moving twice as much at equal weight", () => {
    const report = analyzeRisk([pos("A", 1000 / a[n - 1], a[n - 1]), pos("B", 1000 / b[n - 1], b[n - 1])], history);
    // Weights drift with fixed share counts, but the contributions use today's weights: 2w / (2w + w) = 2/3.
    expect(report.positions[0].riskShare).toBeCloseTo(2 / 3, 8);
    expect(report.positions[1].riskShare).toBeCloseTo(1 / 3, 8);
  });

  it("uses the sessions every holding has, and lists positions without history", () => {
    const late = [...Array(40).fill(null), ...closesFrom(10, noise(3, n - 41))];
    const report = analyzeRisk([pos("A", 1, a[n - 1]), pos("LATE", 1, 10), pos("NONE", 1, 5)], { dates, closes: { ...history.closes, LATE: late, NONE: Array(n).fill(null) } });
    expect(report.symbols).toEqual(["A", "LATE"]);
    expect(report.missingHistory).toEqual(["NONE"]);
    expect(report.since).toBe(dates[40]);
    expect(report.sessions).toBe(n - 41);
    expect(report.values.slice(0, 40).every((v) => v === null)).toBe(true);
  });

  it("covers the last 252 daily returns, the 1Y chart window", () => {
    const long = 400;
    const longMarket = noise(11, long - 1);
    const longDates = Array.from({ length: long }, (_, i) => i * DAY);
    const report = analyzeRisk([pos("SPY", 1, 500)], { dates: longDates, closes: { SPY: closesFrom(400, longMarket) } });
    expect(report.dates).toHaveLength(RISK_SESSIONS + 1);
    expect(report.dates[0]).toBe(longDates[long - RISK_SESSIONS - 1]);
    expect(report.sessions).toBe(RISK_SESSIONS);
    expect(lastSessions({ dates: [1, 2, 3], closes: { A: [1, 2, 3] } }, 2)).toEqual({ dates: [2, 3], closes: { A: [2, 3] } });
  });

  it("returns empty statistics without history or benchmark", () => {
    const empty = analyzeRisk([pos("A", 1, 10)], null);
    expect(empty.symbols).toEqual([]);
    expect(empty.missingHistory).toEqual(["A"]);
    expect(empty.beta).toBeNull();
    expect(empty.volatility).toBeNull();
    expect(empty.varAmount).toBeNull();
    expect(empty.correlation.matrix).toEqual([]);
    const noBench = analyzeRisk([pos("A", 1, a[n - 1])], { dates, closes: { A: a } });
    expect(noBench.beta).toBeNull();
    expect(noBench.volatility).not.toBeNull();
    expect(noBench.benchmark.every((v) => v === null)).toBe(true);
  });
});

describe("largestRiskGap", () => {
  const p = (symbol: string, weight: number, riskShare: number | null): PositionRisk => ({ symbol, value: weight, weight, riskShare, beta: null, volatility: null });

  it("finds the position whose risk exceeds its weight the most", () => {
    expect(largestRiskGap([p("MSFT", 0.2, 0.31), p("KO", 0.3, 0.1), p("NVDA", 0.1, 0.15)])?.symbol).toBe("MSFT");
    expect(largestRiskGap([p("KO", 0.5, 0.4), p("PG", 0.5, 0.6)])?.symbol).toBe("PG");
    expect(largestRiskGap([p("KO", 0.5, 0.5), p("PG", 0.5, null)])).toBeNull();
    expect(largestRiskGap([])).toBeNull();
  });
});

describe("performanceWindow", () => {
  const dates = [0, 1, 2, 3, 4].map((i) => i * DAY);

  it("rebases both series to 100 on the first shared session of the window", () => {
    const w = performanceWindow(dates, [90, 100, 110, 99, 120], [40, 50, 55, 50, 60], 3);
    expect(w.dates).toEqual(dates.slice(1));
    expect(w.holdings.map((v) => Number(v?.toFixed(9)))).toEqual([100, 110, 99, 120]);
    expect(w.benchmark[0]).toBe(100);
    expect(w.benchmark[3]).toBeCloseTo(120);
    expect(w.holdingsReturn).toBeCloseTo(0.2);
    expect(w.benchmarkReturn).toBeCloseTo(0.2);
    expect(w.drawdown).toEqual([0, 0, 99 / 110 - 1, 0]);
    expect(w.maxDrawdown).toMatchObject({ depth: 99 / 110 - 1, peakDate: 2 * DAY, troughDate: 3 * DAY, recoveryIndex: 3 });
  });

  it("starts where both series have values and works without a benchmark", () => {
    const w = performanceWindow(dates, [null, null, 100, 105, 110], [40, 50, 55, 50, 60], 10);
    expect(w.dates).toEqual(dates.slice(2));
    expect(w.holdingsReturn).toBeCloseTo(0.1);
    const solo = performanceWindow(dates, [100, 101, 102, 103, 104], [null, null, null, null, null], 2);
    expect(solo.dates).toEqual(dates.slice(2));
    expect(solo.benchmark).toEqual([null, null, null]);
    expect(solo.benchmarkReturn).toBeNull();
    expect(performanceWindow([], [], [], 63).holdingsReturn).toBeNull();
  });
});

describe("exposure", () => {
  const rows = [pos("AAPL", 10, 200), pos("SPY", 2, 500), pos("PLTR", 10, 100), pos("XYZ", 5, 100), pos("SHELL", 1, 100)];
  const info: Record<string, { quoteType: string | null; sector: string | null }> = {
    AAPL: { quoteType: "EQUITY", sector: null },
    SPY: { quoteType: "ETF", sector: null },
    PLTR: { quoteType: "EQUITY", sector: "Technology" },
    XYZ: { quoteType: "EQUITY", sector: null },
    SHELL: { quoteType: "EQUITY", sector: "Shell Companies" },
  };

  it("groups by universe sector, asset class and Yahoo sector, by value", () => {
    const slices = sectorExposure(rows, (s) => info[s]);
    expect(slices.map((s) => [s.id, s.value])).toEqual([
      ["sector:technology", 3000],
      ["asset:etf", 1000],
      ["unclassified", 500],
      ["other:shell companies", 100],
    ]);
    expect(slices[0].symbols).toEqual(["AAPL", "PLTR"]);
    expect(slices.reduce((s, x) => s + x.weight, 0)).toBeCloseTo(1);
    expect(slices[0].weight).toBeCloseTo(3000 / 4600);
  });

  it("groups by asset class", () => {
    expect(assetClassOf("EQUITY")).toBe("equity");
    expect(assetClassOf("mutualfund")).toBe("fund");
    expect(assetClassOf(null)).toBe("other");
    expect(assetClassOf("WARRANT")).toBe("other");
    const slices = assetClassExposure(rows, (s) => info[s].quoteType);
    expect(slices.map((s) => [s.key, s.value])).toEqual([
      ["equity", 3600],
      ["etf", 1000],
    ]);
  });

  it("folds small slices into one", () => {
    const slices = sectorExposure(rows, (s) => info[s]);
    const folded = foldSlices(slices, 3);
    expect(folded.shown.map((s) => s.id)).toEqual(["sector:technology", "asset:etf"]);
    expect(folded.rest).toEqual({ value: 600, weight: expect.closeTo(600 / 4600, 10), symbols: ["XYZ", "SHELL"] });
    expect(foldSlices(slices, 2).rest?.symbols).toEqual(["AAPL", "PLTR", "SPY", "XYZ", "SHELL"].slice(2));
    expect(foldSlices(slices, 4).rest).toBeNull();
  });
});

describe("currencies", () => {
  it("knows minor units and FX symbols", () => {
    expect(currencyUnit("GBp")).toEqual({ major: "GBP", factor: 100 });
    expect(currencyUnit("usd")).toEqual({ major: "USD", factor: 1 });
    expect(fxPairSymbol("JPY", "USD")).toBe("JPYUSD=X");
    expect(fxPairSymbol("GBp", "USD")).toBe("GBPUSD=X");
    expect(fxPairSymbol("GBp", "GBP")).toBeNull();
    expect(fxPairSymbol("USD", "USD")).toBeNull();
  });

  it("lists the FX symbols the breakdown needs, once each and sorted", () => {
    const foreign = [{ currency: "JPY" }, { currency: "GBp" }, { currency: "JPY" }, { currency: "EUR" }, { currency: "GBP" }];
    expect(fxSymbolsFor(foreign, "USD")).toEqual(["EURUSD=X", "GBPUSD=X", "JPYUSD=X"]);
    expect(fxSymbolsFor([{ currency: "GBp" }], "GBP")).toEqual([]);
    expect(fxSymbolsFor([], "USD")).toEqual([]);
  });

  it("converts other currencies for the breakdown and keeps unknown rates apart", () => {
    const positions = [pos("AAPL", 10, 200), pos("7203.T", 100, 3000, "JPY"), pos("VOD.L", 100, 100, "GBp"), pos("SAP.DE", 1, 200, "EUR")];
    const rates: Record<string, number> = { "JPYUSD=X": 0.0065, "GBPUSD=X": 1.25 };
    const result = currencyExposure(positions, "USD", (pair) => rates[pair] ?? null);
    expect(result.slices.map((s) => [s.currency, s.value])).toEqual([
      ["USD", 2000],
      ["JPY", 1950],
      ["GBp", 125],
      ["EUR", null],
    ]);
    expect(result.total).toBeCloseTo(4075);
    expect(result.slices[0].weight).toBeCloseTo(2000 / 4075);
    expect(result.slices[3]).toMatchObject({ localValue: 200, weight: null, symbols: ["SAP.DE"] });
    expect(result.unconverted).toEqual(["EUR"]);
  });

  it("converts into a minor-unit base currency", () => {
    const result = currencyExposure([pos("VOD.L", 100, 100, "GBp"), pos("AAPL", 1, 200)], "GBp", (pair) => (pair === "USDGBP=X" ? 0.8 : null));
    expect(result.slices.map((s) => [s.currency, s.value])).toEqual([
      ["USD", 16000],
      ["GBp", 10000],
    ]);
  });
});

describe("income and concentration", () => {
  it("projects dividends from the forward rate", () => {
    const rows = [pos("KO", 100, 70), pos("NVDA", 10, 180), pos("SPY", 2, 500)];
    const rates: Record<string, number | null> = { KO: 2.04, NVDA: 0.04, SPY: null };
    const result = projectedDividends(rows, (s) => rates[s] ?? null);
    expect(result.amount).toBeCloseTo(204.4);
    expect(result).toMatchObject({ payers: 2, positions: 3 });
    expect(result.yield).toBeCloseTo(204.4 / 9800);
    expect(projectedDividends([], () => 1)).toEqual({ amount: 0, payers: 0, positions: 0, yield: null });
  });

  it("counts effective positions", () => {
    expect(effectivePositionCount([pos("A", 1, 100), pos("B", 1, 100)])).toBeCloseTo(2);
    expect(effectivePositionCount([pos("A", 1, 300), pos("B", 1, 100)])).toBeCloseTo(1 / (0.75 ** 2 + 0.25 ** 2));
    expect(effectivePositionCount([])).toBeNull();
  });
});
