import { describe, expect, it } from "vitest";

import type { DailyBar } from "@/lib/bars";

import { mulberry32 } from "./research-stats";
import {
  drawdownWithin,
  forecastDailyVolatility,
  logReturns,
  ownVolatilityPercentile,
  priceRange,
  qlike,
  RISK_SETTINGS,
  riskSnapshot,
  shortWindowDailyVolatility,
} from "./risk-forecast";

const DAY_MS = 86_400_000;
const START = Date.UTC(2024, 0, 2);

function gaussians(n: number, seed: number): number[] {
  const random = mulberry32(seed);
  return Array.from({ length: n }, () => Math.sqrt(-2 * Math.log(Math.max(random(), 1e-12))) * Math.cos(2 * Math.PI * random()));
}

function closesFromLogReturns(returns: readonly number[], start = 100): number[] {
  const closes = [start];
  for (const r of returns) closes.push(closes[closes.length - 1] * Math.exp(r));
  return closes;
}

function bars(closes: readonly number[], offsetDays = 0): DailyBar[] {
  return closes.map((c, i) => ({ t: START + (i + offsetDays) * DAY_MS, o: c, h: c, l: c, c, adjClose: c, v: 1e6 }));
}

function sampleVariance(xs: readonly number[]): number {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
}

describe("logReturns", () => {
  it("returns NaN at the start and around invalid prices", () => {
    const r = logReturns([100, 110, 0, 121]);
    expect(Number.isNaN(r[0])).toBe(true);
    expect(r[1]).toBeCloseTo(Math.log(1.1), 12);
    expect(Number.isNaN(r[2]) && Number.isNaN(r[3])).toBe(true);
  });
});

describe("forecastDailyVolatility", () => {
  it("blends the 20- and 252-session variances equally", () => {
    const returns = [Number.NaN, ...gaussians(300, 1).map((z, k) => z * (k < 250 ? 0.01 : 0.03))];
    const i = returns.length - 1;
    const short = sampleVariance(returns.slice(i - 19, i + 1));
    const long = sampleVariance(returns.slice(i - 251, i + 1));
    expect(forecastDailyVolatility(returns)).toBeCloseTo(Math.sqrt(0.5 * short + 0.5 * long), 12);
    expect(shortWindowDailyVolatility(returns)).toBeCloseTo(Math.sqrt(short), 12);
    // The blend sits between the calm year and the turbulent month.
    const blend = forecastDailyVolatility(returns) ?? 0;
    expect(blend).toBeGreaterThan(Math.sqrt(long));
    expect(blend).toBeLessThan(Math.sqrt(short));
  });

  it("needs 252 returns", () => {
    const returns = [Number.NaN, ...gaussians(251, 2).map((z) => 0.01 * z)];
    expect(forecastDailyVolatility(returns)).toBeNull();
    expect(forecastDailyVolatility([Number.NaN, ...gaussians(252, 2).map((z) => 0.01 * z)])).not.toBeNull();
  });
});

describe("priceRange", () => {
  it("moves the price by k standard deviations over the horizon in log space", () => {
    const range = priceRange(100, 0.02, 10, 1);
    expect(range?.low).toBeCloseTo(100 * Math.exp(-0.02 * Math.sqrt(10)), 10);
    expect(range?.high).toBeCloseTo(100 * Math.exp(0.02 * Math.sqrt(10)), 10);
    const two = priceRange(100, 0.02, 10, 2);
    expect((two?.low ?? 0) * (two?.high ?? 0)).toBeCloseTo(100 * 100, 8);
    expect(priceRange(0, 0.02, 10, 1)).toBeNull();
    expect(priceRange(100, Number.NaN, 10, 1)).toBeNull();
  });

  it("covers about 68% and 95% of 10-session moves of a Gaussian random walk", () => {
    const daily = 0.015;
    const returns = gaussians(20_000, 3).map((z) => daily * z);
    let in1 = 0;
    let in2 = 0;
    let n = 0;
    for (let k = 0; k + 10 <= returns.length; k += 10) {
      const move = Math.abs(returns.slice(k, k + 10).reduce((a, b) => a + b, 0));
      const range = priceRange(1, daily, 10, 1) as { high: number };
      if (move <= Math.log(range.high)) in1 += 1;
      if (move <= 2 * Math.log(range.high)) in2 += 1;
      n += 1;
    }
    expect(in1 / n).toBeGreaterThan(0.64);
    expect(in1 / n).toBeLessThan(0.72);
    expect(in2 / n).toBeGreaterThan(0.93);
    expect(in2 / n).toBeLessThan(0.97);
  });
});

