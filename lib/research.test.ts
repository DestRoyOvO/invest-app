import { describe, expect, it } from "vitest";

import type { DailyBar } from "@/lib/bars";

import { RESEARCH_FACTORS } from "./evaluation";
import {
  betaAdjustedReturns,
  buildPanel,
  evaluateDate,
  exPostWinners,
  forwardReturns,
  runResearch,
  type FactorStudySettings,
  type ResearchInput,
  type RiskStudySettings,
} from "./research";
import { mulberry32 } from "./research-stats";

// ---------------------------------------------------------------------------
// Fixtures: Gaussian random walks on a common market factor, opening at the previous close
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** Weekday session dates from a start date. */
function sessions(n: number, start = Date.UTC(2015, 0, 1)): number[] {
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

const DATES = sessions(1100);
/** Daily log returns of the market. */
const MARKET = (() => {
  const random = mulberry32(5);
  return DATES.map(() => 0.0003 + 0.01 * gaussian(random));
})();

/** Bars whose daily log return is beta times the market's plus Gaussian noise; each session opens at the last close. */
function walk(seed: number, beta: number, vol: number, from = 0): DailyBar[] {
  const random = mulberry32(seed);
  let price = 50 + 50 * random();
  const bars: DailyBar[] = [];
  DATES.forEach((t, i) => {
    const o = price;
    price = o * Math.exp(beta * MARKET[i] + vol * gaussian(random));
    if (i >= from) bars.push({ t, o, h: Math.max(o, price), l: Math.min(o, price), c: price, adjClose: price, v: 1e6 });
  });
  return bars;
}

const WINDOW = { from: "2016-03-01", to: "2019-02-28" };
const HALVES = [
  { from: "2016-03-01", to: "2017-08-31" },
  { from: "2017-09-01", to: "2019-02-28" },
];
const FACTORS: FactorStudySettings = { window: WINDOW, horizons: [5, 21], minStocksPerDate: 10, alpha: 0.05, excludeWinners: 3, subperiods: HALVES };
const RISK: RiskStudySettings = { window: WINDOW, bandHorizon: 10, persistenceHorizon: 63, drawdownHorizon: 21, drawdownThreshold: -0.1, subperiods: HALVES };

/** 20 stocks with rising beta and idiosyncratic volatility, a pure-beta stock, a late listing and a symbol without bars. */
function fixture(): ResearchInput {
  const bars: Record<string, DailyBar[]> = {};
  const symbols: string[] = [];
  const sectors = new Map<string, string>();
  for (let j = 0; j < 20; j++) {
    const symbol = `S${String(j).padStart(2, "0")}`;
    bars[symbol] = walk(100 + j, 0.5 + 0.05 * j, 0.006 + 0.0012 * j);
    symbols.push(symbol);
    sectors.set(symbol, j % 2 === 0 ? "tech" : "energy");
  }
  bars.BETA = walk(7, 1.5, 0);
  bars.LATE = walk(8, 1, 0.015, 600);
  bars.NONE = [];
  symbols.push("BETA", "LATE", "NONE");
  bars.SPY = walk(9, 1, 0);
  bars.RSP = walk(10, 0.9, 0.001);
  return { bars, symbols, sectors, benchmarks: { market: "SPY", equalWeight: "RSP" }, factors: FACTORS, risk: RISK };
}

/** Prices that revert toward a market-driven anchor (an AR(1) gap with coefficient 0.9), so last month's losers bounce. */
function reverting(seed: number, beta: number): DailyBar[] {
  const random = mulberry32(seed);
  let anchor = Math.log(50 + 50 * random());
  let gap = 0;
  let close = Math.exp(anchor);
  return DATES.map((t, i) => {
    const o = close;
    anchor += beta * MARKET[i];
    gap = 0.9 * gap + 0.02 * gaussian(random);
    close = Math.exp(anchor + gap);
    return { t, o, h: Math.max(o, close), l: Math.min(o, close), c: close, adjClose: close, v: 1e6 };
  });
}

function panelOf(input: ResearchInput) {
  return buildPanel(input.bars, { symbols: input.symbols, sectors: input.sectors, market: "SPY", window: WINDOW, minStocks: 10 });
}

// ---------------------------------------------------------------------------
// Panel and returns
// ---------------------------------------------------------------------------

describe("buildPanel", () => {
  const input = fixture();
  const panel = panelOf(input);

  it("puts the stocks with bars on the market's calendar up to the window end", () => {
    expect(panel.T).toEqual(DATES.filter((t) => t <= Date.parse("2019-02-28T00:00:00Z")));
    expect(panel.symbols).toEqual(input.symbols.filter((symbol) => symbol !== "NONE"));
    expect(panel.sectors.slice(0, 2)).toEqual(["tech", "energy"]);
    expect(panel.sectors[panel.symbols.indexOf("BETA")]).toBe("other");
    const late = panel.symbols.indexOf("LATE");
    expect(Number.isNaN(panel.C[late][599]) && panel.C[late][600] > 0).toBe(true);
    expect(panel.T[panel.k0] >= Date.parse("2016-03-01T00:00:00Z") && panel.T[panel.k0 - 1] < Date.parse("2016-03-01T00:00:00Z")).toBe(true);
  });

  it("signs every factor in its literature direction", () => {
    const k = panel.k0 + 100;
    for (let s = 0; s < 20; s++) {
      expect(panel.F.volatility[s][k]).toBe(-panel.vol63[s][k]);
      expect(panel.F.beta[s][k]).toBe(-panel.beta[s][k]);
      expect(Number.isFinite(panel.F.composite[s][k]) && Number.isFinite(panel.F.technical[s][k])).toBe(true);
    }
    // Rising idiosyncratic volatility and beta show up in the raw measures.
    expect(panel.vol63[19][k]).toBeGreaterThan(panel.vol63[0][k]);
    expect(panel.beta[panel.symbols.indexOf("BETA")][k]).toBeCloseTo(1.5, 1);
  });

  it("needs a year of history before the window and market bars", () => {
    const options = { symbols: input.symbols, sectors: input.sectors, minStocks: 10 };
    expect(() => buildPanel(input.bars, { ...options, market: "SPY", window: { from: "2015-06-01", to: WINDOW.to } })).toThrow(/252/);
    expect(() => buildPanel(input.bars, { ...options, market: "NONE", window: WINDOW })).toThrow(/market/);
  });
});

describe("forward and beta-adjusted returns", () => {
  const panel = panelOf(fixture());
  const h = 5;
  const raw = forwardReturns(panel, h, 10);
  const adjusted = betaAdjustedReturns(panel, h, 10);
  const s = panel.symbols.indexOf("BETA");

  it("buys the next open and sells the close h sessions later", () => {
    const k = panel.k0 + 7;
    expect(raw.R[0][k]).toBeCloseTo(panel.C[0][k + h] / panel.O[0][k + 1] - 1, 12);
    const day = panel.symbols.map((_, i) => raw.R[i][k]).filter(Number.isFinite);
    expect(raw.mean[k]).toBeCloseTo(day.reduce((a, b) => a + b, 0) / day.length, 12);
    expect(Number.isNaN(raw.R[0][panel.T.length - h])).toBe(true);
  });

  it("nets out trailing beta times the market's return over the same span", () => {
    const k = panel.k0 + 10;
    expect(adjusted.R[s][k]).toBeCloseTo(raw.R[s][k] - panel.beta[s][k] * (panel.M[k + h] / panel.MO[k + 1] - 1), 12);
    // A stock that is pure market exposure has almost nothing left.
    let rawMove = 0;
    let adjustedMove = 0;
    for (let j = panel.k0; j + h < panel.T.length; j++) {
      rawMove += Math.abs(raw.R[s][j]);
      adjustedMove += Math.abs(adjusted.R[s][j]);
    }
    expect(adjustedMove).toBeLessThan(0.05 * rawMove);
  });
});

describe("evaluateDate", () => {
  // Two sectors: within each, the factor orders returns perfectly, but the high-factor sector earned less.
  const panel = { symbols: ["A1", "A2", "A3", "A4", "A5", "B1", "B2", "B3", "B4", "B5"], sectors: ["A", "A", "A", "A", "A", "B", "B", "B", "B", "B"] };
  const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const y = [0.06, 0.07, 0.08, 0.09, 0.1, 0.01, 0.02, 0.03, 0.04, 0.05];
  const values = x.map((v) => [v]);
  const returns = { R: y.map((v) => [v]), mean: [y.reduce((a, b) => a + b, 0) / y.length] };

  it("demeans ranks within sectors for the sector-neutral IC", () => {
    const row = evaluateDate(panel, values, returns, 0, 10);
    expect(row?.ic).toBeCloseTo(-42.5 / 82.5, 12);
    expect(row?.sectorIc).toBeCloseTo(1, 12);
    // Quintiles of two: the top pair (B4, B5) earned 2 points less than the bottom pair (A1, A2).
    expect(row?.spread).toBeCloseTo(-0.02, 12);
    expect(row?.top).toEqual([8, 9]);
  });

  it("needs enough stocks and a same-day mean", () => {
    expect(evaluateDate(panel, values, returns, 0, 11)).toBeNull();
    expect(evaluateDate(panel, values, returns, 0, 10, new Set([0]))).toBeNull();
    expect(evaluateDate(panel, values, { ...returns, mean: [Number.NaN] }, 0, 5)).toBeNull();
  });
});

describe("exPostWinners", () => {
  it("ranks by annual return from the window start or listing, ties by symbol", () => {
    const panel = {
      T: [0, 365.25 * DAY_MS],
      C: [
        [100, 150],
        [100, 200],
        [100, 200],
        [Number.NaN, 120],
      ],
      symbols: ["A", "C", "B", "D"],
      k0: 0,
    };
    expect(exPostWinners(panel, 2).map((w) => [w.symbol, w.annualReturn])).toEqual([
      ["B", 1],
      ["C", 1],
    ]);
    // D only has a price on the last session, so it has no annual return.
    expect(exPostWinners(panel, 10).map((w) => w.symbol)).toEqual(["B", "C", "A"]);
  });
});

// ---------------------------------------------------------------------------
// Both studies
// ---------------------------------------------------------------------------

describe("runResearch", () => {
  const { research, risk } = runResearch(fixture());

  it("is reproducible: the same bars and settings give identical JSON", () => {
    expect(JSON.stringify(runResearch(fixture()))).toBe(JSON.stringify({ research, risk }));
  });

  it("tests every pre-registered factor at every horizon and applies the adoption rule", () => {
    expect(research.universe).toBe(22);
    expect(research.factors.map((f) => f.key)).toEqual([...RESEARCH_FACTORS]);
    for (const factor of research.factors) {
      expect(factor.results.map((r) => r.days)).toEqual(FACTORS.horizons);
      for (const r of factor.results) {
        const sameSign = r.ic !== null && r.signs.every((s) => s === Math.sign(r.ic as number));
        expect(r.verdict).toBe((r.holmP ?? 1) < FACTORS.alpha && sameSign ? "predictive" : "not_predictive");
        expect(r.holmP ?? 0).toBeGreaterThanOrEqual(r.p ?? 0);
        expect(r.signs).toHaveLength(HALVES.length);
      }
    }
    expect(research.power.map((p) => p.days)).toEqual(FACTORS.horizons);
    expect(research.bias.exWinners).toHaveLength(FACTORS.excludeWinners);
    expect(research.bias.universeVsBenchmarks).toHaveLength(1 + HALVES.length);
    // Random walks carry no factor structure.
    expect(research.factors.flatMap((f) => f.results).every((r) => r.verdict === "not_predictive")).toBe(true);
  });

  it("calls a factor predictive when it passes Holm with the same sign in every subperiod", () => {
    const input = fixture();
    const bars: Record<string, readonly DailyBar[]> = { ...input.bars };
    for (let j = 0; j < 20; j++) bars[`S${String(j).padStart(2, "0")}`] = reverting(300 + j, 0.5 + 0.05 * j);
    const reversal = runResearch({ ...input, bars }).research.factors.find((f) => f.key === "reversal")?.results.find((r) => r.days === 5);
    expect(reversal?.verdict).toBe("predictive");
    expect(reversal?.ic ?? 0).toBeGreaterThan(0.1);
    expect(reversal?.signs).toEqual([1, 1]);
    expect(reversal?.holmP ?? 1).toBeLessThan(FACTORS.alpha);
  });

  it("finds 10-session bands near their nominal coverage on Gaussian walks, and the blend beats the 20-session estimate", () => {
    expect(risk.bands.overall.within1).toBeGreaterThan(0.64);
    expect(risk.bands.overall.within1).toBeLessThan(0.72);
    expect(risk.bands.overall.within2).toBeGreaterThan(0.92);
    expect(risk.bands.overall.within2).toBeLessThan(0.975);
    expect(risk.bands.subperiods.reduce((sum, p) => sum + p.n, 0)).toBe(risk.bands.overall.n);
    expect(risk.qlike.blend ?? Infinity).toBeLessThan(risk.qlike.shortWindowOnly ?? 0);
  });

  it("sees stable differences in volatility and beta persist", () => {
    expect(risk.persistence.volatility.mean ?? 0).toBeGreaterThan(0.8);
    expect(risk.persistence.beta.mean ?? 0).toBeGreaterThan(0.5);
  });

  it("sorts stock-months into near-equal volatility quintiles, the riskiest falling most often", () => {
    const rows = risk.quintiles.overall;
    expect(rows.map((row) => row.quintile)).toEqual([1, 2, 3, 4, 5]);
    // With 21 or 22 stocks on a date, each quintile holds 4 or 5 of them.
    const total = rows.reduce((sum, row) => sum + row.n, 0);
    for (const row of rows) {
      expect(row.n / total).toBeGreaterThanOrEqual(4 / 22);
      expect(row.n / total).toBeLessThanOrEqual(5 / 21);
    }
    expect(rows[4].drawdown ?? 0).toBeGreaterThan(rows[0].drawdown ?? 1);
    expect(rows[4].medianVolatility ?? 0).toBeGreaterThan(rows[0].medianVolatility ?? 1);
    expect([...risk.quintiles.breakpoints.median].sort((a, b) => a - b)).toEqual(risk.quintiles.breakpoints.median);
    expect(risk.quintiles.breakpoints.latest?.date).toBe("2019-02-28");
  });
});