describe("ownVolatilityPercentile", () => {
  it("ranks a turbulent month high and a calm month low against the past year", () => {
    const year = gaussians(300, 4).map((z) => 0.015 * z);
    const storm = [Number.NaN, ...year, ...gaussians(20, 5).map((z) => 0.06 * z)];
    const calm = [Number.NaN, ...year, ...gaussians(20, 5).map((z) => 0.002 * z)];
    expect(ownVolatilityPercentile(storm)).toBeGreaterThan(95);
    expect(ownVolatilityPercentile(calm)).toBeLessThan(5);
  });

  it("needs a full year of 20-session values", () => {
    const returns = [Number.NaN, ...gaussians(270, 6).map((z) => 0.01 * z)];
    expect(ownVolatilityPercentile(returns)).toBeNull();
    expect(ownVolatilityPercentile([...returns, 0.01])).not.toBeNull();
  });
});

describe("qlike and drawdownWithin", () => {
  it("scores a perfect variance forecast 0 and penalizes misses", () => {
    expect(qlike(0.04, 0.04)).toBeCloseTo(0, 12);
    expect(qlike(0.04, 0.02)).toBeCloseTo(2 - Math.log(2) - 1, 12);
    expect(qlike(0.02, 0.04)).toBeGreaterThan(0);
    expect(qlike(0, 0.04)).toBeNull();
  });

  it("measures the worst decline from a running high after a session", () => {
    const closes = [100, 110, 99, 105, 88, 120];
    expect(drawdownWithin(closes, 0, 4)).toBeCloseTo(88 / 110 - 1, 12);
    expect(drawdownWithin(closes, 0, 1)).toBe(0);
    expect(drawdownWithin(closes, 3, 2)).toBeCloseTo(88 / 105 - 1, 12);
    expect(drawdownWithin(closes, 3, 3)).toBeNull();
  });
});

describe("riskSnapshot", () => {
  const market = closesFromLogReturns(gaussians(320, 7).map((z) => 0.01 * z));
  const marketReturns = logReturns(market);
  // A stock with twice the market's simple returns plus a little noise of its own.
  const noise = gaussians(320, 8);
  const stock = [100];
  for (let k = 1; k < market.length; k++) stock.push(stock[k - 1] * (1 + 2 * (market[k] / market[k - 1] - 1) + 0.001 * noise[k - 1]));

  it("fills every field from a long history", () => {
    const risk = riskSnapshot(bars(stock), bars(market));
    expect(risk.horizonDays).toBe(RISK_SETTINGS.horizonDays);
    expect(risk.price).toBeCloseTo(stock[stock.length - 1], 10);
    expect(risk.beta).toBeCloseTo(2, 1);
    expect(risk.forecastVolatility).toBeGreaterThan(0.25);
    expect(risk.forecastVolatility).toBeLessThan(0.4);
    // Unrounded forecast from the same returns: the report rounds volatilities to 4 decimals and prices to 6 digits.
    const daily = forecastDailyVolatility(logReturns(stock)) ?? 0;
    expect(risk.forecastVolatility).toBeCloseTo(daily * Math.sqrt(252), 4);
    const price = risk.price ?? 0;
    expect(Math.abs((risk.range1?.high ?? 0) / (price * Math.exp(daily * Math.sqrt(10))) - 1)).toBeLessThan(1e-5);
    expect(Math.abs((risk.range2?.low ?? 0) / (price * Math.exp(-2 * daily * Math.sqrt(10))) - 1)).toBeLessThan(1e-5);
    expect(risk.ownPercentile).toBeGreaterThanOrEqual(0);
    expect(risk.ownPercentile).toBeLessThanOrEqual(100);
    expect(risk.volatility63).toBeGreaterThan(0);
    expect(Number.isNaN(marketReturns[0])).toBe(true);
  });

  it("leaves beta null without a benchmark or matching sessions", () => {
    expect(riskSnapshot(bars(stock), null).beta).toBeNull();
    expect(riskSnapshot(bars(stock), bars(market, 1000)).beta).toBeNull();
  });

  it("returns nulls for a short history and survives unsorted, duplicated and broken bars", () => {
    const short = riskSnapshot(bars(stock.slice(0, 100)), bars(market));
    expect(short).toMatchObject({ forecastVolatility: null, range1: null, range2: null, ownPercentile: null, beta: null });
    expect(short.volatility63).not.toBeNull();
    const messy = [...bars(stock)].reverse();
    messy.push({ ...messy[0] }, { t: START - DAY_MS, o: 1, h: 1, l: 1, c: Number.NaN, adjClose: 1, v: null });
    expect(riskSnapshot(messy, bars(market))).toEqual(riskSnapshot(bars(stock), bars(market)));
    expect(riskSnapshot([], null)).toMatchObject({ forecastVolatility: null, price: null, volatility63: null });
  });
});
